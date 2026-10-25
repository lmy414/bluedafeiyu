# 静态开放 API v1

公开说明同时保存在关于页的 `#open-data-api` 章节，支持简体、繁体、英语和日语。本文记录接口契约及维护方式，不包含客户端程序示例。

## 请求

- 根地址：`https://xn--pssy23gqgbz2d718b.com/open-api/v1/`。
- 方法：`GET`；无需登录、密钥或请求体。
- 格式：UTF-8 JSON，所有响应都有 `apiVersion: 1`。
- 路径对应真实静态文件；查询参数不执行筛选。花括号是需要替换的路径占位符。
- 存在的文件返回 200，不存在的作品、分组、页码和路径返回 404。404 正文可能是站点的 HTML 错误页，先检查状态码再解析 JSON。

| 相对路径 | 返回内容 |
|---|---|
| `index.json` | 顶层 `revision`、各类 `counts`、`pageSize`、`totalPages`、`endpoints`、文档地址 |
| `manifest.json` | 顶层 `revision`、`total`、完整作品摘要 `items` |
| `taxonomy.json` | `characters`、`categories`、`tags`、`topics`、`creators` 五个数组 |
| `works.json` | `total` 和全部完整作品 `items` |
| `works/page/{n}.json` | `page`、`pageSize`、`total`、`totalPages`、`previous`、`next`、完整作品 `items` |
| `works/{id}.json` | 一个完整 `work` 对象 |
| `characters.json`、`categories.json`、`tags.json`、`topics.json`、`creators.json` | 各自目录的 `total` 和 `items`；条目包含 `id`、`name`、`count`、`worksUrl` |
| `characters/{id}.json`、`categories/{id}.json`、`tags/{id}.json`、`topics/{id}.json`、`creators/{id}.json` | 对应分组信息、`total` 和作品摘要 `items` |
| `characters/{characterId}/categories/{categoryId}.json` | 角色与类型交集：两个筛选 ID、`total` 和作品摘要 `items` |

作品摘要的字段固定为 `id`、`name`、`revision`、`detailUrl`、`originalUrl`。分组索引直接提供下载地址，无需逐件读取详情才能批量下载。

页码从 1 开始，默认每页 100 件；最后一页 `next` 为 `null`，第一页 `previous` 为 `null`。空目录仍有第一页。普通作品列表沿用站内的收录时间倒序及 slug 次序；专题保留人工编排顺序。

作品路径使用冻结的作品 `id`，不是 `slug`。角色、类型、专题及作者 ID 从对应目录读取。标签 ID 为 `tag-` 加标签原文 UTF-8 字节的完整 SHA-256；推荐直接读取标签目录的 `worksUrl`，无需自行生成。

## 完整作品字段

| 字段 | 语义 |
|---|---|
| `id`、`slug`、`name` | 冻结作品 ID、冻结详情页 slug、当前中文标题 |
| `url`、`detailUrl` | 站内 HTML 详情页绝对地址、单件 API 绝对地址 |
| `description`、`commentary` | 图片说明、站内点评；缺失时为空字符串 |
| `characterId`、`characterIds` | 主角色、完整角色 ID 数组；多角色作品会出现在各角色索引 |
| `categoryIds` | 一个有效作品类型：`meme`、`illustration`、`setting`、`comic`、`standing`、`other` |
| `topicIds`、`creatorIds` | 人工专题、作者作品集的 ID 数组；不按标签自动归入专题 |
| `tags` | 原记录标签字符串数组 |
| `createdAt`、`updatedAt` | 原记录收录和更新日期；缺失为 `null`，不可用来代替 `revision` |
| `author.name` | 已明确记录的原作者，未知为 `null` |
| `attribution.name`、`attribution.url`、`attribution.explicit` | 公开收录署名、署名主页、是否明确选择署名方式；匿名投稿不导出其私有身份 |
| `source.type`、`source.url` | 来源类型、公开来源或投稿 Issue 地址；不导出群号及审核内部字段 |
| `license.type`、`license.note`、`license.url`、`license.copyrightNotice` | 逐作品授权类型、备注、说明地址、版权说明 |
| `image.originalUrl`、`image.thumbnailUrl`、`image.displayUrl` | 原图、缩略图、展示图的绝对地址；原图保留现有存储来源，不经 API 代理 |
| `image.format`、`image.mimeType`、`image.animated` | 文件格式、MIME、是否动画 |
| `image.width`、`image.height`、`image.bytes`、`image.sha256` | 原图宽高、字节数、原文件 SHA-256；未知为 `null` |
| `i18n.en`、`i18n.ja` | 已有的英文、日文 `name`、`description`、`commentary`、`tags`、`licenseNote`；无译文时不添加该语言 |
| `revision` | 完整公开作品元数据的 SHA-256；与原图文件摘要不同 |

目录保持同一套角色、六种类型和人工专题关系。作者作品集只来自明确的作者型专题；同一哔哩哔哩 UID 的专题合并到 `bilibili-{uid}`，其他作者型专题沿用专题 ID。该接口范围为图片，不混入独立的视频档案。

## 全量与增量读取

首次读取 `works.json` 或顺序遍历分页数据。保存 `manifest.json` 的 ID 和条目 `revision`；后续仅重新读取新增或摘要改变的作品。旧清单有、当前完整清单没有的 ID 即为下架作品。失效作品、空专题和不再使用的标签文件随下一次发布一起移除，不保留可公开读取的旧详情。

顶层 `revision` 覆盖完整图片目录、分类关系及分页配置；逐作品 `revision` 只覆盖对应作品的公开字段。原记录日期未更新但正文有变化时，摘要仍会变化。相同输入重复构建得到相同 API 字节，不加入每次构建都会变化的时间戳。

静态文件不保留历史快照。读取前后核对 `manifest.json` 的顶层 `revision`；变化时刷新清单并重试。分页不是跨发布的固定快照，也没有 `since`、时间戳查询或服务器端动态搜索。更多组合条件由调用方按元数据筛选。

保留作品的作者、来源和授权信息；开放接口提供下载地址不改变各作品的使用许可。

## 构建和部署

完整站点发布自动调用 `frontend/scripts/open-api.mjs`，从本次权威 `site-data.json` 生成到待发布目录的 `open-api/v1/`。接口经过同一套原子切换和产物摘要校验，无变更文件按既有增量机制复用。

只生成接口使用根目录脚本 `npm run build:api`。它仅暂存站点仓的权威数据、生成快照和 JSON，不同步图片、不执行 Astro、无需运行数据库或业务后端。默认输出 `.build/open-api/open-api/v1/`；`--out` 指定独立输出目录，`--snapshot` 可使用已生成快照。输出目录有专属标记，不能覆盖普通站点产物。

跨域浏览器读取需要在公开域名 HTTPS 配置中包含 `ops/nginx-open-api.conf`，检查 nginx 配置并重载。该配置只回发静态文件，提供匿名 GET/HEAD、OPTIONS 和 CORS，短缓存并保留 ETag 与 Last-Modified。命令行或服务端 HTTP 客户端不受浏览器 CORS 限制。构建过程不会修改服务器配置。

变更非兼容字段或语义时发布新的版本路径，保留 v1 契约。新增可选字段允许在 v1 内扩展。
