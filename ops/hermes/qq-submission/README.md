# dafeiyu-qq-submission

Hermes Agent v0.21.0 的 QQ 群投稿插件。它拦截 `qqbot` 消息：群内只接受
`投稿`（兼容前面带一个 `/`），私聊和其他群消息只 `skip`，不会把 QQ 流量交给 Agent。

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

## 用法

Hermes 的 QQ 适配器只把群里 @机器人 的消息推给插件，`event.text` 已去掉 @ 前缀，
因此命令直接从 `投稿` 开始，兼容一个前导 `/`：

```text
@机器人 投稿 早安 世界 deepseek + 图片
@机器人 /投稿 早安 世界 蓝色大肥鱼 + 图片
```

- 命令词必须是 `投稿` 或 `/投稿`，且后面必须是空白或消息结尾；`投稿xxx` 按非投稿消息静默 `skip`。
- 去掉命令词后按空白切分，最后一个词是角色，其余部分是标题；标题可以包含空格。
- 角色必填，支持 `characters.json` 中的 id / 别名，大小写不敏感；也兼容
  `角色:deepseek` / `角色：deepseek`。
- 只支持本条消息内联的 `image/*` 附件。Hermes 会把引用/回复消息里的图片追加到
  `event.media_urls` 末尾；插件按本条 `raw_message.attachments` 的内联图片数量截取前缀，
  引用图片不会提交。
- 标题按 64 个字符兜底校验。已核对 `server/adapters/qq.mjs` 与
  `server/config.mjs`，QQ 入站路径未声明标题/名称长度上限，因此使用插件约定值 64。

## 参数错误提示

参数错误时回复原消息（`reply_to` 原 `message_id`）后 `skip`。标题/角色问题优先于图片问题，
一次只提示一条；每条提示末尾都会附：

```text
格式：@机器人 投稿 标题 角色 + 图片（例：@机器人 投稿 早安 deepseek）
```

| 情况 | 提示正文 |
| --- | --- |
| 只有 `投稿` | `缺少标题和角色` |
| 命令后只有一个已知角色 | `缺少标题` |
| 命令后只有一个未知词 | `缺少角色` |
| 最后一个词不是已知角色 | `角色「xxx」不存在，可用：<所有角色 id，用 / 分隔>` |
| 标题超过 64 个字符 | `标题太长` |
| 没有内联图片 | `缺少图片` |
| 有引用/回复且内联图片为 0 | `只支持在同一条消息里附图，不支持引用或回复的图片` |

## 行为

1. 非 `qqbot` 消息返回 `None`，不改变 Hermes 正常分发。
2. 所有 `qqbot` 消息返回 `skip`；私聊不回复。
3. 群消息必须是 `投稿` / `/投稿` 开头，且命令词后为空白或消息结尾。
4. 合法投稿按“标题 + 最后一个角色词”解析；角色别名会归一成 `characters.json` 的 id。
5. 先校验标题和角色，再校验内联图片；参数不合法时回复对应提示并 `skip`。
6. 每张内联图片单独 POST。请求体字段为 `groupId`、`userId`、`messageId`、`name`、
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

测试只使用临时文件和 mock `urllib.request.urlopen`，不会连接投稿服务或 QQ。当前覆盖：
无斜杠 / 兼容斜杠命令、`投稿xxx` 静默、别名与角色前缀、标题含空格、各参数错误提示、
标题边界、引用图片排除，以及内联 + 引用混合时只提交内联图片。

## 限速

按 Asia/Shanghai 自然小时计数，默认每小时最多接收 10 张新入库图片。整点重置，未使用次数不累计；只有投稿服务返回 `202` 的新图片占用名额，重复（`200`）和失败不占名额。多图逐张提交，达到上限后停止并提示。成功回复会带上本小时剩余次数与重置时间。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DAFEIYU_QQ_HOURLY_LIMIT` | `10` | 每个自然小时允许新入库的图片上限 |
| `DAFEIYU_QQ_RATE_FILE` | 插件目录下 `rate_state.json` | 保存整点计数，内容形如 `{"hour":"2026-09-29T14","count":N}` |
