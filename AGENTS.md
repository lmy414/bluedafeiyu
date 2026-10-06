# AGENTS.md

给在这个仓库里干活的代理和贡献者看的上手说明。

## 这是什么项目

“蓝色大肥鱼”是 AI 娘二创表情包站，前端由 Astro 在构建时生成**纯静态** HTML；源码在 `frontend/src/`，无需线上 Node 运行时。站点仓另外带两段**服务端程序**——`server/`（统一投稿服务）与 `tools/intake/`（维护者收录中转），它们只在内地服务器本地运行、线上尚未开通，前端本身仍是静态站点。

源码、结构化数据与内容分成两个仓库：

| 仓库 | 放什么 |
|---|---|
| `lmy414/bluedafeiyu`（本仓库） | Astro 页面、样式、构建与发布脚本、`data/` 结构化清单、全部自动化脚本，以及 `server/` 统一投稿服务与 `tools/intake/` 收录中转 |
| `lmy414/ai-girl-stickers` | 图片（投稿原图、派生图、站点图标、QQ 群二维码）与投稿 Issue 模板 |

线上地址：<https://xn--pssy23gqgbz2d718b.com/>（中文域名一律写 punycode）。

本仓库**不跟踪任何图片**（`*.png`/`*.jpg`/`*.gif`/`*.webp`/`*.ico` 等一律忽略），但**跟踪结构化数据**：角色、分类、投稿清单、id 冻结映射与首批编辑叠加层都在仓库根的 `data/`。构建时 `data/` 由 `tools/stage_data.mjs` 暂存成 `dist/` 下的产物路径，图片则由 `tools/sync_content.mjs` 从内容仓库同步。**构建不读内容仓库的任何 JSON 或脚本。**

`data/` 的构建暂存映射（`tools/stage_data.mjs` 里写死）：

| `data/` | 产物路径 |
|---|---|
| `characters.json` | `dist/characters.json` |
| `categories.json` | `dist/categories.json` |
| `blue-fish-ids.json` | `dist/blue-fish-ids.json` |
| `works.json` | `dist/submissions/works.json` |
| `owner-picks.json` | `dist/owner-picks/works.json` |
| `topics.json` | `dist/topics.json`（专题：**站长人工精选**的作品合集，不分类；快照里带成 `topics`，供 `topics.html` 与首页专题轮播用） |
| `blue-fish-classification.json` | `dist/data/blue-fish-classification.json`（构建期读，不进产物） |
| `blue-fish-editorial.json` | `dist/data/blue-fish-editorial.json`（构建期读，不进产物） |
| `work-localizations.json` | `dist/data/work-localizations.json`（按作品 ID 和中文内容摘要合并英日译文） |

专题收录的作品由站长人工精选，**不要自动把作品批量归进专题**；专题元数据可由 owner/bot 经后台 upsert 接口创建或更新，本仓库不预置具体专题记录。每条字段：`id`（kebab-case，发布后冻结，用于 `topics/<id>.html`；旧 hash 链接仍可用）、`name`、`summary`、`coverWorkId`、`status`（`active` 才上线）、`order`（升序）、`createdAt`/`updatedAt`、`workIds`（显式收录的作品 id，按此顺序展示）。构建时下架或不存在的 `workIds` 会被跳过并警告，封面失效退回首张，收录清空的专题不上线。

后台另提供受鉴权的专题 upsert 接口（`POST /cms-api/topics/upsert`，owner 或 bot 均可调用），只允许按严格白名单维护文案与作者元数据：`topicId`（查找键）、`name`/`summary` 与英日译名、`author`（省略保留、`null` 清空）、`status`、`order`；`works`、`cover`、`needsPublish` 等键一律 400 拒绝。**作品与封面只能由站长在后台关联**，机器人不得通过该接口改动；机器人也不能把已关联作品的专题改成草稿。一条 `active` 但没有任何作品的专题不会生成专题页面。

可选字段 `author` 表示「来源作者专题」，结构 `{ name, url?, bio?, channels: [{ platform, label?, url }] }`：`channels` 第一项即首选联系方式，每行 `platform` 与 `url` 必填，`url`（含 `author.url`）只接受 http/https；没有 `author` 时专题维持普通版式（`SubHead` + `Feed`），有 `author` 时前台改用独立作者版式并展示作者名（不做头像），缺作者名或首选渠道会直接构建失败。作者型专题记录按需创建，本仓库不预置。

`dist/data/blue-fish/previews/` 不在这张表里：它是 `tools/sync_content.mjs` 从内容仓 `dist/data/blue-fish/previews/` **同步进来的首批预览图**；上表两张 blue-fish JSON 则是**站点仓 `data/` 的清单暂存副本**。三者都落在 `dist/data/`，而 Astro 发布步骤不复制 `dist/data/`，所以这批预览图与两张 JSON 都**不进发布包**；线上的首批预览图由 `DEPLOY_ROOT/shared/data` 持久副本硬链接提供（见「更新与发布」）。

## 文档在哪

历史文档已归档到**本仓库**的 `archive/2026-09-24/`（内容仓没有这份 archive）：

- `架构边界.md`：分层边界与硬性规则；
- `数据契约.md`：字段与枚举的唯一来源；
- `docs/SEO规范.md`：详情页文案与结构化数据口径；
- `docs/维护与发布.md`：发布拓扑与 `ops/` 脚本细节。

归档文档记录的是仓库拆分前的单仓库形态，与现状冲突时以本文件和实际代码为准。

## 本地构建

```powershell
cd frontend
npm ci
cd ..
node tools/build_site.mjs --content-dir <内容仓绝对路径> --out .build/site
python -m http.server 5173 -d .build/site
```

权威清单仍在 `data/`；`dist/` 只暂存清单、快照及图片，不含可维护的前台页面。构建依次暂存数据、同步图片、生成快照，再由 `frontend/src/pages/` 输出 `.html`。改版式改 Astro 页面/组件；不要手工编辑 `.build/site/`。作品 `id`、`slug` 冻结，构建期不运行 `tools/prepare_works.mjs`。

作品详情正文来自 `data/works.json` 或 `data/owner-picks.json` 的 `commentary`，SEO 文案公式在 `frontend/src/lib/seo.mjs`。六类单选类型由 `data/categories.json` 自动生成 `/categories/<id>.html`；专题由 `data/topics.json` 自动生成 `/topics/<id>.html`，每个专题需有有效作品。旧的 `/category.html` 与 `/topics.html` 仍保留。

界面支持简体中文（`zh`，默认）、繁体中文（`zh-Hant`）、英语（`en`）和日语（`ja`）。简体保留原 URL，其他语言使用 `/zh-hant/`、`/en/` 和 `/ja/` 前缀。`frontend/scripts/localize-pages.mjs` 在 Astro 构建后复用 `frontend/public/lang.js` 生成各语言静态 HTML、canonical、hreflang 和 sitemap。语言菜单跳转到当前页面的对应版本，地址固定页面语言，不受浏览器偏好影响。动态链接用 `SiteLang.url()` 保持当前语言；图片、脚本和数据共用根目录资源。繁体动态文案按需加载站内 OpenCC，特殊用词在 `traditionalOverrides` 中维护。动态文案改动后要检查繁体转换和英、日词典。`frontend/public/page-styles/`、`page-scripts/` 管页内特有代码；公共布局与可复用结构在 `frontend/src/layouts/`、`components/`。后台 `admin/` 独立运行，不参与公开前端。

英日详情页必须有真实译文。存量译文在 `data/work-localizations.json`，新内容从后台的 `i18n` 导出；中文修改后必须重新生成译文。公共文案由 Astro 直接读取 `data/site-copy-localizations.json`，命名与维护规则见 `docs/多语言内容维护.md`。发布前运行 `node tools/localization/audit-pages.mjs <构建目录>` 检查正文及结构化数据。

sitemap 的 `lastmod` 根据页面正文、SEO 文案和结构化数据变化更新。重复部署沿用原日期。服务器构建用 `SITE_PREVIOUS_DIR` 读取现行发布目录的 sitemap 与 HTML；本地默认读取旧输出目录。公开 JSON 和 `/data/blue-fish/previews/` 允许抓取，robots 只限制后台与内部审核接口。作者未知时保留缺省 `creator`。维护细则见 `docs/抓取与更新时间.md`。

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
- 修改作品角色不移动已发布图片：派生图脚本从记录的 `path` 读取原图目录，缩略图和大图沿用同一目录；不要用可编辑的 `characterId` 重算图片路径。内容仓稀疏检出时，已有的完整派生图可以继续复用。

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
