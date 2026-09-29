/* server/notify.mjs —— 投稿服务的飞书群通知（零依赖、尽力而为）
 *
 * 只发群消息，不走私聊。三项 FEISHU_NOTIFY_* 环境变量缺任一即关闭；
 * 发送失败只告警，不向队列或发布流程抛错。
 */
const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
const REQUEST_TIMEOUT_MS = 5000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const SOURCE_LABELS = Object.freeze({
  'github-issue': 'GitHub',
  web: '站内',
  qq: 'QQ群',
  local: '本地',
  manual: '手动',
});

const REVIEW_LABELS = Object.freeze({
  auto_passed: 'AI 通过',
  auto_rejected: 'AI 拒绝',
  needs_manual: '转人工',
  approved: '人工通过',
  rejected: '人工拒绝',
});

function filled(value, fallback = '(未填)') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function sourceLabel(value) {
  const source = String(value || '');
  return SOURCE_LABELS[source] || source || '未知';
}

function actorOf(item) {
  const history = Array.isArray(item?.stateHistory) ? item.stateHistory : [];
  return filled(history.length ? history[history.length - 1].actor : '', 'system');
}

function receivedText(item = {}) {
  const lines = [
    `📥 收到投稿｜来源：${sourceLabel(item.source)}`,
    `标题：${filled(item.fields?.name)}`,
    `角色：${filled(item.fields?.character)}`,
    `投稿 id：${filled(item.id, '(无)')}`,
  ];
  if (item.source === 'github-issue' && item.origin?.issueUrl) {
    lines.push(`Issue 链接：${item.origin.issueUrl}`);
  }
  return lines.join('\n');
}

function reviewedText(item = {}, { from, to, reason } = {}) {
  const status = REVIEW_LABELS[to] || REVIEW_LABELS[from] || to || from || '未知';
  return [
    `🔎 审核结果｜${status}`,
    `标题：${filled(item.fields?.name)}`,
    `来源：${sourceLabel(item.source)}`,
    `投稿 id：${filled(item.id, '(无)')}`,
    `操作者：${actorOf(item)}`,
    `理由：${filled(reason)}`,
  ].join('\n');
}

function summaryCount(summary, key) {
  const value = Number(summary?.[key] ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function publishedText({ ok, runId, summary, error, siteUrl } = {}) {
  const success = Boolean(ok);
  const lines = [
    success ? '🚀 上线成功' : '❌ 上线失败',
    `runId：${filled(runId, '(无)')}`,
    `新增：${summaryCount(summary, 'added')}｜修改：${summaryCount(summary, 'updated')}｜隐藏：${summaryCount(summary, 'hidden')}｜删除：${summaryCount(summary, 'deleted')}｜专题：${summaryCount(summary, 'topics')}`,
    success ? `站点：${filled(siteUrl)}` : `错误：${filled(error?.message || error, '未知错误')}`,
  ];
  return lines.join('\n');
}

function noopNotifier() {
  return {
    enabled: false,
    async send() {},
    async received() {},
    async reviewed() {},
    async published() {},
  };
}

export function createNotifier({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const sourceEnv = env || {};
  const appId = String(sourceEnv.FEISHU_NOTIFY_APP_ID || '').trim();
  const appSecret = String(sourceEnv.FEISHU_NOTIFY_APP_SECRET || '').trim();
  const chatId = String(sourceEnv.FEISHU_NOTIFY_CHAT_ID || '').trim();
  if (!appId || !appSecret || !chatId) return noopNotifier();

  let tokenCache = null;
  let tokenInFlight = null;

  function warn(message) {
    try {
      logger?.warn?.(message);
    } catch { /* 告警本身也不能影响调用方 */ }
  }

  async function requestJson(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`飞书返回非 JSON（HTTP ${response?.status ?? 'unknown'}）`);
      }
      if (response?.ok === false || (data?.code !== undefined && data.code !== 0)) {
        throw new Error(data?.msg || `飞书请求失败（HTTP ${response?.status ?? 'unknown'}）`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function tenantAccessToken() {
    if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    if (tokenInFlight) return tokenInFlight;

    const pending = (async () => {
      const data = await requestJson(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const token = String(data?.tenant_access_token || '');
      if (!token) throw new Error(data?.msg || '飞书令牌响应缺少 tenant_access_token');
      const expireSeconds = Number(data?.expire);
      const ttlMs = Number.isFinite(expireSeconds) && expireSeconds > 0
        ? Math.max(0, expireSeconds * 1000 - TOKEN_REFRESH_MARGIN_MS)
        : 0;
      tokenCache = { token, expiresAt: Date.now() + ttlMs };
      return token;
    })();
    tokenInFlight = pending;
    try {
      return await pending;
    } finally {
      if (tokenInFlight === pending) tokenInFlight = null;
    }
  }

  async function send(text) {
    try {
      const token = await tenantAccessToken();
      await requestJson(MESSAGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: String(text ?? '') }),
        }),
      });
    } catch (error) {
      warn(`飞书群通知失败：${error?.message || error}`);
    }
  }

  return {
    enabled: true,
    send,
    received(item) {
      return send(receivedText(item));
    },
    reviewed(item, detail) {
      return send(reviewedText(item, detail));
    },
    published(detail) {
      return send(publishedText(detail));
    },
  };
}
