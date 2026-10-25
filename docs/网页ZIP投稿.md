# 网页 ZIP 图片集投稿

网页 `/submit.html` 可上传一张原图或一个 ZIP 图片集，继续使用 `POST /api/v1/submissions`，复用 Issue 已有的 `tools/intake/zip.mjs`、成员来源键与统一投稿队列。网页来源仍为 `web`，不代用户创建 Issue。

## 行为与接口

- 单独图片维持前端 10 MiB 限制；ZIP 最大 32 MiB、100 张、200 个条目，包内单图最大 16 MiB（`SUBMISSION_MAX_BYTES` 更低时取较小值），解压总量最大 64 MiB，单成员压缩比不超过 200。只允许 PNG、JPG/JPEG、GIF、WebP、APNG。
- ZIP 只通过 multipart 上传，文件字段可继续使用 `image`，文件扩展名须为 `.zip`，大小和内容以服务端校验为准，不相信浏览器 MIME。JSON/base64 仍只接收单图。
- 图集名称、角色、作品类型、说明与署名适用于每张图片；原始成员名仅记录在私有 `origin.archive.member` 中。不同角色、类型或署名的作品建议分包。
- 整包先检查安全性与全部图片。任一成员不合规则整包不入队。沿用 Issue 的路径、CRC、文件头、压缩算法、加密、嵌套包等校验，不写成员路径、不存 ZIP 供发布。图片继续按 SHA 保存原始字节。
- 每张进入现有 `received`，供 Hermes AI 逐张审核；通过后仍走原发布流程。AI 无法判断的内容按现有规则复核，上传处理本身不调用 AI 或发布。
- 跨渠道及包内相同图片由队列 SHA 索引合并，不覆盖已有文案。成员来源键为 `web:zip:<包SHA256>:<图片数>:<序号>`。中途写入失败可以重传同包，已接收图片不会重新审核。
- Origin/CORS、可信代理 IP 限流与 Turnstile 沿用原表单；验证在解包前完成。没有新增公开队列、原图或审核结果接口。

成功有新增图片时返回 201，全部重复返回 200。响应只给计数，不暴露 SHA、文件名、私有路径或审核原文，例如：

```json
{"ok":true,"count":18,"created":16,"duplicates":2}
```

`count` 包含去重前全部图片，`created + duplicates = count`。重复项不意味着当前仍待审或审核通过。前端核对计数后才清空表单，显示新增和重复数量。

安全或格式检查失败返回 400、固定代码 `INVALID_ARCHIVE`；ZIP 或请求体超限返回 413。部分入队后发生技术错误返回 503、固定代码 `ARCHIVE_RETRY`，不报成功；前端保留表单并提示重试。服务端异常详情仅写私有日志。

## 本地 Codex 发布交接

代码测试不等于已上线。按 `AGENTS.md` 从 GitHub 更新服务器；用户此前安排的前端统一样式发布步骤见 [前端统一样式发布交接](前端统一样式发布交接.md)。本次同时涉及投稿服务与公开静态前端，必须协调更新。

1. 保留本地未提交修改，拉取 `origin/main` 并核对待发布 SHA；确认现行 release、回滚位置及投稿进程实际运行目录。不要上传本地构建产物。
2. 检查实际承接 `/api/v1/submissions` 的全部反向代理。请求体必须容纳 **32 MiB 文件加 multipart 头和字段**；Nginx 对这个 location 建议 `client_max_body_size 33m;`（至少 33 MiB），并执行配置校验、按现有运维流程重载。仅设成 `32m` 会拒绝恰好 32 MiB 的合法包。`ops/admin/nginx-admin.conf` 的限制针对 CMS，不能代替公开投稿入口核验。保留其他路径现有限制。
3. 服务器从 GitHub 拉取新版 `server/http.mjs` 与原有 `tools/intake/`，沿用原私有队列和 Hermes 配置，先重启实际投稿服务。无需数据库迁移、新审核 AI 或新定时器。
4. 回读 `/api/v1/health`，检查 `limits.zip.maxArchiveBytes=33554432`、`maxFiles=100` 及有效单图上限；确认 Hermes 的独立内部审核接口正常。不能只因静态页面更新就宣称 API 已启用 ZIP。
5. 使用 `ops/deploy-server.sh` 的独立副本构建并发布静态前端。公共语言资源版本已更新；沿用此前交接要求，以 `BUILD_FULL=1` 完整构建发布，保留增量缓存。核对公开 `build-info.json` 的发布 SHA。
6. 浏览器核对简体、繁体、英语、日语投稿页的 ZIP 选择、限制说明、成功计数、失败保留表单，以及 390px 手机宽度和明暗主题。旧的单图与视频作者登记继续可用。
7. 生产接收验收应使用站长允许的真实图片，观察逐张 `received`、Hermes 领取及去重；不为了测试导入垃圾图片、绕过审核或直接发布。记录 API 与前端实际发布版本。若部分成员待审，只报告已接收，不报告已收录。

回滚时同时核对静态前端、投稿服务代码与反向代理配置的版本；按现有脚本切回旧 release、恢复相应服务版本。已进入私有队列的真实图片保留，不删队列或成员记录。

## 验证命令

```bash
node --test server/*.test.mjs server/adapters/*.test.mjs tools/intake/*.test.mjs ops/tests/issue-reconcile.test.mjs ops/tests/publish-batch.test.mjs ops/tests/hermes-publish.test.mjs ops/hermes/tests/hermes.test.mjs
npm --prefix frontend run check:components
node --test tools/tests/submit-form.test.mjs
npm --prefix frontend test
```

前端测试需先生成 `.build/site`。发布验证结果以本次交付记录为准，不能把本地队列及浏览器验收等同于生产 AI 审核或部署成功。
