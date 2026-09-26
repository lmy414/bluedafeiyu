# 投稿收录中转（站点仓 · tools/intake/）

> 2026-09-26 从内容仓 `tools/intake/` 迁到站点仓。原内容仓的 `tools/intake/` 已删除；
> 命令与配置变量名不变，但**清单改读站点仓 `data/`**、**`contentDir` 必须显式指定**。

这组脚本是**内容 / 运维侧的中转服务**，不是前端功能，也不是公开投稿入口。
公开投稿与 AI 初审走站点仓的 `server/`（见 [`../../server/README.md`](../../server/README.md)）。

它解决的是：

```text
本地图片 / GitHub Issue 附件 / server/ 审核通过的图
（投稿者只填图片、名称、角色、可选说明）
          ↓
服务器外部中转区（不进 git，不进 dist，不进发布产物）
          ↓ 维护者看图、补字段、跑派生图、写入清单
提交内容仓 main → 服务器 fetch/reset → 回源 sha256 校验
          ↓
确认 main 上的原图与中转副本一致后，才允许清理中转副本
```

`main` 仍然是唯一公开内容真源。中转区不是作品数据库，站点不能直接读它。

## 与 `server/` 的分工

| | `server/`（进站入口） | `tools/intake/`（收录中转） |
| --- | --- | --- |
| 干什么 | 网页 / QQ / Issue 统一进 AI 审核队列 | 收录前的中转、查重、回源校验、清理 |
| 数据 | 私有队列（待审图、AI 结果） | 私有中转区（staged 原图 + 元数据） |
| 对外 | 公开投稿入口 + 管理接口 | 仅本地 CLI + 回环管理 API |
| 谁调用 | 网页、QQ 机器人、维护者 | 维护者 |

`server/adapters/github.mjs` 复用本目录 `core.mjs` 里同一套 Issue 解析函数，两处字段口径一致。

## 清单来源与内容仓

- **权威清单读站点仓 `data/`**：`data/characters.json`、`data/works.json`、
  `data/owner-picks.json`。`published` 判重、角色校验都用它。
- **`contentDir` 只用于原图校验**：按 `${INTAKE_REF}`（默认 `origin/main`）读 git blob
  重算 sha256。它必须是内容仓根目录，且**没有默认值**，用
  `INTAKE_CONTENT_DIR` 或 `--content-dir` 显式给。
- 默认来源仓库仍是 `lmy414/ai-girl-stickers`（`INTAKE_GITHUB_REPO` 可覆盖）。

## 目录与安全边界

默认中转根目录是**内容仓库同级目录**：

```text
/srv/www/dafeiyu/content        # INTAKE_CONTENT_DIR，内容仓 git 工作树
/srv/www/dafeiyu/dafeiyu-intake # INTAKE_ROOT，服务私有中转区
```

也可以用 `INTAKE_ROOT` 显式指定，但它必须在**站点仓和内容仓之外**，且不能落在任何
git 工作树内。任一条不满足脚本直接拒绝启动，这样 `git reset --hard` 和误提交都碰不到中转区。
中转区里有：

```text
inbox/   <sha256>.<ext>         原图字节
meta/    <sha256>.json          投稿字段、来源、状态、目标路径
logs/    intake.log             追加式操作记录
```

硬性规则：

- 不写 `dist/`、`blue-fish-originals/` 或任何 git 工作树；
- 原图按 SHA-256 命名，不使用投稿者文件名作为磁盘路径；
- 接收时做大小限制、文件头格式识别和扩展名一致性检查；
- `targetPath` 只能指向 `dist/submissions/originals/`、`owner-picks/` 或
  `blue-fish-originals/`，不能是绝对路径，也不能穿越 `..`；
- 管理 API 默认只监听 `127.0.0.1`，必须有 Bearer 令牌；不要用 Nginx 反代到公网；
- `prune` 默认是报告模式，只有明确加 `--apply` 才删；
- 自动清理只看 `${INTAKE_REF}`：按站点已发布清单的 `sha256` 找到路径，再从内容仓 git blob
  读取并重新计算 SHA-256。路径不存在、清单不一致或无法确认时一律保留。

## 本地 CLI

从站点仓根目录执行：

```bash
export INTAKE_CONTENT_DIR=/path/to/ai-girl-stickers   # 必填，仅用于原图回源校验

# 维护者本地上传。默认进入内容仓同级的 ../dafeiyu-intake
node tools/intake/cli.mjs add ./图片.png \
  --name "不是……而是……大学习" \
  --character deepseek \
  --description "用于表达质疑或无语"

# 指定未来要收录的原图路径（只记元数据，不会写这个路径）
node tools/intake/cli.mjs add ./图片.png \
  --target dist/submissions/originals/deepseek/my-image.png

# 通过 SSH 隧道把本地图片直接传到服务器中转区
INTAKE_API_URL=http://127.0.0.1:8787 \
INTAKE_API_TOKEN="$INTAKE_API_TOKEN" \
node tools/intake/cli.mjs upload ./图片.png \
  --name "作品名" --character deepseek --description "可选说明"

# 查看中转记录
node tools/intake/cli.mjs list
node tools/intake/cli.mjs list --status staged --json
node tools/intake/cli.mjs show <sha256>
node tools/intake/cli.mjs export <sha256> --out ./review
```

如果图片的 SHA-256 已经在站点仓 `data/works.json` 或 `data/owner-picks.json` 里，
`add` 会返回 `published`，不会再制造中转副本。

## GitHub Issue 附件

需要内容仓有 `origin/main`：

```bash
git -C "$INTAKE_CONTENT_DIR" fetch --prune origin

INTAKE_CONTENT_DIR="$INTAKE_CONTENT_DIR" \
INTAKE_ROOT=/srv/www/dafeiyu/dafeiyu-intake \
INTAKE_GITHUB_TOKEN="$GITHUB_READ_TOKEN" \
node tools/intake/cli.mjs pull-issues

node tools/intake/cli.mjs pull-issues --issue 123
```

支持 `INTAKE_GITHUB_TOKEN` / `GITHUB_TOKEN`。生产环境不要把令牌写进命令历史，
建议用 systemd `EnvironmentFile` 或权限受限的凭据文件注入。**令牌只需能读取 Issue，
不要给写仓库权限。** Issue 的幂等键是 `Issue number + attachment asset id`。

## 人工收录顺序

中转服务不会自动把未审核图片写进仓库。维护者仍按既有流程人工收录：

1. `list` / `export` 后逐张看图（`server/` 里 AI 初审通过后同样要人工看图）；
2. 按 `sha256` 查重，决定是 `submissions` 还是 `owner-picks`；
3. 原图复制到目标目录，补至少一个 Tag、分类、来源、授权和 `commentary` 等清单字段；
4. 跑 `prepare_works.mjs`、`generate_image_derivatives.py` 和契约校验；
5. 确认公开记录达到展示门槛后，提交并推送 `main`；
6. 服务器拉取最新内容仓；
7. 回源验证，再清理已确认进入 `main` 的中转副本。

```bash
node tools/intake/cli.mjs verify         # 只读报告
node tools/intake/cli.mjs prune --apply  # 确认后再删
node tools/intake/cli.mjs drop <sha256> --reason "重复投稿"
```

## 管理 API

站长自用的内部 API 包装，不是给访客的公共 API。启动前必须设令牌，默认只监听回环：

```bash
export INTAKE_API_TOKEN="$(openssl rand -hex 32)"
export INTAKE_CONTENT_DIR=/srv/www/dafeiyu/content
export INTAKE_ROOT=/srv/www/dafeiyu/dafeiyu-intake
node tools/intake/http.mjs
```

从本机经 SSH 隧道访问：

```bash
ssh -N -L 8787:127.0.0.1:8787 user@server
curl -H "Authorization: Bearer $INTAKE_API_TOKEN" http://127.0.0.1:8787/api/v1/items
```

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/health` | 服务和清单来源摘要 |
| `GET` | `/api/v1/items?status=staged` | 列出中转记录 |
| `GET` | `/api/v1/items/<sha256>` | 读取一条元数据 |
| `GET` | `/api/v1/items/<sha256>/raw` | 以附件方式下载中转原图 |
| `PUT` | `/api/v1/items?filename=x.png&name=...&character=...&tags=a,b` | 以裸字节上传一张图 |
| `POST` | `/api/v1/pull-issues` | 拉取 Issue 附件；JSON 可传 `{"issue":123}` |
| `GET` | `/api/v1/verify` | 回源校验可清理记录 |
| `POST` | `/api/v1/prune` | JSON `{"apply":false}`；`true` 才删除 |
| `POST` | `/api/v1/drop` | JSON `{"sha256":"...","reason":"..."}` |

`PUT` 只接受 `INTAKE_MAX_BYTES`（默认 16 MiB）以内的 PNG/JPEG/GIF/WebP 字节。
API 永远只监听回环地址，不能通过 `INTAKE_API_HOST` 改成公网地址。

## 自测

```bash
INTAKE_CONTENT_DIR=/path/to/ai-girl-stickers node tools/intake/selftest.mjs
```

重点验证：清理只删已确实进 `main` 的记录、存储根不落任一公开仓、最小 Issue 字段兼容、
格式与大小校验、幂等。中转区落在系统临时目录，不碰仓库工作树。

## 配置变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `INTAKE_CONTENT_DIR` | 无（必填） | 内容仓库根目录，仅用于读原文 git blob 校验 |
| `INTAKE_ROOT` | 内容仓同级 `dafeiyu-intake` | 私有中转根目录，须在两仓之外 |
| `INTAKE_GITHUB_REPO` | `lmy414/ai-girl-stickers` | Issue 来源仓库 |
| `INTAKE_GITHUB_TOKEN` | 空 | GitHub 只读令牌；空值回退 `GITHUB_TOKEN`，再空则用匿名 API |
| `INTAKE_GITHUB_API` | `https://api.github.com` | GitHub API 基址（测试 / 企业版可覆盖） |
| `INTAKE_REF` | `origin/main` | 回源校验基准；不要指向未推送工作树 |
| `INTAKE_MAX_BYTES` | `16777216` | 单图大小上限 |
| `INTAKE_HTTP_TIMEOUT_MS` | `15000` | 单个 HTTP 请求（Issue / 附件下载）超时 |
| `INTAKE_MAX_REDIRECTS` | `3` | 附件下载允许的重定向次数 |
| `INTAKE_API_TOKEN` | 无 | 管理 API 必填 Bearer 令牌 |
| `INTAKE_API_HOST` | `127.0.0.1` | 只允许回环监听 |
| `INTAKE_API_PORT` | `8787` | 管理 API 端口 |
| `INTAKE_SITE_DATA_DIR` | 站点仓 `data/` | 权威清单目录（角色 / 作品 / 站长自用） |

生产环境还要给中转目录做磁盘配额和备份；这部分属于服务器运维配置，不写进公开仓库。
