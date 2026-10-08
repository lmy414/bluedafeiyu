# AI 阅读入口与一周观察

## 阅读入口

`/llms.txt` 提供网站简介、角色、作品类型和人工精选专题的导航。
导航链接到 `.html.md` 正文，原始 HTML 继续作为回答引用来源。

`frontend/scripts/ai-content.mjs` 从当前发布快照生成角色、类型、专题和作品正文。
关于和投稿说明从本次构建的公开页面提取，沿用现有规则。
Markdown 使用简体中文，HTML 的四种语言均提供发现入口。

只导出已发布作品。草稿、下架作品和没有有效作品的专题不生成入口。
专题保留人工编排顺序。版权元数据复用现有 `imageRights`，投稿署名与作者分别说明。
未知作者、未知授权保留未知，图片许可不从站点代码的 MIT 协议推断。

## 服务器配置

两个公开域名的 HTTPS `server` 块均 include `ops/nginx-ai-content.conf` 的服务器绝对路径。
先备份 vhost，再运行 `nginx -t` 和 reload。
`.html.md` 返回 `text/markdown; charset=utf-8`，并设置 `X-Robots-Tag: noindex, follow`。
Markdown 不进入 sitemap；现有 HTML 的 canonical 和 lastmod 规则不变。

阅读入口请求写入 `/var/log/nginx/dafeiyu-ai-access.log`。
沿用 nginx 现有 logrotate 规则，不另外保存访客标识。
验收请求使用 `BlueFish-AI-Check/1.0`，汇总时排除。
User-Agent 只表示自报身份；只有请求记录不足以确认真实爬虫身份或推荐次数。

## 观察口径

用户在本次改动前已经观察到 AI 推荐。该信息作为背景记录，不能算作上线成果。
上线前基线查询 2026-10-01 至 2026-10-07 的完整自然日。
一周后查询 2026-10-08 至 2026-10-14；上线当天只有部分时段包含新入口。
基线和复盘报告存到本地 `.build/ai-observation/`，不公开聚合流量数据。

1. 从 GA4 按本网站 `streamId` 查询来源会话、落地页及作品浏览和下载点击。
2. 从独立访问日志统计导航和 Markdown 的请求，分开成功、失败和验收请求。
3. 重复相同的角色查找、作品查找、来源和授权问题，核对回答与实际页面。

来源域名识别只覆盖可观察到的 AI 来源。没有 referrer 的访问可能归为直接访问。
`sessions` 是会话，`work_download` 是下载按钮点击，不代表下载完成。
流量变化与入口请求不能单独证明因果。GA4 处理延迟、抽样和阈值限制需随报告说明。

## 只读查询

使用现有服务器环境读取 GA4。命令不输出服务账号文件和令牌：

```bash
set -a
. /etc/dafeiyu/admin.env
set +a
node /srv/www/dafeiyu/source/ops/admin/report-ai-referrals.mjs --start 2026-10-01 --end 2026-10-07
node /srv/www/dafeiyu/source/ops/admin/report-ai-reads.mjs --from 2026-10-08T00:00:00+08:00 --until 2026-10-15T00:00:00+08:00
```

报表脚本需要 Node.js 22.18 或以上，以直接读取现有 TypeScript 认证模块。
GA4 查询复用现有服务账号的只读权限，不修改分析配置。

参考：[llms.txt 提案](https://llmstxt.org/)、[Google 的 AI 搜索说明](https://developers.google.com/search/docs/appearance/ai-features)、[GA4 报表字段](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)。
