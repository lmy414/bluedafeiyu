# 统一投稿服务（server/）

网页公开投稿、QQ 群入站、GitHub 内容仓 Issue 附件，三种来源统一进一条 **AI 审核队列**，
审核只做建议，**最终发布仍由维护者人工决定**。后端放在站点仓（本仓库）里，不另建第三仓。

> 状态：这是**本地可运行、可测试**的实现（`node --test "server/**/*.test.mjs"` 当前全绿）。
> 线上**尚未开通**，也**没有配置任何真实服务密钥**；未配置的服务一律「关闭/明确未配置」，
> 不会假造审核结论。

## 私有数据边界（最重要）

以下内容**只允许留在内地服务器的私有存储根**，绝不进任何公开仓、不进发布产物：

- 待审图片字节；
- AI 原始返回结果；
- 队列数据库（本实现是磁盘 JSON，不是外部数据库）；
- 密钥（只走环境变量注入）；
- 日志。

`SUBMISSION_STORAGE_ROOT` 必须显式配置，没有默认值。配置期会拒绝以下位置：

- 落在站点仓（`bluedafeiyu`）内；
- 落在内容仓（`ai-girl-stickers`，若提供 `SUBMISSION_CONTENT_DIR`）内；
- 落在任何 git 工作树内（向上查找 `.git` 即判定）。

目录会被建成 `0700`，文件 `0600`：

```text
$SUBMISSION_STORAGE_ROOT/
  objects/<sha256><ext>   待审原图
  items/<id>.json         条目元数据、状态历史
  index/source.json       sourceId -> id（幂等）
  index/sha256.json       sha256   -> id（去重）
  ai/<id>.json            AI 原始结果（仅管理端可见）
  logs/queue.log          操作日志（不含密钥、不含图片正文）
  state/queue.lock        跨进程写锁
```

**本仓库不引入数据库依赖，也不需要 `npm install`**：队列是 Node 标准库的磁盘实现
（临时文件 + fsync + rename 原子写，`wx` 锁文件 + 进程内串行）。如果将来确实要换成
SQLite/Postgres，需要单独说明新增依赖与迁移方案——本次没有引入。

## 配置变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SUBMISSION_STORAGE_ROOT` | 是 | 私有存储根；不得在任何公开仓 / git 工作树内 |
| `SUBMISSION_ADMIN_TOKEN` | 启动管理口时必填 | 管理接口 Bearer 令牌；不配则拒绝启动 |
| `SUBMISSION_ALLOWED_ORIGINS` | 建议 | 逗号分隔的公开入口 Origin 白名单；不允许 `*` |
| `SUBMISSION_PUBLIC_HOST` / `SUBMISSION_PUBLIC_PORT` | 否 | 公开入口监听，默认 `127.0.0.1:8790` |
| `SUBMISSION_ADMIN_HOST` / `SUBMISSION_ADMIN_PORT` | 否 | 管理入口监听，默认 `127.0.0.1:8788`；只允许回环 |
| `SUBMISSION_TRUSTED_PROXY_CIDRS` | 否 | 可信反向代理网段（如 `127.0.0.1/32,10.0.0.0/8`）。只有 TCP 对端确实落在网段内才解析 `X-Forwarded-For` / `X-Real-IP`，否则一律用 socket 对端地址，防止伪造 XFF 绕过限流 |
| `SUBMISSION_MAX_BYTES` | 否 | 单图大小上限，默认 16 MiB |
| `SUBMISSION_MAX_JSON_BYTES` | 否 | JSON 投稿与管理端请求体上限，默认 24 MiB |
| `SUBMISSION_CHARACTER_MAX_LENGTH` | 否 | 角色字段长度上限，默认 64 |
| `SUBMISSION_RATE_MAX` / `SUBMISSION_RATE_WINDOW_MS` | 否 | 公开入口限流，默认 10 次 / 60 秒 / IP |
| `SUBMISSION_RATE_MAX_KEYS` | 否 | 限流器内存里保留的客户端键上限，默认 5000（防 IPv6 轮换把内存撑爆） |
| `SUBMISSION_TURNSTILE_SECRET` | 否 | 配了才校验 Turnstile（siteverify）；不配则跳过（公开入口本身仍有限流） |
| `SUBMISSION_TURNSTILE_TIMEOUT_MS` | 否 | siteverify 请求超时，默认 5000 ms；超时 / 异常一律 fail-closed |
| `SUBMISSION_AI_ENDPOINT` / `SUBMISSION_AI_API_KEY` / `SUBMISSION_AI_MODEL` | 否 | OpenAI 兼容 vision 审核服务；不配则审核一律转人工 |
| `SUBMISSION_AI_TIMEOUT_MS` / `SUBMISSION_AI_MIN_CONFIDENCE` | 否 | 审核超时与置信度阈值，默认 60s / 0.6 |
| `SUBMISSION_AI_PROMPT_VERSION` | 否 | 审核提示词版本标记（只落私有记录，便于回溯），默认 `v1` |
| `SUBMISSION_GITHUB_REPO` | 否 | 默认 `lmy414/ai-girl-stickers` |
| `SUBMISSION_GITHUB_LABEL` | 否 | 默认 `sticker-submission` |
| `SUBMISSION_GITHUB_TOKEN` | 否 | 只读令牌（最小权限）；仅发给 api.github.com，附件请求不带 |
| `SUBMISSION_GITHUB_API` | 否 | GitHub API 基址，默认 `https://api.github.com`（测试 / 企业版可覆盖） |
| `SUBMISSION_GITHUB_TIMEOUT_MS` | 否 | GitHub API 与附件下载超时，默认 20s |
| `SUBMISSION_GITHUB_MAX_REDIRECTS` | 否 | 附件下载允许的重定向次数，默认 3 |
| `SUBMISSION_QQ_ENABLED` | 否 | 必须显式为 `true` 才开启 QQ 入站 |
| `SUBMISSION_QQ_INBOUND_TOKEN` | 开启时必填 | QQ 机器人侧推入时携带的 Bearer 令牌 |
| `SUBMISSION_QQ_GROUP_ALLOWLIST` | 开启时必填 | 逗号分隔的群号白名单 |
| `SUBMISSION_QQ_IMAGE_HOST_ALLOWLIST` | 否 | 图片 URL 域名白名单；不配则只接受 base64 图片 |
| `SUBMISSION_QQ_TIMEOUT_MS` | 否 | QQ 入站处理（含图片下载）超时，默认 20s |
| `SUBMISSION_REVIEW_RECOVER_MS` | 否 | 重启后把卡在 `reviewing` 的条目转人工的等待时长，默认 5 分钟 |
| `SUBMISSION_CONTENT_DIR` | 否 | 内容仓路径。**只用于配置期校验**：拒绝把 `SUBMISSION_STORAGE_ROOT` 落在内容仓内。服务不读、不写、不校验内容仓的任何文件 |

## 运行

```bash
# 1) 先自检：不发网络请求，只校验配置与存储根
SUBMISSION_STORAGE_ROOT=/srv/www/dafeiyu/submission-private \
SUBMISSION_ADMIN_TOKEN="$(openssl rand -hex 32)" \
SUBMISSION_ALLOWED_ORIGINS=https://xn--pssy23gqgbz2d718b.com \
node server/cli.mjs doctor

# 2) 启动公开入口 + 管理接口
node server/cli.mjs serve

# 3) 本地把一张图放进队列 / 查看 / 跑审核 / 人工决定
node server/cli.mjs enqueue ./test.png --name "作品名" --character deepseek
node server/cli.mjs list
node server/cli.mjs review --all
node server/cli.mjs approve sub_xxxx --reason "看图确认"
```

测试（Node 内置 `node:test`，全部注入假 fetch，不外呼，测试根在系统临时目录）：

```bash
node --test "server/**/*.test.mjs"
```

## 三种来源

| 来源 | 入口 | 鉴权与边界 |
| --- | --- | --- |
| 网页公开投稿 | `POST /api/v1/submissions` | 匿名；严格 Origin/CORS、限流、大小/魔数/字段校验；响应只回 `{ok,id,status}` |
| QQ 群入站 | `POST /api/v1/adapters/qq/events` | 必须开启且配令牌 + 群白名单；**不连接任何未配置机器人**（纯被动入站） |
| GitHub Issue 附件 | `node server/cli.mjs pull-issues` 或管理端 `POST /api/v1/pull-issues` | 只拉 `sticker-submission` 标签；附件域名白名单、限制跳转/大小/超时；token 最小权限 |

公开投稿支持 `multipart/form-data`（表单上传一张图）或 `application/json`
（`{ name, character, description, filename, dataBase64 }`）。

## 状态机与人工边界

```text
received ──review.start──▶ reviewing ──review.pass──▶ auto_passed ──human.approve──▶ approved
                                    ├─review.reject─▶ auto_rejected ─human.approve/reject─┤
                                    └─review.manual▶ needs_manual ─human.approve/reject──┤
                                                                        human.reject──▶ rejected
```

- **没有 `published` 状态**，服务不会把图片写进内容仓、不会推送、不会发布；
- AI 未配置 / 超时 / 报错 / 返回解析不了 / 置信度低于阈值 —— 一律 `needs_manual`，绝不通过；
- 即使 AI 判 `pass`，也只到 `auto_passed`，仍需人 `approve`；
- 重启时卡在 `reviewing` 的条目按超时转人工（`server/cli.mjs recover`）。

## 管理接口

管理口只绑回环、必须 Bearer `SUBMISSION_ADMIN_TOKEN`，建议走 SSH 隧道访问：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/health` `/api/v1/stats` | 脱敏摘要与计数 |
| `GET` | `/api/v1/items?state=&source=&limit=` | 列表 |
| `GET` | `/api/v1/items/<id>` | 条目详情 |
| `GET` | `/api/v1/items/<id>/raw` | 原图（附件下载、`nosniff`） |
| `GET`/`POST` | `/api/v1/items/<id>/review` | 读取原始 AI 结果 / 触发一次审核 |
| `POST` | `/api/v1/items/<id>/decision` | `{decision:"approved"|"rejected","reason":...}` |
| `POST` | `/api/v1/review` | 批量审核 `{ids:[...]}` 或待审队列 |
| `POST` | `/api/v1/pull-issues` | 拉取 Issue 附件 |
| `POST` | `/api/v1/recover` | 恢复卡住的审核 |

## 已实现 vs 待真实服务配置

**已实现并本地验收**：配置与私有根检查、持久队列与状态机、幂等去重、原子写与恢复、
网页 multipart/JSON 上传与限流/CORS/字段校验、可信代理下的客户端 IP 解析、管理端鉴权与读取、
GitHub 标签过滤与附件域名白名单/限额、QQ 被动入站与令牌/群白名单、
**Turnstile siteverify 校验器（fail-closed）**、AI 审核失败关闭与人工决定、CLI。

**待服务器侧配置后才能真实使用（当前未配置，处于关闭/未配置状态）**：

- AI 审核：需要 `SUBMISSION_AI_ENDPOINT` + `SUBMISSION_AI_API_KEY`（现在审核一律转人工）；
- QQ 入站：需要在 AstrBot 侧把群图片推到本入口，并配 `SUBMISSION_QQ_INBOUND_TOKEN` + 群白名单；
- GitHub Issue：匿名可读公开 Issue，但建议配只读 `SUBMISSION_GITHUB_TOKEN` 以放宽配额；
- Turnstile：**校验器已在当前代码实现**（`server/http.mjs` 的 `createTurnstileVerifier` 走
  Cloudflare siteverify，超时或异常一律拒绝），配 `SUBMISSION_TURNSTILE_SECRET` 即启用；
  但当前没有配任何 secret、前端也还没回传 token，所以线上并未实际启用。

**本次未做**：未部署、未开公网、未接入任何真实密钥、未替维护者自动推送或发布图片。

## 与 `tools/intake/` 的分工

- `tools/intake/`：维护者**收录中转**（原内容仓的 intake 已迁到这里）。收录后按
  `sha256` 回源校验、清理、查重；它读站点仓 `data/{characters,works,owner-picks}.json`
  作为权威清单，`contentDir` 仅用于原图 git blob 校验。
- `server/`：面向**投稿入站与 AI 初审**的统一队列。审核通过（`approved`）后，
  仍由维护者按既有流程人工收录到内容仓，再走 `tools/intake/` 的校验与清理。

`server/adapters/github.mjs` 复用 `tools/intake/core.mjs` 的 Issue 解析函数，
保证两处的字段口径一致。
