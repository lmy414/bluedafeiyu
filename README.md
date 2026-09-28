# 蓝色大肥鱼

“蓝色大肥鱼”是一个 AI 娘二创表情包开放档案。站内收集梗图、插画、设定图和漫画，并按角色归档。站点支持按名称、Tag 和角色别名搜索。每件作品都有独立详情页，可查看来源与授权，也提供原图下载入口。

界面支持中文、英文和日文。

## 常用入口

| 用途 | 地址 |
| --- | --- |
| 在线浏览 | <https://xn--pssy23gqgbz2d718b.com/> |
| 投稿作品 | <https://github.com/lmy414/ai-girl-stickers/issues/new?template=sticker-submission.yml> |
| 署名或下架申请 | <https://github.com/lmy414/ai-girl-stickers/issues/new?template=takedown-request.yml> |
| 图片存档仓库 | <https://github.com/lmy414/ai-girl-stickers> |

## 仓库分工

| 仓库 | 负责内容 |
| --- | --- |
| `bluedafeiyu`（本仓库） | Astro 前台、结构化数据、构建脚本、投稿服务代码和发布工具 |
| `ai-girl-stickers` | 投稿原图、派生图、站点图片资源，以及投稿和下架表单 |

站点仓负责生成页面，图片仓负责保存位图。本仓库不跟踪图片文件，线上资源由构建流程从图片仓同步。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `frontend/` | Astro 前台源码。页面在 `src/pages/`，布局和组件在 `src/layouts/`、`src/components/`，静态资源在 `public/` |
| `data/` | 角色、分类、作品、站长自用、专题和编辑叠加层的权威 JSON 清单 |
| `tools/` | 构建、内容同步、数据暂存、快照生成、图片派生和静态压缩脚本 |
| `server/` | 网站、QQ 和 GitHub Issue 的统一投稿服务。目前只在本地运行和测试，线上尚未开通 |
| `tools/intake/` | 维护者用的收录中转工具，负责查重、暂存和 Issue 附件导入 |
| `ops/` | 部署、回滚、审核发布自动化和服务器配置示例 |
| `docs/` | 访问提速、CDN、投稿自动化和 Hermes 审核等维护文档 |
| `archive/` | 拆分仓库前的历史文档 |
| `dist/`、`.build/`、`frontend/out/` | 构建期或本地运行产物，不是前台源码，不要手工编辑 |

投稿服务、收录工具的详细用法见 [`server/README.md`](server/README.md) 和 [`tools/intake/README.md`](tools/intake/README.md)。公开投稿目前以图片仓的 GitHub 表单为准。

## 本地预览

普通浏览不需要本地环境。修改前台或核对构建时，需要 Node.js 22.12 或更高版本，还要准备图片存档仓库。

```powershell
cd frontend
npm ci
cd ..
node tools/build_site.mjs --content-dir <图片存档仓库路径> --out .build/site
python -m http.server 5173 -d .build/site
```

构建结果在 `.build/site/`。前台细节见 [`frontend/README.md`](frontend/README.md)，自动化部署和服务器配置见 [`docs/`](docs/)。

## 投稿与版权

这是一个非官方同人整理项目。投稿、署名更正和下架申请都走图片仓的 GitHub Issue 表单，具体规则见 [`CONTRIBUTING.md`](https://github.com/lmy414/ai-girl-stickers/blob/main/CONTRIBUTING.md)。

作品图片的著作权归原作者。公开仓库或收录到站点，都不会让作品图片自动获得 MIT 授权。使用图片时，以作品详情页标注的来源与授权为准。本仓库代码按 MIT 许可发布，见 [`LICENSE`](LICENSE)。
