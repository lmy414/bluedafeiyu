# Payload 后台（蓝色大肥鱼）

这里是“蓝色大肥鱼”的独立后台。公开站仍是 Astro 静态站，后台只负责管理 Payload 数据、镜像投稿队列、导出发布快照和接收发布请求；后台不直接替换线上 `current`。

GA4 作品浏览与下载统计的权限、配置、定时同步和验证步骤见 [`../docs/GA4作品统计.md`](../docs/GA4作品统计.md)。统计写入独立缓存，不触发内容发布。

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

`--limit` 表示每页条数，整轮同步会沿 `nextCursor` 读到末页。默认每页 200 条，上限 500 条。
投稿服务必须先升级到支持游标分页和版本摘要的版本。镜像内容没有变化时不重复写库。
定时同步和“立即同步”默认先读取 `/api/v1/item-versions`，只拉取版本不同的完整记录。
原图或收录失败的条目不确认版本，下轮继续尝试。需要完整对账时向同步接口传 `{ "full": true }`。
CLI 保留完整遍历，用于人工对账。
原图释放或预览生成失败时，仍保存投稿元数据。缺少预览的新条目不会自动创建待发布作品。
同步结果包含 `pages`、`scanned`、`unchanged`、`previewUnavailable` 和逐条 `errors`。
存在错误时，后台返回 `ok:false`，发布桥接停止本轮发布。

## 后台界面

后台首页为业务概览，左侧业务导航依次为：概览、投稿审核、作品库、专题、发布、机器人；Payload 默认集合导航保留在下方作为高级入口。

| 路由 | 用途 |
|---|---|
| `/admin` | 渠道待发布数、AI 拒绝/转人工、待发布改动和最近发布批次 |
| `/admin/review` | 按渠道和状态审核作品，抽屉内编辑，支持移除/隐藏/收录；`?mode=rejected` 直达未处理人工列表，已关联作品的 AI 记录可在“已处理的 AI 记录”页签查看 |
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

## 列表与持久化批量任务

作品库和投稿审核每页读取 48 条卡片摘要。筛选、搜索、作者统计和全局热度排序都在服务器执行。
卡片不返回完整审核内容、英日译文和状态历史；点击条目后才读取详情。概览用数据库聚合统计。
角色、类型和专题词表在当前后台会话中缓存 60 秒。

多选后支持以下操作：

- 批量写字段：只写勾选字段，所选条目使用同一值。可修改名称、说明、点评、标签、角色和类型。
- AI 批量补写：逐图补写缺失字段并生成英日版本，保留已有内容。
- 批量翻译：根据当前中文生成英日版本。有效译文默认跳过；覆盖需要确认。
- 批量人工收录：仅限未关联作品的人工审核投稿。站长必须确认已逐张看图，字段、译文、预览和原图校验通过后才进入待发布。

每批最多 200 条，同时最多 5 个待执行任务。任务存入 `bulk-jobs`，由独立 systemd 执行器处理。
关闭页面不会停止任务，服务重启后从已提交游标恢复。结果保留在界面的“批量任务”区域。
失败项可以单独重试；取消只停止尚未提交的条目。写入与进度推进共用事务，操作逐条记录审计。
生成期间人工修改过的条目会失败，避免覆盖。投稿的人工编辑存入 `editorial`，同步不会覆盖草稿，原投稿和 AI 结论保留。

接口均需站长身份，执行器接口需独立令牌：

```text
GET  /cms-api/console/list?kind=works&page=1&limit=48
GET  /cms-api/console/authors?kind=works
POST /cms-api/bulk/request
GET  /cms-api/bulk/jobs?jobId=<任务 ID>
POST /cms-api/bulk/cancel
POST /cms-api/bulk/retry
POST /cms-api/bulk/process-next  （仅 ADMIN_WORKER_TOKEN）
```

安装独立执行器前先部署新后台并完成迁移：

```bash
install -m 644 /srv/apps/dafeiyu-admin/src/ops/systemd/dafeiyu-admin-bulk.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now dafeiyu-admin-bulk.service
systemctl status dafeiyu-admin-bulk.service
```

执行器复用 `/etc/dafeiyu/admin.env` 中的 `ADMIN_WORKER_TOKEN`，仅访问回环地址。
迁移新增任务表、草稿字段、版本摘要字段和列表索引，不修改已发布内容。

## 创建机器人

```powershell
npm run create:bot
```

脚本幂等创建或重置 `hermes@bot.local`，角色 `bot`，显示名 `hermes`。每次运行都会生成新的 API Key，并只在本次终端输出一次。

## 机器人 API

### 认证

- 后台用户/机器人：`Authorization: users API-Key <key>`
- 发布执行器：`Authorization: Bearer <ADMIN_WORKER_TOKEN>`

机器人不能登录后台界面，不能管理用户，不能删除、隐藏或移除作品；可以读取投稿、作品、专题，通过普通作品 REST API 修改可编辑字段和分类，通过 `POST /cms-api/topics/upsert` 维护专题文案与作者元数据，也可以发起发布。机器人调用批量接口时目前只允许 `set-categories`。

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

#### 专题 upsert

```http
POST /cms-api/topics/upsert
Authorization: users API-Key <key>
Content-Type: application/json

{
  "topicId": "maojing",
  "name": "猫鲸",
  "summary": "收录 GitHub 用户 1cyberlangke1 投稿的相关作品。",
  "author": {
    "name": "1cyberlangke1",
    "url": "https://github.com/1cyberlangke1",
    "channels": [{ "platform": "GitHub", "url": "https://github.com/1cyberlangke1" }]
  },
  "status": "active"
}
```

owner 或 bot 均可调用。按 `topicId` 查找：命中更新、未命中新建；输入与库中一致时返回 `changed:false` 且不写库，避免误设 `needsPublish`。严格白名单只接受 `topicId`、`name`、`summary`、`nameEn`/`summaryEn`/`nameJa`/`summaryJa`、`author`、`status`、`order`；`works`、`cover`、`needsPublish`、`id`、时间戳等键一律 400 拒绝并报出键名。`author` 省略保留旧值、显式 `null` 清空；渠道第一项是首选联系方式。**传入 `author` 对象是整个作者块的全量替换**：后续要追加 X/Bilibili 等渠道时，需先查询原有渠道并连同 GitHub 一起提交，只有省略 `author` 才保留原作者块。**收录作品与封面只能由站长在后台关联**；机器人不能把已关联作品的专题改成草稿（403）。成功返回 `{ ok, created, changed, id, topicId, status }`，字段校验失败 400、请求体非合法 JSON 400、`topicId` 并发唯一冲突 409。

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
- `submissions` 的原投稿、AI 结论和队列状态是投稿服务镜像，仍以 `server/` 为准。人工草稿独立存入 `editorial`。
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
