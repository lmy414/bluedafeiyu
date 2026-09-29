# Payload 后台（蓝色大肥鱼）

这里是“蓝色大肥鱼”站点的后台应用，负责登录、投稿、作品、素材、角色、分类、审核申请、发布批次和审计记录。

公开站点仍然是独立的静态网站：后台不会替换前台，也不会直接改线上 `current`。后续发布流程应由受控 Worker 导出发布快照，再调用仓库现有构建与原子发布脚本。

## 当前状态

- Payload `3.90.2`，Next.js 管理界面；
- 本地开发数据库默认使用 SQLite：`admin/admin.db`；
- 已建立第一版集合和权限角色；
- 已导入现有角色、分类、作品和历史投稿数据；
- 尚未接通真实投稿适配器或自动发布 Worker。

## 本地启动

```bash
cd admin
npm install
npm run dev
```

打开 <http://localhost:3000/admin>，首次运行会创建第一个用户。请使用本地 `.env`，不要提交真实密钥。

生产环境至少需要：

- 独立的 `PAYLOAD_SECRET`；
- 受限的后台监听或反向代理；
- 数据库与上传目录备份；
- 不把后台端口和管理 API 直接暴露给公众；
- 后台操作与静态站发布任务分权。

## 导入历史数据

站点现有 `data/characters.json`、`data/categories.json`、`data/works.json`、`data/owner-picks.json` 和蓝色大肥鱼档案数据，可以用脚本导入 Payload。脚本默认从本地内容仓读取图片：

```powershell
cd E:\quick-site-studio\bluedafeiyu\admin
npm run import:legacy -- --dry-run --previews-only
npm run import:legacy -- --previews-only
npm run import:legacy
```

参数说明：

- `--dry-run`：只检查数据，不写数据库。
- `--previews-only`：只导入预览图，先快速查看后台效果。
- 不带 `--previews-only`：补传本地已有原图和大图。
- `--skip-blue-fish`：跳过蓝色大肥鱼档案。
- `--skip-submissions`：不生成历史投稿记录。
- `--limit=N`：每个数据集只导入前 N 条，便于本地试验。

默认内容仓路径是 `E:\quick-site-studio\AI娘表情包`。如果内容仓在其他位置，使用：

```powershell
npm run import:legacy -- --content-dir="D:\path\to\ai-girl-stickers"
```

脚本会按 `workId`、`characterId`、`categoryId` 和 `sha256` 做幂等更新。重复运行不会生成重复作品或重复素材。
## 数据模型原则

- `works.workId` 与 `works.slug` 对应现有站点的永久 ID / URL，迁移后冻结；
- `media.sha256` 是素材去重和回源校验的唯一依据；
- `submissions` 记录入站、AI 初审和人工决定，不等同于正式作品；
- `publish-runs` 只记录批次和结果，实际构建仍复用仓库现有脚本；
- `audit-events` 保存重要业务操作，AI 使用服务账号，不使用个人管理员凭据；
- 旧 `data/*.json` 在迁移完成前仍是当前静态构建链的输入，不可删除或手工重算。

## 集合

| 集合 | 用途 |
|---|---|
| `users` | 人员、角色、AI 服务账号标记 |
| `media` | 原图、派生图和外部媒体元数据 |
| `characters` | 角色词表 |
| `categories` | 分类词表 |
| `submissions` | 多来源投稿及审核状态机 |
| `works` | 正式公开作品 |
| `takedown-requests` | 下架、署名、来源、授权更正 |
| `publish-runs` | 构建发布批次 |
| `audit-events` | 人、AI、系统操作审计 |

## 验证

```bash
npm run generate:types
npm run build
```


