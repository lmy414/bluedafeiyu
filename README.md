# bluedafeiyu：蓝色大肥鱼站点源码

AI 娘表情包站“蓝色大肥鱼”的**站点源码仓库**。前端由 Astro 构建为**纯静态** HTML；线上不运行 Astro 服务。构建需要 `frontend/` 锁定的 Node 依赖。站点仓另外带两段服务端程序——`server/`（统一投稿服务，收网页 / QQ / GitHub Issue 三种来源）与 `tools/intake/`（维护者收录中转）；它们都只在内地服务器本地运行，**线上尚未开通**，前端本身依旧是静态站点。

站点线上地址：<https://xn--pssy23gqgbz2d718b.com>（中文域名一律用 punycode 书写）。

## 两个仓库的分工

| 仓库 | 内容 | 地址 |
| --- | --- | --- |
| **本站（源码）** | Astro 页面、样式、构建器、发布脚本、`data/` 结构化清单、全部自动化脚本，以及 `server/` 统一投稿服务与 `tools/intake/` 收录中转 | `lmy414/bluedafeiyu` |
| **内容仓库** | 图片（投稿原图、派生图、站点图标、QQ 群二维码）与投稿 / 下架表单 | `lmy414/ai-girl-stickers` |

本仓库**不跟踪任何图片**（`*.png`/`*.jpg`/`*.jpeg`/`*.gif`/`*.webp`/`*.ico` 全部忽略），但**跟踪结构化数据**：角色、分类、投稿清单、id 冻结映射与首批编辑叠加层都在仓库根的 `data/`（`characters.json`、`categories.json`、`blue-fish-ids.json`、`works.json`、`owner-picks.json`、`topics.json`、`blue-fish-classification.json`、`blue-fish-editorial.json`）。构建时 `data/` 由 `tools/stage_data.mjs` 暂存成 `dist/` 下的产物路径，图片由 `tools/sync_content.mjs` 从内容仓库同步；**构建不读内容仓库的任何 JSON 或脚本**。`dist/data/blue-fish/previews/` 是**从内容仓库同步进来的首批预览图**；`dist/data/blue-fish-classification.json` 与 `dist/data/blue-fish-editorial.json` 则是**站点仓 `data/` 的清单暂存副本**，只在构建期被读取，**不进发布包**（Astro 构建不复制 `dist/data/`，线上的首批预览图由 `DEPLOY_ROOT/shared/data` 持久副本提供）。从内容仓库同步进来的其余图片与模板副本（`dist/submissions/`、`dist/owner-picks/`、`favicon.*`、`avatar.png`、`qq-group.png`、`dist/.github/`）和构建生成物（`dist/site-data.json/js`）也不进 git。

投稿入口继续指向内容仓库的 GitHub 表单：<https://github.com/lmy414/ai-girl-stickers/issues/new?template=sticker-submission.yml>。
投稿者只需上传图片、填写图片名称和角色，一句话说明可选；Tag、分类、来源、授权和详情页文案由维护者审核时补充。站内投稿服务（`server/`）已在站点仓实现、可本地运行，但**线上尚未开通**，前端仍是静态站点；飞书通道同样未开放。
原图继续走内容仓库的 GitHub Raw URL，路径不随本次拆分改变。投稿表单里的角色下拉由本仓库的 `tools/sync_issue_template.mjs` 从 `data/characters.json` 生成（见下）。

## 源码目录

- `frontend/src/pages/`：Astro 页面。原有 `/works/<slug>.html` 等 URL 不变；每个启用分类、有效专题各有独立 `.html`。
- `frontend/src/layouts/`、`frontend/src/components/`：公共页头/页脚、作品卡片、详情页内容等。
- `frontend/public/`：全站设计样式、三语词典、统计脚本、页面专属 CSS/JS、robots 与验证文件。
- `data/`：作品、分类、角色、专题等权威结构化清单。`dist/` 仅为构建期暂存，**不是前台源码**。
- `tools/`：清单暂存、图片同步、快照归一及发布辅助工具；`ops/`：现有发布/回滚流程。
- `server/`、`tools/intake/` 与独立的 `admin/` 不属于公开 Astro 页面。

## 构建与预览

本地需要 Node 22.12+ 和内容图片仓。发布时先在 `frontend/` 安装锁定依赖，再使用仓库现有的统一构建入口。

```powershell
cd frontend
npm ci
cd ..
node tools/build_site.mjs --content-dir <内容仓绝对路径> --out .build/site
node --test tools/tests/submit-form.test.mjs
npm --prefix frontend test
python -m http.server 5173 -d .build/site
```

构建按顺序暂存 `data/` 清单、同步图片、生成 `dist/site-data.json` 快照、用 Astro 输出静态 HTML，最后合并原有公共清单与预览资源。发布产物在 `.build/site/`。不要手工编辑构建产物，也不要在构建期重算冻结的作品 `id` 或 `slug`。首批预览图在正式部署时由服务器 `shared/data/` 持久副本提供，不直接入发布包。

三语界面由 `frontend/public/lang.js` 处理。作品名、Tag、评价仍保留原文；界面词条在英文和日文词典中都要维护。详情页 SEO 文案公式在 `frontend/src/lib/seo.mjs`，推荐排序在 `frontend/src/lib/related.mjs`。

本地直接打开 `file://` 不能验收评论等依赖合法 Origin 的内容，应使用本地 HTTP 服务。服务器侧的 `ops/deploy-server.sh` 仍使用 `tools/build_site.mjs` 入口，发布前会在 `frontend/` 运行 `npm ci` 安装锁定依赖。

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
