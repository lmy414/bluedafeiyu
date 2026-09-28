# 公开前台（Astro）

本站前台在 `src/pages/`，按页面组织。`src/layouts/` 放公共页面壳，`src/components/` 放页头、页脚、作品卡与详情区块。`src/lib/` 放 SEO 文案、推荐排序和构建期数据读取；`public/` 放三语脚本、公共样式及各页的样式/交互。后台 `../admin/` 独立运行。

不要编辑 `../dist/` 的暂存文件或 `out/`、`../.build/site/` 的构建结果。作品与分类、专题的权威数据在 `../data/`；图片来自内容仓库。`../tools/build_site.mjs` 负责暂存、同步、生成快照，再用 Astro 构建。公开路径保持 `/works/<slug>.html`、`/category.html`、`/topics.html` 等现有地址，新增分类与专题单独 `.html` 页面。

```powershell
cd frontend
npm ci
cd ..
node tools/build_site.mjs --content-dir <内容仓绝对路径> --out .build/site
node --test tools/tests/submit-form.test.mjs
npm --prefix frontend test
python -m http.server 5173 -d .build/site
```

`npm run preview` 只查看上一次 Astro 的 `out/`，不包含构建后同步的内容仓图片。完整验收请预览 `.build/site/`。发布仍由 `ops/deploy-server.sh` 从 GitHub 获取代码与内容，运行 `npm ci --prefix frontend`，构建后原子切换；上线前必须确认服务器的 Node/npm 版本兼容，并且没有未提交变更被脚本覆盖。
