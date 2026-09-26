# AGENTS.md

给在这个仓库里干活的代理和贡献者看的上手说明。

## 这是什么项目

“蓝色大肥鱼”是 AI 娘二创表情包站，前端是**纯静态**的：手写 HTML / CSS / JS，没有前端框架、没有前端运行时依赖、构建零依赖。站点仓另外带两段**服务端程序**——`server/`（统一投稿服务）与 `tools/intake/`（维护者收录中转），它们只在内地服务器本地运行、线上尚未开通，前端本身仍是静态站点。

源码、结构化数据与内容分成两个仓库：

| 仓库 | 放什么 |
|---|---|
| `lmy414/bluedafeiyu`（本仓库） | 站点页面、样式、生成器、构建与发布脚本、`data/` 结构化清单、全部自动化脚本，以及 `server/` 统一投稿服务与 `tools/intake/` 收录中转 |
| `lmy414/ai-girl-stickers` | 图片（投稿原图、派生图、站点图标、QQ 群二维码）与投稿 Issue 模板 |

线上地址：<https://xn--pssy23gqgbz2d718b.com/>（中文域名一律写 punycode）。

本仓库**不跟踪任何图片**（`*.png`/`*.jpg`/`*.gif`/`*.webp`/`*.ico` 等一律忽略），但**跟踪结构化数据**：角色、分类、投稿清单、id 冻结映射与首批编辑叠加层都在仓库根的 `data/`。构建时 `data/` 由 `tools/stage_data.mjs` 暂存成 `dist/` 下的产物路径，图片则由 `tools/sync_content.mjs` 从内容仓库同步。**构建不读内容仓库的任何 JSON 或脚本。**

`data/` 七个文件与产物的对应关系（`tools/stage_data.mjs` 里写死）：

| `data/` | 产物路径 |
|---|---|
| `characters.json` | `dist/characters.json` |
| `categories.json` | `dist/categories.json` |
| `blue-fish-ids.json` | `dist/blue-fish-ids.json` |
| `works.json` | `dist/submissions/works.json` |
| `owner-picks.json` | `dist/owner-picks/works.json` |
| `blue-fish-classification.json` | `dist/data/blue-fish-classification.json`（构建期读，不进产物） |
| `blue-fish-editorial.json` | `dist/data/blue-fish-editorial.json`（构建期读，不进产物） |

`dist/data/blue-fish/previews/` 不在这张表里：它是 `tools/sync_content.mjs` 从内容仓 `dist/data/blue-fish/previews/` **同步进来的首批预览图**；上表两张 blue-fish JSON 则是**站点仓 `data/` 的清单暂存副本**。三者都落在 `dist/data/`，而 `tools/build.mjs` 会整个跳过 `dist/data/`，所以这批预览图与两张 JSON 都**不进发布包**；线上的首批预览图由 `DEPLOY_ROOT/shared/data` 持久副本硬链接提供（见「更新与发布」）。

## 文档在哪

历史文档已归档到**本仓库**的 `archive/2026-09-24/`（内容仓没有这份 archive）：

- `架构边界.md`：分层边界与硬性规则；
- `数据契约.md`：字段与枚举的唯一来源；
- `docs/SEO规范.md`：详情页文案与结构化数据口径；
- `docs/维护与发布.md`：发布拓扑与 `ops/` 脚本细节。

归档文档记录的是仓库拆分前的单仓库形态，与现状冲突时以本文件和实际代码为准。

## 本地构建

```bash
node tools/build_site.mjs --content-dir /path/to/ai-girl-stickers
python -m http.server 5173 -d .build/site        # 打开 http://127.0.0.1:5173
```

构建链：暂存站点数据 → 同步内容图片 → 归一快照 → 生成详情页 → sitemap → 复制成发布产物。

`dist/works/<slug>.html` 是生成物，不要手改；改版式改 `tools/generate_work_pages.mjs` 再重跑。构建期**不会**跑 `tools/prepare_works.mjs`（它现在也归本仓库）：`id` 和 `slug` 一经发布即冻结，绝不能在构建期重算。

详情页的正文段（H1 下那段）**整段是内容数据**，不是模板：取清单里的 `commentary`（蓝色大肥鱼第一人称评价），缺字段才退兜底句；要改某一页的正文，改本仓库 `data/works.json`（或 `data/owner-picks.json`）里的清单，不要改生成器。分类枚举同理走本仓库的 `data/categories.json`，加分类不用动代码，但新增分类要同时补 `generate_work_pages.mjs` 的 `KIND_WORDS`、`index.html` 与 `category.html` 里那份 `kindWord` 映射（前端卡片 alt 用），漏了会静默退成“表情包”。

**界面是三语的**（zh 默认 / en / ja），由零依赖的 `dist/lang.js` 承担：en/ja 词典 + 运行时 + 顶栏切换贴纸。zh 不进词典：页面原文与 JS 兜底串就是中文，运行时缓存原文、切回即还原。静态文案挂 `data-i18n`，动态文案调 `SiteLang.fmt(key, 中文兜底)`，页面级 title/meta 挂 `body[data-i18n-page]`；详情页模板的 i18n 写在 `generate_work_pages.mjs`。**作品名、Tag、commentary 是内容数据，三语保持中文**；新增界面 key 时 en/ja 两份都要补（漏了静默退中文）。完整约定见 README“多语言”一节与 `lang.js` 头部注释。

首批（blue-fish）记录的归一有两条容易踩的线：`build_site_snapshot.mjs` **先合并 `data/blue-fish-editorial.json` 叠加层，再判“够不够格当作品”**（名字 / 标签 / 角色三者齐全）。顺序反了，那 59 条补过名字的记录会重新掉线；叠加层里带 `originalPath` 的记录原图走内容仓（`lmy414/ai-girl-stickers`）的 Raw，没带的仍指上游档案馆。

## 结构化数据与脚本

迁移后所有清单与自动化脚本都在本仓库（内容仓只留图片 / 文档 / Issue 模板）；另外两段**站点仓程序**也在这里：`server/`（统一投稿服务）与 `tools/intake/`（收录中转）。

```bash
node tools/stage_data.mjs                                          # data/ → dist/ 暂存
node tools/prepare_works.mjs                                       # 冻结 id/slug、补 slug 与兜底 categoryIds
node tools/sync_issue_template.mjs --check --content-dir <内容仓>  # 校验内容仓投稿模板下拉
node tools/sync_issue_template.mjs --write --content-dir <内容仓>  # 从 data/characters.json 生成模板
python tools/generate_image_derivatives.py --content-dir <内容仓>  # 派生图（写内容仓图片、改本仓 data/works.json）
python tools/prepare_favicon.py --content-dir <内容仓>             # 站点图标
node tools/tests/migration.test.mjs --content-dir <内容仓>         # 迁移回归测试（瘦身内容仓也能构建）
```

- `id` / `slug` 一经发布即冻结：`slug` 决定详情页 URL，`id` 决定评论串（`sticker-<id>`），都不能重算；
- `data/blue-fish-editorial.json` 是按 `sourcePath` 认图的编辑叠加层（59 条补名字 / 标签的记录靠它上线），**不要删**；
- `data/blue-fish-classification.json` 是上游 raw 清单；仓库外导入流程会重新生成它，编辑结论要写在叠加层里；
- 投稿模板归内容仓（`.github/ISSUE_TEMPLATE/`），但下拉**由本仓库从 `data/characters.json` 生成**。

## Git 流程

1. 从最新 `main` 开功能分支，用 `feat/`、`fix/`、`docs/`、`chore/` 前缀；
2. **显式列文件名暂存，禁止 `git add -A` 和 `git add .`**；
3. 本地构建过一遍，并起服务在浏览器里验收；
4. 提交信息用前缀 + 中文简述；
5. 推送功能分支，复核后快进 `main` 再推送。

## 更新与发布

**每次更新都由服务器从 GitHub 拉取，不要本地上传。**

- 先推送 `origin/main`；**推送不等于发布**；
- 发布在服务器侧跑 `ops/deploy-server.sh` 的**副本**（脚本会先 `git fetch` 加 `reset --hard origin/main`。直接跑工作树里的这份脚本，`reset --hard` 会在运行中把它替换掉）；
- 发布脚本分别拉取代码仓与内容仓的 `main`，构建、预压缩、原子切换 `current`，健康检查失败自动回滚；
- 不要用面板上传整包，也不要直接改服务器上的站点文件；
- 回滚用 `ops/rollback-server.sh <release目录名>`，只切软链、不删文件；
- **首批图的派生图（`data/blue-fish/previews/`）不在发布产物里**：`build.mjs` 跳过 `data/`，线上由 `DEPLOY_ROOT/shared/data` 这份持久副本硬链接进每个 release。所以**内容仓的 `dist/data/blue-fish/previews/` 一旦新增或替换文件，必须先把它刷进 `shared/data` 再发布**，否则页面对得上、图对不上。2026-09-25 新收编的 59 件作品用的就是这批派生图，发之前请确认 `shared/data/blue-fish/previews/` 里那 59 个文件名都在（清单本身在本仓库 `data/`，不在 `shared/data`）；
- 服务器配置（`DEPLOY_ENV`、`DEPLOY_ROOT`、`SOURCE_DIR`、`CONTENT_DIR` 等）由维护者在服务器侧维护，不写进仓库。
