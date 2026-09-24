# AGENTS.md

给在这个仓库里干活的代理和贡献者看的上手说明。

## 这是什么项目

「蓝色大肥鱼」是 AI 娘二创表情包站，纯静态前端：手写 HTML / CSS / JS，没有前端框架、没有后端、没有第三方依赖。

源码与内容分成两个仓库：

| 仓库 | 放什么 |
|---|---|
| `lmy414/bluedafeiyu`（本仓库） | 站点页面、样式、生成器、构建与发布脚本 |
| `lmy414/ai-girl-stickers` | 投稿原图、派生图、内容清单、投稿 Issue 表单 |

线上地址：<https://xn--pssy23gqgbz2d718b.com/>（中文域名一律写 punycode）。

本仓库**不跟踪任何图片**，页面用的清单与派生图在构建时从内容仓库同步进来。

## 文档在哪

历史文档已归档到 `archive/2026-09-24/`：

- `架构边界.md` —— 分层边界与硬性规则；
- `数据契约.md` —— 字段与枚举的唯一来源；
- `docs/SEO规范.md` —— 详情页文案与结构化数据口径；
- `docs/维护与发布.md` —— 发布拓扑与 `ops/` 脚本细节。

归档文档记录的是仓库拆分前的单仓库形态，与现状冲突时以本文件和实际代码为准。

## 本地构建

```bash
node tools/build_site.mjs --content-dir /path/to/ai-girl-stickers
python -m http.server 5173 -d .build/site        # 打开 http://127.0.0.1:5173
```

构建链：同步内容 → 归一快照 → 生成 250 个详情页 → sitemap → 复制成发布产物。

`dist/works/<slug>.html` 是生成物，不要手改；改版式改 `tools/generate_work_pages.mjs` 再重跑。也不要在构建期跑内容仓库的 `prepare_works.mjs`：`id` 和 `slug` 一经发布即冻结。

详情页的正文段（H1 下那段）**整段是内容数据**，不是模板：取清单里的 `commentary`（蓝色大肥鱼第一人称评价），缺字段才退兜底句；要改某一页的正文，改内容仓库的清单，不要改生成器。分类枚举同理走内容仓库的 `categories.json`，加分类不用动代码——但新增分类要同时补 `generate_work_pages.mjs` 的 `KIND_WORDS`、`index.html` 与 `category.html` 里那份 `kindWord` 映射（前端卡片 alt 用），漏了会静默退成「表情包」。

首批（blue-fish）记录的归一有两条容易踩的线：`build_site_snapshot.mjs` **先合并 `data/blue-fish-editorial.json` 叠加层、再判「够不够格当作品」**（名字 / 标签 / 角色三者齐全），顺序反了那 59 条补过名字的记录会重新掉线；叠加层里带 `originalPath` 的记录原图走本内容仓的 Raw，没带的仍指上游档案馆。

## Git 流程

1. 从最新 `main` 开功能分支，用 `feat/` / `fix/` / `docs/` / `chore/` 前缀；
2. **显式列文件名暂存，禁止 `git add -A` / `git add .`**；
3. 本地构建过一遍，并起服务在浏览器里验收；
4. 提交信息用前缀 + 中文简述；
5. 推送功能分支，复核后快进 `main` 再推送。

## 更新与发布

**每次更新都由服务器从 GitHub 拉取，不要本地上传。**

- 先推送 `origin/main`；**推送不等于发布**；
- 发布在服务器侧跑 `ops/deploy-server.sh` 的**副本**（脚本会 `git fetch` + `reset --hard origin/main`，直接跑工作树里的脚本会被它自己替换掉）；
- 发布脚本分别拉取代码仓与内容仓的 `main`，构建、预压缩、原子切换 `current`，健康检查失败自动回滚；
- 不要用面板上传整包，也不要直接改服务器上的站点文件；
- 回滚用 `ops/rollback-server.sh <release目录名>`，只切软链、不删文件；
- **首批图的派生图（`data/blue-fish/previews/`）不在发布产物里**：`build.mjs` 跳过 `data/`，线上由 `DEPLOY_ROOT/shared/data` 这份持久副本硬链接进每个 release。所以**内容仓的 `dist/data/` 一旦新增或替换文件，必须先把它刷进 `shared/data` 再发布**，否则页面对得上、图对不上。2026-09-25 新收编的 59 件作品用的就是这批派生图，发之前请确认 `shared/data/blue-fish/previews/` 里那 59 个文件名都在；
- 服务器配置（`DEPLOY_ENV`、`DEPLOY_ROOT`、`SOURCE_DIR`、`CONTENT_DIR` 等）由维护者在服务器侧维护，不写进仓库。
