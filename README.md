# bluedafeiyu —— 蓝色大肥鱼站点源码

AI 娘表情包站「蓝色大肥鱼」的**站点源码仓库**。纯静态前端：没有前端框架、没有后端、没有测试框架。零依赖构建，只用 Node 内置模块。

站点线上地址：<https://xn--pssy23gqgbz2d718b.com>（中文域名一律用 punycode 书写）。

## 两个仓库的分工

| 仓库 | 内容 | 地址 |
| --- | --- | --- |
| **本站（源码）** | 手写页面、样式、生成器、构建器、发布脚本 | `lmy414/bluedafeiyu` |
| **内容仓库** | 投稿与原图、派生图、清单、投稿/下架表单 | `lmy414/ai-girl-stickers` |

本仓库**不跟踪任何图片**（`*.png`/`*.jpg`/`*.jpeg`/`*.gif`/`*.webp`/`*.ico` 全部忽略），也不跟踪从内容仓库同步进来的清单与派生资产（`dist/data/`、`dist/submissions/`、`dist/owner-picks/`、`characters.json`、`categories.json`、`blue-fish-ids.json`、`favicon.*`、`avatar.png`）和构建生成物（`dist/site-data.json/js`、`dist/sitemap.xml`、`dist/works/`）。

投稿入口继续指向内容仓库的表单：<https://github.com/lmy414/ai-girl-stickers/issues/new/choose>。
原图继续走内容仓库的 GitHub Raw URL，路径不随本次拆分改变。

## 本仓库跟踪什么

- `dist/index.html`、`dist/category.html`、`dist/submit.html`、`dist/about.html`、`dist/projects.html`、`dist/changelog.html` —— 手写页面；
- `dist/styles.css`、`dist/tokens.css`、`dist/analytics.js`、`dist/robots.txt`、`dist/google653ce5fe960a5fb0.html`；
- `tools/` —— 内容同步、快照、详情页生成、sitemap、构建、模板校验；
- `ops/` —— 服务器侧发布 / 回滚脚本；
- `archive/2026-09-24/` —— 改造前的历史文档副本。

`dist/works/<slug>.html` 是生成物，别手改。

## 本地构建

先把内容仓库准备好（任意目录），然后：

```bash
node tools/build_site.mjs --content-dir /path/to/ai-girl-stickers
# 或
CONTENT_DIR=/path/to/ai-girl-stickers node tools/build_site.mjs
```

产物默认落在 `.build/site`，可加 `--out <目录>`（必要时 `--force-clean`）指定。

`tools/build_site.mjs` 顺序执行：

1. `tools/sync_content.mjs` —— 从内容仓库把清单 / 派生图 / `data/` 同步进本仓库 `dist/`（只覆盖清单内的目标，缺文件即报错）；
2. `tools/build_site_snapshot.mjs` —— 归一成 `dist/site-data.json` + `dist/site-data.js`；
3. `tools/generate_work_pages.mjs` —— 幂等生成 250 个 `dist/works/<slug>.html`；
4. `tools/generate_sitemap.mjs` —— 生成 `dist/sitemap.xml`；
5. `tools/build.mjs` —— 把 `dist/` 复制成干净发布产物，跳过 `dist/data/` 与 `dist/submissions/originals/`，并对清单、派生图、详情页、投稿模板下拉做断言。

**不会**在构建期调用内容仓库的 `tools/prepare_works.mjs`：slug 与 id 一经发布即冻结，绝不能重算。

也可以把内容仓库克隆到本仓库同级的 `content/` 目录，之后省略 `--content-dir`（该目录已在 `.gitignore` 里）。

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
  当前结果与已渲染数，筛选变化只清空网格并重置批次，不会新建 observer）；同时保留始终可见的「加载更多」按钮，
  并用接近底部的 passive scroll 做 WebView 兜底，三条路径都仍然首批起步、绝不一次性全量渲染。首批前 6 张 `eager`、
  第一张 `fetchpriority="high"`，续接批次一律 `lazy`；结果计数仍是完整命中的元数据，不受
  已渲染数量影响。
- **详情页**：主图 `loading="eager" fetchpriority="high" decoding="async"`；相关推荐图与角色头像
  保持 `loading="lazy" decoding="async"`。
- **数据脚本**：`index.html` / `category.html` 在 `<head>` 用 `<link rel="preload" as="script">`
  提前请求 `site-data.js`，脚本仍在文档末尾同步执行，执行顺序与 hash 兼容跳转不变。
- `dist/about.html` 删掉了没有任何页面逻辑使用的 `site-data.js` 引用。

`dist/works/*.html` 仍是生成物：改版式要改 `tools/generate_work_pages.mjs` 再重新构建。

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
`node tools/compress_static.mjs --dir <staging>/site --precompress`；预压缩失败则中止发布、
`current` 保持不变。想关闭就显式设 `PRECOMPRESS=0`（或 `false`/`no`/`off`，大小写均可），
也能写在 `DEPLOY_ENV` 配置文件里。

**注意**：脚本只负责生成 `.gz`，**不会自动改服务器 nginx 配置**。正式发布默认会在产物里生成
`.gz`，且 `ops/nginx-performance.conf` 里已启用 `gzip_static on`；但仍需由人工把该片段 include
进服务器 `server {}` 块并 `nginx -t` / reload 才会真正回发 `.gz`（不再需要手动取消注释）。没有
include 时也没关系：那些 `.gz` 只是发布包里多出的文件，nginx 照常回源文件并实时 gzip，站点行为
不变。

`ops/nginx-performance.conf` 是可 include 进现有 `server {}` 块的最小 nginx 片段，当前只补
`gzip_static on;`；现有 vhost 继续负责 gzip、gzip_types 与缓存分层，避免重复指令冲突。
正式发布默认生成 `.gz`，人工 include 后执行 `nginx -t` / reload 即会优先回发预压缩文件；缺少 `.gz`
时仍由已有 `gzip on` 实时压缩兜底。Brotli 暂不启用。

## 发布

线上跑在阿里云香港的 nginx 上，根目录 `current` → `releases/<时间戳>`。发布由 `ops/deploy-server.sh` 完成：分别更新**代码工作树**与**内容工作树**，在 staging 里跑 `tools/build_site.mjs`，`nginx -t` 通过后原子切 `current`，健康检查失败自动回滚。回滚用 `ops/rollback-server.sh <release目录名>`，只切软链、不重新构建。脚本的配置全部走环境变量 / `DEPLOY_ENV`，不写死服务器路径。

（历史文档见 `archive/2026-09-24/docs/维护与发布.md`，其中记录的仍是拆分前的单仓库拓扑。）
