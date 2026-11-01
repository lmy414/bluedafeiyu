# Payload 后台（蓝色大肥鱼）

这里是“蓝色大肥鱼”的独立后台。公开站仍是 Astro 静态站，后台只负责管理 Payload 数据、镜像投稿队列、导出发布快照和接收发布请求；后台不直接替换线上 `current`。

GA4 作品浏览与下载统计的权限、配置、定时同步和验证步骤见 [`../docs/GA4作品统计.md`](../docs/GA4作品统计.md)。统计写入独立缓存，不触发内容发布。

## 环境变量

- `PAYLOAD_SCHEMA_PUSH=false`：本地验收复用已迁移数据库时关闭 dev push。生产始终关闭。
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

同步或人工收录复用已有预览时，仍读取原图元数据。自动收录和人工收录都会保留 GIF 的 `format`、`mimeType` 和 `isAnimated`。GIF 只作为原图格式参与 `/gifs.html` 归集，不新增第七个作品类别。

如果历史同步在预览已存在时创建作品，图片元数据可能没有落库。历史作品不会因部署自动回填，发布前需显式执行修复命令。以下命令在 admin 目录执行，与其他后台命令一致：

```powershell
npm run repair:image-metadata -- --content-dir=E:\quick-site-studio\AI娘表情包
```

命令默认 dry-run，只打印 `scanned`、`candidates`、`repaired`、`skipped`、`errors` 和 `changes`。候选只包含已发布且缺 `format` 或 `mimeType` 的作品；写入时保留既有 `changeAction`，只在为空或 `update` 时设为 `update`。确认后加 `--write` 回填 `format`、`mimeType`、`isAnimated`、`width`、`height`、`fileSize`，并标记待发布。`--limit=N` 限制候选数量，重复 `--work=<workId>` 只处理指定作品。脚本按本地原图重新探测并校验 `sha256`，只改上述图片字段，不改 `id`、`slug`、原图路径和分类。原图缺失或哈希不一致会跳过，命令以 1 退出。

必须写显式 `--content-dir`，不要依赖默认目录。该命令不会随定时同步自动执行；发布前显式运行，修正 CMS 后再走正常导出和发布，避免旧 CMS 数据覆盖已修复的 `data/works.json`。

`--limit` 表示每页条数，整轮同步会沿 `nextCursor` 读到末页。默认每页 200 条，上限 500 条。
投稿服务必须先升级到支持游标分页和版本摘要的版本。镜像内容没有变化时不重复写库。
定时同步和“立即同步”默认先读取 `/api/v1/item-versions`，只拉取版本不同的完整记录。
原图或收录失败的条目不确认版本，下轮继续尝试。需要完整对账时向同步接口传 `{ "full": true }`。
CLI 保留完整遍历，用于人工对账。
原图释放或预览生成失败时，仍保存投稿元数据。缺少预览的新条目不会自动创建待发布作品。
同步结果包含 `pages`、`scanned`、`unchanged`、`previewUnavailable` 和逐条 `errors`。
存在错误时，后台返回 `ok:false`，发布桥接停止本轮发布。

## 后台界面

后台首页为任务中心。桌面端侧栏默认展开，并记住站长最后一次折叠选择。高级集合默认折叠。网页和本地机器人共用任务状态。

任务中心先回答“现在需要谁做什么”：

| 分组 | 内容 | 计数单位 |
|---|---|---|
| 需要判断 | 投稿、视频、下架申请等需要人工决定的事项 | 条任务 |
| 需要介入 | 失败、部分失败或技术暂挂，需要检查后决定是否重试 | 条任务 |
| 待发布 | 作品、专题、视频和作者资料中已保存、等待发布的变更 | 件内容 |
| 系统处理中 | 执行器或后台任务正在处理，不需要站长操作 | 条任务 |
| 历史与全部 | 已完成、失败和全部记录，默认不占主屏 | 条任务 |

“待发布”按发布计划口径统计内容件数，不与任务条数相加。列表默认只显示 5 条，标题、一个主状态、一行原因/下一步和短时间；操作者、来源、完整时间和逐项结果放到右侧详情。可以展开本页其余条目，分页和总数始终保留，不能靠截断隐藏待办。系统处理中按真实批次折叠，默认最多 5 个批次，展开后才读取该批次的逐项任务。失败父任务创建重试子任务后留在历史，详情链接到子任务当前进度。`completed` 只表示处理完成，不等于公开站点已上线。

服务器机器人历史批次来自只读快照，页面标记“只读快照 · 非实时”。快照只有 run 摘要时显示“未记录明细”，不把机器人输出里的完成文案当作业已落库。

| 路由 | 用途 |
|---|---|
| `/admin` | 精简任务收件箱、分组、真实批次、详情、失败重试和上传入口；`?task=<任务号>&kind=<类型>&contentType=<work|topic|video|creator>` 可精确定位，同号作品/专题不会串 |
| `/admin/review` | 按唯一处理状态审核投稿或作品，支持上一张/下一张、抽屉编辑和批量选择；`?kind=submissions|works&mode=needs_review|processing|needs_publish|published|blocked|rejected|history`，`?submission=<投稿 ID>` 或 `?work=<作品 ID>` 可直达抽屉 |
| `/admin/library` | 按唯一状态、渠道、作者、角色、类型、格式、专题归属和关键词筛选全量作品；支持“未进任何专题”；卡片一级“加入专题” |
| `/admin/topics-board` | 中文基本信息、折叠的英日翻译、作品编排和作者资料；拖动或 Alt + ↑/↓ 排序，`?topic=<topicId>` 直达 |
| `/admin/publish` | 非空变更清单、二次确认、真实批次阶段和历史记录 |
| `/admin/bots` | 本地站长身份、设备密钥、统计和原有服务机器人 |

作品和投稿都使用服务端唯一的 `processingState`：

| 状态 | 含义 |
|---|---|
| 待判断 | 需要人工决定是否收录 |
| 处理中 | 有真实的 queued/running 后台任务 |
| 待发布改动 | 已保存修改或待发布，包含已上线作品的改动 |
| 已上线 | 线上版本存在且没有未发布改动 |
| 技术暂挂 | 处理阶段阻塞，需要检查原因 |
| 已隐藏、已移除、已删除、已拒绝 | 终态；有未发布动作时主状态仍是待发布改动 |

“全部”是总览，不是状态页签。已上线作品加 `needsPublish` 时只计入“待发布改动”，“已有线上版本”作为次要附注。列表筛选统一发送 `state=<processingState>`；角色和类型仍用稳定 `characterId`、`categoryId`，GIF 按原图格式/MIME 判断。

专题卡片和作品抽屉都有一级“加入专题”。弹层支持服务端搜索、最近专题、当前整理专题、多选一次收录、已有成员标记和撤销本次新增。新建专题只填中文名称，保存为草稿并立即收录；不要求英日齐全。收录只建立专题关系，不改变作品状态、审核结论或发布状态。

专题翻译是持久任务：先保存中文名称和简介，再点“生成英日翻译”或“更新英日翻译”。中文简介为空时按钮提示先补简介，不提交无效翻译任务；简介和英日译文都可以稍后补。任务只改 `nameEn`、`summaryEn`、`nameJa`、`summaryJa` 和翻译元数据，不改作品、封面、作者、排序、状态或已冻结的 `topicId`。中文或人工译文变化后，旧任务会因 `sourceHash`/`translationRevision` 不匹配失败，不能覆盖新内容。AI 和本地编辑 Agent 未连接时任务保持排队。

列表筛选都由服务端对全量数据执行，再分页。筛选条件、页码和打开的抽屉写入 URL，刷新、前进后退和从任务中心直达都会保持。角色筛选统一使用 `characterId`，类型统一使用 `categoryId`。格式筛选的 GIF 指原图格式或 MIME 为 GIF，不把动画 WebP 当成 GIF；缺少图片元数据时显示“格式未知”。

同一对象已有活跃后台任务时，列表显示“处理中”，并禁止再次提交。批量写字段和人工收录只显示“已接收”和任务号；进度、逐项结果和失败链接来自 `/bulk/jobs?jobId`。成功只表示内容已保存并等待发布，公开站点要等发布批次成功后才更新。

发布由独立执行器完成。后台不伪造百分比或线上状态；没有执行器连接时，批次保持排队或未执行。没有字段前后快照的变更只显示当前变更类型和待发布内容，不编造字段 diff。

### 本地体验环境

体验环境与 `admin/admin.db`、线上数据和生产发布目录隔离。数据、素材和请求文件都放在 `.build/admin-workflow-upgrade/`，该目录已被忽略，不进入产品构建。

```powershell
cd admin
$env:DATABASE_URL='file:E:/quick-site-studio/bluedafeiyu/.build/admin-workflow-upgrade/admin.db'
$env:MEDIA_DIR='E:/quick-site-studio/bluedafeiyu/.build/admin-workflow-upgrade/media'
$env:ADMIN_PUBLISH_REQUEST_DIR='E:/quick-site-studio/bluedafeiyu/.build/admin-workflow-upgrade/run'
$env:PAYLOAD_SECRET='s3-admin-workflow-upgrade-local-only-secret'
$env:PAYLOAD_PUBLIC_SERVER_URL='http://127.0.0.1:3106'
$env:PAYLOAD_SCHEMA_PUSH='false'
npm run payload -- migrate
node node_modules/tsx/dist/cli.mjs ../.build/admin-workflow-upgrade/seed.mjs
$env:ADMIN_WORKER_TOKEN=(Get-Content ../.build/admin-workflow-refinement/worker-token -Raw).Trim()
npm run dev -- --port 3106
```

翻译任务由独立本地 consumer 执行，不创建第二条队列：

```powershell
$env:ADMIN_WORKER_TOKEN=(Get-Content ../.build/admin-workflow-refinement/worker-token -Raw).Trim()
$env:ADMIN_BASE_URL='http://127.0.0.1:3106'
node ../.build/admin-workflow-refinement/topic-translation-consumer.mjs
```

consumer 只接受 `127.0.0.1:3106`，使用现有 `/cms-api/agent` 协议和 PI JSON 生成真实英日译文，来源标记为 `local-editor` / 本地编辑 Agent。`ADMIN_WORKER_TOKEN` 必须与 3106 dev 一致；不要把 token 写进仓库或日志。停止 dev 做构建时 consumer 会重试，不 fatal；恢复后重新启动两边。

打开 `http://127.0.0.1:3106/admin`，使用本地体验账号 `owner+ux@local.test`，密码 `Local-UX-2026!`。这个账号只存在于隔离体验库。样例作品、投稿、专题和任务都在页面上标注为体验样例，图片来自本机内容仓的少量真实预览。

样例覆盖待人工判断、处理中、部分失败、失败重试父任务/子任务、待发布修改、历史记录和专题。外部生产 Hermes 和发布执行器未连接时，`queued`、`running` 会保持真实等待状态，页面不会用计时器改成成功。任务中心的服务器批次快照来自 `/cms-api/console/server-batches` 的只读文件，只显示历史 run 摘要，不当作逐项落库证明。需要停止时结束 `npm run dev` 和 consumer 进程即可；删除 `.build/admin-workflow-upgrade/` 会连同体验库和素材一起清理，本轮验收产物在 `.build/admin-workflow-refinement/`。

自定义视图通过 `admin.components.views` 注册；新增一级路由必须使用 `DefaultTemplate` 包住客户端视图，否则不会渲染后台导航。运行 `npm run generate:importmap` 后，自定义组件会写入 `src/app/(payload)/admin/importMap.js`。

端到端测试使用隔离 SQLite：

```powershell
$env:DATABASE_URL='file:E:/quick-site-studio/tmp/admin-usability-qa/admin.db'
$env:S3_ADMIN_DATABASE_URL=$env:DATABASE_URL
$env:MEDIA_DIR='E:/quick-site-studio/tmp/admin-usability-qa/media'
$env:PAYLOAD_SECRET='s3-admin-local-secret'
$env:ADMIN_PUBLISH_REQUEST_DIR='E:/quick-site-studio/tmp/admin-usability-qa/run'
$env:S3_ADMIN_OWNER_PASSWORD='<在本机测试库中设置的站长密码>'
npm run dev -- --port 3100
npm run test:e2e
```

Playwright 配置默认使用 `http://127.0.0.1:3100`，测试截图写入 `E:\quick-site-studio\tmp\s3-shots`。测试只创建发布请求并检查 queued 状态，不启动发布执行器。

## 列表与持久化批量任务

作品库和投稿审核每页读取 48 条卡片摘要。筛选、搜索、作者统计和全局热度排序都在服务器执行。
卡片不返回完整审核内容、英日译文和状态历史；点击条目后才读取详情。任务中心用数据库聚合统计。
角色、类型和专题词表在当前后台会话中缓存 60 秒。

多选后支持以下操作：

- 批量写字段：写入选中的字段。作品修改会在同一任务里补齐内容和英日版本。
- 批量人工收录：确认所选图片后，补齐空白中文字段、生成英日译文，再校验预览和原图。

界面不再提供独立补全、翻译入口。已有工具接口保留兼容。每批最多 200 条，同时最多 5 个待执行任务。任务存入现有 `bulk-jobs`。内容准备和人工收录由 Hermes Agent 原生工具处理，确定性字段写入由 systemd 执行器处理。
关闭页面不会停止任务，服务重启后从已提交游标恢复。结果统一显示在任务中心。
失败项可以单独重试；取消只停止尚未提交的条目。写入与进度推进共用事务，操作逐条记录审计。
生成期间人工修改过的条目会失败，避免覆盖。投稿的人工编辑存入 `editorial`，同步不会覆盖草稿，原投稿和 AI 结论保留。

`/ai-fill` 返回 202 和任务编号，页面查询持久化结果。中文、英文和日文通过工具分别校验、保存，技术失败保留已完成内容，不转人工。Agent 处理规范和上线步骤见 `../docs/Hermes审核与发布接线.md`。

`POST /cms-api/works/bulk` 是同步操作，返回 `results[]`、`affected`、`skipped`、`failed` 和 `errors`。HTTP 200 或 `ok:true` 不等于每一项都成功，界面按逐项结果提示，并保留失败项。`POST /cms-api/bulk/request` 只返回已接收的任务号，后续进度从 `/bulk/jobs?jobId` 读取。

接口均需站长身份，执行器接口需独立令牌：

```text
GET  /cms-api/console/tasks?group=decide&page=1
GET  /cms-api/console/tasks?summary=true
GET  /cms-api/console/counts?kind=works&character=claude&format=gif
GET  /cms-api/console/list?kind=works&character=claude&format=gif&page=1&limit=48
GET  /cms-api/console/authors?kind=works
POST /cms-api/bulk/request
GET  /cms-api/bulk/jobs?jobId=<任务 ID>
POST /cms-api/bulk/cancel
POST /cms-api/bulk/retry
POST /cms-api/bulk/process-next  （仅 ADMIN_WORKER_TOKEN，只处理确定性操作）
POST /cms-api/agent              （仅 ADMIN_WORKER_TOKEN，Agent 工具协议）
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

## 本地机器人

本地设备使用独立的 `owner` 身份，权限与站长相同。网页“设置 → 本地机器人”可创建、停用或轮换设备密钥。命令行配置见 [本地机器人操作通道](../docs/本地机器人操作通道.md)。

## 创建服务机器人

```powershell
npm run create:bot
```

脚本幂等创建或重置 `hermes@bot.local`，角色 `bot`，显示名 `hermes`。每次运行都会生成新的 API Key，并只在本次终端输出一次。

## 机器人 API

### 认证

- 后台用户/机器人：`Authorization: users API-Key <key>`
- 发布执行器：`Authorization: Bearer <ADMIN_WORKER_TOKEN>`

以下限制仅适用于原有 `bot` 服务身份；本地设备的 `owner` 身份具有站长权限。

`bot` 不能登录后台界面，不能管理用户，不能删除、隐藏或移除作品；可以读取投稿、作品、专题，通过普通作品 REST API 修改可编辑字段和分类，通过 `POST /cms-api/topics/upsert` 维护专题文案与作者元数据，也可以发起发布。机器人调用批量接口时目前只允许 `set-categories`。

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
