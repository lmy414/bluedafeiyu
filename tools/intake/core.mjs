/* tools/intake/core.mjs —— 投稿收录中转的核心逻辑（站点仓版）
 *
 * 这里只做一件事：把「还没进仓库的图」放在仓库外面等着被收录。
 * 三个来源（本地上传 / GitHub Issue 附件 / 网页或 QQ 投稿）统一成一条 IntakeItem，
 * 按 sha256 去重，收录并推送之后由 verify + prune 安全清掉。
 *
 * 与旧的「内容仓版」的差别（2026-09-26 迁移）：
 *
 *   1. **清单读站点仓的 data/**：`data/characters.json`、`data/works.json`、
 *      `data/owner-picks.json` 是权威副本。`contentDir` 只用于按 git blob 做
 *      原图 sha256 校验，不再从内容仓读清单。
 *   2. **contentDir 必须显式给**（`INTAKE_CONTENT_DIR` 或参数），不再默认当前仓。
 *   3. **存储根不得落进任一公开仓**：站点仓和内容仓都算公开仓，两者之外才允许。
 *   4. 默认仓库仍是 `lmy414/ai-girl-stickers`。
 *
 * 两条不变硬规则：
 *
 *   1. **不写 dist/，不写 blue-fish-originals/，不碰工作树。**
 *   2. **清理的唯一判据是「回源校验」**，不是时间、不是人工打标记。
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'intake/1';
export const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
export const DEFAULT_GITHUB_REPO = 'lmy414/ai-girl-stickers';
export const DEFAULT_HTTP_TIMEOUT_MS = 15 * 1000;
export const DEFAULT_MAX_REDIRECTS = 3;
/* Issue 必须带这个标签才允许被拉取附件（查询里带了，返回结果还要再核一遍） */
export const SUBMISSION_LABEL = 'sticker-submission';
export const ORIGINAL_PREFIXES = [
  'dist/submissions/originals/',
  'owner-picks/',
  'blue-fish-originals/',
];

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* 站点仓根目录：tools/intake/ -> tools/ -> 站点根 */
export const SITE_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_SITE_DATA_DIR = path.join(SITE_ROOT, 'data');

/* 允许的图片格式，与投稿表单里写的一致 */
export const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.apng']);
export const ALLOWED_SOURCES = new Set(['local', 'github-issue', 'feishu', 'manual', 'web', 'qq']);

/**
 * 按文件头认格式。HTTP 那层是按裸字节收的，扩展名是投稿者说了算的，
 * 只看扩展名会把改名的 zip / 脚本放进中转区。认不出来就拒绝入库。
 */
export function sniffImageFormat(buffer) {
  if (buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('latin1') === 'RIFF'
    && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const GITHUB_API = 'https://api.github.com';

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/** 向上找最近的 git 工作树；找到了说明这个目录落在公开仓里。 */
export function findGitAncestor(dir) {
  let current = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 识别一个目录是不是内容仓（用于迁移后的自动发现）。
 * 判据：有 .git、仓库根有投稿表单和图片目录，且不是站点仓自己。
 * 内容清单属于站点仓 data/，内容仓不再需要 JSON 清单。
 */
export async function looksLikeContentRepo(dir) {
  const abs = path.resolve(dir);
  if (abs === SITE_ROOT) return false;
  if (!existsSync(path.join(abs, '.git'))) return false;
  if (!existsSync(path.join(abs, '.github', 'ISSUE_TEMPLATE', 'sticker-submission.yml'))) return false;
  if (!existsSync(path.join(abs, 'dist', 'submissions', 'originals'))) return false;
  return true;
}

/** 在 startDir 及其同级目录里找一个内容仓；找不到返回 null。只读，不写。 */
export async function discoverContentDir(startDir = SITE_ROOT) {
  const candidates = new Set();
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 3; depth += 1) {
    if (await looksLikeContentRepo(current)) return current;
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch { entries = []; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(current, entry.name);
      if (child === SITE_ROOT) continue;
      if (await looksLikeContentRepo(child)) return child;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/* ---------------------------------------------------------------- 配置 */

export function resolveConfig(overrides = {}) {
  const env = process.env;
  const providedContent = overrides.contentDir || env.INTAKE_CONTENT_DIR || '';
  if (!String(providedContent).trim()) {
    throw new Error('必须指定内容仓库根目录：--content-dir <路径> 或 INTAKE_CONTENT_DIR=<路径>（仅用于原图 sha256 回源校验）');
  }
  const contentDir = path.resolve(String(providedContent).trim());

  const siteDataDir = path.resolve(
    overrides.siteDataDir || env.INTAKE_SITE_DATA_DIR || DEFAULT_SITE_DATA_DIR,
  );

  const root = path.resolve(
    overrides.root || env.INTAKE_ROOT || path.join(path.dirname(contentDir), 'dafeiyu-intake'),
  );
  if (isInside(contentDir, root)) {
    throw new Error(`INTAKE_ROOT 不能位于内容仓库内：${root}`);
  }
  if (isInside(SITE_ROOT, root)) {
    throw new Error(`INTAKE_ROOT 不能位于站点公开仓内：${root}`);
  }
  const gitRoot = findGitAncestor(root);
  if (gitRoot) {
    throw new Error(`INTAKE_ROOT 不能位于任何 git 工作树内（发现 ${gitRoot}）：${root}`);
  }

  const maxBytes = Number(overrides.maxBytes || env.INTAKE_MAX_BYTES || DEFAULT_MAX_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`INTAKE_MAX_BYTES 必须是正整数：${maxBytes}`);
  }
  const timeoutMs = Number(overrides.timeoutMs || env.INTAKE_HTTP_TIMEOUT_MS || DEFAULT_HTTP_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`INTAKE_HTTP_TIMEOUT_MS 必须是正整数：${timeoutMs}`);
  }
  const maxRedirects = Number(overrides.maxRedirects || env.INTAKE_MAX_REDIRECTS || DEFAULT_MAX_REDIRECTS);
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error(`INTAKE_MAX_REDIRECTS 必须是非负整数：${maxRedirects}`);
  }
  return {
    siteRoot: SITE_ROOT,
    siteDataDir,
    contentDir,
    root,
    inboxDir: path.join(root, 'inbox'),
    metaDir: path.join(root, 'meta'),
    logDir: path.join(root, 'logs'),
    repo: overrides.repo || env.INTAKE_GITHUB_REPO || DEFAULT_GITHUB_REPO,
    token: overrides.token || env.INTAKE_GITHUB_TOKEN || env.GITHUB_TOKEN || '',
    ref: overrides.ref || env.INTAKE_REF || 'origin/main',
    apiBase: overrides.apiBase || env.INTAKE_GITHUB_API || GITHUB_API,
    maxBytes,
    timeoutMs,
    maxRedirects,
    fetchImpl: overrides.fetchImpl || globalThis.fetch,
  };
}

/** 读站点仓的权威清单（角色 / 作品 / 站长自用）。只读，缺文件时报错而不是静默。 */
export async function loadSiteData(cfg) {
  const read = async (name) => JSON.parse(await fs.readFile(path.join(cfg.siteDataDir, name), 'utf8'));
  const [characters, works, ownerPicks] = await Promise.all([
    read('characters.json'),
    read('works.json'),
    read('owner-picks.json'),
  ]);
  return { characters, works, ownerPicks };
}

export function characterIds(characters) {
  return new Set((characters || []).map((entry) => entry.id));
}

/* ---------------------------------------------------------------- 基础工具 */

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function sha256File(file) {
  return sha256(await fs.readFile(file));
}

export function normalizeExt(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return ext === '.jpeg' ? '.jpg' : ext;
}

export function targetPathIsAllowed(value) {
  const raw = String(value || '').replace(/[\\\\]/g, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) return false;
  if (raw.split('/').some((segment) => segment === '..')) return false;
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) return false;
  return ORIGINAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function normalizeTargetPath(value) {
  if (!targetPathIsAllowed(value)) {
    throw new Error(`targetPath 只能落在原图目录，且不能含绝对路径或 ..：${value}`);
  }
  return path.posix.normalize(String(value).replace(/[\\\\]/g, '/'));
}

function assertDigest(value) {
  const digest = String(value || '');
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`sha256 必须是 64 位小写十六进制：${digest}`);
  }
  return digest;
}

function extensionHint(name, targetPath) {
  const nameExt = normalizeExt(name);
  const targetExt = normalizeExt(targetPath);
  return nameExt || targetExt;
}

function extensionFromSniffed(format) {
  return { png: '.png', jpeg: '.jpg', gif: '.gif', webp: '.webp' }[format] || '';
}

/* 临时文件名带 pid + 随机后缀：并发写同一目标时不会互相覆盖 / rename 踩空 */
function tempSibling(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
}

/* 同一目标路径的写入串行化：Windows 上并发 rename 覆盖同一目标会 EPERM，
 * 进程内排队即可（同一 digest 并发入库只会落一份） */
const writeLocks = new Map();
function withFileLock(file, task) {
  const key = path.resolve(file);
  const previous = writeLocks.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(() => {}, () => {});
  writeLocks.set(key, settled);
  settled.then(() => {
    if (writeLocks.get(key) === settled) writeLocks.delete(key);
  });
  return run;
}

async function writeBufferAtomic(file, buffer) {
  return withFileLock(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = tempSibling(file);
    try {
      await fs.writeFile(temporary, buffer, { mode: 0o600 });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
}

/* 原子写：先写临时文件再 rename，避免半截 JSON 被后续读到 */
async function writeJsonAtomic(file, value) {
  return withFileLock(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = tempSibling(file);
    try {
      await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function git(cfg, args, options = {}) {
  return execFileSync('git', ['-C', cfg.contentDir, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
    ...options,
  });
}

function repoRelative(cfg, absolute) {
  return path.relative(cfg.contentDir, absolute).split(path.sep).join('/');
}

/* intake 自己的路径只由 sha256 决定，永不由投稿者提供的文件名决定 */
export function itemFile(cfg, item) {
  if (!ALLOWED_EXT.has(item.ext)) {
    throw new Error(`中转记录的扩展名非法：${item.ext}`);
  }
  return path.join(cfg.inboxDir, `${assertDigest(item.sha256)}${item.ext}`);
}

export function metaFile(cfg, digest) {
  return path.join(cfg.metaDir, `${assertDigest(digest)}.json`);
}

export async function ensureLayout(cfg) {
  await fs.mkdir(cfg.root, { recursive: true, mode: 0o700 });
  for (const dir of [cfg.inboxDir, cfg.metaDir, cfg.logDir]) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700);
  }
  await fs.chmod(cfg.root, 0o700);
}

async function log(cfg, event, detail) {
  await fs.mkdir(cfg.logDir, { recursive: true });
  const line = `${new Date().toISOString()}\t${event}\t${JSON.stringify(redactValue(detail))}\n`;
  const logFile = path.join(cfg.logDir, 'intake.log');
  await fs.appendFile(logFile, line, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(logFile, 0o600);
}

async function findByOrigin(cfg, origin) {
  const issue = origin && origin.issue;
  const assetId = origin && origin.assetId;
  if (issue === undefined || issue === null || !assetId) return null;
  for (const item of await listItems(cfg)) {
    if (item.origin && String(item.origin.issue) === String(issue)
      && String(item.origin.assetId) === String(assetId)) return item;
  }
  return null;
}

/* ---------------------------------------------------------------- 写入 */

/**
 * 把一个 Buffer 收进中转区。已存在同 sha256 的记录时直接返回 duplicate，
 * 不再写第二份——这就是「按 sha256 查重」在入库侧的实现。
 */
export async function stageBuffer(cfg, buffer, { source, fields = {}, origin = {}, targetPath = null, name = '' }) {
  await ensureLayout(cfg);
  /* 任何落盘内容（字段、来源）先剥掉 URL 里的 jwt 之类签名参数 */
  const safeOrigin = redactValue(origin);
  const originExisting = await findByOrigin(cfg, safeOrigin);
  if (originExisting) return { status: 'duplicate', item: originExisting, sha256: originExisting.sha256 };
  if (!ALLOWED_SOURCES.has(source)) {
    throw new Error(`不支持的来源 ${source}，可用值：${[...ALLOWED_SOURCES].join(', ')}`);
  }
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length === 0) throw new Error('不能收空文件');
  if (buffer.length > cfg.maxBytes) {
    throw new Error(`图片超过大小上限 ${cfg.maxBytes} 字节：${buffer.length}`);
  }
  if (targetPath) targetPath = normalizeTargetPath(targetPath);

  const digest = sha256(buffer);
  const existing = await readItem(cfg, digest);
  if (existing) return { status: 'duplicate', item: existing, sha256: digest };

  const published = (await buildPublishedIndex(cfg)).get(digest);
  if (published) {
    return { status: 'published', sha256: digest, published };
  }

  const hintedExt = extensionHint(name, targetPath);
  if (hintedExt && !ALLOWED_EXT.has(hintedExt)) {
    throw new Error(`不支持的图片格式 ${hintedExt}：${name}`);
  }

  const sniffed = sniffImageFormat(buffer);
  if (!sniffed) {
    throw new Error(`文件头不是已知图片格式，拒绝入库：${name}`);
  }
  const expected = hintedExt === '.apng' ? ['png'] : hintedExt ? [hintedExt.slice(1)] : [];
  if (hintedExt === '.jpg') expected.push('jpeg');
  if (expected.length > 0 && !expected.includes(sniffed)) {
    throw new Error(`文件内容像 ${sniffed}，扩展名却是 ${hintedExt}，拒绝入库：${name}`);
  }
  const ext = hintedExt || extensionFromSniffed(sniffed);

  const item = {
    schema: SCHEMA,
    sha256: digest,
    ext,
    bytes: buffer.length,
    source,
    receivedAt: new Date().toISOString(),
    status: 'staged',
    fields: redactValue({ name: '', description: '', character: '', tags: [], ...fields }),
    origin: safeOrigin,
    targetPath,
    publishedAt: null,
  };

  await writeBufferAtomic(itemFile(cfg, item), buffer);
  await writeJsonAtomic(metaFile(cfg, digest), item);
  await log(cfg, 'stage', { sha256: digest, source, bytes: buffer.length, targetPath });
  return { status: 'staged', item, sha256: digest };
}

export async function addLocalFile(cfg, file, { fields = {}, targetPath = null } = {}) {
  const buffer = await fs.readFile(file);
  return stageBuffer(cfg, buffer, {
    source: 'local',
    fields,
    origin: { fileName: path.basename(file) },
    targetPath,
    name: path.basename(file),
  });
}

/* ------------------------------------------------- 审核通过条目桥接入区 */

/* 中转状态：ready 供自动发布批次消费；staged 仍是人工收录的默认状态。 */
export const READY_STATUS = 'ready';

const FORMAT_BY_EXT = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.gif': 'gif', '.webp': 'webp', '.apng': 'png' };

/**
 * 把已通过审核、内容完整的条目写进中转区，状态 `ready`。
 *
 * 与 stageBuffer 的差别：
 *   1. 状态是 `ready`（供发布批次消费），不是人工收录用的 `staged`；
 *   2. 附带 `submissionId` 与受校验的完整 AI 内容，供发布批次与追溯使用；
 *   3. 幂等键仍是 sha256：已有记录一律返回 duplicate，绝不覆盖既有记录。
 *
 * 调用方（server/bridge.mjs）负责先做内容 schema 校验；这里只做字节层校验与落盘。
 * 本函数不读、不写、不跑 git，也不碰内容仓工作树。
 */
export async function stageReadyItem(cfg, buffer, {
  ext = '',
  submissionId = null,
  source = 'web',
  fields = {},
  content = null,
  contentSchema = null,
  origin = {},
  license = 'unknown',
  receivedAt = null,
} = {}) {
  await ensureLayout(cfg);
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length === 0) throw new Error('不能收空文件');
  if (buffer.length > cfg.maxBytes) {
    throw new Error(`图片超过大小上限 ${cfg.maxBytes} 字节：${buffer.length}`);
  }

  const digest = sha256(buffer);
  const existing = await readItem(cfg, digest);
  if (existing) return { status: 'duplicate', item: existing, sha256: digest };

  const sniffed = sniffImageFormat(buffer);
  if (!sniffed) throw new Error('文件头不是已知图片格式，拒绝写入中转区');

  /* ext 是队列条目里的裸扩展名（.png/.jpg/...），不能走 path.extname（点文件会判成无扩展名）。 */
  let resolvedExt = String(ext || '').trim().toLowerCase();
  if (resolvedExt && !resolvedExt.startsWith('.')) resolvedExt = `.${resolvedExt}`;
  if (resolvedExt === '.jpeg') resolvedExt = '.jpg';
  if (!ALLOWED_EXT.has(resolvedExt)) resolvedExt = extensionFromSniffed(sniffed);
  if (FORMAT_BY_EXT[resolvedExt] && FORMAT_BY_EXT[resolvedExt] !== sniffed) {
    throw new Error(`文件内容像 ${sniffed}，扩展名却是 ${resolvedExt}，拒绝写入中转区`);
  }

  const at = new Date().toISOString();
  const item = {
    schema: SCHEMA,
    sha256: digest,
    ext: resolvedExt,
    bytes: buffer.length,
    source,
    status: READY_STATUS,
    submissionId: submissionId ? String(submissionId) : null,
    contentSchema: contentSchema || null,
    receivedAt: receivedAt || at,
    bridgedAt: at,
    fields: redactValue({ name: '', description: '', character: '', tags: [], ...fields }),
    content: redactValue(content),
    origin: redactValue({ ...origin, submissionId: submissionId ? String(submissionId) : null }),
    license: redactValue(license),
    targetPath: null,
    batch: null,
    publishedAt: null,
  };

  await writeBufferAtomic(itemFile(cfg, item), buffer);
  await writeJsonAtomic(metaFile(cfg, digest), item);
  await log(cfg, 'stage-ready', { sha256: digest, submissionId: item.submissionId, source, bytes: buffer.length });
  return { status: READY_STATUS, item, sha256: digest };
}

/* ---------------------------------------------------------------- 读取 */

export async function readItem(cfg, digest) {
  const file = metaFile(cfg, digest);
  if (!(await exists(file))) return null;
  return readJson(file);
}

export async function listItems(cfg, { status, source } = {}) {
  await ensureLayout(cfg);
  let entries = [];
  try {
    entries = await fs.readdir(cfg.metaDir);
  } catch {
    return [];
  }
  const items = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    /* 坏 meta（半截 JSON / 非对象）只跳过这一条，不能让整个 list/verify/pull 崩 */
    let item;
    try {
      item = await readJson(path.join(cfg.metaDir, entry));
    } catch {
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (status && item.status !== status) continue;
    if (source && item.source !== source) continue;
    items.push(item);
  }
  items.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
  return items;
}

export async function updateItem(cfg, digest, patch) {
  const item = await readItem(cfg, digest);
  if (!item) throw new Error(`中转区里没有 ${digest}`);
  const next = { ...item, ...patch, fields: { ...item.fields, ...(patch.fields || {}) } };
  await writeJsonAtomic(metaFile(cfg, digest), next);
  return next;
}

/* ---------------------------------------------------------------- GitHub Issue 来源 */

/* ------------------------------------------------ 出站安全：URL / 白名单 */

/* URL query 里的签名 / 令牌类参数，写 origin、结果或日志前必须剥掉 */
const SENSITIVE_QUERY_KEYS = new Set([
  'jwt',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'authorization',
  'auth',
  'sig',
  'signature',
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-security-token',
  'x-goog-signature',
  'x-goog-credential',
]);

/** 去掉 URL 里 jwt 之类的敏感 query（以及形如参数表的 fragment）；解析失败或没有敏感参数就原样返回。 */
export function redactUrl(value) {
  const raw = String(value ?? '');
  if (!raw) return raw;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  if (!parsed.search && !parsed.hash) return raw;
  let changed = false;
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
      changed = true;
    }
  }
  /* fragment 也可能被塞进 jwt；只在形如 key=value 时才当参数处理，
   * 普通锚点（#section-2、#token）原样保留，别把无关的锚点删了。 */
  if (parsed.hash.includes('=')) {
    const params = new URLSearchParams(parsed.hash.slice(1));
    let hashChanged = false;
    for (const key of [...params.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        params.delete(key);
        hashChanged = true;
      }
    }
    if (hashChanged) {
      const rest = params.toString();
      parsed.hash = rest ? `#${rest}` : '';
      changed = true;
    }
  }
  return changed ? parsed.toString() : raw;
}

/* 递归清洗：字符串里嵌的 URL（哪怕夹在正文 / 表单字段里）也要剥掉 jwt 之类参数 */
function redactValue(value) {
  if (typeof value === 'string') {
    return value.replace(/https?:\/\/[^\s)"'<>\]]+/g, (url) => redactUrl(url));
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = redactValue(entry);
    return out;
  }
  return value;
}

/* 附件域名白名单（与 server/adapters/github.mjs 的 isAllowedAttachmentUrl 一致）：
 * https-only、默认端口、不得带凭据；github.com 只允许 /user-attachments/assets/。 */
const ATTACHMENT_HOSTS = new Set([
  'github.com',
  'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com',
]);

export function isAllowedAttachmentUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.port !== '') return false;
  if (url.username || url.password) return false;
  if (url.hostname === 'github.com') return url.pathname.startsWith('/user-attachments/assets/');
  return ATTACHMENT_HOSTS.has(url.hostname);
}

function apiBaseUrl(cfg) {
  try {
    return new URL(cfg.apiBase);
  } catch {
    return null;
  }
}

/* 只允许 apiBase 的同源地址；Authorization 也只发给这个源 */
function isApiUrl(cfg, value) {
  const base = apiBaseUrl(cfg);
  if (!base) return false;
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  return url.protocol === base.protocol && url.host === base.host;
}

function githubHeaders(cfg, url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'blue-fish-intake',
  };
  /* token 只发给 API 同源，绝不落到别的主机 */
  if (cfg.token && isApiUrl(cfg, url)) headers.Authorization = `Bearer ${cfg.token}`;
  return headers;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * 统一的手动重定向 + 超时出站。每一跳都先过 allowUrl，再用 AbortController 限时；
 * redirect 固定 'manual'，绝不把跳转交给底层自动跟到白名单外。请求头由 headersFor(url)
 * 现算，保证跨源时不会带上不该带的头。整个响应消费（含读取 body）都在超时窗口内。
 */
async function requestWithLimits(cfg, startUrl, { what, headersFor, allowUrl, consume }) {
  const maxRedirects = cfg.maxRedirects;
  let current = String(startUrl);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    if (!allowUrl(current)) {
      throw new Error(`${what}地址不在白名单，拒绝请求：${redactUrl(current)}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let response;
    try {
      response = await cfg.fetchImpl(current, {
        headers: headersFor(current),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new Error(`${what}超时（${cfg.timeoutMs}ms）：${redactUrl(current)}`);
      }
      throw new Error(`${what}请求失败：${error.message}：${redactUrl(current)}`);
    }

    try {
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`${what}返回重定向却没有 Location：${redactUrl(current)}`);
        const next = new URL(location, current).toString();
        if (!allowUrl(next)) {
          throw new Error(`${what}重定向到白名单外的地址，拒绝：${redactUrl(next)}`);
        }
        try { await response.body?.cancel(); } catch { /* 只是尽早释放连接 */ }
        current = next;
        continue;
      }
      return await consume(response, current);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`${what}超时（${cfg.timeoutMs}ms）：${redactUrl(current)}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${what}重定向超过上限 ${maxRedirects} 次：${redactUrl(startUrl)}`);
}

/**
 * GitHub Issue 表单渲染出来的正文长这样：
 *
 *   ### 图片名称
 *
 *   不是……而是……大学习
 *
 *   ### 一句话说明（可选）
 *
 *   _No response_
 *
 * 这里按 `### ` 切段还原成 { 标题: 值 }。看不出结构的正文返回空对象，
 * 不猜字段——猜错会写脏收录数据。
 */
export function parseIssueForm(body) {
  const sections = {};
  const text = String(body || '').replace(/\r\n/g, '\n');
  const parts = text.split(/^###[ \t]+/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    if (newline < 0) continue;
    const label = part.slice(0, newline).trim();
    const value = part.slice(newline + 1).trim();
    sections[label] = /^_No response_$/i.test(value) ? '' : value;
  }
  return sections;
}

const ATTACHMENT_PATTERNS = [
  /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+/g,
  /https:\/\/user-images\.githubusercontent\.com\/[^\s)"'<>\]]+/g,
  /https:\/\/private-user-images\.githubusercontent\.com\/[^\s)"'<>\]]+/g,
];

export function extractAttachments(body) {
  const text = String(body || '');
  const found = [];
  for (const pattern of ATTACHMENT_PATTERNS) {
    for (const url of text.match(pattern) || []) {
      if (!found.includes(url)) found.push(url);
    }
  }
  return found;
}

export function assetIdOf(url) {
  const assets = String(url).match(/\/user-attachments\/assets\/([0-9a-fA-F-]+)/);
  if (assets) return assets[1];
  const legacy = String(url).match(/user-images\.githubusercontent\.com\/\d+\/([^/]+)\//);
  return legacy ? legacy[1] : String(url);
}

const FIELD_LABELS = {
  图片名称: 'name',
  '一句话说明（可选）': 'description',
  角色: 'character',
  角色补充: 'characterExtra',
  Tag: 'tags',
  内容来源: 'originType',
  来源作者: 'originAuthor',
  来源链接: 'originUrl',
  授权状态: 'licenseType',
  授权说明: 'licenseNote',
};

export function fieldsFromSections(sections) {
  const fields = {};
  for (const [label, key] of Object.entries(FIELD_LABELS)) {
    const value = sections[label];
    if (value === undefined || value === '') continue;
    if (key === 'tags') {
      fields[key] = value
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .split(/[\s,，、]+/)
        .filter((tag) => tag && !tag.startsWith('http'));
    } else {
      fields[key] = value;
    }
  }
  return fields;
}

/** 括号里的 characterId，例如「DeepSeek娘（deepseek · 别名 …）」-> deepseek */
export function characterIdFromLabel(value) {
  const match = String(value || '').match(/（([a-z0-9_-]+)\s*[·)）]/);
  return match ? match[1] : '';
}

/** 调 GitHub API。只跟 apiBase 同源重定向，Authorization 只发给同源。 */
export async function githubJson(cfg, url) {
  return requestWithLimits(cfg, url, {
    what: 'GitHub 接口',
    headersFor: (target) => githubHeaders(cfg, target),
    allowUrl: (target) => isApiUrl(cfg, target),
    consume: async (response, finalUrl) => {
      if (!response.ok) {
        throw new Error(`GitHub ${response.status} ${response.statusText}：${redactUrl(finalUrl)}`);
      }
      return { json: await response.json(), headers: response.headers };
    },
  });
}

/**
 * 下载 Issue 附件。每跳都过附件白名单，绝不携带 API token，超时由 AbortController 约束。
 * 返回裸 Buffer；大小上限仍在这里把关。
 */
export async function downloadAttachment(cfg, url) {
  return requestWithLimits(cfg, url, {
    what: '附件下载',
    /* 附件请求只有 UA / Accept，绝不放 Authorization */
    headersFor: () => ({ 'User-Agent': 'blue-fish-intake', Accept: 'application/octet-stream' }),
    allowUrl: isAllowedAttachmentUrl,
    consume: async (response, finalUrl) => {
      if (!response.ok) {
        throw new Error(`附件下载失败 ${response.status}：${redactUrl(finalUrl)}`);
      }
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > cfg.maxBytes) {
        throw new Error(`附件超过大小上限 ${cfg.maxBytes} 字节：${redactUrl(finalUrl)}`);
      }
      if (!response.body) {
        const whole = Buffer.from(await response.arrayBuffer());
        if (whole.length > cfg.maxBytes) {
          throw new Error(`附件超过大小上限 ${cfg.maxBytes} 字节：${redactUrl(finalUrl)}`);
        }
        return whole;
      }
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > cfg.maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error(`附件超过大小上限 ${cfg.maxBytes} 字节：${redactUrl(finalUrl)}`);
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock?.();
      }
      return Buffer.concat(chunks, total);
    },
  });
}

/** Issue 是否带 sticker-submission 标签（对象或字符串标签都认）。 */
export function hasStickerSubmissionLabel(entry) {
  const labels = entry && Array.isArray(entry.labels) ? entry.labels : [];
  return labels.some((label) => {
    const name = typeof label === 'string' ? label : label && label.name;
    return String(name || '').trim().toLowerCase() === SUBMISSION_LABEL;
  });
}

/**
 * 把带投稿标签的 Issue 附件拉进中转区。
 * 幂等键是 Issue 号 + 附件 id：重复跑不会重复下载、不产生第二条记录。
 */
export async function pullIssueAttachments(cfg, { issue = null, state = 'open', limit = 100 } = {}) {
  await ensureLayout(cfg);
  const entries = [];

  if (issue !== null && issue !== undefined) {
    const { json } = await githubJson(cfg, `${cfg.apiBase}/repos/${cfg.repo}/issues/${encodeURIComponent(issue)}`);
    entries.push(json);
  } else {
    const url = `${cfg.apiBase}/repos/${cfg.repo}/issues`
      + `?state=${encodeURIComponent(state)}&labels=${encodeURIComponent(SUBMISSION_LABEL)}&per_page=${limit}`;
    const { json } = await githubJson(cfg, url);
    if (Array.isArray(json)) entries.push(...json.filter((entry) => !entry.pull_request));
  }

  const results = [];
  for (const entry of entries) {
    /* 二次核对：查询里带了标签，返回结果仍要逐条确认，别信“列表接口已过滤” */
    if (!hasStickerSubmissionLabel(entry)) {
      results.push({ issue: entry.number, url: '', status: 'skipped', error: `缺少 ${SUBMISSION_LABEL} 标签` });
      continue;
    }
    const sections = parseIssueForm(entry.body);
    const fields = fieldsFromSections(sections);
    if (fields.character) fields.character = characterIdFromLabel(fields.character) || fields.character;

    for (const rawUrl of extractAttachments(entry.body)) {
      /* 写进 origin / 结果的 URL 先剥掉 jwt 之类的签名参数 */
      const safeUrl = redactUrl(rawUrl);
      const origin = {
        issue: entry.number,
        issueTitle: entry.title,
        issueUrl: redactUrl(entry.html_url),
        submitter: entry.user ? entry.user.login : '',
        assetId: assetIdOf(safeUrl),
        assetUrl: safeUrl,
      };
      try {
        const existing = await findByOrigin(cfg, origin);
        if (existing) {
          results.push({ issue: entry.number, url: safeUrl, status: 'duplicate', item: existing, sha256: existing.sha256 });
          continue;
        }
        const buffer = await downloadAttachment(cfg, rawUrl);
        const result = await stageBuffer(cfg, buffer, {
          source: 'github-issue',
          fields,
          origin,
          name: path.basename(new URL(rawUrl).pathname) || `${assetIdOf(safeUrl)}.png`,
        });
        results.push({ issue: entry.number, url: safeUrl, ...result });
      } catch (error) {
        results.push({ issue: entry.number, url: safeUrl, status: 'failed', error: error.message });
      }
    }
  }
  await log(cfg, 'pull-issues', { issues: entries.length, items: results.length });
  return results;
}

/* ---------------------------------------------------------------- 已入库校验 */

/**
 * 从站点仓的权威清单建 sha256 索引。
 * 注意：读的是站点仓 data/，不是内容仓 dist/——清单权威副本在站点仓。
 */
export async function buildPublishedIndex(cfg) {
  const index = new Map();
  const manifests = [
    { file: 'works.json', label: 'submissions' },
    { file: 'owner-picks.json', label: 'owner-picks' },
  ];
  for (const { file, label } of manifests) {
    let records;
    try {
      records = JSON.parse(await fs.readFile(path.join(cfg.siteDataDir, file), 'utf8'));
    } catch {
      continue;
    }
    for (const record of records) {
      if (record && record.sha256) {
        index.set(record.sha256, {
          manifest: label,
          name: record.name,
          path: urlToRepoPath(cfg, record.path),
        });
      }
    }
  }
  return index;
}

function urlToRepoPath(cfg, rawUrl) {
  const value = String(rawUrl || '');
  if (!value) return '';
  const marker = `/${cfg.repo}/main/`;
  const at = value.indexOf(marker);
  if (at >= 0) return value.slice(at + marker.length);
  return '';
}

/** 取 origin/main 上某个 blob 的 sha256；取不到返回 null */
export function blobDigest(cfg, repoPath) {
  if (!repoPath) return null;
  try {
    return sha256(git(cfg, ['cat-file', 'blob', `${cfg.ref}:${repoPath}`]));
  } catch {
    return null;
  }
}

/**
 * 判断一条中转记录是否已经真的进了 origin/main。
 * 只有返回 prunable: true 的记录才允许被 prune 删除。
 */
export async function verifyItem(cfg, item, index) {
  const candidates = [];
  if (item.targetPath) candidates.push(item.targetPath);

  const published = index.get(item.sha256);
  if (published && published.path) candidates.push(published.path);

  const name = (item.fields && item.fields.name) || '';

  if (candidates.length === 0) {
    return {
      sha256: item.sha256,
      name,
      prunable: false,
      reason: '既没有 targetPath，已发布清单里也没有这个 sha256',
    };
  }

  let mismatch = '';
  for (const candidate of candidates) {
    const digest = blobDigest(cfg, candidate);
    if (digest && digest === item.sha256) {
      return {
        sha256: item.sha256,
        name,
        prunable: true,
        reason: `${cfg.ref}:${candidate} 的 sha256 与中转副本一致`,
        committedPath: candidate,
      };
    }
    if (digest && !mismatch) {
      mismatch = `${candidate} 在 ${cfg.ref} 上存在但 sha256 不一致（图上错位，人工确认）`;
    }
  }

  return {
    sha256: item.sha256,
    name,
    prunable: false,
    reason: mismatch || `${candidates.join(' / ')} 在 ${cfg.ref} 上都不存在`,
  };
}

export async function verifyItems(cfg, { status } = {}) {
  const items = await listItems(cfg, { status: status || 'staged' });
  const index = await buildPublishedIndex(cfg);
  const results = [];
  for (const item of items) results.push(await verifyItem(cfg, item, index));
  return results;
}

/**
 * 清理。默认只报告，必须显式 apply 才删。
 * 删除条件只有一条：verifyItem 判定 prunable。任何拿不准的情况一律保留。
 */
export async function pruneItems(cfg, { apply = false, status } = {}) {
  const reports = await verifyItems(cfg, { status });
  const prunable = reports.filter((entry) => entry.prunable);
  const kept = reports.filter((entry) => !entry.prunable);
  const removed = [];

  if (apply) {
    for (const entry of prunable) {
      /* 单条坏记录（缺 ext / meta 损坏）不能让整轮清理中断，拿不准就保留 */
      try {
        const item = await readItem(cfg, entry.sha256);
        if (!item) continue;
        await fs.rm(itemFile(cfg, item), { force: true });
        await fs.rm(metaFile(cfg, entry.sha256), { force: true });
        removed.push(entry);
      } catch (error) {
        console.error(`× 清理 ${String(entry.sha256).slice(0, 12)} 失败，已保留：${error.message}`);
      }
    }
    await log(cfg, 'prune', { removed: removed.map((entry) => entry.sha256) });
  }
  return { applied: apply, prunable, kept, removed };
}

/**
 * 显式丢弃一条记录（审核不通过、重复投稿等）。这是人的决定，不是自动判断，
 * 所以要走单独的命令，不能混在 prune 里。
 */
export async function dropItem(cfg, digest, reason = '') {
  const item = await readItem(cfg, digest);
  if (!item) throw new Error(`中转区里没有 ${digest}`);
  await fs.rm(itemFile(cfg, item), { force: true });
  await fs.rm(metaFile(cfg, digest), { force: true });
  await log(cfg, 'drop', { sha256: digest, reason, name: item.fields.name || '' });
  return item;
}

/** 把中转的原图导出一份到本地，方便审核时看图 */
export async function exportItem(cfg, digest, outDir) {
  const item = await readItem(cfg, digest);
  if (!item) throw new Error(`中转区里没有 ${digest}`);
  await fs.mkdir(outDir, { recursive: true });
  const base = item.fields.name ? sanitizeName(item.fields.name) : digest.slice(0, 12);
  const target = path.join(outDir, `${base}${item.ext}`);
  await fs.copyFile(itemFile(cfg, item), target);
  return target;
}

function sanitizeName(value) {
  return String(value).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'item';
}

export { repoRelative };
