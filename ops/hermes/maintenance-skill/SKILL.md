---
name: dafeiyu-server-maintenance
description: 查看或清理蓝色大肥鱼服务器的过期原图、旧发布版本、日志和下载缓存，查看维护报告。
---

# 服务器定期维护

维护在香港服务器宿主机执行。Hermes 通过现有 SSH 桥接调用，容器内的目录不能当作宿主机目录。

每天北京时间 04:15，服务器执行原图和磁盘维护。04:30，Hermes 把结果投递到用户的飞书私聊。飞书投递由原生 cron 完成，不调用模型，也不向 QQ 发维护消息。

## 调用方式

查看最新报告：

```bash
ssh codex-host sudo -n /usr/local/sbin/dafeiyu-hermes-bridge maintenance-report
```

预览可清理对象：

```bash
ssh codex-host sudo -n /usr/local/sbin/dafeiyu-hermes-bridge maintenance-plan
```

用户要求立即清理时执行：

```bash
ssh codex-host sudo -n /usr/local/sbin/dafeiyu-hermes-bridge maintenance
```

## 清理范围

- 投稿原图沿用现有队列规则：超过 14 天且尚未释放的本地副本。保留投稿记录、状态历史和 GitHub 图片。
- 三个发布目录各保留当前版本及最近两个历史版本。
- 清理超过 30 天且未被近期读取的归档文本日志，保留当前日志。
- systemd 日志轮转后，清理超过 14 天的归档，归档总量限制为 200 MiB。
- npm 下载缓存保留 14 天，npm 日志保留 30 天。
- Hermes 网页、执行输出、截图和视觉临时缓存保留 7 天。图片附件、文档附件、会话、数据库、记忆和凭据保留。
- Node 临时编译缓存保留 7 天，清理 APT 下载的安装包。

维护程序持有发布锁。目录出现软链或当前版本异常时跳过并报告，不能临时扩大删除范围。

## 报告规则

报告包含原图数、旧版本数、过期文件数、本轮释放空间、磁盘余量和健康检查。失败项照实报告。超过 20 小时或早于本轮 04:15 的报告会被拒绝，不能说成本次维护完成。

不要再创建第二个执行清理的定时任务。服务器 systemd 执行清理，Hermes cron 只读取和投递结果。
