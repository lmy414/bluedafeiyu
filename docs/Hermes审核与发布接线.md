# Hermes 审核与发布接线

## 职责

Hermes Agent 负责看图初审、中文补全和英日编辑。原生工具通过免密 SSH 访问宿主机的固定桥接命令。工具只读取、校验和保存业务数据，不请求模型接口。

投稿状态保存在 `server/` 私有队列。后台补全和翻译保存在已有 `bulk-jobs`。Hermes 不另建业务队列，不直接编辑数据库、原图或公开清单。发布任务沿用现有执行器，不扩大 Agent 权限。

## 处理流程

```text
新投稿 / 站长提交的补全与翻译任务
  → Hermes Agent 领取一个条目
  → 图片通过多模态工具结果进入当前 Agent 上下文
  → 中文校验与保存
  → 英文校验与保存
  → 日文校验与保存
  → 完整性检查和提交
```

中文、英文和日文分别保存。译文错误返回字段路径，Agent 修正后再次提交。网络、格式和校验问题不把投稿改成待人工。只有内容风险和合规性不确定才提交 `manual`。

完成初审前，投稿仍为 `received`，私有 `agent.stage` 表示处理阶段。后台在“Hermes 处理中 / 待翻译”页签显示排队、待翻译、重试和技术暂挂。初审通过并且英日内容完整后，才进入现有待发布流程。

## 工具和接口

插件在 `ops/hermes/editorial-plugin/`，技能在 `ops/hermes/editorial-skill/`。插件注册 `dafeiyu_editorial` 工具组：

| 工具 | 用途 |
| --- | --- |
| `dafeiyu_tasks` | 查询任务、枚举和规则，同步后台 |
| `dafeiyu_claim` | 领取一个条目，返回领取令牌 |
| `dafeiyu_read` | 读取草稿，或把图片直接交给当前 Agent |
| `dafeiyu_save_draft` | 校验和保存中文字段 |
| `dafeiyu_save_locale` | 分别校验和保存 en、ja |
| `dafeiyu_finish` | 完整性检查和提交结果 |
| `dafeiyu_release` | 技术失败时保存进度并暂挂 |

每次调用把 JSON 参数写入 SSH 标准输入。宿主机只执行固定命令 `dafeiyu-hermes-bridge agent-tool`，不拼接模型提供的 shell 命令。`ops/hermes/tool.mjs` 只访问回环业务接口：

- 投稿：`POST /api/v1/internal/agent`，用 Hermes 审核令牌。
- 后台：`POST /cms-api/agent`，用执行器令牌。
- 同步：`POST /cms-api/submissions/sync`，用执行器令牌。

支持 `list`、`rules`、`claim`、`get`、`image`、`draft`、`locale`、`validate`、`complete` 和 `release`。同步只允许后台目标。密钥在宿主机环境文件里，插件和技能不携带业务密钥。

## 并发、校验与恢复

领取有效期为 10 分钟，保存草稿时续期。每次写入检查领取令牌、任务状态和中文版本摘要。中文变化后，旧译文失效。后台任务还检查提交时的文档指纹，保护人工修改。

每轮最多处理 3 个条目。每条最多修正 3 次或处理 8 分钟，之后 release。跨轮领取最多 3 次，仍未完成则技术暂挂，等待站长检查。中断后保留已校验的草稿和单语言内容，下一轮继续。

发布前仍要求完整的英日内容。未知字段、非法枚举、脚本文本和过期译文继续拒绝。准确的作者姓名仅在来源与授权说明里豁免语言检查，安全检查仍覆盖原文。

现有 `needs_manual` 条目不自动重审。站长可以从后台提交补全和翻译任务，核验后人工收录。不得把历史违规或人工已处理记录批量改成通过。

## 上线

1. 按仓库 Git 流程推送新代码，等待后台 GitHub Actions 测试、构建和 Release 完成。
2. 备份后台数据库、旧发布软链和 Hermes 配置。服务器从 GitHub 更新代码，部署指定 Admin Release。新增迁移只增加 `submissions.agent_progress`。
3. 更新宿主机桥接脚本。把插件和技能从已拉取的仓库安装到 Hermes 用户目录，权限归 Hermes 运行用户。
4. 在容器中运行 `configure-editorial.py`。脚本备份配置，把原 `dafeiyu-review-cycle` 改为 Agent 任务并保持禁用。不要创建第二个审核定时器。
5. 验证主 Agent 模型确实支持原生图片。插件会拒绝未知视觉能力，不回退到辅助模型。当前验证过的任务模型为 `deepseek/deepseek-v4.1-flash`，能力设置只作用于这个模型。
6. 验证 7 个工具已注册，SSH 鉴权成功，字段错误返回 422。用一个条目验证看图、中文、en、ja 和完成结果。
7. 验证成功后启用原审核任务。拉取和发布任务继续保持原配置。普通字段写入和站长已确认的人工收录仍由原 systemd 执行器处理。

旧 `review-cycle --live`、`server/cli.mjs review` 和生产直接审核入口已停用。后台 `/ai-fill` 返回持久化任务编号，页面等待结果。关闭页面不取消任务。

## 验证与回滚

```bash
node --test server/*.test.mjs server/adapters/*.test.mjs ops/hermes/tests/*.test.mjs
python3 -m unittest discover -s ops/hermes/editorial-plugin -p test_plugin.py
cd admin
npm run test:int -- --maxWorkers=1
npx tsc --noEmit
```

线上检查旧直接调用入口返回停用错误、领取令牌过期不能写入、坏日文不会删除中文和英文。只凭 Agent 最后回复不能认定落库成功，必须回读工具结果和队列状态。

回滚时先禁用审核 Agent，恢复备份的 Hermes 配置和任务，再回滚后台发布软链及服务器代码。新增进度列可保留，避免为了回滚删除业务数据。不能在新版停用脚本上直接恢复旧审核定时任务。
