/* server/http.mjs —— 统一投稿服务的 HTTP 层
 *
 * 两个监听口，职责与信任级别完全不同：
 *
 *   1. **公开入口**（public）：给网页投稿表单用。匿名、限流、严格 Origin/CORS、
 *      字段/格式/魔数/大小校验，响应只回 { ok, id, status }，
 *      **绝不泄露内部路径、sha256、AI 原始结果或存储根**。
 *   2. **管理入口**（admin）：只绑回环、必须配 SUBMISSION_ADMIN_TOKEN，
 *      Bearer 常量时间鉴权；列表 / 原图 / 审核 / 决定 / 拉取 Issue 都在这里。
 *
 * QQ 机器人侧走公开口的 POST /api/v1/adapters/qq/events，它自带令牌与群白名单鉴权。
 *
 * 这里只做「HTTP -> 队列/审核/适配器」的映射，不含业务判断。
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { DEFAULT_TURNSTILE_TIMEOUT_MS, configSummary, isIpAddress, isTrustedProxy, normalizeIp } from './config.mjs';
import { STATES, sha256 } from './queue.mjs';
import { reviewQueuedItem } from './review.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Cloudflare Turnstile 服务端校验地址（公开、无需鉴权，走服务端 secret）。 */
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        // 不销毁 socket：先把余下的请求体排空，再让处理器回 413，
        // 否则客户端只会看到 ECONNRESET 而不是明确的错误码。
        failed = true;
        chunks.length = 0;
        req.resume();
        reject(Object.assign(new Error(`请求体超过上限 ${maxBytes} 字节`), { code: 'TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', (error) => { if (!failed) reject(error); });
  });
}

function boundaryOf(contentType) {
  const match = /boundary="?([^";]+)"?/i.exec(String(contentType || ''));
  return match ? match[1] : '';
}

/** 逐段解析 Content-Disposition 参数，避免 `filename="a"` 里的 `name=` 被误当成属性名。 */
function parseDisposition(rawHeaders) {
  const line = /content-disposition:[^\r\n]*/i.exec(String(rawHeaders || ''));
  if (!line) return { name: '', filename: null };
  const params = {};
  for (const segment of line[0].split(';').slice(1)) {
    const eq = segment.indexOf('=');
    if (eq < 0) continue;
    const key = segment.slice(0, eq).trim().toLowerCase();
    let value = segment.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    params[key] = value;
  }
  return { name: params.name || '', filename: params.filename ?? null };
}

/**
 * 极简 multipart/form-data 解析：只够投稿表单用。
 * - 必须有 boundary；
 * - 最多 20 个 part，超过即拒绝；
 * - 字段名与文件分开返回；
 * - 不解析嵌套 multipart。
 */
export function parseMultipartForm(buffer, contentType, { maxBytes = Infinity, maxParts = 20 } = {}) {
  if (!/multipart\/form-data/i.test(String(contentType || ''))) {
    throw new Error('只接受 multipart/form-data');
  }
  const boundary = boundaryOf(contentType);
  if (!boundary) throw new Error('multipart 缺少 boundary');
  if (buffer.length > maxBytes) throw new Error(`请求体超过上限 ${maxBytes} 字节`);

  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let index = buffer.indexOf(delimiter);
  if (index < 0) throw new Error('multipart 结构与 boundary 不匹配');
  index += delimiter.length;
  while (index < buffer.length) {
    // 结束标记 --boundary--
    if (buffer[index] === 0x2d && buffer[index + 1] === 0x2d) break;
    // 跳过 CRLF
    if (buffer[index] === 0x0d && buffer[index + 1] === 0x0a) index += 2;
    const next = buffer.indexOf(delimiter, index);
    if (next < 0) throw new Error('multipart 未正常结束');
    let chunk = buffer.subarray(index, next);
    // 去掉结尾 CRLF
    if (chunk.length >= 2 && chunk[chunk.length - 2] === 0x0d && chunk[chunk.length - 1] === 0x0a) {
      chunk = chunk.subarray(0, chunk.length - 2);
    }
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd < 0) throw new Error('multipart part 缺少头部');
    const rawHeaders = chunk.subarray(0, headerEnd).toString('latin1');
    const data = chunk.subarray(headerEnd + 4);
    const disposition = parseDisposition(rawHeaders);
    const part = {
      name: disposition.name,
      filename: disposition.filename && disposition.filename !== '' ? disposition.filename : null,
      data,
    };
    parts.push(part);
    if (parts.length > maxParts) throw new Error(`multipart part 数超过上限 ${maxParts}`);
    index = next + delimiter.length;
  }

  const fields = {};
  const files = [];
  for (const part of parts) {
    if (part.filename !== null && part.filename !== '') files.push(part);
    else if (part.name) fields[part.name] = part.data.toString('utf8');
  }
  return { fields, files };
}

function authorized(req, token) {
  const header = String(req.headers.authorization || '');
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(String(token || ''));
  return given.length === expected.length && given.length > 0 && timingSafeEqual(given, expected);
}

/**
 * 解出用于限流的客户端 IP。
 *
 * 只有显式配置了可信代理网段、且 TCP 对端确实落在网段里，才解析 X-Forwarded-For；
 * 否则永远用 socket 上的对端地址，匿名请求无法靠伪造 XFF 绕过限流。
 * XFF 从右往左找第一个非可信地址：右侧是最后一跳代理写入的、最可信。
 */
export function resolveClientIp(req, trustedCidrs = []) {
  const remote = normalizeIp(req && req.socket ? req.socket.remoteAddress : '');
  if (!Array.isArray(trustedCidrs) || trustedCidrs.length === 0) return remote || 'unknown';
  if (!isTrustedProxy(remote, trustedCidrs)) return remote || 'unknown';

  const headers = (req && req.headers) || {};
  const chain = String(headers['x-forwarded-for'] || '')
    .split(',')
    .map((entry) => normalizeIp(entry))
    .filter((entry) => isIpAddress(entry));
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!isTrustedProxy(chain[i], trustedCidrs)) return chain[i];
  }
  if (chain.length > 0) return chain[0];

  const real = normalizeIp(headers['x-real-ip']);
  if (isIpAddress(real) && !isTrustedProxy(real, trustedCidrs)) return real;
  return remote || 'unknown';
}

/**
 * 内存滑动窗口限流。两个防内存放大措施：
 *   - 惰性清理：每到下一个窗口就扫一遍，删掉已过期的桶；
 *   - key 上限：桶数触顶时淘汰最旧的键（插入序），IPv6 轮换也无法把 Map 撑爆。
 * 返回的 allow 带一个只读 size，便于测试观察桶数。
 */
export function createRateLimiter({ max, windowMs, maxKeys = 5000, now = () => Date.now() }) {
  const buckets = new Map();
  let nextSweepAt = 0;

  function sweep(at) {
    for (const [key, entry] of buckets) {
      if (at >= entry.resetAt) buckets.delete(key);
    }
    nextSweepAt = at + windowMs;
  }

  function allow(key) {
    const at = now();
    if (at >= nextSweepAt) sweep(at);
    let entry = buckets.get(key);
    if (entry && at >= entry.resetAt) {
      buckets.delete(key);
      entry = undefined;
    }
    if (!entry) {
      if (buckets.size >= maxKeys) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      buckets.set(key, { count: 1, resetAt: at + windowMs });
      return { allowed: true, retryAfter: windowMs };
    }
    if (entry.count >= max) return { allowed: false, retryAfter: Math.max(1, entry.resetAt - at) };
    entry.count += 1;
    return { allowed: true, retryAfter: 0 };
  }

  Object.defineProperty(allow, 'size', { get: () => buckets.size });
  return allow;
}

/**
 * Turnstile 服务端校验：POST form 到 siteverify。
 * 任何异常（缺 token、网络错误、超时、非 2xx、success 不为 true）都返回 false，
 * 即 fail-closed——宁可不收，也不放过未验证的投稿。
 */
export function createTurnstileVerifier({
  secret,
  timeoutMs = DEFAULT_TURNSTILE_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  return async function verify(token, { remoteip = '' } = {}) {
    if (!secret || !token) return false;
    if (typeof fetchImpl !== 'function') return false;
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('turnstile verify timeout'));
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      const body = new URLSearchParams({ secret: String(secret), response: String(token) });
      if (remoteip) body.set('remoteip', String(remoteip));
      const response = await Promise.race([
        fetchImpl(TURNSTILE_VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: controller.signal,
        }),
        timeout,
      ]);
      if (!response || !response.ok) return false;
      const data = await response.json().catch(() => null);
      return Boolean(data && data.success === true);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}

function validateSubmissionFields(fields, characters, { characterMaxLength = 64 } = {}) {
  const name = String(fields.name || '').trim();
  if (!name || name.length > 120) return { error: '名称必填且不超过 120 字' };
  const character = String(fields.character || '').trim();
  if (!character) return { error: '角色必填' };
  if (character.length > characterMaxLength) return { error: `角色不超过 ${characterMaxLength} 字` };
  if (Array.isArray(characters) && characters.length > 0 && !characters.includes(character)) {
    return { error: '角色不在允许列表内' };
  }
  const description = String(fields.description || '').trim();
  if (description.length > 500) return { error: '说明不超过 500 字' };
  return { fields: { name, character, description } };
}

/* 标准 base64 字母表 + 可选补位；逗号不是合法字符，出现即视为 data: URI 或垃圾输入。 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * 严格解码 JSON 投稿里的图片：拒绝 data: 前缀、含逗号、非法字符、空白与错误长度，
 * 解码后超过图片上限抛 TOO_LARGE（外层映射 413），其余非法输入抛 INVALID_BASE64（400）。
 */
function decodeBase64Image(value, maxBytes) {
  const text = String(value ?? '');
  if (!text.trim()) throw Object.assign(new Error('缺少图片内容'), { code: 'INVALID_BASE64' });
  if (/^data:/i.test(text) || text.includes(',')) {
    throw Object.assign(new Error('不接受 data: 前缀或含逗号的图片内容'), { code: 'INVALID_BASE64' });
  }
  if (text.length % 4 === 1 || !BASE64_PATTERN.test(text)) {
    throw Object.assign(new Error('图片内容不是合法的 base64'), { code: 'INVALID_BASE64' });
  }
  const buffer = Buffer.from(text, 'base64');
  if (buffer.length === 0) throw Object.assign(new Error('图片内容为空'), { code: 'INVALID_BASE64' });
  if (buffer.length > maxBytes) {
    throw Object.assign(new Error(`图片超过大小上限 ${maxBytes} 字节`), { code: 'TOO_LARGE' });
  }
  return buffer;
}

function queueErrorStatus(error) {
  const message = String(error && error.message);
  if (error && error.code === 'TOO_LARGE') return 413;
  if (/超过大小上限|超过上限/.test(message)) return 413;
  if (/图片格式|扩展名|空文件|不支持/.test(message)) return 400;
  return 400;
}

/* ---------------------------------------------------------------- 公开入口 */

export function createPublicHandler({
  cfg,
  queue,
  qqAdapter,
  characters = [],
  turnstileVerify = null,
  now = () => Date.now(),
  logger = console,
} = {}) {
  const allowRate = createRateLimiter({ ...cfg.rateLimit, now });
  // 配了 secret 却没注入测试客户端时，才构造真实的 siteverify 客户端；测试注入优先。
  const verifyTurnstile = turnstileVerify
    || (cfg.turnstile.enabled
      ? createTurnstileVerifier({ secret: cfg.turnstile.secret, timeoutMs: cfg.turnstile.timeoutMs })
      : null);

  return async function publicHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const origin = req.headers.origin;

      if (origin) {
        if (!cfg.allowedOrigins.includes(origin)) {
          return sendJson(res, 403, { ok: false, error: 'origin not allowed' });
        }
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/health') {
        return sendJson(res, 200, {
          ok: true,
          service: 'blue-fish-submission',
          schedule: 'manual-review-required',
          review: cfg.review.configured ? 'configured' : 'not_configured',
          qq: cfg.qq.enabled ? 'enabled' : 'disabled',
          github: { repo: cfg.github.repo, label: cfg.github.label, token: cfg.github.token ? 'configured' : 'absent' },
          limits: { maxBytes: cfg.maxBytes },
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/adapters/qq/events') {
        if (!qqAdapter) return sendJson(res, 503, { ok: false, error: 'QQ adapter unavailable' });
        let payload = {};
        try {
          const raw = await readBody(req, cfg.maxBytes);
          payload = raw.length ? JSON.parse(raw.toString('utf8')) : {};
        } catch (error) {
          if (error && error.code === 'TOO_LARGE') {
            return sendJson(res, 413, { ok: false, error: `请求体超过上限 ${cfg.maxBytes} 字节` });
          }
          return sendJson(res, 400, { ok: false, error: 'invalid json' });
        }
        const result = await qqAdapter.handleInbound({ authorization: req.headers.authorization || '', payload });
        return sendJson(res, result.code, result.body);
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/submissions') {
        const clientIp = resolveClientIp(req, cfg.trustedProxyCidrs);
        const limit = allowRate(clientIp);
        if (!limit.allowed) {
          return sendJson(res, 429, { ok: false, error: 'too many requests' }, { 'Retry-After': String(Math.ceil(limit.retryAfter / 1000)) });
        }

        const contentType = String(req.headers['content-type'] || '');
        let fields = {};
        let fileBuffer = null;

        if (/multipart\/form-data/i.test(contentType)) {
          const raw = await readBody(req, cfg.maxBytes);
          const parsed = parseMultipartForm(raw, contentType, { maxBytes: cfg.maxBytes });
          fields = parsed.fields;
          if (parsed.files.length !== 1) return sendJson(res, 400, { ok: false, error: '必须且只能上传一张图片' });
          fileBuffer = parsed.files[0].data;
        } else if (/application\/json/i.test(contentType)) {
          const raw = await readBody(req, cfg.maxBytes);
          let payload = {};
          try { payload = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { return sendJson(res, 400, { ok: false, error: 'invalid json' }); }
          fields = { name: payload.name, character: payload.character, description: payload.description };
          try {
            fileBuffer = decodeBase64Image(payload.dataBase64, cfg.maxBytes);
          } catch (error) {
            const status = error && error.code === 'TOO_LARGE' ? 413 : 400;
            return sendJson(res, status, { ok: false, error: status === 413 ? '图片超过大小上限' : '图片内容非法' });
          }
          if (payload.turnstileToken) fields.turnstileToken = payload.turnstileToken;
        } else {
          return sendJson(res, 415, { ok: false, error: 'unsupported content-type' });
        }

        if (cfg.turnstile.enabled) {
          const token = fields.turnstileToken || req.headers['x-turnstile-token'] || '';
          let verified = false;
          if (token && verifyTurnstile) {
            try {
              verified = Boolean(await verifyTurnstile(String(token), { remoteip: clientIp }));
            } catch {
              verified = false; // 校验器异常一律 fail-closed
            }
          }
          if (!verified) return sendJson(res, 403, { ok: false, error: 'turnstile verification failed' });
        }

        const checked = validateSubmissionFields(fields, characters, { characterMaxLength: cfg.characterMaxLength });
        if (checked.error) return sendJson(res, 400, { ok: false, error: checked.error });
        if (!fileBuffer || fileBuffer.length === 0) return sendJson(res, 400, { ok: false, error: '图片内容为空' });

        const digest = sha256(fileBuffer);
        const result = await queue.enqueue({
          source: 'web',
          sourceId: `web:${digest}`,
          buffer: fileBuffer,
          fields: checked.fields,
          origin: { via: 'web' },
        });
        return sendJson(res, result.status === 'created' ? 201 : 200, {
          ok: true,
          id: result.item.id,
          status: result.item.state,
        });
      }

      return sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      const status = queueErrorStatus(error);
      logger.error?.(`公开投稿失败：${error.message}`);
      if (!res.headersSent) sendJson(res, status, { ok: false, error: status === 413 ? '图片超过大小上限' : '请求无法处理' });
    }
  };
}

/* ---------------------------------------------------------------- 管理入口 */

export function createAdminHandler({
  cfg,
  queue,
  reviewer,
  githubAdapter = null,
  now = () => Date.now(),
  logger = console,
} = {}) {
  const itemIdPattern = /^\/api\/v1\/items\/(sub_[A-Za-z0-9_]+)(\/raw|\/review|\/decision)?$/;

  return async function adminHandler(req, res) {
    try {
      if (!cfg.adminToken) {
        return sendJson(res, 503, { ok: false, error: 'admin token not configured' });
      }
      if (!authorized(req, cfg.adminToken)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
      }
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/api/v1/health') {
        return sendJson(res, 200, { ok: true, summary: configSummary(cfg), stats: await queue.stats() });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/stats') {
        return sendJson(res, 200, { ok: true, stats: await queue.stats() });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/items') {
        const limit = Number(url.searchParams.get('limit') || 200);
        const items = await queue.list({
          state: url.searchParams.get('state') || undefined,
          source: url.searchParams.get('source') || undefined,
          limit: Number.isSafeInteger(limit) && limit > 0 ? limit : 200,
        });
        return sendJson(res, 200, { ok: true, count: items.length, items });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/review') {
        const raw = await readBody(req, cfg.maxJsonBytes);
        const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
        const targets = Array.isArray(body.ids) ? body.ids : [];
        if (targets.length === 0) {
          const pending = await queue.list({ state: STATES.RECEIVED, limit: Number(body.limit) || 50 });
          targets.push(...pending.map((item) => item.id));
        }
        const results = [];
        for (const id of targets) {
          try {
            results.push({ id, ...(await reviewQueuedItem(queue, reviewer, id, { actor: 'ai' })) });
          } catch (error) {
            results.push({ id, verdict: 'manual', reason: error.message });
          }
        }
        return sendJson(res, 200, { ok: true, results });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/recover') {
        return sendJson(res, 200, { ok: true, ...(await queue.recover()) });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/pull-issues') {
        if (!githubAdapter) return sendJson(res, 503, { ok: false, error: 'github adapter unavailable' });
        const raw = await readBody(req, cfg.maxJsonBytes);
        const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
        const results = await githubAdapter.pullIssues({ issue: body.issue ?? null, state: body.state || 'open' });
        return sendJson(res, 200, { ok: true, results });
      }

      const match = itemIdPattern.exec(url.pathname);
      if (match) {
        const id = match[1];
        const sub = match[2] || '';
        if (req.method === 'GET' && sub === '') {
          const item = await queue.get(id);
          if (!item) return sendJson(res, 404, { ok: false, error: 'not found' });
          return sendJson(res, 200, { ok: true, item });
        }
        if (req.method === 'GET' && sub === '/raw') {
          const item = await queue.get(id);
          if (!item) return sendJson(res, 404, { ok: false, error: 'not found' });
          const file = await queue.objectFile(id);
          const { readFile } = await import('node:fs/promises');
          const buffer = await readFile(file);
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': buffer.length,
            'Content-Disposition': `attachment; filename="${id}${item.ext}"`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          });
          res.end(buffer);
          return undefined;
        }
        if (req.method === 'GET' && sub === '/review') {
          return sendJson(res, 200, { ok: true, raw: await queue.readReviewRaw(id) });
        }
        if (req.method === 'POST' && sub === '/review') {
          const result = await reviewQueuedItem(queue, reviewer, id, { actor: 'ai' });
          const item = await queue.get(id);
          return sendJson(res, 200, { ok: true, id, ...result, state: item.state });
        }
        if (req.method === 'POST' && sub === '/decision') {
          const raw = await readBody(req, cfg.maxJsonBytes);
          const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
          const item = await queue.decide(id, body.decision, { actor: 'admin', reason: body.reason || '' });
          return sendJson(res, 200, { ok: true, id, state: item.state });
        }
      }

      return sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      logger.error?.(`管理请求失败：${error.message}`);
      if (!res.headersSent) sendJson(res, 400, { ok: false, error: '请求无法处理' });
    }
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

/**
 * 启动两个监听口。管理口必须是回环地址且必须配令牌，否则拒绝启动。
 * public 口默认也绑回环；只有显式设置 SUBMISSION_PUBLIC_HOST 才可能对公网开放。
 */
export async function startServers(cfg, deps) {
  if (!LOOPBACK_HOSTS.has(cfg.adminHost)) {
    throw new Error(`管理 API 只允许绑定回环地址，拒绝 ${cfg.adminHost}`);
  }
  if (!cfg.adminToken) {
    throw new Error('启动管理 API 必须配置 SUBMISSION_ADMIN_TOKEN');
  }
  const publicServer = createServer(createPublicHandler(deps));
  const adminServer = createServer(createAdminHandler(deps));
  await listen(publicServer, cfg.publicPort, cfg.publicHost);
  try {
    await listen(adminServer, cfg.adminPort, cfg.adminHost);
  } catch (error) {
    await new Promise((resolve) => publicServer.close(resolve));
    throw error;
  }
  return {
    publicServer,
    adminServer,
    close: async () => {
      await Promise.all([
        new Promise((resolve) => publicServer.close(resolve)),
        new Promise((resolve) => adminServer.close(resolve)),
      ]);
    },
  };
}
