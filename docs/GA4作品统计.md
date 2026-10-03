# GA4 作品统计

作品浏览和下载点击上报到现有 GA4 数据流。后台从 GA4 Data API 读取聚合计数，每小时覆盖一次缓存。前台和后台作品库读取同一份缓存，按累计浏览量或下载点击量排序。

## 统计口径

| 事件 | 触发时机 | 作品标识 |
| --- | --- | --- |
| `work_view` | 打开作品浮层、左右切换作品、直接访问作品地址并打开浮层 | `work_id`，沿用作品稳定 ID |
| `work_download` | 点击“下载原图” | 同上 |

语言切换只重画浮层，不重复计浏览。关闭后重新打开、返回历史中的作品会重新计一次。列表图片加载不计浏览。下载计数表示按钮点击，无法证明外链图片已经保存到设备。浏览量不去重，不是独立访客数。

热度等于累计 `work_view` 次数，不加权。统计区间从 `GA4_START_DATE` 到媒体资源时区下的今天。同分保留原列表顺序。首次打开列表和搜索页时，有统计就默认按下载量降序；未同步时保留原顺序。专题作品范围仍由站长精选，访客可切回精选顺序。

GA4 处理有延迟；新自定义维度通常需要 24～48 小时。未同步时显示“—”，禁用统计排序。同步失败保留上次缓存；超过一天未更新会提示延迟。GA4 抽样、阈值限制或无法归属作品的事件会提示数据限制，不补造计数。

## Google 侧配置

1. 在 Google Cloud 项目中启用 Google Analytics Data API，创建服务账号，生成 JSON 密钥。密钥放在服务器受限目录，不提交到 Git。
2. 在 GA4 媒体资源 `553936531` 的“媒体资源访问权限管理”中，把服务账号 JSON 中的 `client_email` 添加为“查看者”。该资源同时含博客数据流和蓝色大肥鱼数据流。网站数据流 ID 为 `15814452848`，衡量 ID 为 `G-4LWN9Z2WT2`；后台报表按 `streamId` 过滤，前台事件指定 `send_to`，避免混入博客流量。
3. 在“自定义定义”中创建事件范围维度：显示名称“作品 ID”，事件参数为 `work_id`。API 使用 `customEvent:work_id`。应在开始采集前创建，旧的普通页面访问不能直接补成这两种作品事件。

## 服务器配置

服务账号 JSON 建议放在 `/etc/dafeiyu/ga4-service-account.json`，仅允许后台服务用户读取，权限为 `0640` 或更严格。在 `/etc/dafeiyu/admin.env` 中配置：

```dotenv
GA4_PROPERTY_ID=553936531
GA4_STREAM_ID=15814452848
GA4_START_DATE=2026-10-03
GOOGLE_APPLICATION_CREDENTIALS=/etc/dafeiyu/ga4-service-account.json
GA4_CACHE_FILE=/srv/apps/dafeiyu-admin/run/analytics.json
```

后台部署流程沿用 `docs/后台运维.md`，无需数据库迁移。统计文件使用临时文件和原子替换写入，不修改作品和专题，也不标记待发布。

后台启动后，在概览点击“同步 GA4”。核对首次同步结果后，安装定时任务：

```bash
sudo cp ops/systemd/dafeiyu-analytics.service ops/systemd/dafeiyu-analytics.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dafeiyu-analytics.timer
sudo systemctl start dafeiyu-analytics.service
```

定时脚本使用现有 `/etc/dafeiyu/admin-publish.env` 的 `ADMIN_API_URL` 和 `ADMIN_WORKER_TOKEN`。它只调用后台同步接口，不启动发布器。后台服务负责读取 GA4 密钥和写缓存。

## 接口

| 接口 | 权限 | 内容 |
| --- | --- | --- |
| `GET /cms-api/analytics` | 站长或机器人 | 计数、同步时间、配置状态 |
| `POST /cms-api/analytics/sync` | 站长或发布执行器令牌 | 从 GA4 覆盖同步统计 |
| `GET /cms-api/analytics/public` | 公开 | 当前已发布作品计数、统计区间及更新时间 |

公开接口仅提供聚合计数，不返回服务账号、私钥、访问令牌或访客明细；缓存中有下架作品时，接口会过滤。前台每页读取一次，后续卡片和浮层复用结果。统计排序只加载完整范围的元数据，再按每批 24 件显示图片，不下载所有分页 HTML。

nginx 已有 `/cms-api` 反代可复用。确认 Cloudflare 不缓存后台写请求；公开统计接口的应用缓存时间为 5 分钟，现有 nginx 的 `no-store` 设置可能使其不缓存，这不影响正确性。

## 验证

1. 在 GA4 DebugView 或实时事件中确认 `work_view`、`work_download` 和正确的 `work_id`，同时检查浮层换语言不会重复计浏览。
2. 维度处理完成后同步。连续同步两次，相同报表的计数应保持一致。
3. 后台与前台对应作品的计数一致。分类、角色、专题和搜索结果排序只影响各自范围；首页排序包括所有分页作品。
4. 暂时断开读取权限，同步应报错并保留上次数据。后台不产生待发布变更。

参考：[GA4 事件参数](https://developers.google.com/analytics/devguides/collection/ga4/event-parameters)、[服务账号读取报表](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart)、[runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)。
