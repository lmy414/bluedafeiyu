# Hermes v2 切换与回滚

操作在 `locvps-hk` 宿主机执行。`hermes-webui` 容器继续通过 SSH 调用 `/usr/local/sbin/dafeiyu-hermes-bridge agent-tool`。两套站点分别使用自己的数据库和发布目录。

## 切换前

1. 检查 `curl -fsS http://127.0.0.1:4331/api/v1/health`。确认 v2 的 `/api/v1/internal/agent`、`/cms-api/agent`、`/cms-api/video-agent`、`/cms-api/request-agent` 和 `/cms-api/submissions/sync` 已完成联调。v2 的 `HERMES_REVIEW_TOKEN` 和 `ADMIN_WORKER_TOKEN` 须与旧桥接进程取得的值一致。
2. 暂停 `dafeiyu-review-cycle` 并等待当前审核结束。记录旧站的发布、Issue 对账和 QQ 入站配置。主域正式切流前，按架构方案暂停旧站写入并完成增量数据同步。
3. 备份宿主机环境文件和桥接命令。以 root 执行，将打印的目录记入切流记录。

   ```bash
   backup=$(mktemp -d /root/dafeiyu-v2-hermes.XXXXXX)
   cp -a /etc/dafeiyu/hermes.env "$backup/hermes.env"
   cp -a /usr/local/sbin/dafeiyu-hermes-bridge "$backup/bridge"
   printf '%s\n' "$backup"
   ```

## 切到 v2

在 `/etc/dafeiyu/hermes.env` 中设置两个地址。维护现有文件权限，沿用原令牌。

```dotenv
HERMES_REVIEW_API_URL=http://127.0.0.1:4331
HERMES_ADMIN_API_URL=http://127.0.0.1:4331
```

检查宿主机 `/srv/apps/dafeiyu/source/ops/hermes/tool.mjs` 中的 `const base`。旧版后台地址写死为 `http://127.0.0.1:3100`。如果仍是这个版本，在宿主机复制并修改工具文件，再让固定桥接命令使用副本。以下命令要求在同一个 root shell 中保留上节的 `backup` 变量。

```bash
(
  set -euo pipefail
  source_tool=/srv/apps/dafeiyu/source/ops/hermes/tool.mjs
  grep -Fq ": 'http://127.0.0.1:3100';" "$source_tool"
  sed "s|: 'http://127.0.0.1:3100';|: (env.HERMES_ADMIN_API_URL || 'http://127.0.0.1:3100');|" \
    "$source_tool" > "$backup/tool-v2.mjs"
  grep -Fq 'env.HERMES_ADMIN_API_URL' "$backup/tool-v2.mjs"
  /usr/bin/node --check "$backup/tool-v2.mjs"
  install -D -o root -g root -m 0644 "$backup/tool-v2.mjs" /usr/local/lib/dafeiyu-v2/hermes-tool.mjs

  grep -Fq '/usr/bin/node ops/hermes/tool.mjs' "$backup/bridge"
  sed 's|/usr/bin/node ops/hermes/tool.mjs|/usr/bin/node /usr/local/lib/dafeiyu-v2/hermes-tool.mjs|' \
    "$backup/bridge" > "$backup/bridge-v2"
  bash -n "$backup/bridge-v2"
  install -o root -g root -m 0755 "$backup/bridge-v2" /usr/local/sbin/.dafeiyu-hermes-bridge-v2
  mv -T /usr/local/sbin/.dafeiyu-hermes-bridge-v2 /usr/local/sbin/dafeiyu-hermes-bridge
)
```

在 Hermes 容器内用现有 SSH 配置跑只读探针。每个返回对象的 `status` 应为 `200`，队列应来自 v2。随后用一条联调用投稿验证领取、看原图、英日编辑和提交。

```bash
for target in submission admin videos requests; do
  printf '{"target":"%s","action":"list"}\n' "$target" |
    ssh -o BatchMode=yes codex-host sudo -n /usr/local/sbin/dafeiyu-hermes-bridge agent-tool
done
```

验证后恢复原审核任务。正式切流时停用旧站批量发布和旧 Issue 对账任务，启用 v2 对应计时器。

QQ 插件读取 `DAFEIYU_QQ_INBOUND_URL`。测试时可将它设为 `https://v2.xn--pssy23gqgbz2d718b.com/api/v1/adapters/qq/events`，并按现有容器部署流程重新加载环境。v2 的 `QQ_INBOUND_TOKEN` 须与容器的 `DAFEIYU_QQ_INBOUND_TOKEN` 一致。使用默认主域地址的容器会随 Nginx 切流，无须改环境。检查一条测试群投稿的入队状态。

## 回滚

暂停审核任务并等待当前调用结束。恢复备份的 `/etc/dafeiyu/hermes.env` 与固定桥接命令，然后重跑只读探针，确认队列回到旧站。若已切主域，同时恢复旧 Nginx 配置和 QQ 入站目标，再恢复旧写入和发布任务。切流期间新增的 v2 记录留在 v2，回滚后单独对账。

```bash
cp -a "$backup/hermes.env" /etc/dafeiyu/hermes.env
install -o root -g root -m 0755 "$backup/bridge" /usr/local/sbin/.dafeiyu-hermes-bridge-rollback
mv -T /usr/local/sbin/.dafeiyu-hermes-bridge-rollback /usr/local/sbin/dafeiyu-hermes-bridge
```
