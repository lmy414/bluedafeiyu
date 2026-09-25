# Cloudflare CDN 配置方案

> 状态：调研稿（2026-09-25）。**未实施、未提交。**
>
> 文中事实均为实测：DNS 走 AliDNS DoH 查询，响应头与证书链取自线上，脚本取自本仓 `ops/`。
> 站点形态、发布拓扑见 [`docs/维护与发布.md`](../archive/2026-09-24/docs/维护与发布.md)。

---

## 0. 最快路径：3 步就是全部

只想要「把 CDN 开起来」的话，后面都不用读。全部在面板里点：

1. **CF 添加站点** → 拿到分配的两台 NS → 去万网把 NS 改掉（等生效，通常几分钟到几小时）。
2. **核对记录**：CF 自动导入的 `@`、`www` 两条 A 是否都指向 `47.242.248.43`？确认无误后把两条都点成**橙云**（Proxied）。
3. **SSL/TLS → 显式选 Full (Strict)**。默认那项叫 `Automatic SSL/TLS`，它可能自动退化成 Flexible，所以要手动选。

完事。**缓存不用配** —— 源站已有的 `Cache-Control` 已经把分层做对了（HTML / JSON 不缓存、`?v=` 资源一年、图片七天），CF 默认行为正好照做。

### 只有两条「不能做」，而且都是别点某个开关

| 别做的事 | 代价 |
|---|---|
| **别选 Flexible**（SSL 模式） | CF 以 HTTP 回源，撞上源站 80 端口的 301 → **无限重定向，站点直接打不开** |
| **别开 Always Use HTTPS** | 12 月证书续期会失败。这开关默认关闭，不动它就行（源站自己已经在做 80→443 跳转） |

### 后面所有内容都是可选的

§1–§8 是「要不要上」的判断和分层加固，跳过只会少点收益，不会坏站：

| 跳过的东西 | 少了什么 |
|---|---|
| Cache Rules / Tiered Cache | 多回源几次，省带宽效果打折 |
| 真实 IP + 安全组锁源站 | 日志里是 CF 的 IP；源站可被直连绕过 |
| 发布后清缓存钩子 | 忘了 bump `?v=` 时会痛 |
| 健康检查 cache-buster | 图片那步检查可信度降低，不影响站点 |

回滚同样简单：**橙云一关**就回到直连。

---

## 1. 结论

**CF 免费版能给这个站省钱、扛攻击、加快海外访问，但对「中国大陆访客」基本不加速。**

原因很硬：CF 免费版的 Anycast 边缘**没有中国大陆节点**，而源站在香港。大陆访客走 CF 等于「大陆 → 海外边缘 → 回香港源站」，比直连香港多一跳绕行，常常更慢。

所以这不是「配置对不对」的问题，是**访客在哪**的问题：

| 访客构成 | 建议 |
|---|---|
| 大陆为主 | 上 CF 图的是**省源站带宽 + 抗攻击**，别指望提速；要真加速只有换境内源站（+备案） |
| 海外 / 港澳台为主，或访客普遍有代理 | 直接上，收益明确 |
| 说不清 | 先按 §4 做双轨实测再决定 |

---

## 2. 实测现状（2026-09-25）

| 项 | 值 |
|---|---|
| 源站 | `47.242.248.43`（阿里云香港）nginx/1.24.0 (Ubuntu) |
| 站点根 | `/srv/www/dafeiyu/current` → `releases/<时间戳>`（原子切链） |
| DNS | 万网 `dns15/dns16.hichina.com`，只有 `@`、`www` 两条 A → 47.242.248.43 |
| 邮箱记录 | **无 MX / TXT / CAA** → 域名上没有邮箱，迁 NS 不会踩坏邮件 |
| 证书 | Let's Encrypt，SAN 只有 `@` 和 `www`，2026-09-18 → **2026-12-17**（90 天，webroot HTTP-01 续期） |
| CDN | 无，直连 |
| 压缩 | 源站 gzip + `gzip_static on`（构建期产出 `.gz`），**无 Brotli** |

线上缓存分层（nginx 已做，实测响应头）：

| 资源 | 响应头 | CF 免费版默认会怎么处理 |
|---|---|---|
| HTML、`robots.txt`、`sitemap.xml` | `no-cache` | 不缓存（HTML 默认也不缓存） |
| `data/*.json`、`submissions/works.json` | `no-cache` | 不缓存 |
| `styles.css?v=`、`tokens.css?v=` | `public, max-age=31536000, immutable` | 缓存 1 年（`.css` 在默认缓存扩展名表里） |
| `submissions/previews/*`、`submissions/large/*`（`.webp`） | `public, max-age=604800` | 缓存 7 天（`.webp` 在默认表里） |

**好消息：CF 的默认缓存行为几乎正好等于 nginx 手工做的那套分层。** HTML / JSON 不缓存、`?v=` 资源长缓存、图片 7 天，全部由源站 `Cache-Control` 驱动，第一版基本不需要写 Cache Rules。

先算一笔账：首屏约 0.66 MB（HTML 20 KB + `works.json` 64 KB + CSS 29 KB + 24 张预览图 ≈ 550 KB），其中约 0.6 MB 是能被边缘吃掉的静态资源。**重复访问的源站出网能降到接近 0** —— 这是阿里云香港出网费省下来的真金白银，也是上 CF 最实在的收益。

---

## 3. 先排除三条走不通的路

1. **CF 中国网络**：要 Enterprise + 境内备案 + 京东云落地，个人站无门；且备案本身要求源站在境内。
2. **阿里云 CDN 大陆节点**：要备案，同样要求源站在境内。
3. 所以「真·中国大陆加速」= **把源站换到境内 + 备案**。CF 免费版只能算成本 / 抗打方案，不算加速方案。

---

## 4. 先测后切（建议路径）

**不要直接切 `@`。**

1. 建 `cf-test.<域名>` A → 47.242.248.43，**打开橙云**（Proxied）。
2. 该主机名单独设 **SSL/TLS = Full（不是 Strict）**：现有 LE 证书 SAN 只有 `@` 和 `www`，`cf-test` 不在里面，Strict 会验签失败。测完删掉这条子域。
3. 用境内拨测（17ce / 阿里云站点监控）对 `@`（直连）与 `cf-test`（CF）跑同城同时段的 TTFB 与下载耗时。
4. CF 不明显更差 → 再切 `@` / `www`；明显更差且访客在大陆 → 结论是不上，精力放回源站位置。

---

## 5. 配置步骤

### 5.1 迁 DNS

万网改 NS 为 CF 分配的两台。**CF 免费版必须全量接管 zone**，没有 CNAME 接入（Partial / CNAME Setup 要 Business 起）。

- 迁移前把现存记录抄全：**只有 `@`、`www` 两条 A**；迁完核对一遍。
- 迁完补一条 **CAA**：`0 issue "letsencrypt.org"`（若继续用 LE）。现在没有 CAA，等于允许任何 CA 给这个域签证书。

### 5.2 SSL/TLS 模式：Full (Strict)

源站有有效 LE 证书，用 **Full (Strict)**。

**不要用 Flexible**：CF 会以 HTTP 回源，而源站 80 端口是 301 → 无限重定向。

### 5.3 ACME 续期（唯一必须上服务器验证的坑）

源站 80 端口**已确认**有专门的 `/.well-known/acme-challenge/` location（探测该路径返回 404 而不是 301，说明没被跳转吞掉）。证书 **2026-12-17 到期**。CF 在边缘终结 80 端口，所以要分两种情况：

- CF 官方说 Always Use HTTPS **不影响** HTTP DCV —— 成立的前提是**源站在 443 上也能应答 `/.well-known/acme-challenge/`**（LE 会跟随 http→https 跳转）。443 侧**从外部无法判断**（探测同样返回 404，无法区分是 acme location 还是站点根），必须上服务器确认：
  ```bash
  nginx -T | grep -B2 -A4 acme-challenge
  ```
- **443 的 server 块里有这个 location** → 可以开 Always Use HTTPS。
- **只有 80 的块里有** → 别开，或者改走 DNS-01。

**最省事的默认做法：Always Use HTTPS 保持关闭。** 源站自己已经在做 80 → 443 的 301（实测确认），访客体验完全一样，续期风险为零。

想彻底摆脱 90 天续期：给源站装 **CF Origin CA 证书（15 年）**，LE 停掉。代价是源站证书只对 CF↔源站有效，将来若去掉橙云，直连访客会报证书错。这条路顺带能把 80 端口关掉。

### 5.4 Cache Rules（免费版 10 条，够用）

默认行为已经对了，只补护栏：

1. **Bypass cache**：`http.request.uri.path eq "/" or ends_with(http.request.uri.path, ".html")`
   —— 挡住以后任何「Cache Everything」误伤 HTML，保证切 `current` 立刻可见。
2. **Edge TTL 覆盖 30 天、Browser TTL 沿用源站**：`/submissions/previews/*`、`/submissions/large/*`、`/data/*`（图片）、`/owner-picks/*`
   —— 源站只给 7 天，把**边缘**拉到 30 天能再砍一截回源；浏览器仍 7 天，改图不会长滞。
3. **Bypass cache**：`/data/*.json`、`/submissions/works.json`（默认已不缓存，显式锁死）。
4. 开 **Tiered Cache**（免费）：回源走上层 tier，进一步减少源站命中；开完清一次缓存。

`?v=` 是缓存键的一部分（CF 默认 Standard 缓存级别含查询串），所以 `styles.css?v=18` 与 `?v=19` 是两条缓存 —— 现有 bump 纪律在 CF 下语义不变，但**失效代价从「最长一年拿到旧代码」变成「一年 + 必须清缓存」**。§6.2 的发布后清缓存正好补上这点。

### 5.5 压缩：先不动

- CF 免费版给访客的默认是 **Zstandard**（Brotli 是 Pro 及以上）。
- 但源站已经在回发 `.gz`，而 CF 在源站带 `content-encoding: gzip` 且访客支持时会**原样透传 gzip**，不一定升级。
- 想要更小体积只有两条路：构建期同时产出 `.br`（需要 nginx 有 brotli 模块，现在没有——见 `ops/nginx-performance.conf` 注释），或关掉 `gzip_static` 让 CF 自己压（那样直连源站就没压缩了）。

**结论：压缩这块先不动**，收益小、牵连多。

### 5.6 源站加固（必须和「真实 IP」一起做）

- 阿里云安全组 **443 只放行 CF 的 IP 段**（从 `https://www.cloudflare.com/ips-v4`、`/ips-v6` 取，别手抄；快照见附录）。**SSH 端口不要动。**
- 80 端口保持开放（ACME 续期要用；改走 Origin CA 后可以关）。
- nginx 加真实 IP，否则日志里全是 CF 的 IP：
  ```nginx
  # 追加到 ops/nginx-performance.conf（该片段被 include 进 server{}）
  set_real_ip_from <CF 段...>;   # 见附录
  real_ip_header CF-Connecting-IP;
  real_ip_recursive on;
  ```

⚠️ **顺序很重要**：先做安全组限制，再加 `real_ip_header`。源站 IP 现在是公开的，直接打源站的人可以伪造 `CF-Connecting-IP`；在防火墙锁死之前加这个，等于给日志放水。

不锁源站的后果：任何人拿到 `47.242.248.43` 就能绕过 CF 的全部防护。

### 5.7 其他开关

| 开关 | 建议 |
|---|---|
| HTTP/3 (QUIC) | 开 |
| Min TLS 1.2 + TLS 1.3 | 开 |
| Always Use HTTPS | 见 §5.3，默认先关 |
| Rocket Loader | **关**（会改内联脚本执行时序） |
| Bot Fight Mode | 先关；会给爬虫 / 脚本发挑战，用脚本拉 `works.json` 的调用方可能受影响 |
| Under Attack Mode | 平时关，被打时一键开 —— 上 CF 最实在的收益之一 |
| 源站 HSTS | 源站已有 `includeSubDomains`，CF 透传，无需重复设置 |

---

## 6. 本仓要改的东西

### 6.1 健康检查必须加 cache-buster（**必改**）

`ops/deploy-server.sh` 的 `check_ok` 直接请求 `HEALTH_URL`。切到 CF 之后：

- `/`、`/robots.txt`、`works.json` 源站是 `no-cache`，CF 不缓存 → 没问题；
- 但拿 `previews/*.webp` 回读那一步，**`.webp` 正是 CF 默认缓存 7 天的类型** → CF 会把上一版的图喂回来，检查照样 200，等于「检查通过了，但没检查到新 release」。

最小改法：给检查 URL 拼一个唯一查询串，强制 CF 缓存未命中。

```bash
HEALTH_MARK="hc=$(date +%s)-$$"
...
check_ok "${HEALTH_URL}${path}?${HEALTH_MARK}"
check_ok "${HEALTH_URL}/${PREVIEW_REL}?${HEALTH_MARK}" 1
```

静态文件下 nginx 忽略未知查询参数，行为不变。

### 6.2 发布后清 CF 缓存（强烈建议）

加在**切链成功 + 健康检查通过之后**，且**失败只告警、不中断**（CF 挂了不能挡住发布）：

```bash
if [ -n "${CF_API_TOKEN:-}" ] && [ -n "${CF_ZONE_ID:-}" ]; then
  curl -sS --max-time 20 -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' >/dev/null \
    && log "CF 缓存已清" || log "警告：CF 缓存清理失败（不阻塞发布）"
fi
```

- `CF_API_TOKEN` 用「Zone → Cache Purge」权限的最小权限 token；`CF_ZONE_ID` 在 CF 面板右侧。
- 两个变量**可选**（不要加进 `CONFIG_VARS` 的必填循环），由服务器私有配置提供，不进仓库。
- 顺带好处：**忘 bump `?v=` 也能自愈**。没有这一步，CF 边缘最长一年不回源，一次漏 bump 就是一年。

### 6.3 real-ip 片段

见 §5.6，追加到 `ops/nginx-performance.conf`。

### 6.4 边界文档要改口

归档的 `架构边界.md` 写着「**图片只放 GitHub 仓库，不自建对象存储或 CDN**」。上 CF 等于推翻这条，`AGENTS.md` 的边界叙述要同步改，否则下一个人会被旧规则拦住。

---

## 7. 可选：GitHub 原图加速（另一件事）

下载原图走 `raw.githubusercontent.com`，**不在你的 zone 里，CF 缓存不了**。要加速只有：

- 在 CF 上挂一个 **Worker** 反代 GitHub Raw（如 `gh.<域名>/...`），吃 CF 边缘缓存；或
- 换 **jsDelivr**（改 host 即可，零配置，但历史上在大陆有过解析 / 阻断不稳）。

原图是「点了下载才请求」，不在首屏，收益有限。建议放第二阶段，且**先确认要不要改清单里的原图 URL** —— `AGENTS.md` 明确要求已发布的 Raw 路径不得改名或移动。

---

## 8. 回滚

- **CF 侧**：橙云一关，DNS 立刻回到直连（等 TTL）。这是最干净的开关。
- **源站侧**：做过安全组收紧的，回滚前**先把 443 安全组改回全网放行**，否则关了橙云访客全挂。
- `/data/*` 图片边缘 TTL 拉到 30 天之后，回滚要**记得清一次 CF 缓存**，否则看到旧图。

---

## 附录：CF IP 段快照

2026-09-25 取自官方，取用请以 <https://www.cloudflare.com/ips-v4> 与 `/ips-v6` 为准。

**IPv4**

```text
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/13
104.24.0.0/14
172.64.0.0/13
131.0.72.0/22
```

**IPv6**

```text
2400:cb00::/32
2606:4700::/32
2803:f800::/32
2405:b500::/32
2405:8100::/32
2a06:98c0::/29
2c0f:f248::/32
```
