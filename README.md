# 蓝色大肥鱼 v2

蓝色大肥鱼（`xn--pssy23gqgbz2d718b.com`）的完整重构版本，独立开发于本目录，上线验收前不改动旧站 `bluedafeiyu/` 与现行生产服务。

## 技术栈

| 层级 | 选型 | 说明 |
| --- | --- | --- |
| 前台 | Astro 5 SSR（`@astrojs/node`） | 沿用三视库布局骨架，改为蓝白视觉体系与新图标 |
| 后端 | Hono + TypeScript | 统一承接公开接口、投稿入站、后台接口与 Hermes 兼容接口 |
| 数据库 | PostgreSQL + Drizzle ORM | 单一数据真源，支持多语言、标签筛选与模糊搜索 |
| 后台 CMS | React + Vite（静态托管于 `/admin`） | 自研轻量管理台，替换原 Payload CMS |
| 媒体存储 | Cloudflare R2 | 托管原图、派生图、立绘、头像、分享图与数据库备份 |
| 评论系统 | Giscus | 保留既有 `sticker-<id>` 映射，延续历史评论 |

## 目录规划

```text
bluedafeiyu-v2/
  apps/
    api/          Hono 统一后端、Drizzle Schema、迁移与后台任务
    web/          Astro 5 SSR 前台（四语言、图库、连载、视频、OpenAPI 代理）
    admin/        React + Vite 轻量 CMS 管理台
  packages/
    shared/       共享类型、枚举、校验规则、蓝白设计变量与图标资产
  scripts/        R2 迁移、旧数据导入、完整性校验与备份脚本
  ops/            Nginx 配置、systemd 单元与部署脚本
  docs/           架构、接口与运维文档
```

## 文档入口

- [架构与重构方案](docs/架构与重构方案.md)：完整架构、R2 规范、数据库 Schema、Hermes 复用协议、UI 规范与分阶段施工计划。
- [开发约定](AGENTS.md)：本仓库的硬性红线、开发边界与验收要求。
