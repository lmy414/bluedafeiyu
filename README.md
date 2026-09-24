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
3. `tools/generate_work_pages.mjs` —— 幂等生成 191 个 `dist/works/<slug>.html`；
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

- **字体**：去掉 `dist/styles.css` 首行的阻塞式 `@import`，改为各页 `<head>` 的
  `preconnect`（`fonts.googleapis.com` + `fonts.gstatic.com`）+ Google Fonts stylesheet
  （`display=swap`）。详情页同一份链接在 `tools/generate_work_pages.mjs`，改字体链接要两处同步。
- **首屏图片优先级**：`dist/index.html` / `dist/category.html` 的卡片按渲染序号给前 6 张
  `loading="eager"`，其中第一张真实作品图 `fetchpriority="high"` 抢 LCP；其余保持
  `loading="lazy" decoding="async"`。首页 hero 装饰照片墙补 1:1 `width/height` +
  `decoding="async" fetchpriority="low"`，不抢主内容带宽。
- **详情页**：主图 `loading="eager" fetchpriority="high" decoding="async"`；相关推荐图与角色头像
  保持 `loading="lazy" decoding="async"`。
- **数据脚本**：`index.html` / `category.html` 在 `<head>` 用 `<link rel="preload" as="script">`
  提前请求 `site-data.js`，脚本仍在文档末尾同步执行，执行顺序与 hash 兼容跳转不变。
- `dist/about.html` 删掉了没有任何页面逻辑使用的 `site-data.js` 引用。

`dist/works/*.html` 仍是生成物：改版式要改 `tools/generate_work_pages.mjs` 再重新构建。

## 发布产物 gzip 预压缩（可选）

`tools/compress_static.mjs` 用 Node 内置 zlib 给发布产物里的 html/css/js/json/xml/svg/txt
生成同名 `.gz`，供 nginx `gzip_static` 直接回发：

```bash
node tools/compress_static.mjs --dir .build/site               # 只报告收益（默认，不写文件）
node tools/compress_static.mjs --dir .build/site --precompress # 写出 .gz
# 或
npm run compress -- --dir .build/site
npm run compress:write -- --dir .build/site
```

默认只报告、加 `--precompress` 才写；`.gz` 只落在发布产物里，脚本会拒绝在 `dist/` 或仓库根上运行。

发布脚本内置了这个开关：给 `ops/deploy-server.sh` 设环境变量 `PRECOMPRESS=1`（或 `true`）时，
`build_site.mjs` 成功后、`chmod` / 删 `.build-output` / `cp -al data` 之前，会自动对 staging 产物
跑一次 `node tools/compress_static.mjs --dir <staging>/site --precompress`；预压缩失败则中止发布、
`current` 保持不变。默认 `PRECOMPRESS=0`（关闭），避免每个 release 的产物无谓膨胀；也能写在
`DEPLOY_ENV` 配置文件里。开着它还要在服务器 nginx 打开 `gzip_static on`（见下）。

`ops/nginx-performance.conf` 是可直接抄进 `server {}` 块的 nginx 片段：`gzip_types`、可选 brotli，
以及一份「不无脑长缓存」的缓存策略——只有带 `?v=<n>` 的 css/js 才用一年 `immutable`（改版即换
query）；图片给 **7 天**普通缓存（**非 immutable**，因为派生图文件名不是内容指纹，换图靠覆盖同名
文件）；HTML/JSON `no-cache`；xml/txt 短缓存 1 小时。特别地，`site-data.js` 不带 `?v=`，会落到
`no-cache`，不会被长缓存。它**不会**被 `ops/deploy-server.sh` 自动加载——线上 nginx 配置仍在
服务器侧，需要人工 include 并 `nginx -t` 后 reload；不启用时脚本与站点行为保持原样。

## 发布

线上跑在阿里云香港的 nginx 上，根目录 `current` → `releases/<时间戳>`。发布由 `ops/deploy-server.sh` 完成：分别更新**代码工作树**与**内容工作树**，在 staging 里跑 `tools/build_site.mjs`，`nginx -t` 通过后原子切 `current`，健康检查失败自动回滚。回滚用 `ops/rollback-server.sh <release目录名>`，只切软链、不重新构建。脚本的配置全部走环境变量 / `DEPLOY_ENV`，不写死服务器路径。

（历史文档见 `archive/2026-09-24/docs/维护与发布.md`，其中记录的仍是拆分前的单仓库拓扑。）
