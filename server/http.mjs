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
 * **内置 AI 自动审核默认关闭**：网页投稿与 QQ 入站只把条目写进队列（received），
 * 不再在入队后自动调用 review.mjs。审核结论由外部 reviewer（AstrBot / Hermes）
 * 通过独立的内部接口 **POST /api/v1/internal/review-results** 回写，每个 reviewer
 * 用各自令牌鉴权；已配置则按结论推进（pass 且内容完整才自动桥接），
 * 未配置则条目停在 received 等人工处理。
 *
 * 内部接口还有一个只读列表/原图/字段接口，方便 Hermes 每 5 分钟取 web/github 待审条目：
 *   GET /api/v1/internal/submissions[?state=&sources=&limit=]
 *   GET /api/v1/internal/submissions/<id>[/raw]
 * 这些接口同样走独立令牌，响应绝不回显令牌或私有路径。
 *
 * 这里只做「HTTP -> 队列/审核/适配器」的映射，不含业务判断。
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { AI_CONTENT_SCHEMA, DEFAULT_TURNSTILE_TIMEOUT_MS, configSummary, isIpAddress, isTrustedProxy, loadContentVocabulary, normalizeIp } from './config.mjs';
import { SOURCES, STATES, sha256 } from './queue.mjs';
import { reviewQueuedItem } from './review.mjs';
import { validateContent as validateReviewContent } from './bridge.mjs';

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

function safeTokenEqual(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function authorized(req, token) {
  const header = String(req.headers.authorization || '');
  return safeTokenEqual(header.startsWith('Bearer ') ? header.slice(7) : '', token);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
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

/**
 * 审核协调器：把「入队后异步审核 + 自动桥接」收敛成一个按 id 去重的执行器，
 * 公开入口（后台即发即忘）与管理入口（显式等待结果）共用同一实例，因此
 * **同一 id 永远不会被并发重审**——管理端若撞上正在飞行的后台审核，直接复用
 * 那个任务的结果，而不是再开一次。
 *
 * 硬性边界：
 *   - run(id) 只做一次 reviewQueuedItem；verdict=pass 且桥接可用时自动
 *     bridgeItem，把 ready 写进私有中转区；
 *   - 审核 / 桥接异常只记日志并返回 null：不抛出、不改公开响应、不动队列；
 *   - trigger(id) 即发即忘；不可用或该 id 已在飞行中返回 null（并发保护）。
 */
export function createReviewCoordinator({ queue, reviewer, bridge = null, logger = console } = {}) {
  const inFlight = new Map();
  const available = Boolean(queue && reviewer && typeof reviewer.review === 'function');

  function run(id, { actor = 'ai' } = {}) {
    const target = String(id || '');
    if (!available || !target) return Promise.resolve(null);
    const existing = inFlight.get(target);
    if (existing) return existing;

    const task = (async () => {
      try {
        const result = await reviewQueuedItem(queue, reviewer, target, { actor });
        if (result && result.verdict === 'pass' && bridge && bridge.enabled) {
          try {
            await bridge.bridgeItem(target);
          } catch (error) {
            logger.error?.(`后台桥接失败 ${target}：${error.message}`);
          }
        }
        return result;
      } catch (error) {
        logger.error?.(`后台审核失败 ${target}：${error.message}`);
        return null;
      }
    })();

    inFlight.set(target, task);
    const settle = () => { if (inFlight.get(target) === task) inFlight.delete(target); };
    task.then(settle, settle);
    return task;
  }

  function trigger(id, options) {
    const target = String(id || '');
    if (!available || !target || inFlight.has(target)) return null;
    return run(target, options);
  }

  /** 等待当前在飞的审核任务全部落定（测试收尾用）；不启动新任务。 */
  async function drain({ timeout = 5000 } = {}) {
    const tasks = [...inFlight.values()];
    if (tasks.length === 0) return;
    let timer;
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((resolve) => { timer = setTimeout(resolve, timeout); timer.unref?.(); }),
    ]).finally(() => clearTimeout(timer));
  }

  return { available, run, trigger, drain, size: () => inFlight.size };
}

/* 进程内按队列共享协调器：公开口与管理口即便分开构造，也拿到同一实例。 */
const REVIEW_COORDINATORS = new WeakMap();

export function reviewCoordinatorFor({ queue, reviewer, bridge = null, logger = console } = {}) {
  if (!queue || typeof queue !== 'object') return createReviewCoordinator({ queue, reviewer, bridge, logger });
  let coordinator = REVIEW_COORDINATORS.get(queue);
  if (!coordinator) {
    coordinator = createReviewCoordinator({ queue, reviewer, bridge, logger });
    REVIEW_COORDINATORS.set(queue, coordinator);
  }
  return coordinator;
}

/* ------------------------------------------------------- 内部审核接口
 *
 * 外部 reviewer（AstrBot / Hermes）用各自独立令牌走这里回写审核结论，并从只读列表
 * 取待审条目与原图。内部接口不走公开 Origin/CORS（机器人不带 Origin），但**必须**
 * 通过令牌鉴权；未配置任何内部令牌时整组接口 503。
 */

/* reviewer 身份与令牌一一对应；令牌未配置即该来源不可用。 */
export const INTERNAL_REVIEWERS = Object.freeze(['astrbot', 'hermes']);
const INTERNAL_SOURCES = Object.freeze(['web', 'github-issue']);
const INTERNAL_ID_PATTERN = /^sub_[A-Za-z0-9_-]{1,64}$/;
const INTERNAL_ITEM_PATTERN = /^\/api\/v1\/internal\/submissions\/(sub_[A-Za-z0-9_-]{1,64})(\/raw)?$/;
/* 同一 reviewer 审完后的稳定态：重复提交只需回原结果，不再改状态。 */
const INTERNAL_REVIEW_STATES = new Set([STATES.AUTO_PASSED, STATES.AUTO_REJECTED, STATES.NEEDS_MANUAL]);
const INTERNAL_MAX_LIMIT = 200;
const INTERNAL_MAX_BATCH = 200;
const INTERNAL_REASON_MAX = 1000;
const INTERNAL_MODEL_MAX = 128;

/**
 * 内部接口鉴权：从独立令牌解析 reviewer 身份。
 * 返回 { ok:true, reviewer } 或 { ok:false, status, error }。常量时间比对，不回显令牌。
 */
export function authenticateInternalReview(req, cfg) {
  const tokens = (cfg && cfg.internalReview && cfg.internalReview.tokens) || {};
  const configured = INTERNAL_REVIEWERS.filter((name) => String(tokens[name] || ''));
  if (configured.length === 0) return { ok: false, status: 503, error: 'internal review not configured' };
  const given = bearerToken(req);
  for (const name of configured) {
    if (safeTokenEqual(given, tokens[name])) return { ok: true, reviewer: name };
  }
  return { ok: false, status: 401, error: 'unauthorized' };
}

/** 内部只读视图：给 reviewer 字段与原图入口，不含存储路径与任何密钥。 */
function internalItemView(item) {
  const view = {
    id: item.id,
    source: item.source,
    state: item.state,
    sha256: item.sha256,
    ext: item.ext,
    mime: item.mime,
    bytes: item.bytes,
    fields: item.fields || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    rawPath: `/api/v1/internal/submissions/${item.id}/raw`,
  };
  if (item.review) view.review = item.review;
  return view;
}

/**
 * 应用一条内部审核结果（单条基元）。硬规则：
 *   - 令牌已确定 reviewer 身份，单条请求里的 reviewer 字段必须与之一致（上层校验）；
 *   - submissionId / verdict / confidence / reason / model 严格校验；
 *   - 只有 received 能写入；同一 reviewer 已审完的条目幂等返回原结果、不改状态；
 *     别人已审或状态不符则 409，绝不覆盖；
 *   - pass 必须带通过六字段 + 枚举 + 注入校验的 content，否则 422 且状态不变；
 *   - pass 走 attachReview → review.pass → 桥接（写待发布区）；
 *   - reject / manual 只进人工审核区，绝不触发桥接。
 * 返回 { status, body }，由 HTTP 层原样发出；业务错误不抛出。
 * 兼容两家字段命名：submissionId 与 id 二选一。
 */
export async function applyOneReview({ queue, bridge = null, cfg, reviewer, result, vocabulary = null, logger = console } = {}) {
  const send = (status, body) => ({ status, body });
  const body = result && typeof result === 'object' && !Array.isArray(result) ? result : {};

  const submissionId = String(body.submissionId || body.id || '').trim();
  if (!INTERNAL_ID_PATTERN.test(submissionId)) {
    return send(400, { ok: false, error: 'submissionId 非法' });
  }
  if (body.verdict !== 'pass' && body.verdict !== 'reject' && body.verdict !== 'manual') {
    return send(400, { ok: false, error: 'verdict 必须是 pass / reject / manual' });
  }
  if (typeof body.confidence !== 'number' || !Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 1) {
    return send(400, { ok: false, error: 'confidence 必须是 0..1 的 JSON number' });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > INTERNAL_REASON_MAX) {
    return send(400, { ok: false, error: `reason 必填且不超过 ${INTERNAL_REASON_MAX} 字` });
  }
  const model = body.model === undefined || body.model === null ? '' : String(body.model).trim();
  if (model.length > INTERNAL_MODEL_MAX) return send(400, { ok: false, error: `model 不超过 ${INTERNAL_MODEL_MAX} 字` });

  const item = await queue.get(submissionId);
  if (!item) return send(404, { ok: false, error: 'not found' });

  /* 幂等与冲突：状态必须 received；已由同一 reviewer 审完的直接回原结果。 */
  if (item.state !== STATES.RECEIVED) {
    const sameReviewer = Boolean(item.review && item.review.decidedBy === reviewer);
    if (sameReviewer && INTERNAL_REVIEW_STATES.has(item.state)) {
      return send(200, {
        ok: true,
        id: item.id,
        state: item.state,
        duplicate: true,
        verdict: item.review.verdict,
        confidence: item.review.confidence,
        reason: item.review.reason,
        model: item.review.model || null,
        bridge: item.bridge || null,
      });
    }
    return send(409, { ok: false, error: '条目状态不允许写入审核结果' });
  }

  let content = null;
  if (body.verdict === 'pass') {
    const check = validateReviewContent(body.content, vocabulary || loadContentVocabulary(cfg.siteRoot));
    if (!check.ok) {
      return send(422, { ok: false, error: 'content 校验未通过', errors: check.errors.slice(0, 5) });
    }
    content = check.value;
  }

  /* 判重返回原结果：并发下同一 reviewer 的第二个请求撞上已推进的状态时也走这里，
   * 不会当成失败，也不会覆盖别人写下的结论。 */
  const duplicateResponse = (current) => ({
    ok: true,
    id: current.id,
    state: current.state,
    duplicate: true,
    verdict: current.review ? current.review.verdict : null,
    confidence: current.review ? current.review.confidence : null,
    reason: current.review ? current.review.reason : '',
    model: (current.review && current.review.model) || null,
    bridge: current.bridge || null,
  });

  try {
    await queue.transition(submissionId, 'review.start', { actor: reviewer });
    await queue.attachReview(submissionId, {
      verdict: body.verdict,
      confidence: body.confidence,
      reason,
      schema: body.verdict === 'pass' ? AI_CONTENT_SCHEMA : null,
      content,
      model: model || null,
      promptVersion: null,
      latencyMs: null,
      decidedBy: reviewer,
    }, {
      raw: { source: 'internal-review', reviewer, model: model || null, verdict: body.verdict, confidence: body.confidence, reason },
    });
    const event = body.verdict === 'pass' ? 'review.pass' : body.verdict === 'reject' ? 'review.reject' : 'review.manual';
    await queue.transition(submissionId, event, { actor: reviewer, reason });
  } catch (error) {
    /* 并发下先到者已把状态推进，后到者按幂等回原结果；否则失败关闭转人工。 */
    const current = await queue.get(submissionId).catch(() => null);
    if (current && current.review && current.review.decidedBy === reviewer && INTERNAL_REVIEW_STATES.has(current.state)) {
      return send(200, duplicateResponse(current));
    }
    if (current && current.state !== STATES.RECEIVED) {
      if (current.state === STATES.REVIEWING) {
        await queue.transition(submissionId, 'review.manual', {
          actor: reviewer,
          reason: `内部审核写入失败：${error.message}`,
        }).catch(() => {});
      }
      return send(409, { ok: false, error: '条目状态不允许写入审核结果' });
    }
    await queue.transition(submissionId, 'review.manual', {
      actor: reviewer,
      reason: `内部审核写入失败：${error.message}`,
    }).catch(() => {});
    logger.error?.(`内部审核写入失败 ${submissionId}：${error.message}`);
    return send(500, { ok: false, error: '审核结果写入失败' });
  }

  let bridgeResult = null;
  if (body.verdict === 'pass' && bridge) {
    try {
      bridgeResult = await bridge.bridgeItem(submissionId);
    } catch (error) {
      logger.error?.(`内部审核桥接失败 ${submissionId}：${error.message}`);
      bridgeResult = { id: submissionId, status: 'failed', reason: '桥接异常' };
    }
  }

  const stored = await queue.get(submissionId);
  return send(200, {
    ok: true,
    id: submissionId,
    state: stored ? stored.state : null,
    duplicate: false,
    verdict: body.verdict,
    confidence: body.confidence,
    bridge: bridgeResult,
  });
}

/**
 * 单条请求形态：body 自带 reviewer，必须与令牌身份一致，再交给 applyOneReview。
 */
export async function applyInternalReview({ queue, bridge = null, cfg, reviewer, payload, vocabulary = null, logger = console } = {}) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  if (String(body.reviewer || '') !== reviewer) {
    return { status: 403, body: { ok: false, error: 'reviewer 与令牌不匹配' } };
  }
  return applyOneReview({ queue, bridge, cfg, reviewer, result: body, vocabulary, logger });
}

/**
 * 批量请求形态（Hermes 客户端）：{ schema, reviewer, promptVersion, results:[...] }。
 * 信封的 reviewer 必须与令牌一致；逐条独立处理并回逐条结果——单条不合法不拖垮整批。
 * schema / promptVersion 只作审计透传，不参与判定。
 */
export async function applyInternalReviewBatch({ queue, bridge = null, cfg, reviewer, payload, vocabulary = null, logger = console } = {}) {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  if (String(body.reviewer || '') !== reviewer) {
    return { status: 403, body: { ok: false, error: 'reviewer 与令牌不匹配' } };
  }
  const entries = Array.isArray(body.results) ? body.results : [];
  if (entries.length > INTERNAL_MAX_BATCH) {
    return { status: 413, body: { ok: false, error: `results 数量超过上限 ${INTERNAL_MAX_BATCH}` } };
  }
  const results = [];
  for (const entry of entries) {
    const outcome = await applyOneReview({ queue, bridge, cfg, reviewer, result: entry, vocabulary, logger });
    results.push({
      id: (entry && (entry.submissionId || entry.id)) || null,
      status: outcome.status,
      ...outcome.body,
    });
  }
  return {
    status: 200,
    body: {
      ok: true,
      schema: body.schema ? String(body.schema).slice(0, 64) : null,
      reviewer,
      count: results.length,
      results,
    },
  };
}

/** 处理内部接口的只读列表 / 详情 / 原图 / 审核结果写入。 */
export async function handleInternalRequest({ req, res, url, reviewer, cfg, queue, bridge = null, vocabulary = null, logger = console }) {
  if (req.method === 'GET' && url.pathname === '/api/v1/internal/submissions') {
    const state = url.searchParams.get('state') || STATES.RECEIVED;
    if (!Object.values(STATES).includes(state)) return sendJson(res, 400, { ok: false, error: 'state 非法' });
    const sourcesParam = url.searchParams.get('sources');
    const sources = sourcesParam
      ? sourcesParam.split(',').map((entry) => entry.trim()).filter(Boolean)
      : [...INTERNAL_SOURCES];
    for (const source of sources) {
      if (!SOURCES.has(source)) return sendJson(res, 400, { ok: false, error: `source 非法：${source}` });
    }
    const rawLimit = Number(url.searchParams.get('limit') || 50);
    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, INTERNAL_MAX_LIMIT) : 50;
    const items = await queue.list({ state, sources, limit });
    return sendJson(res, 200, { ok: true, count: items.length, items: items.map((item) => internalItemView(item)) });
  }

  const match = INTERNAL_ITEM_PATTERN.exec(url.pathname);
  if (match && req.method === 'GET') {
    const item = await queue.get(match[1]);
    if (!item) return sendJson(res, 404, { ok: false, error: 'not found' });
    if (match[2] === '/raw') {
      const buffer = await queue.readImage(match[1]);
      res.writeHead(200, {
        'Content-Type': item.mime || 'application/octet-stream',
        'Content-Length': buffer.length,
        'Content-Disposition': `attachment; filename="${item.id}${item.ext}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      res.end(buffer);
      return undefined;
    }
    return sendJson(res, 200, { ok: true, item: internalItemView(item) });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/internal/review-results') {
    let payload = {};
    try {
      const raw = await readBody(req, cfg.maxJsonBytes);
      payload = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    } catch (error) {
      if (error && error.code === 'TOO_LARGE') return sendJson(res, 413, { ok: false, error: '请求体过大' });
      return sendJson(res, 400, { ok: false, error: 'invalid json' });
    }
    const result = Array.isArray(payload.results)
      ? await applyInternalReviewBatch({ queue, bridge, cfg, reviewer, payload, vocabulary, logger })
      : await applyInternalReview({ queue, bridge, cfg, reviewer, payload, vocabulary, logger });
    return sendJson(res, result.status, result.body);
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

export function createPublicHandler({
  cfg,
  queue,
  qqAdapter,
  bridge = null,
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

      /* 内部审核接口走独立令牌，不参与公开 Origin/CORS（机器人不带 Origin）。
       * 必须放在 Origin 校验之前，否则带 Origin 的机器人会被公开白名单误拦。 */
      if (url.pathname.startsWith('/api/v1/internal/')) {
        const auth = authenticateInternalReview(req, cfg);
        if (!auth.ok) {
          return sendJson(res, auth.status, { ok: false, error: auth.error }, auth.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
        }
        return handleInternalRequest({ req, res, url, reviewer: auth.reviewer, cfg, queue, bridge, logger });
      }

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
          internalReview: cfg.internalReview.enabled ? 'enabled' : 'disabled',
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
        /* 只入队，不自动审核：内置 AI 自动触发已关闭，结论由内部审核接口回写。 */
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
        /* 只入队（received），不自动审核、不自动桥接；结论由内部审核接口回写。 */
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
  bridge = null,
  githubAdapter = null,
  now = () => Date.now(),
  logger = console,
} = {}) {
  const itemIdPattern = /^\/api\/v1\/items\/(sub_[A-Za-z0-9_]+)(\/raw|\/review|\/decision)?$/;
  // 与公开口共享同一协调器：管理端显式审核会加入正在飞行的后台审核，不重复审。
  const reviewCoordinator = reviewCoordinatorFor({ queue, reviewer, bridge, logger });

  return async function adminHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      /* 内部审核接口也挂在管理口（Hermes 客户端默认走回环管理口）：用独立 reviewer
       * 令牌鉴权，不占用管理令牌；其余管理路由仍必须 Bearer 管理令牌。 */
      if (url.pathname.startsWith('/api/v1/internal/')) {
        const auth = authenticateInternalReview(req, cfg);
        if (!auth.ok) {
          return sendJson(res, auth.status, { ok: false, error: auth.error }, auth.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
        }
        return handleInternalRequest({ req, res, url, reviewer: auth.reviewer, cfg, queue, bridge, logger });
      }

      if (!cfg.adminToken) {
        return sendJson(res, 503, { ok: false, error: 'admin token not configured' });
      }
      if (!authorized(req, cfg.adminToken)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
      }

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
          const result = await reviewCoordinator.run(id);
          results.push(result ? { id, ...result } : { id, verdict: 'manual', reason: '审核未能执行，转人工' });
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
          const result = await reviewCoordinator.run(id);
          if (!result) return sendJson(res, 400, { ok: false, error: '请求无法处理' });
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
 *
 * deps 来自 buildContext，携带 queue / reviewer / bridge / qqAdapter 等；cfg 由本函数
 * 合并进来。公开口用 bridge 处理内部审核结果的桥接；管理口用 reviewer 做手动审核，
 * 但公开入队已不再自动调用 reviewer。
 */
export async function startServers(cfg, deps) {
  if (!LOOPBACK_HOSTS.has(cfg.adminHost)) {
    throw new Error(`管理 API 只允许绑定回环地址，拒绝 ${cfg.adminHost}`);
  }
  if (!cfg.adminToken) {
    throw new Error('启动管理 API 必须配置 SUBMISSION_ADMIN_TOKEN');
  }
  const handlerDeps = { ...deps, cfg };
  const publicServer = createServer(createPublicHandler(handlerDeps));
  const adminServer = createServer(createAdminHandler(handlerDeps));
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
