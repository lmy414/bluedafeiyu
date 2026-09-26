/* server/config.mjs —— 统一投稿服务的配置与私有存储根检查
 *
 * 这个服务同时收三种来源：网页公开投稿、QQ 群入站、内容仓 Issue 附件。
 * 它们的待审图片、AI 原始结果、队列数据库、密钥与日志**只允许留在内地服务器的
 * 私有目录**，绝不进任何公开仓。所以配置层有一条硬规则：
 *
 *   SUBMISSION_STORAGE_ROOT 必须显式给，没有默认值；
 *   它不得位于站点仓、内容仓，也不得位于任何 git 工作树内。
 *
 * 注意：本文件只做「配置 + 目录布局」，不联网、不读密钥文件、不创建公开产物。
 * 密钥一律走环境变量注入，仓库里不存任何真实值。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'submission-server/1';
/* AI 受校验内容的响应契约版本。审核层只认这个版本的形状，其余一律转人工。 */
export const AI_CONTENT_SCHEMA = 'submission-ai-content/1';
export const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_JSON_BYTES = 24 * 1024 * 1024;
export const DEFAULT_GITHUB_REPO = 'lmy414/ai-girl-stickers';
export const DEFAULT_GITHUB_LABEL = 'sticker-submission';
export const GITHUB_API_BASE = 'https://api.github.com';
/* GitHub Issue 列表分页：per_page 上限 100（GitHub 硬限制），翻页次数有上限，防跑飞。 */
export const GITHUB_MAX_PER_PAGE = 100;
export const DEFAULT_GITHUB_PER_PAGE = 100;
export const DEFAULT_GITHUB_MAX_PAGES = 5;
/* 429 / 5xx / 网络超时的有限退避重试：次数与退避上限都有界。 */
export const DEFAULT_GITHUB_MAX_RETRIES = 3;
export const DEFAULT_GITHUB_RETRY_BASE_MS = 500;
export const DEFAULT_GITHUB_RETRY_MAX_MS = 8000;
export const DEFAULT_REVIEW_TIMEOUT_MS = 60 * 1000;
export const DEFAULT_REVIEW_MIN_CONFIDENCE = 0.6;
/* promptVersion 跟响应契约绑定：改契约就换版本号。 */
export const DEFAULT_PROMPT_VERSION = AI_CONTENT_SCHEMA;
export const DEFAULT_RATE_MAX = 10;
export const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
/* 限流器内存里最多保留多少个客户端键；防止 IPv6 地址轮换把 Map 撑爆。 */
export const DEFAULT_RATE_MAX_KEYS = 5000;
export const DEFAULT_REVIEW_TIMEOUT_RECOVER_MS = 5 * 60 * 1000;
export const DEFAULT_TURNSTILE_TIMEOUT_MS = 5 * 1000;
export const DEFAULT_CHARACTER_MAX_LENGTH = 64;

/* 允许的图片格式：扩展名以「文件头认出来的格式」为准，不用投稿者的文件名 */
export const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.apng']);
export const FORMAT_EXT = { png: '.png', jpeg: '.jpg', gif: '.gif', webp: '.webp' };

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* 站点仓根目录：server/ 的上一级。存储根落在它里面就等于进了公开仓。 */
export const SITE_ROOT = path.resolve(HERE, '..');

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/** 从 dir 向上找最近的 git 工作树根；找不到返回 null。同步版，供配置期快速失败。 */
export function findGitAncestor(dir) {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 私有存储根检查。任一条命中就拒绝——宁可起不来，也不能把待审数据落进公开仓。
 * 同步抛错，方便配置期和测试直接 assert.throws。
 */
export function assertPrivateRoot(root, { contentDir = null } = {}) {
  const abs = path.resolve(String(root || ''));
  if (!String(root || '').trim()) throw new Error('存储根不能为空');
  if (isInside(SITE_ROOT, abs)) {
    throw new Error(`存储根不能位于站点公开仓内（${SITE_ROOT}）：${abs}`);
  }
  if (contentDir && isInside(contentDir, abs)) {
    throw new Error(`存储根不能位于内容公开仓内（${contentDir}）：${abs}`);
  }
  const gitRoot = findGitAncestor(abs);
  if (gitRoot) {
    throw new Error(`存储根不能位于任何 git 工作树内（发现 ${gitRoot}）：${abs}`);
  }
  return abs;
}

/**
 * 从内容仓 `data/characters.json` 与 `data/categories.json` **动态**读取可用枚举。
 * 只认 status=active（缺省视为 active）的条目；文件缺失或损坏一律 ok=false，
 * 让审核层 fail-closed 转人工，绝不放开未校验的枚举。
 */
export function loadContentVocabulary(siteRoot = SITE_ROOT) {
  const readList = (fileName) => {
    try {
      const records = JSON.parse(fs.readFileSync(path.join(siteRoot, 'data', fileName), 'utf8'));
      return Array.isArray(records) ? records : null;
    } catch {
      return null;
    }
  };
  const activeIds = (records) => new Set((records || [])
    .filter((entry) => entry && typeof entry === 'object' && (entry.status === undefined || entry.status === 'active'))
    .map((entry) => String(entry.id || '').trim())
    .filter(Boolean));
  const characters = readList('characters.json');
  const categories = readList('categories.json');
  const characterIds = activeIds(characters);
  const categoryIds = activeIds(categories);
  const loaded = characters !== null && categories !== null;
  return {
    characterIds,
    categoryIds,
    loaded,
    ok: loaded && characterIds.size > 0 && categoryIds.size > 0,
  };
}

/* ------------------------------------------------ 可信代理与客户端 IP 工具
 *
 * 只有显式配置了可信代理网段（SUBMISSION_TRUSTED_PROXY_CIDRS），且 TCP 对端确实
 * 落在这些网段里，才允许采信 X-Forwarded-For。没配置就永远用 socket 上的对端地址，
 * 这样匿名请求无法靠伪造 XFF 绕过限流。零依赖，自己实现 IPv4 / IPv6 前缀匹配。
 */

function ipv4Bytes(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4) return null;
  const bytes = Buffer.alloc(4);
  for (let i = 0; i < 4; i += 1) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const number = Number(parts[i]);
    if (number > 255) return null;
    bytes[i] = number;
  }
  return bytes;
}

function ipv6Bytes(value) {
  const text = String(value).toLowerCase();
  let head = text;
  let tail = '';
  const marker = text.indexOf('::');
  if (marker >= 0) {
    head = text.slice(0, marker);
    tail = text.slice(marker + 2);
    if (tail.includes('::')) return null;
  }
  function expand(chunk) {
    if (chunk === '') return [];
    const parts = chunk.split(':');
    const groups = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (part === '') return null;
      if (part.includes('.')) {
        if (i !== parts.length - 1) return null;
        const v4 = ipv4Bytes(part);
        if (!v4) return null;
        groups.push(v4.subarray(0, 2).toString('hex'));
        groups.push(v4.subarray(2).toString('hex'));
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        groups.push(part);
      }
    }
    return groups;
  }
  const headGroups = expand(head);
  const tailGroups = expand(tail);
  if (headGroups === null || tailGroups === null) return null;
  let list;
  if (marker < 0) {
    if (headGroups.length !== 8) return null;
    list = headGroups;
  } else {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return null;
    list = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  }
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 8; i += 1) bytes.writeUInt16BE(Number.parseInt(list[i], 16), i * 2);
  return bytes;
}

/** 归一化 IP：去掉方括号、%zone，并把 IPv4 映射地址还原成点分形式。 */
export function normalizeIp(value) {
  let ip = String(value ?? '').trim();
  if (!ip) return '';
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(ip)) ip = ip.slice(7);
  return ip;
}

function ipBytes(value) {
  const ip = normalizeIp(value);
  if (!ip) return null;
  return ip.includes(':') ? ipv6Bytes(ip) : ipv4Bytes(ip);
}

/** 是否为合法 IPv4 / IPv6 地址（已归一化）。 */
export function isIpAddress(value) {
  return ipBytes(value) !== null;
}

/** 把字符串 CIDR 或已解析对象统一成 { bytes, prefix, bits }；非法返回 null。 */
function cidrOf(cidr) {
  if (cidr && Buffer.isBuffer(cidr.bytes) && Number.isInteger(cidr.prefix)) return cidr;
  try {
    return parseCidr(cidr);
  } catch {
    return null;
  }
}

/** 解析 `addr/prefix` 形式的 CIDR；非法即抛错（配置期快速失败）。 */
export function parseCidr(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('可信代理 CIDR 不能为空');
  const slash = text.lastIndexOf('/');
  if (slash < 0) throw new Error(`可信代理 CIDR 缺少前缀长度：${text}`);
  const address = text.slice(0, slash);
  const prefixText = text.slice(slash + 1);
  const bytes = ipBytes(address);
  if (!bytes) throw new Error(`可信代理 CIDR 地址非法：${text}`);
  if (!/^\d{1,3}$/.test(prefixText)) throw new Error(`可信代理 CIDR 前缀非法：${text}`);
  const prefix = Number(prefixText);
  if (prefix > bytes.length * 8) throw new Error(`可信代理 CIDR 前缀超出范围：${text}`);
  return { bytes, prefix, bits: bytes.length * 8 };
}

export function isIpInCidr(ip, cidr) {
  const parsed = cidrOf(cidr);
  if (!parsed) return false;
  const bytes = ipBytes(ip);
  if (!bytes || bytes.length !== parsed.bytes.length) return false;
  let remaining = parsed.prefix;
  for (let i = 0; i < bytes.length && remaining > 0; i += 1) {
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (parsed.bytes[i] & mask)) return false;
    remaining -= take;
  }
  return true;
}

export function isTrustedProxy(ip, cidrs = []) {
  return cidrs.some((cidr) => isIpInCidr(ip, cidr));
}

function integerOf(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} 必须是正整数：${value}`);
  return number;
}

/**
 * 闭区间整数解析：用于分页 / 重试这类既要允许 0 又要有上限的配置。
 * 越界即抛错（配置期快速失败），不接受 0.5、'abc' 这类值。
 */
function rangedIntegerOf(value, fallback, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} 必须是 ${min}-${max} 之间的整数：${value}`);
  }
  return number;
}

function floatOf(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} 必须是 0..1 之间的数：${value}`);
  return number;
}

function listOf(value) {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(/[\s,，、]+/);
  return raw.map((entry) => String(entry).trim()).filter(Boolean);
}

function portOf(value, fallback, label) {
  const port = integerOf(value, fallback, label);
  if (port > 65535) throw new Error(`${label} 必须在 1-65535：${port}`);
  return port;
}

/**
 * 解析配置。overrides 优先于环境变量；env 可注入（测试用）。
 * 只返回纯数据，不建立任何网络连接、不读取密钥文件。
 */
export function resolveConfig(overrides = {}, { env = process.env } = {}) {
  const storageRaw = overrides.storageRoot ?? env.SUBMISSION_STORAGE_ROOT ?? '';
  if (!String(storageRaw).trim()) {
    throw new Error('必须显式配置 SUBMISSION_STORAGE_ROOT（私有存储根，不得位于任何公开仓或 git 工作树）');
  }
  const contentRaw = overrides.contentDir ?? env.SUBMISSION_CONTENT_DIR ?? '';
  const contentDir = String(contentRaw).trim() ? path.resolve(String(contentRaw).trim()) : '';
  const storageRoot = assertPrivateRoot(path.resolve(String(storageRaw).trim()), { contentDir: contentDir || null });

  const maxBytes = integerOf(overrides.maxBytes ?? env.SUBMISSION_MAX_BYTES, DEFAULT_MAX_BYTES, 'SUBMISSION_MAX_BYTES');
  const maxJsonBytes = integerOf(overrides.maxJsonBytes ?? env.SUBMISSION_MAX_JSON_BYTES, DEFAULT_MAX_JSON_BYTES, 'SUBMISSION_MAX_JSON_BYTES');

  const allowedOrigins = listOf(overrides.allowedOrigins ?? env.SUBMISSION_ALLOWED_ORIGINS);
  if (allowedOrigins.includes('*')) throw new Error('SUBMISSION_ALLOWED_ORIGINS 不允许通配符 *');

  const trustedProxyCidrs = listOf(overrides.trustedProxyCidrs ?? env.SUBMISSION_TRUSTED_PROXY_CIDRS);
  for (const entry of trustedProxyCidrs) parseCidr(entry);

  const reviewEndpoint = overrides.reviewEndpoint ?? env.SUBMISSION_AI_ENDPOINT ?? '';
  const reviewApiKey = overrides.reviewApiKey ?? env.SUBMISSION_AI_API_KEY ?? '';
  const reviewModel = overrides.reviewModel ?? env.SUBMISSION_AI_MODEL ?? '';

  const qqEnabled = String(overrides.qqEnabled ?? env.SUBMISSION_QQ_ENABLED ?? '').toLowerCase() === 'true';
  const qqGroupAllowlist = listOf(overrides.qqGroupAllowlist ?? env.SUBMISSION_QQ_GROUP_ALLOWLIST);

  const githubRepo = String(overrides.githubRepo ?? env.SUBMISSION_GITHUB_REPO ?? DEFAULT_GITHUB_REPO).trim();
  const githubLabel = String(overrides.githubLabel ?? env.SUBMISSION_GITHUB_LABEL ?? DEFAULT_GITHUB_LABEL).trim();

  const review = {
    endpoint: String(reviewEndpoint).trim(),
    apiKey: String(reviewApiKey),
    model: String(reviewModel).trim(),
    timeoutMs: integerOf(overrides.reviewTimeoutMs ?? env.SUBMISSION_AI_TIMEOUT_MS, DEFAULT_REVIEW_TIMEOUT_MS, 'SUBMISSION_AI_TIMEOUT_MS'),
    minConfidence: floatOf(overrides.reviewMinConfidence ?? env.SUBMISSION_AI_MIN_CONFIDENCE, DEFAULT_REVIEW_MIN_CONFIDENCE, 'SUBMISSION_AI_MIN_CONFIDENCE'),
    promptVersion: String(overrides.promptVersion ?? env.SUBMISSION_AI_PROMPT_VERSION ?? DEFAULT_PROMPT_VERSION),
    configured: Boolean(String(reviewEndpoint).trim() && String(reviewApiKey)),
  };

  const qq = {
    enabled: qqEnabled,
    inboundToken: String(overrides.qqInboundToken ?? env.SUBMISSION_QQ_INBOUND_TOKEN ?? ''),
    groupAllowlist: qqGroupAllowlist,
    imageHostAllowlist: listOf(overrides.qqImageHostAllowlist ?? env.SUBMISSION_QQ_IMAGE_HOST_ALLOWLIST),
    timeoutMs: integerOf(overrides.qqTimeoutMs ?? env.SUBMISSION_QQ_TIMEOUT_MS, 20 * 1000, 'SUBMISSION_QQ_TIMEOUT_MS'),
  };

  const turnstileSecret = String(overrides.turnstileSecret ?? env.SUBMISSION_TURNSTILE_SECRET ?? '');

  return {
    schema: SCHEMA,
    storageRoot,
    siteRoot: SITE_ROOT,
    contentDir,
    maxBytes,
    maxJsonBytes,
    allowedOrigins,
    trustedProxyCidrs,
    characterMaxLength: integerOf(overrides.characterMaxLength ?? env.SUBMISSION_CHARACTER_MAX_LENGTH, DEFAULT_CHARACTER_MAX_LENGTH, 'SUBMISSION_CHARACTER_MAX_LENGTH'),
    publicHost: String(overrides.publicHost ?? env.SUBMISSION_PUBLIC_HOST ?? '127.0.0.1').trim(),
    publicPort: portOf(overrides.publicPort ?? env.SUBMISSION_PUBLIC_PORT, 8790, 'SUBMISSION_PUBLIC_PORT'),
    adminHost: String(overrides.adminHost ?? env.SUBMISSION_ADMIN_HOST ?? '127.0.0.1').trim(),
    adminPort: portOf(overrides.adminPort ?? env.SUBMISSION_ADMIN_PORT, 8788, 'SUBMISSION_ADMIN_PORT'),
    adminToken: String(overrides.adminToken ?? env.SUBMISSION_ADMIN_TOKEN ?? ''),
    rateLimit: {
      max: integerOf(overrides.rateMax ?? env.SUBMISSION_RATE_MAX, DEFAULT_RATE_MAX, 'SUBMISSION_RATE_MAX'),
      windowMs: integerOf(overrides.rateWindowMs ?? env.SUBMISSION_RATE_WINDOW_MS, DEFAULT_RATE_WINDOW_MS, 'SUBMISSION_RATE_WINDOW_MS'),
      maxKeys: integerOf(overrides.rateMaxKeys ?? env.SUBMISSION_RATE_MAX_KEYS, DEFAULT_RATE_MAX_KEYS, 'SUBMISSION_RATE_MAX_KEYS'),
    },
    turnstile: {
      secret: turnstileSecret,
      enabled: Boolean(turnstileSecret),
      timeoutMs: integerOf(overrides.turnstileTimeoutMs ?? env.SUBMISSION_TURNSTILE_TIMEOUT_MS, DEFAULT_TURNSTILE_TIMEOUT_MS, 'SUBMISSION_TURNSTILE_TIMEOUT_MS'),
    },
    review,
    github: {
      repo: githubRepo,
      label: githubLabel,
      apiBase: String(overrides.githubApiBase ?? env.SUBMISSION_GITHUB_API ?? GITHUB_API_BASE).replace(/\/+$/, ''),
      token: String(overrides.githubToken ?? env.SUBMISSION_GITHUB_TOKEN ?? ''),
      timeoutMs: integerOf(overrides.githubTimeoutMs ?? env.SUBMISSION_GITHUB_TIMEOUT_MS, 20 * 1000, 'SUBMISSION_GITHUB_TIMEOUT_MS'),
      maxRedirects: integerOf(overrides.githubMaxRedirects ?? env.SUBMISSION_GITHUB_MAX_REDIRECTS, 3, 'SUBMISSION_GITHUB_MAX_REDIRECTS'),
      perPage: rangedIntegerOf(overrides.githubPerPage ?? env.SUBMISSION_GITHUB_PER_PAGE, DEFAULT_GITHUB_PER_PAGE, 'SUBMISSION_GITHUB_PER_PAGE', { min: 1, max: GITHUB_MAX_PER_PAGE }),
      maxPages: rangedIntegerOf(overrides.githubMaxPages ?? env.SUBMISSION_GITHUB_MAX_PAGES, DEFAULT_GITHUB_MAX_PAGES, 'SUBMISSION_GITHUB_MAX_PAGES', { min: 1 }),
      maxRetries: rangedIntegerOf(overrides.githubMaxRetries ?? env.SUBMISSION_GITHUB_MAX_RETRIES, DEFAULT_GITHUB_MAX_RETRIES, 'SUBMISSION_GITHUB_MAX_RETRIES', { min: 0 }),
      retryBaseMs: rangedIntegerOf(overrides.githubRetryBaseMs ?? env.SUBMISSION_GITHUB_RETRY_BASE_MS, DEFAULT_GITHUB_RETRY_BASE_MS, 'SUBMISSION_GITHUB_RETRY_BASE_MS', { min: 1 }),
      retryMaxMs: rangedIntegerOf(overrides.githubRetryMaxMs ?? env.SUBMISSION_GITHUB_RETRY_MAX_MS, DEFAULT_GITHUB_RETRY_MAX_MS, 'SUBMISSION_GITHUB_RETRY_MAX_MS', { min: 1 }),
      maxBytes,
    },
    qq,
    recoverAfterMs: integerOf(overrides.reviewRecoverMs ?? env.SUBMISSION_REVIEW_RECOVER_MS, DEFAULT_REVIEW_TIMEOUT_RECOVER_MS, 'SUBMISSION_REVIEW_RECOVER_MS'),
    paths: {
      items: path.join(storageRoot, 'items'),
      objects: path.join(storageRoot, 'objects'),
      index: path.join(storageRoot, 'index'),
      ai: path.join(storageRoot, 'ai'),
      logs: path.join(storageRoot, 'logs'),
      state: path.join(storageRoot, 'state'),
      tmp: path.join(storageRoot, 'tmp'),
    },
  };
}

/** 建立私有目录，权限 0700；幂等。 */
export async function ensureStorageLayout(cfg) {
  await fsPromises.mkdir(cfg.storageRoot, { recursive: true, mode: 0o700 });
  await fsPromises.chmod(cfg.storageRoot, 0o700).catch(() => {});
  for (const dir of Object.values(cfg.paths)) {
    await fsPromises.mkdir(dir, { recursive: true, mode: 0o700 });
    await fsPromises.chmod(dir, 0o700).catch(() => {});
  }
  return cfg.paths;
}

/**
 * 脱敏摘要：给 health / doctor / 日志用。只报「配没配」，绝不回显密钥原文。
 */
export function configSummary(cfg) {
  return {
    schema: cfg.schema,
    storageRoot: cfg.storageRoot,
    siteRoot: cfg.siteRoot,
    contentDir: cfg.contentDir || null,
    publicListen: `${cfg.publicHost}:${cfg.publicPort}`,
    adminListen: `${cfg.adminHost}:${cfg.adminPort}`,
    adminToken: cfg.adminToken ? 'configured' : 'absent',
    allowedOrigins: cfg.allowedOrigins,
    trustedProxyCidrs: cfg.trustedProxyCidrs || [],
    maxBytes: cfg.maxBytes,
    rateLimit: cfg.rateLimit,
    turnstile: { enabled: cfg.turnstile.enabled },
    review: { configured: cfg.review.configured, model: cfg.review.model || null, minConfidence: cfg.review.minConfidence },
    github: {
      repo: cfg.github.repo,
      label: cfg.github.label,
      token: cfg.github.token ? 'configured' : 'absent',
      perPage: cfg.github.perPage,
      maxPages: cfg.github.maxPages,
      maxRetries: cfg.github.maxRetries,
    },
    qq: {
      enabled: cfg.qq.enabled,
      inboundToken: cfg.qq.inboundToken ? 'configured' : 'absent',
      groupAllowlistCount: cfg.qq.groupAllowlist.length,
      imageHostAllowlistCount: cfg.qq.imageHostAllowlist.length,
    },
  };
}
