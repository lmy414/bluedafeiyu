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

## 发布

线上跑在阿里云香港的 nginx 上，根目录 `current` → `releases/<时间戳>`。发布由 `ops/deploy-server.sh` 完成：分别更新**代码工作树**与**内容工作树**，在 staging 里跑 `tools/build_site.mjs`，`nginx -t` 通过后原子切 `current`，健康检查失败自动回滚。回滚用 `ops/rollback-server.sh <release目录名>`，只切软链、不重新构建。脚本的配置全部走环境变量 / `DEPLOY_ENV`，不写死服务器路径。

（历史文档见 `archive/2026-09-24/docs/维护与发布.md`，其中记录的仍是拆分前的单仓库拓扑。）
