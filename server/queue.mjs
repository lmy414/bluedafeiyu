/* server/queue.mjs —— 统一投稿队列（Node 标准库磁盘实现，零依赖）
 *
 * 三种来源（网页 / QQ / GitHub Issue）都走这里。核心性质：
 *
 *   1. **两种幂等键**：sourceId 唯一 + sha256 唯一。重复投稿返回同一条，
 *      不产生第二条记录、不重复占磁盘。
 *   2. **状态机封闭**：只允许 TRANSITIONS 表里的迁移；**没有 published 态**，
 *      服务永远不会自动把图推出去。AI 只能把条目推进到 auto_passed /
 *      auto_rejected / needs_manual，最终批准或拒绝必须由人来做。
 *   3. **崩溃安全**：写入走 临时文件 + fsync + rename；索引可从 items/ 重建；
 *      重启时卡在 reviewing 的条目按超时转人工，绝不当作通过。
 *
 * 存储布局（全部在私有 root 下，0700/0600）：
 *   objects/<sha256><ext>   待审原图字节
 *   items/<id>.json         条目元数据与状态历史
 *   index/source.json       sourceId -> id
 *   index/sha256.json       sha256   -> id
 *   ai/<id>.json            AI 原始结果（只给人看，不进公开响应）
 *   logs/queue.log          操作日志（不记密钥、不记图片正文）
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { AI_CONTENT_SCHEMA, ALLOWED_IMAGE_EXT, FORMAT_EXT, SCHEMA, ensureStorageLayout } from './config.mjs';

export const SOURCES = new Set(['web', 'qq', 'github-issue', 'local', 'manual']);

export const STATES = Object.freeze({
  RECEIVED: 'received',
  REVIEWING: 'reviewing',
  AUTO_PASSED: 'auto_passed',
  AUTO_REJECTED: 'auto_rejected',
  NEEDS_MANUAL: 'needs_manual',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const TERMINAL_STATES = [STATES.APPROVED, STATES.REJECTED];

/* 事件 -> 允许的来源态与目标态。任何人想加状态都得先改这张表。 */
export const TRANSITIONS = Object.freeze({
  'review.start': { from: [STATES.RECEIVED, STATES.NEEDS_MANUAL], to: STATES.REVIEWING },
  'review.pass': { from: [STATES.REVIEWING], to: STATES.AUTO_PASSED },
  'review.reject': { from: [STATES.REVIEWING], to: STATES.AUTO_REJECTED },
  'review.manual': { from: [STATES.REVIEWING, STATES.RECEIVED], to: STATES.NEEDS_MANUAL },
  'human.approve': { from: [STATES.NEEDS_MANUAL, STATES.AUTO_PASSED, STATES.AUTO_REJECTED], to: STATES.APPROVED },
  'human.reject': { from: [STATES.NEEDS_MANUAL, STATES.AUTO_PASSED, STATES.AUTO_REJECTED], to: STATES.REJECTED },
  'human.reopen': { from: [STATES.APPROVED, STATES.REJECTED], to: STATES.NEEDS_MANUAL },
});

const MIME_BY_FORMAT = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** 按文件头认格式。扩展名是投稿者说了算的，只看扩展名会放进改名的脚本。 */
export function sniffImageFormat(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.length >= 12
    && buf.subarray(0, 4).toString('latin1') === 'RIFF'
    && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 扩展名归一：格式 + 投稿者给的扩展名共同决定，不一致时以文件头为准并拒绝可疑项。 */
export function resolveExtension(buffer, hint) {
  const format = sniffImageFormat(buffer);
  if (!format) throw new Error('文件头不是已知图片格式，拒绝入库');
  const rawHint = String(hint || '').toLowerCase();
  if (rawHint && !ALLOWED_IMAGE_EXT.has(rawHint)) throw new Error(`不支持的图片格式：${rawHint}`);
  if (rawHint && rawHint !== '.jpg' && rawHint !== '.jpeg') {
    const hintFormat = rawHint === '.apng' ? 'png' : rawHint.slice(1);
    if (hintFormat !== format) throw new Error(`文件内容像 ${format}，扩展名却是 ${rawHint}，拒绝入库`);
  }
  if (rawHint === '.apng' && format === 'png') return { format, ext: '.apng', mime: MIME_BY_FORMAT.png };
  return { format, ext: FORMAT_EXT[format], mime: MIME_BY_FORMAT[format] };
}

function normalizeFields(fields = {}) {
  return {
    name: String(fields.name || '').slice(0, 200),
    description: String(fields.description || '').slice(0, 2000),
    character: String(fields.character || ''),
    tags: Array.isArray(fields.tags) ? fields.tags.map((tag) => String(tag)).filter(Boolean).slice(0, 20) : [],
    ...(fields.extra && typeof fields.extra === 'object' ? { extra: fields.extra } : {}),
  };
}

/* AI content 白名单：只有这六个内容字段。系统/法律字段（id/slug/path/submitter/
 * origin/license/status 等）与任何未知字段都不在其中，写摘要时一律丢弃——审核层
 * 已经拒过，这里再兜一次底。审核结论三元组留在 item.review 上，不塞进 content。 */
const REVIEW_CONTENT_LIMITS = Object.freeze({
  name: 200,
  description: 2000,
  commentary: 2000,
  characterId: 64,
  categoryIds: 10,
  categoryId: 64,
  tags: 20,
  tagLength: 40,
});

/** 只保留白名单字段并截断长度；不是对象时返回 null。 */
function normalizeReviewContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const text = (value, max) => String(value ?? '').slice(0, max);
  const list = (value, max, itemMax) => (Array.isArray(value) ? value.slice(0, max).map((entry) => text(entry, itemMax)) : []);
  return {
    name: text(content.name, REVIEW_CONTENT_LIMITS.name),
    description: text(content.description, REVIEW_CONTENT_LIMITS.description),
    commentary: text(content.commentary, REVIEW_CONTENT_LIMITS.commentary),
    characterId: text(content.characterId, REVIEW_CONTENT_LIMITS.characterId),
    categoryIds: list(content.categoryIds, REVIEW_CONTENT_LIMITS.categoryIds, REVIEW_CONTENT_LIMITS.categoryId),
    tags: list(content.tags, REVIEW_CONTENT_LIMITS.tags, REVIEW_CONTENT_LIMITS.tagLength),
  };
}

async function writeFileAtomic(file, data, mode = 0o600) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'w', mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
    await fs.chmod(file, mode).catch(() => {});
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readJsonFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * 打开（或创建）队列。返回的实例自己维护内存索引，并在线性化锁内落盘。
 * 所有写操作都串行化：同进程用 promise 链，跨进程用 wx 锁文件。
 */
export async function createQueue(cfg, { now = () => Date.now(), reviewTimeoutMs = cfg.recoverAfterMs } = {}) {
  await ensureStorageLayout(cfg);
  const paths = cfg.paths;

  let chain = Promise.resolve();
  function runExclusive(fn) {
    const result = chain.then(fn, fn);
    chain = result.then(() => undefined, () => undefined);
    return result;
  }

  const lockFile = path.join(paths.state, 'queue.lock');
  const lockStaleMs = 30 * 1000;

  async function acquireFileLock() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const handle = await fs.open(lockFile, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: now() }));
        await handle.close();
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const stat = await fs.stat(lockFile);
          if (now() - stat.mtimeMs > lockStaleMs) await fs.rm(lockFile, { force: true });
        } catch { /* 锁刚好被别人释放，继续重试 */ }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error('获取队列锁超时，可能有另一个进程正在写入');
  }

  async function releaseFileLock() {
    await fs.rm(lockFile, { force: true }).catch(() => {});
  }

  function withLock(fn) {
    return runExclusive(async () => {
      await acquireFileLock();
      try {
        return await fn();
      } finally {
        await releaseFileLock();
      }
    });
  }

  const itemPath = (id) => path.join(paths.items, `${String(id).replace(/[^A-Za-z0-9_-]/g, '')}.json`);

  async function listItems() {
    const entries = await fs.readdir(paths.items).catch(() => []);
    const items = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.startsWith('.')) continue;
      const item = await readJsonFile(path.join(paths.items, entry));
      if (item && item.id) items.push(item);
    }
    return items;
  }

  let sourceIndex = new Map();
  let shaIndex = new Map();

  async function rebuildIndexes() {
    const items = await listItems();
    sourceIndex = new Map();
    shaIndex = new Map();
    for (const item of items) {
      shaIndex.set(item.sha256, item.id);
      for (const sourceId of item.sourceIds || []) sourceIndex.set(sourceId, item.id);
    }
  }

  async function persistIndexes() {
    await writeFileAtomic(path.join(paths.index, 'source.json'), `${JSON.stringify(Object.fromEntries(sourceIndex), null, 0)}\n`);
    await writeFileAtomic(path.join(paths.index, 'sha256.json'), `${JSON.stringify(Object.fromEntries(shaIndex), null, 0)}\n`);
  }

  /* 从磁盘重建索引：索引只是缓存，items/ 才是真源。 */
  async function reload() {
    await rebuildIndexes();
    await persistIndexes();
    return { items: sourceIndex.size, digests: shaIndex.size };
  }

  async function log(event, detail = {}) {
    const line = `${new Date(now()).toISOString()}\t${event}\t${JSON.stringify(detail)}\n`;
    const file = path.join(paths.logs, 'queue.log');
    await fs.mkdir(paths.logs, { recursive: true, mode: 0o700 });
    await fs.appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(file, 0o600).catch(() => {});
  }

  async function readItem(id) {
    return readJsonFile(itemPath(id));
  }

  async function saveItem(item) {
    await writeFileAtomic(itemPath(item.id), `${JSON.stringify(item, null, 2)}\n`);
  }

  async function enqueue({ source, sourceId, buffer, ext = '', fields = {}, origin = {} }) {
    if (!SOURCES.has(source)) throw new Error(`不支持的来源：${source}`);
    if (!String(sourceId || '').trim()) throw new Error('sourceId 不能为空（幂等键）');
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    if (data.length === 0) throw new Error('不能收空文件');
    if (data.length > cfg.maxBytes) throw new Error(`图片超过大小上限 ${cfg.maxBytes} 字节：${data.length}`);
    const { format, ext: resolvedExt, mime } = resolveExtension(data, ext);
    const digest = sha256(data);
    const id = `sub_${digest.slice(0, 24)}`;

    return withLock(async () => {
      const existingSource = sourceIndex.get(sourceId);
      if (existingSource) {
        const item = await readItem(existingSource);
        if (item) {
          item.lastSeenAt = new Date(now()).toISOString();
          await saveItem(item);
          await log('enqueue.duplicate_source', { id: item.id, source });
          return { status: 'duplicate_source', item };
        }
      }
      const existingSha = shaIndex.get(digest);
      if (existingSha) {
        const item = await readItem(existingSha);
        if (item) {
          if (!item.sourceIds.includes(sourceId)) item.sourceIds.push(sourceId);
          item.sourceIds.sort();
          item.updatedAt = new Date(now()).toISOString();
          sourceIndex.set(sourceId, item.id);
          await saveItem(item);
          await persistIndexes();
          await log('enqueue.duplicate_hash', { id: item.id, source });
          return { status: 'duplicate_hash', item };
        }
      }

      const at = new Date(now()).toISOString();
      const objectFile = path.join(paths.objects, `${digest}${resolvedExt}`);
      if (!(await fs.stat(objectFile).catch(() => null))) {
        await writeFileAtomic(objectFile, data);
      }
      const item = {
        schema: SCHEMA,
        id,
        sha256: digest,
        ext: resolvedExt,
        format,
        mime,
        bytes: data.length,
        source,
        sourceIds: [sourceId],
        fields: normalizeFields(fields),
        origin,
        state: STATES.RECEIVED,
        stateHistory: [{ event: 'enqueue', from: null, to: STATES.RECEIVED, at, actor: source, reason: '' }],
        review: null,
        createdAt: at,
        updatedAt: at,
        lastSeenAt: at,
      };
      await saveItem(item);
      shaIndex.set(digest, id);
      sourceIndex.set(sourceId, id);
      await persistIndexes();
      await log('enqueue', { id, source, bytes: data.length });
      return { status: 'created', item };
    });
  }

  async function get(id) {
    return readItem(id);
  }

  async function findBySourceId(sourceId) {
    const id = sourceIndex.get(sourceId);
    return id ? readItem(id) : null;
  }

  async function list({ state, source, limit } = {}) {
    let items = await listItems();
    if (state) items = items.filter((item) => item.state === state);
    if (source) items = items.filter((item) => item.source === source || (item.sourceIds || []).some((sid) => sid.startsWith(`${source}:`)));
    items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
    if (limit && Number.isFinite(limit)) items = items.slice(0, limit);
    return items;
  }

  async function transition(id, event, { actor = 'system', reason = '' } = {}) {
    const rule = TRANSITIONS[event];
    if (!rule) throw new Error(`未知事件：${event}`);
    return withLock(async () => {
      const item = await readItem(id);
      if (!item) throw new Error(`队列里没有 ${id}`);
      if (!rule.from.includes(item.state)) {
        throw new Error(`非法状态迁移：${item.state} 不能执行 ${event}`);
      }
      const previous = item.state;
      const at = new Date(now()).toISOString();
      item.state = rule.to;
      item.updatedAt = at;
      item.stateHistory.push({ event, from: previous, to: rule.to, at, actor, reason });
      await saveItem(item);
      await log('transition', { id, event, to: rule.to, actor });
      return item;
    });
  }

  async function attachReview(id, review, { raw = null } = {}) {
    return withLock(async () => {
      const item = await readItem(id);
      if (!item) throw new Error(`队列里没有 ${id}`);
      const content = normalizeReviewContent(review.content);
      const schema = review.schema
        ? String(review.schema).slice(0, 64)
        : (content ? AI_CONTENT_SCHEMA : null);
      item.review = {
        verdict: review.verdict,
        confidence: review.confidence,
        reason: String(review.reason || '').slice(0, 1000),
        schema,
        model: review.model || null,
        promptVersion: review.promptVersion || null,
        latencyMs: review.latencyMs ?? null,
        decidedBy: review.decidedBy || 'ai',
        at: new Date(now()).toISOString(),
      };
      /* 受校验的 AI 内容：只保留白名单字段（六个内容字段 + 审核三元组），
       * 系统/法律/未知字段一律剔除；超限不落，桥接会按内容不完整跳过。 */
      if (content) {
        let serialized = '';
        try { serialized = JSON.stringify(content); } catch { serialized = ''; }
        item.review.content = serialized && serialized.length <= cfg.maxJsonBytes ? content : null;
      } else {
        item.review.content = null;
      }
      item.updatedAt = item.review.at;
      if (raw !== null && raw !== undefined) {
        await writeFileAtomic(path.join(paths.ai, `${item.id}.json`), `${JSON.stringify({ id, at: item.review.at, schema: item.review.schema, content: item.review.content ?? null, payload: raw }, null, 2)}\n`);
      }
      await saveItem(item);
      return item;
    });
  }

  /**
   * 记录桥接结果（不改变公开投稿状态机）。桥接是私有中转步骤，状态只作为
   * 附加字段 `item.bridge` 落盘，`state` 始终停在 auto_passed。
   */
  async function recordBridge(id, patch = {}) {
    return withLock(async () => {
      const item = await readItem(id);
      if (!item) throw new Error(`队列里没有 ${id}`);
      item.bridge = {
        ...(item.bridge || {}),
        ...patch,
        at: new Date(now()).toISOString(),
      };
      await saveItem(item);
      await log('bridge', { id, status: item.bridge.status || null, sha256: item.bridge.sha256 || null });
      return item;
    });
  }

  async function readReviewRaw(id) {
    return readJsonFile(path.join(paths.ai, `${id}.json`));
  }

  async function decide(id, decision, { actor = 'maintainer', reason = '' } = {}) {
    if (decision !== 'approved' && decision !== 'rejected') throw new Error(`不支持的审核结论：${decision}`);
    const event = decision === 'approved' ? 'human.approve' : 'human.reject';
    return transition(id, event, { actor, reason });
  }

  async function readImage(id) {
    const item = await readItem(id);
    if (!item) throw new Error(`队列里没有 ${id}`);
    return fs.readFile(path.join(paths.objects, `${item.sha256}${item.ext}`));
  }

  async function objectFile(id) {
    const item = await readItem(id);
    if (!item) return null;
    return path.join(paths.objects, `${item.sha256}${item.ext}`);
  }

  async function stats() {
    const items = await listItems();
    const byState = {};
    const bySource = {};
    for (const item of items) {
      byState[item.state] = (byState[item.state] || 0) + 1;
      bySource[item.source] = (bySource[item.source] || 0) + 1;
    }
    return { total: items.length, byState, bySource, storageRoot: cfg.storageRoot };
  }

  /**
   * 启动恢复：重建索引；把卡在 reviewing 且超过超时的条目转人工。
   * 恢复绝不把条目判成通过——AI 没说完的话，只能人来说。
   */
  async function recover() {
    return withLock(async () => {
      await rebuildIndexes();
      await persistIndexes();
      const recovered = [];
      const items = await listItems();
      for (const item of items) {
        if (item.state !== STATES.REVIEWING) continue;
        const updated = Date.parse(item.updatedAt || item.createdAt || 0);
        if (!Number.isFinite(updated) || now() - updated < reviewTimeoutMs) continue;
        const at = new Date(now()).toISOString();
        const previous = item.state;
        item.state = STATES.NEEDS_MANUAL;
        item.updatedAt = at;
        item.stateHistory.push({ event: 'review.manual', from: previous, to: STATES.NEEDS_MANUAL, at, actor: 'system', reason: '服务重启后超过审核超时，转人工处理' });
        await saveItem(item);
        recovered.push({ id: item.id, reason: '服务重启后超过审核超时，转人工处理' });
      }
      await log('recover', { recovered: recovered.length });
      return { recovered, rebuilt: true };
    });
  }

  await rebuildIndexes();

  return {
    paths,
    itemPath,
    enqueue,
    get,
    findBySourceId,
    list,
    stats,
    transition,
    attachReview,
    readReviewRaw,
    recordBridge,
    decide,
    readImage,
    objectFile,
    recover,
    reload,
    withLock,
  };
}
