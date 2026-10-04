# 公开前台（Astro）

本站前台在 `src/pages/`，使用 Astro 静态路由。`src/layouts/Archive.astro` 组合公共页面壳。导航、页头、页脚、移动导航和预览容器在 `src/components/archive/`，后台 `../admin/` 独立运行。

首页、角色档案、图库、合集、搜索和作品详情共用同一组视图组件。`src/lib/archive.mjs` 从正式快照组装页面数据；`src/lib/archive-seo.mjs` 生成页面元信息和静态分页。作品卡片的唯一渲染器是 `public/archive/work-card.js`，Astro 首屏和浏览器追加作品都会调用它。调整卡片结构只改这一处。

筛选栏由 `components/archive/Listing.mjs` 输出原生控件，`public/archive/filter-select.js` 增强下拉菜单和键盘操作。`public/archive/archive.js` 处理连续加载、预览、搜索和返回位置。公共视觉样式也在 `public/archive/`，正式主题变量和主题脚本继续共用 `public/tokens.css`、`public/theme.js`。

主列表每批显示 24 件作品，正常浏览只提供“再看一些”。历史分页地址保留，无 JavaScript 时使用静态链接继续浏览。筛选和排序状态放在 URL 锚点中，搜索词保留在搜索页参数中。搜索、旧目录和分页使用 `noindex,follow`；只有一件作品的角色与类型组合页也不进入 sitemap。

访问与下载数据读取 `/cms-api/analytics/public`，不使用 DEMO 统计快照。详情和预览继续发送原有作品统计事件。投稿页复用 `SubmissionForm.astro` 和 `/api/v1/submissions`，评论继续使用冻结的 `sticker-<作品 id>` 讨论串。

不要编辑 `../dist/` 的暂存文件或 `out/`、`../.build/site/` 的构建结果。作品与分类、专题的权威数据在 `../data/`；图片来自内容仓库。`../tools/build_site.mjs` 负责暂存、同步、生成快照，再用 Astro 构建。公开路径保持 `/works/<slug>.html`、`/category.html`、`/topics.html` 等现有地址，新增分类与专题单独 `.html` 页面。

```powershell
cd frontend
npm ci
cd ..
node tools/build_site.mjs --content-dir <内容仓绝对路径> --out .build/site
node --test tools/tests/submit-form.test.mjs
npm --prefix frontend test
node tools/preview_site.mjs --dir .build/site --port 5173
```

`npm run preview` 只查看上一次 Astro 的 `out/`，不包含构建后同步的内容仓图片。完整验收请预览 `.build/site/`。发布仍由 `ops/deploy-server.sh` 从 GitHub 获取代码与内容，运行 `npm ci --prefix frontend`，构建后原子切换；上线前必须确认服务器的 Node/npm 版本兼容，并且没有未提交变更被脚本覆盖。

构建后生成简体中文、繁体中文、英文和日文页面，保留原有 canonical 与 hreflang 规则。`archive-labels.js` 在构建时由页面组件生成，静态翻译和浏览器共用同一份界面词典。作品名称、来源与署名仍以权威清单为准。

模型发布厂商和代表图配置在 `src/data/`。正式合集的成员与顺序在 `../data/topics.json` 中人工维护；渲染组件不按标签自动扩展合集。
