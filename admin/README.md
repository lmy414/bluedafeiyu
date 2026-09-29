# Payload 后台（蓝色大肥鱼）

这里是“蓝色大肥鱼”的独立后台。公开站仍是 Astro 静态站，后台只负责管理 Payload 数据、镜像投稿队列、导出发布快照和接收发布请求；后台不直接替换线上 `current`。

## 环境变量

- `DATABASE_URL`：SQLite 文件 URL，生产示例 `file:/srv/apps/dafeiyu-admin/data/admin.db`。
- `PAYLOAD_SECRET`：Payload 加密密钥，必须独立配置。
- `PAYLOAD_PUBLIC_SERVER_URL`：后台对外地址对应的站点 origin。
- `MEDIA_DIR`：后台素材目录，生产示例 `/srv/apps/dafeiyu-admin/media`。
- `CONTENT_REPO_DIR`：内容仓绝对路径，默认取 `..\AI娘表情包`。
- `SUBMISSION_ADMIN_API_URL`：投稿服务管理口，默认 `http://127.0.0.1:8788`。
- `SUBMISSION_ADMIN_TOKEN`：投稿服务管理口 Bearer token。
- `ADMIN_WORKER_TOKEN`：发布执行器调用后台快照/素材/回写接口的独立 token；未配置时相关接口返回 503。
- `ADMIN_PUBLISH_REQUEST_DIR`：发布请求文件目录，默认 `admin/run`。

SQLite 在非生产环境允许 Payload dev push；生产环境不会依赖 dev push，启动前先执行迁移：

```powershell
cd admin
npm run payload -- migrate
```

本地开发：

```powershell
npm install
npm run dev
```

后台固定在 `/admin`，管理 API 固定在 `/cms-api`。首个后台账号默认角色为 `owner`；机器人账号由脚本创建，角色为 `bot`。

## 导入历史数据

导入脚本读取站点仓 `data/`，只从内容仓导入预览图：投稿/站长自用取 `thumbnailPath` 指向的 webp，首批档案取 `dist/data/blue-fish/previews`。原图和大图不会写入后台。媒体文件按 `sha256` 复用，作品按 `workId`，专题按 `topicId` 幂等更新。

```powershell
cd admin
npm run import:legacy -- --dry-run
npm run import:legacy
npm run import:legacy -- --previews-only
npm run import:legacy -- --content-dir="D:\path\to\AI娘表情包"
```

参数：`--dry-run`、`--previews-only`（保留兼容，只导入预览现在已是默认且唯一行为）、`--no-media`、`--skip-blue-fish`、`--skip-submissions`、`--no-update`、`--limit=N`。

导入后，已上线作品为 `published` 且 `needsPublish=false`。首批档案只有通过名字/标签/角色门槛且有冻结 id 的记录才进入 `works`；完整编辑叠加层原文保存在 `legacy-snapshots`，用于恢复 `data/blue-fish-editorial.json`。

## 导出与 round-trip

```powershell
# 写入站点仓 data/；--out 指向站点仓根目录
npm run export:data -- --out E:\quick-site-studio\bluedafeiyu

# 只比较，不写文件
npm run export:data -- --check --out E:\quick-site-studio\bluedafeiyu

# 与当前 git HEAD 的 data/ 逐字节比较
npm run export:data -- --against-head --out E:\quick-site-studio\bluedafeiyu

# 用发布快照逻辑比较（pending 作品视为 published）
npm run export:data -- --snapshot --against-head --out E:\quick-site-studio\bluedafeiyu

# 临时 SQLite 库完整导入后，六文件对比 HEAD
npm run roundtrip:check
```

导出保持字段顺序、两空格缩进、原文件换行风格和末尾换行；`data/topics.json` 为 LF，其余当前为 CRLF。`blue-fish-classification.json` 与 `blue-fish-ids.json` 不由后台改写。

## 投稿同步

投稿队列真源仍在投稿服务；后台只做镜像和自动收录。

```powershell
npm run sync:submissions -- --dry-run --limit=50
npm run sync:submissions -- --state=auto_passed --source=web
```

同步会按 `submissionId` 从 `/raw` 读取原图字节，但只在内存中用 sharp 生成 480px、quality 76 的 webp 预览后上传为 `media.mediaRole=preview`；原图字节不落盘、不入 media。同步还会从原图校验/写入 `sha256`、`format`、`mimeType`、`width`、`height`、`fileSize`。`auto_passed` 且 `review.content` 通过 `name`、`description`、`commentary`、`characterId`、`categoryIds`、`tags` 六字段校验的条目，若没有任何作品使用相同 `sha256`，会创建 `status=pending`、`needsPublish=true` 的投稿作品；重复 `sha256` 只建立投稿到作品的关联。AI 拒绝或转人工的条目同样保存预览，但不创建作品。

## 后台界面

后台首页为业务概览，左侧业务导航依次为：概览、投稿审核、作品库、专题、发布、机器人；Payload 默认集合导航保留在下方作为高级入口。

| 路由 | 用途 |
|---|---|
| `/admin` | 渠道待发布数、AI 拒绝/转人工、待发布改动和最近发布批次 |
| `/admin/review` | 按渠道和状态审核作品，抽屉内编辑，支持移除/隐藏/收录 |
| `/admin/library` | 筛选、搜索、批量改分类、隐藏、恢复、删除和加入专题 |
| `/admin/topics-board` | 专题三语文案、封面、作品选择、拖动排序和上线状态 |
| `/admin/publish` | 发布计划、二次确认、批次轮询和历史记录 |
| `/admin/bots` | 机器人启停与 API Key 重置（仅站长） |

自定义视图通过 `admin.components.views` 注册；新增一级路由必须使用 `DefaultTemplate` 包住客户端视图，否则不会渲染后台导航。运行 `npm run generate:importmap` 后，自定义组件会写入 `src/app/(payload)/admin/importMap.js`。

端到端测试使用隔离 SQLite：

```powershell
$env:DATABASE_URL='file:E:/quick-site-studio/tmp/s3-admin/admin.db'
$env:MEDIA_DIR='E:/quick-site-studio/tmp/s3-admin/media'
$env:PAYLOAD_SECRET='s3-admin-local-secret'
$env:ADMIN_PUBLISH_REQUEST_DIR='E:/quick-site-studio/tmp/s3-admin/run'
$env:S3_ADMIN_OWNER_PASSWORD='<在本机测试库中设置的站长密码>'
npm run dev -- --port 3100
npm run test:e2e
```

Playwright 配置默认使用 `http://127.0.0.1:3100`，测试截图写入 `E:\quick-site-studio\tmp\s3-shots`。测试只创建发布请求并检查 queued 状态，不启动发布执行器。

## 创建机器人

```powershell
npm run create:bot
```

脚本幂等创建或重置 `hermes@bot.local`，角色 `bot`，显示名 `hermes`。每次运行都会生成新的 API Key，并只在本次终端输出一次。

## 机器人 API

### 认证

- 后台用户/机器人：`Authorization: users API-Key <key>`
- 发布执行器：`Authorization: Bearer <ADMIN_WORKER_TOKEN>`

机器人不能登录后台界面，不能管理用户，不能删除、隐藏或移除作品；可以读取投稿、作品、专题，通过普通作品 REST API 修改可编辑字段和分类，也可以发起发布。机器人调用批量接口时目前只允许 `set-categories`。

### 发布执行器接口

#### 获取快照

```http
GET /cms-api/publish/snapshot?runId=run_xxx
Authorization: Bearer <ADMIN_WORKER_TOKEN>
```

只有 `queued` 或 `in_progress` 批次可读取。返回 `files`、`originals`、`deletions` 和 `summary`。`originals` 只列 pending→published 的投稿作品，每项为 `{ workId, sha256, characterId, ext, targetPath, submissionId }`；执行器按 `submissionId` 从投稿服务管理口读取原图，不再从后台下载 media。`files` 是本次发布成功后的目标文本。

#### 回写批次状态

```http
POST /cms-api/publish/runs/<runId>/status
Authorization: Bearer <ADMIN_WORKER_TOKEN>
Content-Type: application/json

{
  "status": "succeeded",
  "step": "deploy",
  "commits": { "site": "abc", "content": "def" },
  "releasePath": "/srv/www/dafeiyu/releases/20260929",
  "healthCheck": { "ok": true },
  "results": { "works": [] }
}
```

`status` 可为 `in_progress`、`succeeded`、`failed`。成功时后台在事务里把 `pending` 改为 `published`，回写 `slug/path` 等字段，清 `needsPublish`，并记录最后发布批次。

### 业务接口

#### 批量操作

```http
POST /cms-api/works/bulk
Authorization: users API-Key <key>
Content-Type: application/json

{ "action": "hide", "ids": ["sticker_xxx"] }
```

支持 `hide`、`restore`、`remove`、`delete`（需 `confirm: "DELETE"`）、`set-categories`（`categoryIds`）、`add-to-topic`（`topicId`）、`include`。

#### 发布计划与请求

```http
GET /cms-api/publish/plan
POST /cms-api/publish/request
GET /cms-api/publish/runs/<runId>
```

`request` 创建 `queued` 批次并把 `{ runId, requestedAt, actor }` 原子写入 `ADMIN_PUBLISH_REQUEST_DIR/publish.request`；已有排队或执行中批次时返回 409。

#### 概览与同步

```http
GET /cms-api/dashboard/stats
POST /cms-api/submissions/sync
```

## 数据模型原则

- `works.workId`、`slug`、`topicId` 发布后冻结；新投稿作品 id 为 `sticker_<sha256 前 24 位>`。
- 公开字段改动由钩子自动置 `needsPublish=true`；发布器带 `context.skipNeedsPublish` 回写时不会重复置真。
- `submissions` 是投稿服务的只读镜像，队列状态仍以 `server/` 为准。
- `audit-events` 记录所有已挂 hooks 的集合写操作，另有批量接口和发布接口的显式审计。
- `media` 只保存 webp 预览；`media.sha256` 对投稿同步使用原图 sha256 作为逻辑去重键，实际落盘文件为预览。删除作品最终只清理预览 media，但保留作品墓碑记录。
- 后台服务器不保存原图。原图在发布前只存在于投稿服务私有队列，发布执行器校验 sha256 后写入内容仓并推送 GitHub。

## 验证

```powershell
npm run generate:types
npx tsc --noEmit
npm run lint
npm run test:int
npm run roundtrip:check
npm run build
```
