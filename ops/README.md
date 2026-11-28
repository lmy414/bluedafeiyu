# v2 部署

在 `locvps-hk` 配置独立运行用户 `dafeiyu-v2`，由该用户在 `/srv/new-business/dafeiyu-v2` 维护部署检出。准备系统级 Node.js 22.12 或更新版本、pnpm、PostgreSQL 16 客户端和 `zstd`。

验收切流前从原仓库的 `v2` 分支部署。首次检出使用以下命令。

```bash
git clone --branch v2 git@github-lmy414:lmy414/bluedafeiyu.git /srv/new-business/dafeiyu-v2
```

脚本默认要求本地检出 `v2`，校验通过后从 `origin` 快进拉取该分支。验收切流前使用默认值，`main` 继续服务旧站。切流后如需部署其他分支，先检出目标分支，再用 `DEPLOY_BRANCH` 指定同名分支。安装依赖使用提交到 Git 的锁文件。

## 运行环境

按 `apps/api/.env.example` 和 `apps/web/.env.example` 准备 `/etc/dafeiyu-v2/api.env`、`/etc/dafeiyu-v2/web.env`。凭证写在宿主机，文件权限设为 `0600`。测试域另配 Turnstile 和来源白名单。

| 文件 | 测试部署设置 |
| --- | --- |
| `api.env` | `HOST=127.0.0.1`、`PORT=4331`、`SITE_PUBLIC_URL=https://v2.xn--pssy23gqgbz2d718b.com`、`ADMIN_DIST_DIR=/srv/new-business/dafeiyu-v2/apps/admin/dist`、`TRUST_PROXY_HOPS=1` |
| `web.env` | `HOST=127.0.0.1`、`PORT=4330`、`API_BASE_URL=http://127.0.0.1:4331`、`PUBLIC_SITE_URL=https://v2.xn--pssy23gqgbz2d718b.com` |

以 root 运行 `bash /srv/new-business/dafeiyu-v2/ops/deploy-v2.sh`。构建与迁移以运行用户执行。脚本安装 systemd 单元，重启 API 和前台，并检查两个回环地址。正式切流后将 `SITE_PUBLIC_URL` 和 `PUBLIC_SITE_URL` 更新为主域，再重新构建和部署。

## Nginx

将 `nginx/*.inc` 安装到 `/etc/nginx/snippets/`，并在 `http` 级加载 `nginx/dafeiyu-v2-cache.conf` 一次。启用测试域配置，核对 TLS 证书路径后运行 `nginx -t` 和 `systemctl reload nginx`。Cloudflare 缓存规则须绕过 `/admin`、`/admin/*` 和 `/api/*`。

主域切流时用 `nginx/xn--pssy23gqgbz2d718b.com.v2.conf` 替换原主域配置，先备份再检查并重载。旧站发布目录和服务保留至少 14 天。Hermes 操作见 [Hermes 切换与回滚](hermes-switch.md)。

## 启用服务与计时器

健康检查通过后启用 `dafeiyu-v2-api.service` 和 `dafeiyu-v2-web.service`，使两项服务随系统启动。Issue 对账会回复和关闭正式内容仓的申请，正式切流后再启用。飞书通知在测试域联调时指向测试群。

| 计时器 | 调度 |
| --- | --- |
| `dafeiyu-v2-video-sync.timer` | 每分钟 |
| `dafeiyu-v2-issue-reconcile.timer` | 每 10 分钟 |
| `dafeiyu-v2-feishu-outbox.timer` | 每分钟 |
| `dafeiyu-v2-db-backup.timer` | 香港时间每日 03:30 |

执行 `systemctl enable --now <计时器>` 启用各项任务。用 `systemctl list-timers 'dafeiyu-v2-*'` 查看触发时间，用 `journalctl -u <服务>` 检查执行结果。
