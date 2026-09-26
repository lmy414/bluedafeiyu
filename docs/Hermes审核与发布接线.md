# Hermes 审核与发布接线

面向服务器维护者。把「网页 / GitHub Issue 投稿的视觉审核」和「批量发布」接到 Hermes 的
应用内定时任务上，替换掉现在由 systemd timer 触发的 `server/cli.mjs review-received`
与 `ops/publish-batch.mjs`。

Hermes 只做两件事：按点触发任务，以及调用视觉模型。条目的状态始终只在 `server/` 的私有队列里。

文里只写变量名，不写真实域名、IP、凭据或服务器绝对路径。目录与回滚约定以
[`投稿自动化部署.md`](投稿自动化部署.md)、[`../server/README.md`](../server/README.md)
和实际代码为准。

## 1. 谁做什么

| 层 | 角色 | 状态与数据 |
| --- | --- | --- |
| `server/` | 统一投稿队列与状态机 | 待审图、AI 原始结果、队列都在私有存储根，唯一真源 |
| `tools/intake/` | 维护者收录中转 | 只由维护者调用，不参与这条接线 |
| Hermes | 定时器 + 视觉模型调用者 | 只留一个锁文件，不存权威状态 |
| QQ 入站 | `server/` 自己处理 | 内部来源固定为 `web` 和 `github-issue`，QQ 不在其中 |

三条边界：

- Hermes 通过内部审核接口读队列、回写结论，绝不直接读写 `SUBMISSION_STORAGE_ROOT`；
- Hermes 不能替人做最终批准，`approved` / `rejected` 只走人工；
- 不存在第二套队列。不上 Redis、MySQL、SQLite，也不拿 Hermes 的任务数据当投稿状态。

## 2. 三件定时任务

| 任务 | 频率 | 动作 | 命令 |
| --- | --- | --- | --- |
| `review-cycle` | 每 5 分钟 | 查 `received`，读原图与字段，调视觉 AI，回写结论 | `node ops/hermes/cli.mjs review-cycle` |
| `pull-issues` | 每天 3 次 | 触发 `server/` 拉取 GitHub Issue 附件 | `node ops/hermes/cli.mjs pull-issues` |
| `publish` | 每 6 小时 | 触发 `ops/publish-batch.mjs --live` | `node ops/hermes/cli.mjs publish` |

```text
网页投稿 ─┐
          ├─▶ server/ 私有队列 ──GET received──▶ Hermes 调视觉 AI ──POST review-results──┐
GitHub Issue┘        ▲                                                                  │
                     └────────────────── 状态机迁移 + pass 自动桥接 ◀─────────────────────┘
                                                │ auto_passed
                                                ▼
                                  私有中转区 INTAKE_ROOT（ready）
                                                │ 每 6 小时
                                                ▼
                                   ops/publish-batch.mjs --live ──▶ 两个公开仓 ──▶ 部署
```

投稿入队**不再自动审核**（`server/http.mjs` 里已关闭自动触发），所以 `web` 与 `github-issue`
条目会停在 `received`，等 Hermes 来审。

## 3. Hermes 应用内定时任务

在 Hermes 里建三个定时任务，都是一次性命令，跑完即退。工作目录设成站点仓工作树。

| 任务 | cron | 超时 | 并发 |
| --- | --- | --- | --- |
| `review-cycle` | `*/5 * * * *` | 5 分钟 | 1 |
| `pull-issues` | `0 8,14,20 * * *` | 30 分钟 | 1 |
| `publish` | `0 0,6,12,18 * * *` | 60 分钟 | 1 |

- 时区设 `Asia/Shanghai`。容器里要显式设 `TZ`，否则 cron 按 UTC 走，6 小时窗口会错位；
- 并发必须为 1。脚本另有本地锁兜底，两个实例同时起也只会有一个真的跑；
- 失败重试由 Hermes 的计划任务重试策略和脚本内部退避共同负责，见第 6 节；
- 密钥统一在 Hermes 私有环境里注入，见第 7 节。不要把密钥写进任务提示词或命令行。

内部审核接口挂在**公开口**，管理口只用于 `pull-issues`。两个口都默认只绑回环，所以 Hermes
要么与 `server/` 同机，要么经 SSH 隧道访问：

```bash
ssh -N -L 8790:127.0.0.1:8790 user@server   # 内部审核口
ssh -N -L 8788:127.0.0.1:8788 user@server   # 管理口，仅 pull-issues 用
# Hermes 侧把 HERMES_REVIEW_API_URL / HERMES_ADMIN_API_URL 指向对应的本机地址
```

两个口都不要反代到公网。内部接口在公开处理器里、Origin 校验之前，靠独立令牌鉴权，不加防护地
暴露会直接放开写队列的能力。

## 4. HTTP 接口契约

接口实现在 `server/http.mjs` 的 `handleInternalRequest`、`authenticateInternalReview` 与
`applyInternalReviewBatch`。鉴权用内部令牌，reviewer 身份与令牌一一对应：
`SUBMISSION_HERMES_REVIEW_TOKEN` 对应 `hermes`，`SUBMISSION_ASTRABOT_REVIEW_TOKEN` 对应 `astrbot`。
两把都配时必须不同值，否则 server 拒绝启动。未配任何内部令牌时，内部接口返回 `503`。

### 4.1 待审列表与原图

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/internal/submissions?state=received&sources=web,github-issue&limit=50` | 待审列表 |
| `GET` | `/api/v1/internal/submissions/<id>` | 单条只读视图 |
| `GET` | `/api/v1/internal/submissions/<id>/raw` | 原图字节，`Content-Type` 取条目 `mime` |

- `state` 默认 `received`，必须是合法状态；`limit` 默认 50、上限 200；
- `sources` 默认 `web,github-issue`，QQ 天然被排除；
- 列表条目字段：`id`、`source`、`state`、`sha256`、`ext`、`mime`、`bytes`、`fields`、
  `createdAt`、`updatedAt`、`rawPath`，已审过的还带 `review`。没有存储路径与密钥。

### 4.2 回写审核结果

`POST /api/v1/internal/review-results`，`Content-Type: application/json`，Bearer 内部令牌。

请求体是批量信封：

```json
{
  "schema": "submission-review-results/1",
  "reviewer": "hermes",
  "promptVersion": "hermes-review-v1",
  "results": [
    {
      "submissionId": "sub_0123456789abcdef01234567",
      "verdict": "pass",
      "confidence": 0.88,
      "reason": "AI 娘二创梗图，画面合规",
      "model": "vision-model-name",
      "content": {
        "name": "不是……而是……大学习",
        "description": "表达被反驳后的无语",
        "commentary": "一看这表情我就知道又是没听进去。",
        "characterId": "deepseek",
        "categoryIds": ["meme"],
        "tags": ["无语", "反差"]
      }
    }
  ]
}
```

信封层规则：

- `reviewer` 必须与令牌身份一致，否则整批 `403`；
- `results` 最多 200 条，超出 `413`；`schema` 与 `promptVersion` 只作审计透传；
- 逐条独立处理，单条不合法不拖垮整批。

单条 `result` 规则：

- `submissionId` 必须匹配 `sub_` + 1–64 位字母、数字、下划线或连字符；
- `verdict` 只接受 `pass` / `reject` / `manual`；`confidence` 必须是 0–1 的 JSON number
  （`manual` 也要给，通常填 0）；`reason` 必填且不超过 1000 字；`model` 不超过 128 字；
- `pass` 必须带通过校验的 `content`，否则该条 `422` 且状态不变。校验复用
  `server/bridge.mjs` 的 `validateContent`：只认 `name` / `description` / `commentary` /
  `characterId` / `categoryIds` / `tags` 六个字段，角色与分类必须在 `data/` 枚举内，
  含 HTML、脚本或控制字符即拒绝；
- `reject` / `manual` 不需要 `content`，server 也不采纳它们的 `content`；
- 只处理 `state=received` 的条目。同一 reviewer 已审完的重复提交返回 `200` 加 `duplicate: true`，
  不改状态；别人已审或状态不符返回 `409`，绝不覆盖；
- `pass` 会走 `attachReview → review.pass → 自动桥接`，把条目写进私有中转区。否则每 6 小时的
  发布批次无事可做；
- `reject` / `manual` 只进人工审核区，不触发桥接。

响应体：

```json
{
  "ok": true,
  "schema": "submission-review-results/1",
  "reviewer": "hermes",
  "count": 1,
  "results": [
    { "id": "sub_0123456789abcdef01234567", "status": 200, "ok": true, "state": "auto_passed", "duplicate": false }
  ]
}
```

单条 `status` 是这条各自的结果码：`200` 应用或重复、`400` 字段非法、`404` 条目不存在、
`409` 状态冲突、`422` 的 `content` 校验不过、`500` 写入失败。

### 4.3 禁止调用的接口

- `POST /api/v1/items/<id>/decision` 与 `POST /api/v1/review`：管理口的人工 / 手动审核入口。
  Hermes 不得调用，不得替人做终态决定；
- `tools/intake/cli.mjs pull-issues` 与中转服务的 `POST /api/v1/pull-issues`：见第 9 节。

## 5. 幂等与锁

四层保护，从下到上：

1. **server 队列锁**：`state/queue.lock` 跨进程互斥，状态迁移只允许走 `TRANSITIONS` 表，
   同一 id 不会被并发迁移。内部接口只接受 `received`，重复提交按同一 reviewer 幂等返回；
2. **两种幂等键**：`sourceId` 唯一加 `sha256` 唯一，重复投稿只返回同一条；GitHub Issue 按
   `Issue number + attachment asset id` 去重，带 `since` 游标；
3. **回写幂等键**：Hermes 对每个批次算 `Idempotency-Key`（`(submissionId, verdict)` 排序后的摘要），
   网络抖动重发同一批时，服务端的重复判定仍以条目状态与 reviewer 为准；
4. **Hermes 本地锁**：`$HERMES_STATE_DIR/review-cycle.lock`，超过 `HERMES_LOCK_STALE_MS`（默认 15 分钟）
   自动回收。两个实例同时启动，第二个直接跳过。

并发只有 1 时这四层足够。要开多个 worker，需要 server 侧另加「认领」接口把 `received` 先置为
`reviewing`，本次没有实现，也不要在 Hermes 侧自己造一套认领。

发布另有 `INTAKE_ROOT/logs/publish.lock`，陈旧阈值 `PUBLISH_LOCK_STALE_MS`（默认 6 小时）。

## 6. 失败与重试

| 情况 | 处理 |
| --- | --- |
| 网络错误 / 5xx / 429 | 指数退避重试 3 次；仍失败则放弃本轮，条目保持 `received`，下轮再试 |
| 401 / 403 | 不重试，报错退出，检查令牌与 reviewer 身份 |
| 503 | 不重试，说明 server 没配内部审核令牌 |
| 回写 404 | 不重试，说明内部接口不存在，检查 server 版本 |
| 模型超时 / 报错 / 返回无法解析 | 该条转 `manual` 回写，不上报 `pass` |
| 单条 `result` 返回 409 / 422 | 记为失败，条目留给人工或下轮，绝不覆盖别人结论 |
| 单图下载失败 | 跳过该条，其余继续；失败条目下轮重试 |
| 审核进程被杀 | server 的 `recover` 把卡在 `reviewing` 超过 `SUBMISSION_REVIEW_RECOVER_MS` 的条目转人工；Hermes 本地锁按陈旧回收 |
| 发布失败 | `publish-batch.mjs` 保留条目为 `ready`，写失败批次日志，下轮从头重算 |

`review-cycle` 逐条隔离：一条坏图不影响同批其它条目。

## 7. 密钥与环境变量

全部放 Hermes 的私有环境，模板见 [`../ops/hermes/hermes.env.example`](../ops/hermes/hermes.env.example)，
复制成 Hermes 私有的环境文件，权限 0600，不进仓库。

| 变量 | 说明 |
| --- | --- |
| `HERMES_REVIEW_API_URL` | 内部审核口，默认 `http://127.0.0.1:8790` |
| `HERMES_REVIEW_TOKEN` | Hermes 专属令牌，对应 server 的 `SUBMISSION_HERMES_REVIEW_TOKEN` |
| `HERMES_REVIEW_SOURCES` | 待审来源，默认 `web,github-issue` |
| `HERMES_ADMIN_API_URL` / `HERMES_ADMIN_TOKEN` | 管理口与 `SUBMISSION_ADMIN_TOKEN`，仅 `pull-issues` 用 |
| `HERMES_VISION_ENDPOINT` / `HERMES_VISION_API_KEY` | OpenAI 兼容 vision 接口；缺任一，`review-cycle --live` 直接报错 |
| `HERMES_VISION_MODEL` | 传给模型的 `model` 字段 |
| `HERMES_REVIEW_MIN_CONFIDENCE` | 置信度门槛，默认 `0.6`，与 `PUBLISH_MIN_CONFIDENCE` 保持一致 |
| `HERMES_REVIEW_PROMPT_VERSION` | 提示词版本标记，随批次透传给 server |
| `HERMES_STATE_DIR` | 本地锁存放目录，不放权威状态 |
| `HERMES_REVIEW_LIVE` / `HERMES_PULL_LIVE` / `HERMES_PUBLISH_LIVE` | 三个真实动作开关，默认 `false` |
| `HERMES_PULL_SSH` / `HERMES_PULL_CMD` | 需要分页或 `since` 游标时，改用 SSH 跑 CLI |
| `HERMES_PUBLISH_SSH` / `HERMES_PUBLISH_CMD` / `HERMES_PUBLISH_DRY_CMD` | 发布命令与演练命令 |
| `HERMES_SERVER_DIR` | SSH 执行前 `cd` 的站点仓工作树 |

server 侧要配的：`SUBMISSION_HERMES_REVIEW_TOKEN`（与 `HERMES_REVIEW_TOKEN` 同值）、
`SUBMISSION_ADMIN_TOKEN`（与 `HERMES_ADMIN_TOKEN` 同值）。令牌只在内网传递，不进任何公开响应。

服务器侧另有 `ops/publish-batch.env.example` 对应的一套开关（`AUTO_PUBLISH_ENABLED`、
`PUBLISH_PUSH_ENABLED`、`PUBLISH_DEPLOY_ENABLED`），留在服务器自己的环境文件里，与 Hermes 环境分开。

## 8. 脚本与用法

`ops/hermes/` 只有无密钥的脚本、提示词和环境变量示例：

| 文件 | 作用 |
| --- | --- |
| `cli.mjs` | 三个任务的入口，复用 `server/review.mjs` 的客户端与校验 |
| `prompt-review.md` | 视觉审核提示词；Hermes 原生视觉步骤用，与 `server/review.mjs` 保持一致 |
| `hermes.env.example` | 环境变量模板，无真实密钥 |
| `tests/hermes.test.mjs` | 离线回归与静态校验 |

```bash
node ops/hermes/cli.mjs doctor                 # 只读：地址、令牌、模型、待审列表
node ops/hermes/cli.mjs doctor --probe         # 再探一次回写接口
node ops/hermes/cli.mjs review-cycle           # 默认 dry-run：只列待审，不调模型
node ops/hermes/cli.mjs review-cycle --live             # 需 HERMES_REVIEW_LIVE=true
node ops/hermes/cli.mjs review-cycle --live --include-needs-manual
node ops/hermes/cli.mjs post-results --file ./results.json --live   # Hermes 原生视觉步骤回写
node ops/hermes/cli.mjs pull-issues --live     # 需 HERMES_PULL_LIVE=true
node ops/hermes/cli.mjs publish --live --limit 5    # 需 HERMES_PUBLISH_LIVE=true
```

默认是 dry-run：只读列表与原图，不发模型请求、不写队列、不触发发布。真实动作要同时满足
命令行 `--live` 和对应环境开关，缺一个就报错退出。

`post-results` 给 Hermes 应用内原生视觉步骤用：把逐条结果写成 JSON（顶层数组，或
`{ results: [...] }`），脚本按第 4.2 节的单条规则校验后再批量回写。QQ 条目始终跳过；
已在 `needs_manual` 且 `review.decidedBy` 为 `hermes` 的条目也不重审，留给人工。

### 8.1 用 server 侧内建审核还是 Hermes

两种模式二选一，别同时开：

- **Hermes 模式**（本文）：`server/` 不配 `SUBMISSION_AI_ENDPOINT`，由 Hermes 通过内部接口回写；
- **内建模式**：由 `server/cli.mjs review` / 管理口 `POST /api/v1/review` 在服务进程内调模型，
  Hermes 只做发布与拉取。

## 9. 禁止事项

- **不要跑 `tools/intake/cli.mjs pull-issues`**，也不要调中转服务的 `POST /api/v1/pull-issues`。
  Issue 入站只能走 `server/cli.mjs pull-issues` 或管理口 `POST /api/v1/pull-issues`。
  中转侧那条路会绕过统一队列与 AI 初审，另起一条入站通道，字段口径和幂等键都不一样；
- **不要建第二套队列**。不引入 Redis / MySQL / SQLite，不把 Hermes 的任务数据当投稿状态，
  不在 Hermes 里另存一份 `id` / 状态映射；
- 不要让 Hermes 调用人工决定接口，也不要让模型生成 `approved` / `published`；
- 不要改 `data/works.json`、内容仓或中转区；发布只走 `ops/publish-batch.mjs`；
- 不要同时开 systemd timer 和 Hermes 定时任务，避免重复审、重复发布。

## 10. 切换与回滚

Hermes 接管后，关掉对应的 systemd timer，保留投稿服务本体：

```bash
sudo systemctl disable --now dafeiyu-review.timer        # 由 review-cycle 接替
sudo systemctl disable --now dafeiyu-pull-issues.timer   # 由 pull-issues 接替
sudo systemctl disable --now dafeiyu-publish.timer       # 由 publish 接替
sudo systemctl status dafeiyu-submission.service         # 这个要留着
```

回滚就把三个 timer 重新 `enable --now`，并把 Hermes 的对应任务停掉。

## 11. 自测

```bash
node --test ops/hermes/tests/hermes.test.mjs   # 或 npm run test:hermes
```

测试全程离线，注入假 fetch / 假 exec：覆盖默认 dry-run、双钥匙开关、`submission-ai-content/1`
校验与降级、回写批量信封与 403 不重试、本地锁互斥与回收、QQ 与已审条目跳过，以及提示词与
`server/review.mjs` 不漂移、环境变量示例不含真实密钥。
