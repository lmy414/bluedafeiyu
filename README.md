# bluedafeiyu：蓝色大肥鱼站点源码

AI 娘表情包站“蓝色大肥鱼”的**站点源码仓库**。前端仍是**纯静态**的：手写 HTML / CSS / JS，没有前端框架、没有前端运行时依赖，构建零依赖、只用 Node 内置模块。站点仓另外带两段服务端程序——`server/`（统一投稿服务，收网页 / QQ / GitHub Issue 三种来源）与 `tools/intake/`（维护者收录中转）；它们都只在内地服务器本地运行，**线上尚未开通**，前端本身依旧是静态站点。

站点线上地址：<https://xn--pssy23gqgbz2d718b.com>（中文域名一律用 punycode 书写）。

## 两个仓库的分工

| 仓库 | 内容 | 地址 |
| --- | --- | --- |
| **本站（源码）** | 手写页面、样式、生成器、构建器、发布脚本、`data/` 结构化清单、全部自动化脚本，以及 `server/` 统一投稿服务与 `tools/intake/` 收录中转 | `lmy414/bluedafeiyu` |
| **内容仓库** | 图片（投稿原图、派生图、站点图标、QQ 群二维码）与投稿 / 下架表单 | `lmy414/ai-girl-stickers` |

本仓库**不跟踪任何图片**（`*.png`/`*.jpg`/`*.jpeg`/`*.gif`/`*.webp`/`*.ico` 全部忽略），但**跟踪结构化数据**：角色、分类、投稿清单、id 冻结映射与首批编辑叠加层都在仓库根的 `data/`（`characters.json`、`categories.json`、`blue-fish-ids.json`、`works.json`、`owner-picks.json`、`blue-fish-classification.json`、`blue-fish-editorial.json`）。构建时 `data/` 由 `tools/stage_data.mjs` 暂存成 `dist/` 下的产物路径，图片由 `tools/sync_content.mjs` 从内容仓库同步；**构建不读内容仓库的任何 JSON 或脚本**。`dist/data/blue-fish/previews/` 是**从内容仓库同步进来的首批预览图**；`dist/data/blue-fish-classification.json` 与 `dist/data/blue-fish-editorial.json` 则是**站点仓 `data/` 的清单暂存副本**，只在构建期被读取，**不进发布包**（`tools/build.mjs` 跳过整个 `dist/data/`，线上的首批预览图由 `DEPLOY_ROOT/shared/data` 持久副本提供）。从内容仓库同步进来的其余图片与模板副本（`dist/submissions/`、`dist/owner-picks/`、`favicon.*`、`avatar.png`、`qq-group.png`、`dist/.github/`）和构建生成物（`dist/site-data.json/js`、`dist/sitemap.xml`、`dist/works/`）也不进 git。

投稿入口继续指向内容仓库的 GitHub 表单：<https://github.com/lmy414/ai-girl-stickers/issues/new?template=sticker-submission.yml>。
投稿者只需上传图片、填写图片名称和角色，一句话说明可选；Tag、分类、来源、授权和详情页文案由维护者审核时补充。站内投稿服务（`server/`）已在站点仓实现、可本地运行，但**线上尚未开通**，前端仍是静态站点；飞书通道同样未开放。
原图继续走内容仓库的 GitHub Raw URL，路径不随本次拆分改变。投稿表单里的角色下拉由本仓库的 `tools/sync_issue_template.mjs` 从 `data/characters.json` 生成（见下）。

## 本仓库跟踪什么

- `dist/index.html`、`dist/category.html`、`dist/submit.html`、`dist/about.html`、`dist/projects.html`、`dist/changelog.html`、`dist/404.html`：手写页面；
- `dist/styles.css`、`dist/tokens.css`、`dist/lang.js`、`dist/analytics.js`、`dist/robots.txt`、`dist/google653ce5fe960a5fb0.html`；
- `data/`：结构化清单（权威副本）；
- `tools/`：数据暂存、图片同步、快照、详情页生成、sitemap、构建、模板生成 / 校验、数据准备（`prepare_works`）、图片派生（`generate_image_derivatives.py`、`prepare_favicon.py`）、迁移回归测试（`tools/tests/`）；
- `server/`：站点仓自带的**统一投稿服务**（网页 / QQ / GitHub Issue 三来源统一进 AI 审核队列），零依赖、只应本地 / 内地服务器运行，见 [`server/README.md`](server/README.md)；
- `tools/intake/`：维护者**收录中转** CLI 与回环管理 API（原内容仓的 `tools/intake/` 已迁到本仓库），见 [`tools/intake/README.md`](tools/intake/README.md)；
- `ops/`：服务器侧发布 / 回滚脚本；
- `archive/2026-09-24/`：本站改造前的历史文档副本（属站点仓，内容仓没有这份 archive）。

`server/` 与 `tools/intake/` 是站点仓里的两段**服务端程序**，都不是前端功能、也不是公开投稿 API：`server/` 面向投稿入站与 AI 初审，`tools/intake/` 面向维护者收录中转。两者目前都只在内地服务器本地运行，线上尚未开通。

`dist/works/<slug>.html` 是生成物，别手改。

## 多语言（zh 默认 / en / ja）

站点界面支持中文（默认）、英语、日语三种语言，由零依赖的 `dist/lang.js` 承担：词典 + 运行时 + 顶栏“中 / EN / 日”切换贴纸（自动注入 `header .topnav` 末尾）。语言取值优先级：URL `?lang=`（会记住）→ `localStorage`（key `bluedafeiyu-lang`）→ 浏览器语言 → zh。切换时 `<html lang>`、页面 title 与 meta 描述同步更新；详情页动态文案监听 `site:langchange` 重渲染。

约定（`lang.js` 头部注释也有一份）：

- **中文不进词典**：zh 就是页面 HTML 原文与 JS 里的兜底串，运行时首次应用时缓存原文，切回 zh 直接还原，词典与页面永不漂移；
- 静态文案挂 `data-i18n="key"`；混排行内元素的段落把每段纯文本包 `<span data-i18n=...>` 再翻；带变量用 `data-i18n-tpl` + `data-i18n-vars`（JSON，`{kindId}` 是特殊变量、按 `kind.<id>` 取品类词）；属性用 `data-i18n-attr="placeholder:key"`；页面级 title/meta 挂 `body[data-i18n-page]`；
- 动态文案（计数、空状态、复制反馈等）在页面脚本里调 `SiteLang.fmt(key, 中文兜底, 变量)`；
- **作品名、Tag、详情页正文（commentary）是内容数据，三种语言保持中文原文**；work 详情页不换 title/meta（canonical 内容语言是中文）；
- 详情页模板的 i18n 在 `tools/generate_work_pages.mjs` 里，改完重跑构建即可；`tools/build.mjs` 把 `lang.js` 列进必需文件，产物缺它直接失败；
- 新增 key 时 en / ja 两份都要补，中文兜底留在页面原处；未翻译的 key 会静默退回中文。

## 本地构建

先把内容仓库准备好（任意目录），然后：

```bash
node tools/build_site.mjs --content-dir /path/to/ai-girl-stickers
# 或
CONTENT_DIR=/path/to/ai-girl-stickers node tools/build_site.mjs
```

产物默认落在 `.build/site`，可加 `--out <目录>`（必要时 `--force-clean`）指定。

`tools/build_site.mjs` 顺序执行：

1. `tools/stage_data.mjs`：把本仓库 `data/` 的清单暂存成 `dist/` 下的产物路径（`data/works.json` → `dist/submissions/works.json` 等，只覆盖清单内的目标，缺文件即报错）；
2. `tools/sync_content.mjs`：从内容仓库把图片（预览图 / 派生图 / 站点图标 / QQ 群二维码）与投稿模板副本同步进本仓库 `dist/`（只覆盖清单内的目标，缺文件即报错；**不读内容仓库的任何 JSON**）；
3. `tools/build_site_snapshot.mjs`：归一成 `dist/site-data.json` + `dist/site-data.js`；
4. `tools/generate_work_pages.mjs`：幂等生成 339 个 `dist/works/<slug>.html`；
5. `tools/generate_sitemap.mjs`：生成 `dist/sitemap.xml`；
6. `tools/build.mjs`：把 `dist/` 复制成干净发布产物，跳过 `dist/data/`、`dist/submissions/originals/` 与 `dist/.github/`，并对清单、派生图、详情页、投稿模板下拉做断言。

**不会**在构建期调用 `tools/prepare_works.mjs`（它现在也归本仓库）：slug 与 id 一经发布即冻结，绝不能重算。

也可以把内容仓库克隆到本仓库同级的 `content/` 目录，之后省略 `--content-dir`（该目录已在 `.gitignore` 里）。

### 数据与内容侧脚本

```bash
node tools/stage_data.mjs                                          # data/ → dist/ 暂存
node tools/prepare_works.mjs                                       # 冻结 id/slug、补 slug 与兜底 categoryIds
node tools/sync_issue_template.mjs --check --content-dir <内容仓>  # 校验内容仓投稿模板下拉
node tools/sync_issue_template.mjs --write --content-dir <内容仓>  # 从 data/characters.json 生成模板
python tools/generate_image_derivatives.py --content-dir <内容仓>  # 生成派生图（写内容仓图片、改本仓 data/works.json）
python tools/prepare_favicon.py --content-dir <内容仓>             # 从 assets/ 生成站点图标
node tools/tests/migration.test.mjs --content-dir <内容仓>         # 迁移回归测试
```

`tools/tests/migration.test.mjs` 会在临时目录里搭一个**只有图片与投稿模板、不含任何 JSON** 的瘦身内容仓库，用它完整构建一遍，并断言产物清单与本仓库 `data/` 逐字节一致——这就是「构建不依赖内容仓库 JSON / 脚本」的回归防线。没有内容仓库时它会打印跳过说明并退出 0。

## 本机预览

```bash
python -m http.server 5173 -d .build/site   # 打开 http://127.0.0.1:5173
```

不要用 `file://` 直开当验收：评论区（Giscus）需要合法 Origin。

## 性能优化（首屏与图片加载）

页面层做的低风险优化（不改 URL / slug / id / Giscus term / 投稿与原图链接，也不改视觉布局）：

- **字体**：移除远程 Google Fonts 请求，改用 `Segoe Print` / `Bradley Hand` / `Comic Sans MS`
  等本机优先的稳定字体栈。这样首屏不等待外部字体，也不会在字体到达后替换文字，避免字体替换造成布局跳动（CLS）。
- **首屏图片优先级**：`dist/index.html` / `dist/category.html` 的卡片按渲染序号给前 6 张
  `loading="eager"`，其中第一张真实作品图 `fetchpriority="high"` 抢 LCP；其余保持
  `loading="lazy" decoding="async"`。首页 hero 装饰照片墙补 1:1 `width/height` +
  `decoding="async" fetchpriority="low"`，不抢主内容带宽。
- **列表增量渲染（分页加载）**：`dist/index.html` 与 `dist/category.html` 的状态变化（首页搜索 /
  排序、分类页角色 / 类型 / 关键词）不再一次性把所有卡片和图片插进 DOM，只先渲染首批 24 张，
  滚动接近底部时由 `IntersectionObserver` 追加下一批。分类页全程复用同一个 observer（回调读取
  当前结果与已渲染数，筛选变化只清空网格并重置批次，不会新建 observer）；同时保留始终可见的“加载更多”按钮，
  并用接近底部的 passive scroll 做 WebView 兜底，三条路径都仍然首批起步、绝不一次性全量渲染。首批前 6 张 `eager`、
  第一张 `fetchpriority="high"`，续接批次一律 `lazy`；结果计数仍是完整命中的元数据，不受
  已渲染数量影响。
- **详情页**：主图 `loading="eager" fetchpriority="high" decoding="async"`；相关推荐图与角色头像
  保持 `loading="lazy" decoding="async"`。
- **数据脚本**：`index.html` / `category.html` 在 `<head>` 用 `<link rel="preload" as="script">`
  提前请求 `site-data.js`，脚本仍在文档末尾同步执行，执行顺序与 hash 兼容跳转不变。
- `dist/about.html` 删掉了没有任何页面逻辑使用的 `site-data.js` 引用。

`dist/works/*.html` 仍是生成物：改版式要改 `tools/generate_work_pages.mjs` 再重新构建。

## 自定义 404 页

`dist/404.html` 是手写页面，和别的页面一样是纸卡 + 便签的手绘风，内容是大号 404、可能原因清单和三个出口（首页 / 分类 / 投稿）。

三处和普通页面不同，改它之前先看一眼：

- **页内链接与静态资源一律用站点根绝对路径**（`/styles.css`、`/index.html`）。nginx 的 `error_page` 会在任意目录深度回发这个文件，`/works/xxx.html` 下面用相对路径会解析成 `/works/styles.css`。
- **状态码保持 404**：`error_page 404 /404.html;` 不带 `=200`，页面自带 `<meta name="robots" content="noindex,follow">` 退出索引；也刻意不往 `robots.txt` 加 `Disallow`，挡住了爬虫就看不到那条 noindex。
- **不引 `site-data.js`**：这页没有任何列表逻辑，白拉一份全站清单没意义（同 `about.html`）。

`tools/build.mjs` 把 `404.html` 列进必需文件，`ops/deploy-server.sh` 也会在产物校验里确认它在，缺了直接构建 / 发布失败。

线上接管这一页要人工把 `ops/nginx-performance.conf` 里的 `error_page 404 /404.html;` include 进 `server {}` 并 `nginx -t && nginx -s reload`（发布脚本只跑 `nginx -t`，不会替你 reload）。没接上也不会用错状态码，只是回到 nginx 默认错误页。发布脚本会在健康检查后回读一个不存在的地址，把“自定义 404 是否已生效”写进 `logs/deploy.log`。这一条只提示，不影响发布结果。

## 发布产物 gzip 预压缩（正式发布默认开启）

`tools/compress_static.mjs` 用 Node 内置 zlib 给发布产物里的 html/css/js/json/xml/svg/txt
生成同名 `.gz`，供 nginx `gzip_static` 直接回发：

```bash
node tools/compress_static.mjs --dir .build/site               # 只报告收益（默认，不写文件）
node tools/compress_static.mjs --dir .build/site --precompress # 写出 .gz
# 或
npm run compress -- --dir .build/site
npm run compress:write -- --dir .build/site
```

脚本本身默认只报告、加 `--precompress` 才写；`.gz` 只落在发布产物里，它拒绝在 `dist/` 或仓库根上运行，
也**不纳入源码 git**。

发布脚本内置了这个开关且**默认开启**：`ops/deploy-server.sh` 在 `build_site.mjs` 成功后、
`chmod` / 删 `.build-output` / `cp -al data` 之前，自动对 staging 产物跑一次
`node tools/compress_static.mjs --dir <staging>/site --precompress`。预压缩失败则中止发布，
`current` 保持不变。想关闭就显式设 `PRECOMPRESS=0`（或 `false`/`no`/`off`，大小写均可），
也能写在 `DEPLOY_ENV` 配置文件里。

**注意**：脚本只负责生成 `.gz`，不会自动改服务器 nginx 配置。正式发布默认会在产物里生成
`.gz`，且 `ops/nginx-performance.conf` 里已启用 `gzip_static on`；但仍需由人工把该片段 include
进服务器 `server {}` 块并 `nginx -t` / reload 才会真正回发 `.gz`（不再需要手动取消注释）。没有
include 时也没关系：那些 `.gz` 只是发布包里多出的文件，nginx 照常回源文件并实时 gzip，站点行为
不变。

`ops/nginx-performance.conf` 是可 include 进现有 `server {}` 块的最小 nginx 片段，当前补两件事：
`gzip_static on;` 与自定义 404 的 `error_page 404 /404.html;`（后者见上一节）。现有 vhost 继续负责
gzip、gzip_types 与缓存分层，避免重复指令冲突。正式发布默认生成 `.gz`，人工 include 后执行
`nginx -t` / reload 即会优先回发预压缩文件；缺少 `.gz` 时仍由已有 `gzip on` 实时压缩兜底。Brotli 暂不启用。

## 发布

线上跑在阿里云香港的 nginx 上，根目录 `current` → `releases/<时间戳>`。发布由 `ops/deploy-server.sh` 完成：分别更新**代码工作树**与**内容工作树**，在 staging 里跑 `tools/build_site.mjs`，`nginx -t` 通过后原子切 `current`，健康检查失败自动回滚。回滚用 `ops/rollback-server.sh <release目录名>`，只切软链、不重新构建。脚本的配置全部走环境变量 / `DEPLOY_ENV`，不写死服务器路径。

（历史文档见 `archive/2026-09-24/docs/维护与发布.md`，其中记录的仍是拆分前的单仓库拓扑。）
