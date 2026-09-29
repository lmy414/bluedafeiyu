<div align="center">
  <img src="https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/dist/avatar.png" width="112" alt="Blue Big Fish site icon">
  <h1>Blue Big Fish</h1>
  <p><strong>An open archive of AI-girl fan stickers and memes</strong></p>
  <p>
    <a href="https://xn--pssy23gqgbz2d718b.com/"><img src="https://img.shields.io/website?url=https%3A%2F%2Fxn--pssy23gqgbz2d718b.com%2F&style=for-the-badge&label=site&up_message=online&down_message=offline" alt="Website status"></a>
    <a href="frontend/"><img src="https://img.shields.io/badge/frontend-Astro%20static-BC52EE?style=for-the-badge&logo=astro&logoColor=white" alt="Static Astro frontend"></a>
    <a href="package.json"><img src="https://img.shields.io/badge/Node.js-22.12%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Requires Node.js 22.12 or later"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/code%20license-MIT-2ea44f?style=for-the-badge" alt="Code licensed under MIT"></a>
  </p>
  <p>
    <a href="README.md">简体中文</a> ·
    <strong>English</strong> ·
    <a href="README.ja.md">日本語</a>
  </p>
</div>

---

Blue Big Fish is an open archive of fan-made AI-girl stickers. It collects memes, illustrations, character sheets and comics, organized by character. You can search by name, tag or character alias. Every work has its own detail page with source and license information, plus a link to download the original.

The interface supports Chinese, English and Japanese.

## Project Snapshot

| Item | Details |
| --- | --- |
| Frontend | Static site built with Astro |
| Interface languages | Chinese, English, Japanese |
| Work types | Memes, illustrations, character sheets, comics |
| Images | Stored in a separate public image archive |
| Submissions | Site form, QQ group bot, GitHub Issue Forms |

## Quick Links

| Purpose | Link |
| --- | --- |
| Browse online | <https://xn--pssy23gqgbz2d718b.com/> |
| Submit through the site | <https://xn--pssy23gqgbz2d718b.com/submit.html> |
| Submit through QQ | @ the bot in the submission group with "投稿 标题 角色" and include the image in the same message |
| Submit via GitHub Issue | <https://github.com/lmy414/ai-girl-stickers/issues/new?template=sticker-submission.yml> |
| Request attribution or takedown | <https://github.com/lmy414/ai-girl-stickers/issues/new?template=takedown-request.yml> |
| Image archive | <https://github.com/lmy414/ai-girl-stickers> |

## Repository Split

| Repository | Responsibility |
| --- | --- |
| `bluedafeiyu` (this repository) | Astro frontend, structured data, build scripts, submission service and release tooling |
| `ai-girl-stickers` | Submitted originals, derivatives, site image assets, and submission or takedown forms |

This repository builds the pages. The image archive stores binary assets. No image files are tracked here; the build process syncs them from the archive repository.

## Repository Layout

| Path | Contents |
| --- | --- |
| `frontend/` | Astro source. Pages live in `src/pages/`; layouts and components live in `src/layouts/` and `src/components/`; public assets live in `public/` |
| `data/` | Authoritative JSON for characters, categories, works, owner picks, topics and editorial overlays |
| `tools/` | Build, content sync, data staging, snapshot generation, image derivatives and static compression scripts |
| `server/` | Unified, live submission service for the website, QQ groups and GitHub Issues |
| `tools/intake/` | Maintainer intake tools for duplicate checks, staging and GitHub Issue attachment imports |
| `ops/` | Deployment, rollback, review and publishing automation, and server configuration examples |
| `docs/` | Maintenance notes for network performance, CDN, submission automation and Hermes review |
| `archive/` | Historical documents from before the repository split |
| `dist/`, `.build/`, `frontend/out/` | Build or local runtime output. These are not frontend source files |

See [`server/README.md`](server/README.md) and [`tools/intake/README.md`](tools/intake/README.md) for detailed instructions. Public submissions are available through the site form, the QQ group bot or the image archive's GitHub Issue Forms.

## Brand Assets

The README header uses `dist/avatar.png` from the image archive. Main brand assets:

| File | Size | Purpose |
| --- | --- | --- |
| [`dist/avatar.png`](https://github.com/lmy414/ai-girl-stickers/blob/main/dist/avatar.png) | 96 × 96 | Site avatar and README logo |
| [`dist/favicon.ico`](https://github.com/lmy414/ai-girl-stickers/blob/main/dist/favicon.ico) | 256 × 256 | Browser tab icon |
| [`dist/favicon.png`](https://github.com/lmy414/ai-girl-stickers/blob/main/dist/favicon.png) | 512 × 512 | High-resolution site icon |
| [`dist/qq-group.png`](https://github.com/lmy414/ai-girl-stickers/blob/main/dist/qq-group.png) | 518 × 518 | QQ group QR code |

## Local Preview

Browsing the site does not require a local environment. To modify the frontend or verify a build, install Node.js 22.12 or later and clone the image archive repository.

```powershell
cd frontend
npm ci
cd ..
node tools/build_site.mjs --content-dir <image-archive-path> --out .build/site
python -m http.server 5173 -d .build/site
```

The build output is written to `.build/site/`. See [`frontend/README.md`](frontend/README.md) for frontend details and [`docs/`](docs/) for deployment and server configuration.

## Submissions and Copyright

This is an unofficial fan archive. Submissions are accepted through the site form, the QQ group bot and the image archive's GitHub Issue Forms; attribution corrections and takedown requests still use the GitHub Issue Forms. See [`CONTRIBUTING.md`](https://github.com/lmy414/ai-girl-stickers/blob/main/CONTRIBUTING.md) for the full rules.

Image copyright always belongs to the original author. Publishing an image in this repository or including it on the website does not automatically grant an MIT license. Check the source and license shown on each work's detail page before reuse. The code in this repository is released under the MIT License; see [`LICENSE`](LICENSE).
