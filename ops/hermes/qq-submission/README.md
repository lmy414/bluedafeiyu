# dafeiyu-qq-submission

Hermes Agent v0.21.0 的 QQ 群投稿插件。它拦截 `qqbot` 消息：群内只接受
`/投稿`，私聊和其他群消息只 `skip`，不会把 QQ 流量交给 Agent。

## 文件

- `plugin.yaml`：Hermes 插件清单，注册 `pre_gateway_dispatch`。
- `__init__.py`：同步 hook，入站请求通过标准库 `urllib` 在 `asyncio.to_thread`
  中执行。
- `characters.json`：站点角色 id / 别名副本。
- `sync_characters.py`：从仓库 `data/characters.json` 刷新副本；插件部署后可不要此脚本。
- `test_plugin.py`：离线单元测试，假 event / gateway / HTTP。

## 部署

将插件文件放到容器内：

```text
~/.hermes/plugins/dafeiyu-qq-submission/
```

至少复制 `plugin.yaml`、`__init__.py`、`characters.json`。不引入第三方 Python 依赖，
使用 Hermes 自带运行时的标准库即可。

Hermes 侧环境变量：

| 变量 | 说明 |
| --- | --- |
| `DAFEIYU_QQ_INBOUND_URL` | 投稿服务 QQ 入站地址；默认 `https://xn--pssy23gqgbz2d718b.com/api/v1/adapters/qq/events` |
| `DAFEIYU_QQ_INBOUND_TOKEN` | 必填；对应服务端 `SUBMISSION_QQ_INBOUND_TOKEN`，通过 `Authorization: Bearer ...` 发送 |

Hermes 的 `QQ_APP_ID` / `QQ_CLIENT_SECRET`、QQ 平台 `qqbot` 的
`group_policy=allowlist` 与 `group_allow_from`，以及 `config.yaml` 的
`plugins.enabled` 条目，均属于仓库外配置；精确键名、层级和取值格式**部署时核实**。
其中 `group_allow_from` 的精确取值和 `plugins.enabled` 中的实际加载名部署时核实。

服务端还需核实 `SUBMISSION_QQ_ENABLED=true`、`SUBMISSION_QQ_INBOUND_TOKEN` 与
`SUBMISSION_QQ_GROUP_ALLOWLIST` 已配置，且白名单包含同一个群 openid。

## 行为

1. 非 `qqbot` 消息返回 `None`，不改变 Hermes 正常分发。
2. 所有 `qqbot` 消息返回 `skip`；私聊不回复。
3. 群消息必须是 `/投稿` 开头，且 `/投稿` 后为空白或消息结尾。
4. 末尾词命中角色 id / 别名，或写成 `角色:xxx` / `角色：xxx` 时，作为
   `character`；其余内容是标题。
5. 标题为空或没有 `image/*` 附件时，回复
   `格式：@机器人 /投稿 标题 角色 + 图片`。
6. 每张图片单独 POST。请求体字段为 `groupId`、`userId`、`messageId`、`name`、
   `character`、`image.base64`；多图共用原消息 `messageId`。
7. HTTP 202 视为新入库，HTTP 200 视为重复；其他状态和网络异常回复简短失败原因。

## 请求与响应契约

契约来自本站仓库的 `server/http.mjs` 与 `server/adapters/qq.mjs`：

- 入口：`POST /api/v1/adapters/qq/events`
- 鉴权：`Authorization: Bearer <SUBMISSION_QQ_INBOUND_TOKEN>`
- 内容类型：`application/json`
- 图片字段：`image.base64`（也兼容 Data URL 前缀，但插件发送纯 base64）
- 新入库：HTTP `202`，`{"ok":true,"id":"...","status":"..."}`
- 重复：HTTP `200`，`{"ok":true,"id":"...","status":"..."}`
- 错误：HTTP `4xx/5xx`，`{"ok":false,"error":"..."}`

## 同步角色

在仓库内维护时运行：

```powershell
python ops/hermes/qq-submission/sync_characters.py
```

部署到容器后，如果站点角色表更新，重新复制新的 `characters.json` 并让 Hermes 重新加载该插件
（具体重载方式部署时核实）。

## 测试

```powershell
python -m unittest discover -s ops/hermes/qq-submission -v
```

测试只使用临时文件和 mock `urllib.request.urlopen`，不会连接投稿服务或 QQ。
