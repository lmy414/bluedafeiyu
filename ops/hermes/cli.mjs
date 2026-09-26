#!/usr/bin/env node
/* ops/hermes/cli.mjs —— Hermes 侧定时任务入口（零依赖，默认 dry-run）
 *
 * Hermes 是编排方，不是第二个队列：条目的真状态只在 server/ 的私有队列里，
 * 本脚本只做三件事：
 *
 *   review-cycle   每 5 分钟：GET received → GET 原图 → 调视觉 AI → POST 审核结果
 *   pull-issues    每天 2–3 次：触发 server/ 拉取 GitHub Issue 附件
 *   publish        每 6 小时：触发 ops/publish-batch.mjs --live
 *
 * 对接的是 server/ 的内部审核接口（server/http.mjs 的 handleInternalRequest）：
 *
 *   GET  /api/v1/internal/submissions?state=received&sources=web,github-issue&limit=N
 *   GET  /api/v1/internal/submissions/<id>/raw
 *   POST /api/v1/internal/review-results
 *        { schema, reviewer:"hermes", promptVersion, results:[{ submissionId, verdict, confidence, reason, model, content }] }
 *
 * 内部接口走**公开口**（默认 127.0.0.1:8790），用 Hermes 专属令牌
 * SUBMISSION_HERMES_REVIEW_TOKEN；QQ 由 server 侧排除在内部来源之外，Hermes 不处理。
 *
 * 安全姿态：
 *
 *   1. **默认 dry-run**：只读待审列表与原图，不发模型请求、不写队列、不触发发布。
 *   2. **真实动作要两把钥匙**：命令行给 --live，且环境变量 HERMES_REVIEW_LIVE /
 *      HERMES_PULL_LIVE / HERMES_PUBLISH_LIVE 对应为 true，缺一不可。
 *   3. **密钥只从环境变量读**，不进仓库；本文件不含真实端点、令牌或服务器路径。
 *   4. 审核结论复用 server/review.mjs 的 submission-ai-content/1 校验，
 *      不自己造字段口径；低置信度、解析失败、异常一律转人工，绝不假造通过。
 *
 * 用法：
 *
 *   node ops/hermes/cli.mjs doctor
 *   node ops/hermes/cli.mjs doctor --probe                 # 探测内部回写接口
 *   node ops/hermes/cli.mjs review-cycle                    # 默认 dry-run
 *   node ops/hermes/cli.mjs review-cycle --live --limit 20
 *   node ops/hermes/cli.mjs post-results --file ./results.json [--live]
 *   node ops/hermes/cli.mjs pull-issues [--live] [--via-ssh]
 *   node ops/hermes/cli.mjs publish [--live] [--via-ssh] [--limit 5]
 *
 * 完整约定见 docs/Hermes审核与发布接线.md，环境变量模板见 ops/hermes/hermes.env.example。
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AI_CONTENT_SCHEMA, loadContentVocabulary } from '../../server/config.mjs';
import { containsForbiddenText, createHttpReviewClient, parseReviewResponse } from '../../server/review.mjs';

export const REVIEW_RESULTS_SCHEMA = 'submission-review-results/1';
export const REVIEW_RESULTS_PATH = '/api/v1/internal/review-results';
export const INTERNAL_LIST_PATH = '/api/v1/internal/submissions';
export const REVIEWER_ID = 'hermes';
export const DEFAULT_SOURCES = 'web,github-issue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

const VERDICTS = new Set(['pass', 'reject', 'manual']);
/* 与 server/http.mjs 的 INTERNAL_ID_PATTERN 同一口径。 */
const ITEM_ID_PATTERN = /^sub_[A-Za-z0-9_-]{1,64}$/;

const DEFAULT_REVIEW_API_URL = 'http://127.0.0.1:8790';
const DEFAULT_ADMIN_API_URL = 'http://127.0.0.1:8788';
const DEFAULT_VISION_TIMEOUT_MS = 60 * 1000;
const DEFAULT_HTTP_TIMEOUT_MS = 30 * 1000;
const DEFAULT_MIN_CONFIDENCE = 0.6;
const DEFAULT_LOCK_STALE_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 50;

/** 每个真实动作对应的环境变量开关；--live 与它都满足才允许执行。 */
export const LIVE_ENV = Object.freeze({
  review: 'HERMES_REVIEW_LIVE',
  pull: 'HERMES_PULL_LIVE',
  publish: 'HERMES_PUBLISH_LIVE',
});

/* ---------------------------------------------------------------- 参数与配置 */

export function parseArgv(argv = []) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (key, name) => {
      if (arg === key) { options[name] = argv[i + 1]; i += 1; return true; }
      if (arg.startsWith(`${key}=`)) { options[name] = arg.slice(key.length + 1); return true; }
      return false;
    };
    if (arg === '--live') options.live = true;
    else if (arg === '--dry-run' || arg === '--dryrun') options.dryRun = true;
    else if (arg === '--via-ssh') options.viaSsh = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--probe') options.probe = true;
    else if (arg === '--include-needs-manual') options.includeNeedsManual = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (takeValue('--limit', 'limit')) { /* 已赋值 */ }
    else if (takeValue('--file', 'file')) { /* 已赋值 */ }
    else if (takeValue('--state', 'state')) { /* 已赋值 */ }
    else if (takeValue('--max-pages', 'maxPages')) { /* 已赋值 */ }
    else if (arg.startsWith('--')) throw new Error(`无法识别的参数：${arg}（node ops/hermes/cli.mjs help 看用法）`);
    else options._.push(arg);
  }
  return options;
}

function boolOf(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function intOf(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

export function resolveHermesConfig({ env = process.env } = {}) {
  return {
    review: {
      apiUrl: String(env.HERMES_REVIEW_API_URL || DEFAULT_REVIEW_API_URL).replace(/\/+$/, ''),
      token: String(env.HERMES_REVIEW_TOKEN || '').trim(),
    },
    admin: {
      apiUrl: String(env.HERMES_ADMIN_API_URL || DEFAULT_ADMIN_API_URL).replace(/\/+$/, ''),
      token: String(env.HERMES_ADMIN_TOKEN || '').trim(),
    },
    vision: {
      endpoint: String(env.HERMES_VISION_ENDPOINT || '').trim(),
      apiKey: String(env.HERMES_VISION_API_KEY || '').trim(),
      model: String(env.HERMES_VISION_MODEL || '').trim(),
      timeoutMs: intOf(env.HERMES_VISION_TIMEOUT_MS, DEFAULT_VISION_TIMEOUT_MS),
    },
    sources: String(env.HERMES_REVIEW_SOURCES || DEFAULT_SOURCES),
    minConfidence: Number.isFinite(Number(env.HERMES_REVIEW_MIN_CONFIDENCE))
      ? Number(env.HERMES_REVIEW_MIN_CONFIDENCE)
      : DEFAULT_MIN_CONFIDENCE,
    promptVersion: String(env.HERMES_REVIEW_PROMPT_VERSION || 'hermes-review-v1'),
    httpTimeoutMs: intOf(env.HERMES_HTTP_TIMEOUT_MS, DEFAULT_HTTP_TIMEOUT_MS),
    stateDir: String(env.HERMES_STATE_DIR || path.join(os.tmpdir(), 'dafeiyu-hermes-state')),
    lockStaleMs: intOf(env.HERMES_LOCK_STALE_MS, DEFAULT_LOCK_STALE_MS),
    live: {
      review: boolOf(env.HERMES_REVIEW_LIVE),
      pull: boolOf(env.HERMES_PULL_LIVE),
      publish: boolOf(env.HERMES_PUBLISH_LIVE),
    },
    pull: {
      ssh: String(env.HERMES_PULL_SSH || '').trim(),
      cmd: String(env.HERMES_PULL_CMD || 'node server/cli.mjs pull-issues --state open --max-pages 5'),
    },
    publish: {
      ssh: String(env.HERMES_PUBLISH_SSH || '').trim(),
      cmd: String(env.HERMES_PUBLISH_CMD || 'node ops/publish-batch.mjs --live'),
      dryCmd: String(env.HERMES_PUBLISH_DRY_CMD || 'node ops/publish-batch.mjs --dry-run'),
    },
    serverDir: String(env.HERMES_SERVER_DIR || '').trim(),
  };
}

/**
 * 决定一个子命令是否真的执行。返回 { live, blocked, reason }。
 * blocked=true 表示操作者给了 --live，但环境开关没开，属于配置错误，要报错退出。
 */
export function resolveLiveMode(kind, cfg, argv = {}) {
  if (argv.dryRun) return { live: false, blocked: false, reason: '--dry-run 强制演练' };
  if (!argv.live) return { live: false, blocked: false, reason: '未给 --live，默认 dry-run' };
  if (!cfg.live[kind]) return { live: false, blocked: true, reason: `给了 --live，但缺少 ${LIVE_ENV[kind]}=true，拒绝真实动作` };
  return { live: true, blocked: false, reason: '' };
}

/* ---------------------------------------------------------------- 基础工具 */

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** 只重试网络错误与 5xx / 429；4xx 立即失败，不空转。 */
export async function retry(fn, { retries = 3, baseMs = 500, maxMs = 8000, sleepImpl = sleep, onRetry = null } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = error && error.retryable !== false;
      if (!retryable || attempt === retries) break;
      const delay = Math.min(maxMs, baseMs * 2 ** attempt);
      if (onRetry) onRetry(error, attempt + 1, delay);
      await sleepImpl(delay);
    }
  }
  throw lastError;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    const aborted = /abort/i.test(String(error && error.message));
    throw Object.assign(new Error(aborted ? `请求超时（${timeoutMs} ms）：${url}` : `请求失败：${error.message}`), { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

function expectOk(response, label) {
  if (response.ok) return response;
  const retryable = response.status >= 500 || response.status === 429;
  throw Object.assign(new Error(`${label} 返回 HTTP ${response.status}`), { retryable, status: response.status });
}

/** 选内部审核口（公开口 + Hermes 令牌）或管理口（回环 + 管理令牌）。 */
function apiOf(cfg, target) {
  return target === 'admin'
    ? { baseUrl: cfg.admin.apiUrl, token: cfg.admin.token }
    : { baseUrl: cfg.review.apiUrl, token: cfg.review.token };
}

async function requestJson(cfg, target, urlPath, { method = 'GET', body = null, headers = {}, fetchImpl = globalThis.fetch } = {}) {
  const { baseUrl, token } = apiOf(cfg, target);
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  }, cfg.httpTimeoutMs);
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, ok: response.ok, json, text };
}

function requireToken(cfg, target) {
  const token = apiOf(cfg, target).token;
  const name = target === 'admin' ? 'HERMES_ADMIN_TOKEN' : 'HERMES_REVIEW_TOKEN';
  if (!token) throw new Error(`缺少 ${name}，拒绝发请求`);
}

/* ---------------------------------------------------------------- 队列读取 */

export async function listPendingItems(cfg, { limit = DEFAULT_LIMIT, includeNeedsManual = false, fetchImpl } = {}) {
  requireToken(cfg, 'review');
  const states = includeNeedsManual ? ['received', 'needs_manual'] : ['received'];
  const items = [];
  for (const state of states) {
    const query = `state=${encodeURIComponent(state)}&sources=${encodeURIComponent(cfg.sources)}&limit=${limit}`;
    const response = await requestJson(cfg, 'review', `${INTERNAL_LIST_PATH}?${query}`, { fetchImpl });
    if (response.status === 401) throw Object.assign(new Error('内部审核令牌无效（HTTP 401）'), { retryable: false, status: 401 });
    if (response.status === 503) throw Object.assign(new Error('server 未配置内部审核令牌（HTTP 503）'), { retryable: false, status: 503 });
    expectOk(response, `列举 ${state} 条目`);
    if (!response.json || !Array.isArray(response.json.items)) {
      throw Object.assign(new Error(`列举 ${state} 条目响应结构不对`), { retryable: false });
    }
    items.push(...response.json.items);
  }
  return items;
}

export async function fetchItemRaw(cfg, item, { fetchImpl = globalThis.fetch } = {}) {
  requireToken(cfg, 'review');
  const id = typeof item === 'string' ? item : item.id;
  const urlPath = (typeof item === 'object' && item.rawPath) ? item.rawPath : `${INTERNAL_LIST_PATH}/${encodeURIComponent(id)}/raw`;
  const response = await fetchWithTimeout(fetchImpl, `${cfg.review.apiUrl}${urlPath}`, {
    headers: { Authorization: `Bearer ${cfg.review.token}` },
  }, cfg.httpTimeoutMs);
  expectOk(response, `下载原图 ${id}`);
  return Buffer.from(await response.arrayBuffer());
}

/* ---------------------------------------------------------------- 审核结果 */

/**
 * 构造视觉审核器。复用 server/review.mjs 的 OpenAI 兼容客户端与提示词，
 * 保证 Hermes 与 server/ 用同一套 submission-ai-content/1 口径。
 */
export function buildVisionReviewer(cfg, { fetchImpl = globalThis.fetch } = {}) {
  if (!cfg.vision.endpoint || !cfg.vision.apiKey) {
    throw new Error('视觉模型未配置：需要 HERMES_VISION_ENDPOINT 与 HERMES_VISION_API_KEY');
  }
  const client = createHttpReviewClient({
    endpoint: cfg.vision.endpoint,
    apiKey: cfg.vision.apiKey,
    model: cfg.vision.model,
    timeoutMs: cfg.vision.timeoutMs,
    fetchImpl,
  });
  return async function review({ buffer, mime, fields, vocabulary }) {
    const started = Date.now();
    const payload = await client({ buffer, mime: mime || 'image/png', fields, vocabulary });
    const parsed = parseReviewResponse(payload, { vocabulary });
    if (parsed.verdict !== 'manual' && parsed.confidence < cfg.minConfidence) {
      return {
        verdict: 'manual',
        confidence: 0,
        content: null,
        reason: `置信度 ${parsed.confidence} 低于阈值 ${cfg.minConfidence}，转人工`,
        latencyMs: Date.now() - started,
      };
    }
    return {
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      reason: parsed.reason,
      content: parsed.content,
      latencyMs: Date.now() - started,
    };
  };
}

/** 单条审核；任何异常都收敛成 manual，绝不上抛成「通过」。 */
export async function reviewOne(reviewer, { buffer, mime, fields, vocabulary }) {
  try {
    return await reviewer({ buffer, mime, fields, vocabulary });
  } catch (error) {
    return {
      verdict: 'manual',
      confidence: 0,
      content: null,
      reason: `视觉审核失败（${error.message}），转人工`,
      latencyMs: null,
    };
  }
}

function reasonError(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'reason 不能为空';
  if (containsForbiddenText(value)) return 'reason 含 HTML/脚本/控制字符';
  if (value.trim().length > 1000) return 'reason 超过 1000 字';
  return null;
}

function confidenceError(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return 'confidence 必须是 0..1 的 JSON number';
  return null;
}

const FALLBACK_MANUAL_REASON = '模型返回的字段不合法，转人工';

function manualResult(id, reason, extras = {}) {
  return { id, verdict: 'manual', confidence: 0, reason, content: null, model: null, ...extras };
}

/**
 * 校验并归一一条待回写的审核结果，形状对齐 server/internal 的单条 result。
 * pass 必须有通过 submission-ai-content/1 校验的 content；reject / manual 不需要 content。
 * 校验失败降级成 manual，而不是丢弃——失败关闭是这里的硬规则。
 * 返回 { ok, result, downgraded, error }。
 */
export function validateResult(raw, { vocabulary = null, minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '结果不是对象' };
  const id = String(raw.submissionId || raw.id || '');
  if (!ITEM_ID_PATTERN.test(id)) return { ok: false, error: `submissionId 不合法：${id}` };
  if (!VERDICTS.has(raw.verdict)) return { ok: false, error: `verdict 只能是 pass / reject / manual，收到 ${raw.verdict}` };

  const issue = reasonError(raw.reason);
  if (raw.verdict === 'manual') {
    return { ok: true, downgraded: false, result: manualResult(id, issue ? FALLBACK_MANUAL_REASON : String(raw.reason).trim(), { model: raw.model || null }) };
  }

  const confidenceIssue = confidenceError(raw.confidence);
  if (confidenceIssue) return { ok: false, error: confidenceIssue };
  if (raw.confidence < minConfidence) {
    return { ok: true, downgraded: true, result: manualResult(id, `置信度 ${raw.confidence} 低于阈值 ${minConfidence}，转人工`, { model: raw.model || null }) };
  }

  if (raw.verdict === 'reject') {
    // reject 只带结论与理由；server 端不会采纳 reject 的 content。
    return { ok: true, downgraded: false, result: { id, verdict: 'reject', confidence: raw.confidence, reason: issue ? FALLBACK_MANUAL_REASON : String(raw.reason).trim(), content: null, model: raw.model || null } };
  }

  // pass：必须有 content，且过 server/review.mjs 的同一套校验。
  if (issue) return { ok: true, downgraded: true, result: manualResult(id, FALLBACK_MANUAL_REASON, { model: raw.model || null }) };
  const parsed = parseReviewResponse({
    schema: AI_CONTENT_SCHEMA,
    verdict: 'pass',
    confidence: raw.confidence,
    reason: raw.reason,
    content: raw.content,
  }, { vocabulary });
  if (parsed.verdict !== 'pass') {
    return { ok: true, downgraded: true, result: manualResult(id, parsed.reason, { model: raw.model || null }) };
  }
  return { ok: true, downgraded: false, result: { id, verdict: 'pass', confidence: raw.confidence, reason: parsed.reason, content: parsed.content, model: raw.model || null } };
}

/** 把归一后的结果转成内部接口的 result 形状（submissionId，只有 pass 带 content）。 */
export function toWireResult(result, cfg) {
  const entry = {
    submissionId: result.id,
    verdict: result.verdict,
    confidence: result.confidence,
    reason: result.reason,
    model: result.model || cfg.vision.model || '',
  };
  if (result.verdict === 'pass' && result.content) entry.content = result.content;
  return entry;
}

export function buildResultsPayload(results, cfg) {
  return {
    schema: REVIEW_RESULTS_SCHEMA,
    reviewer: REVIEWER_ID,
    promptVersion: cfg.promptVersion,
    results: results.map((result) => toWireResult(result, cfg)),
  };
}

/**
 * 批量回写审核结果。server 逐条独立处理并回逐条状态，单条不合法不拖垮整批。
 * 幂等由 server 端保证：同一 reviewer 已审完的条目返回 status 200 + duplicate:true。
 */
export async function postReviewResults(cfg, results, { fetchImpl = globalThis.fetch, retries = 3, onRetry = null } = {}) {
  requireToken(cfg, 'review');
  const payload = buildResultsPayload(results, cfg);
  const idempotencyKey = crypto.createHash('sha256')
    .update(JSON.stringify(payload.results.map((entry) => [entry.submissionId, entry.verdict]).sort()))
    .digest('hex');
  return retry(async () => {
    const response = await requestJson(cfg, 'review', REVIEW_RESULTS_PATH, {
      method: 'POST',
      body: payload,
      headers: { 'Idempotency-Key': idempotencyKey },
      fetchImpl,
    });
    if (response.status === 401) throw Object.assign(new Error('内部审核令牌无效（HTTP 401）'), { retryable: false, status: 401 });
    if (response.status === 403) throw Object.assign(new Error('reviewer 与令牌不匹配（HTTP 403）：检查 reviewer 与令牌来源'), { retryable: false, status: 403 });
    if (response.status === 503) throw Object.assign(new Error('server 未配置内部审核令牌（HTTP 503）'), { retryable: false, status: 503 });
    if (response.status === 404) throw Object.assign(new Error('server 内部回写接口不存在（HTTP 404）'), { retryable: false, status: 404 });
    expectOk(response, '回写审核结果');
    return response.json;
  }, { retries, onRetry });
}

/** 把 server 逐条返回的状态归纳成可读摘要。 */
export function summarizeApplied(response) {
  const entries = (response && Array.isArray(response.results)) ? response.results : [];
  const applied = [];
  const duplicates = [];
  const failed = [];
  for (const entry of entries) {
    if (entry.status === 200 && entry.duplicate) duplicates.push(entry);
    else if (entry.status === 200) applied.push(entry);
    else failed.push(entry);
  }
  return { total: entries.length, applied, duplicates, failed };
}

/* ---------------------------------------------------------------- 本地锁 */

export async function withLocalLock(stateDir, name, fn, { staleMs = DEFAULT_LOCK_STALE_MS, now = () => Date.now(), fsp = null } = {}) {
  const fsPromises = fsp || (await import('node:fs/promises')).default;
  await fsPromises.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(stateDir, `${name}.lock`);
  const acquire = async () => {
    try {
      const handle = await fsPromises.open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date(now()).toISOString() }));
      await handle.close();
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return false;
    }
  };
  if (!(await acquire())) {
    const stat = await fsPromises.stat(lockPath).catch(() => null);
    if (stat && now() - stat.mtimeMs > staleMs) await fsPromises.rm(lockPath, { force: true });
    if (!(await acquire())) return { skipped: true, reason: `已有实例在跑（${lockPath}），本次跳过` };
  }
  try {
    return await fn();
  } finally {
    await fsPromises.rm(lockPath, { force: true }).catch(() => {});
  }
}

/* ---------------------------------------------------------------- 命令实现 */

function emit(argv, payload, lines) {
  if (argv.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else for (const line of lines) process.stdout.write(`${line}\n`);
}

function defaultExec(program, args, { cwd } = {}) {
  const result = spawnSync(program, args, { cwd, stdio: 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status ?? 1 };
}

/** 把一条命令包成「SSH 远端执行」或「本地 sh -c 执行」。命令来自运营者配置的环境变量。 */
function runCommand(cfg, command, { ssh, execImpl }) {
  const commandText = cfg.serverDir ? `cd ${cfg.serverDir} && ${command}` : command;
  if (ssh) return execImpl('ssh', ['-o', 'BatchMode=yes', ssh, commandText], { cwd: REPO_ROOT });
  return execImpl(process.env.SHELL || 'sh', ['-c', commandText], { cwd: REPO_ROOT });
}

async function cmdDoctor(cfg, argv, deps) {
  const { fetchImpl } = deps;
  const lines = [
    `内部审核口：${cfg.review.apiUrl}（令牌${cfg.review.token ? '已配置' : '缺失'}）`,
    `管理口：${cfg.admin.apiUrl}（令牌${cfg.admin.token ? '已配置' : '缺失'}，pull-issues 用）`,
    `视觉模型：${cfg.vision.endpoint && cfg.vision.apiKey ? `已配置（${cfg.vision.model || '默认模型'}）` : '未配置'}`,
    `内部来源：${cfg.sources}（QQ 由 server 排除）`,
    `置信度门槛：${cfg.minConfidence}`,
    `状态目录：${cfg.stateDir}`,
    `真实开关：review=${cfg.live.review} pull=${cfg.live.pull} publish=${cfg.live.publish}`,
  ];
  const payload = {
    reviewApiUrl: cfg.review.apiUrl,
    reviewToken: Boolean(cfg.review.token),
    adminToken: Boolean(cfg.admin.token),
    vision: Boolean(cfg.vision.endpoint && cfg.vision.apiKey),
    live: cfg.live,
    list: null,
    probe: null,
  };

  if (cfg.review.token) {
    const list = await requestJson(cfg, 'review', `${INTERNAL_LIST_PATH}?state=received&limit=1`, { fetchImpl });
    payload.list = list.status;
    lines.push(list.status === 200
      ? `内部待审列表：HTTP 200，接口可用`
      : `内部待审列表：HTTP ${list.status}（401 令牌不对，503 未配置内部审核令牌）`);
  } else {
    lines.push('内部待审列表：未探测（缺 HERMES_REVIEW_TOKEN）');
  }

  if (argv.probe) {
    if (!cfg.review.token) throw new Error('--probe 需要 HERMES_REVIEW_TOKEN');
    const probe = await requestJson(cfg, 'review', REVIEW_RESULTS_PATH, {
      method: 'POST',
      body: { schema: REVIEW_RESULTS_SCHEMA, reviewer: REVIEWER_ID, promptVersion: cfg.promptVersion, results: [] },
      fetchImpl,
    });
    payload.probe = probe.status;
    lines.push(probe.status === 200
      ? '内部回写接口：HTTP 200，已接线'
      : `内部回写接口：HTTP ${probe.status}` + (probe.status === 403 ? '（reviewer 与令牌不匹配）' : ''));
  } else {
    lines.push('内部回写接口：未探测（加 --probe 发一次空批次探测）');
  }
  emit(argv, payload, lines);
  return 0;
}

export async function cmdReviewCycle(cfg, argv, deps) {
  const { fetchImpl, vocabulary = null } = deps;
  const limit = intOf(argv.limit, DEFAULT_LIMIT);
  const mode = resolveLiveMode('review', cfg, argv);
  if (mode.blocked) throw new Error(mode.reason);

  const locked = await withLocalLock(cfg.stateDir, 'review-cycle', async () => {
    const listed = await listPendingItems(cfg, { limit, includeNeedsManual: Boolean(argv.includeNeedsManual), fetchImpl });
    // QQ 已由 server 的内部来源排除；这里再兜一层，避免配置被改错。
    const notQq = listed.filter((item) => item && item.source !== 'qq');
    // 已在 needs_manual 且已被 Hermes 审过的条目不再重审，留给人工，避免每 5 分钟空转。
    const targets = notQq.filter((item) => !(item.review && item.review.decidedBy === REVIEWER_ID));
    const skipped = listed.length - targets.length;

    if (!mode.live) {
      emit(argv, { mode: 'dry-run', reason: mode.reason, pending: listed.length, targets: targets.length, skipped, ids: targets.map((item) => item.id) }, [
        `[review-cycle] ${mode.reason}`,
        `[review-cycle] 待审 ${listed.length} 条，跳过已审 / QQ ${skipped} 条，本轮目标 ${targets.length} 条：${targets.map((item) => item.id).join(', ') || '（空）'}`,
        '[review-cycle] 不发模型请求、不写队列。',
      ]);
      return 0;
    }

    const activeVocabulary = vocabulary && typeof vocabulary === 'object' ? vocabulary : loadContentVocabulary(REPO_ROOT);
    if (!activeVocabulary.ok) throw new Error('无法读取 data/characters.json 与 data/categories.json，拒绝审核（fail-closed）');
    const reviewer = buildVisionReviewer(cfg, { fetchImpl });

    const results = [];
    const failures = [];
    for (const item of targets) {
      try {
        const buffer = await fetchItemRaw(cfg, item, { fetchImpl });
        const reviewed = await reviewOne(reviewer, {
          buffer,
          mime: item.mime,
          fields: item.fields || {},
          vocabulary: activeVocabulary,
        });
        const checked = validateResult({
          submissionId: item.id,
          model: cfg.vision.model || null,
          ...reviewed,
        }, { vocabulary: activeVocabulary, minConfidence: cfg.minConfidence });
        if (!checked.ok) { failures.push({ id: item.id, error: checked.error }); continue; }
        results.push(checked.result);
      } catch (error) {
        failures.push({ id: item.id, error: error.message });
      }
    }

    if (results.length === 0) {
      emit(argv, { mode: 'live', reviewed: 0, failures }, ['[review-cycle] 没有可回写的结果。']);
      return failures.length > 0 ? 1 : 0;
    }
    const response = await postReviewResults(cfg, results, { fetchImpl, onRetry: (error, attempt, delay) => process.stderr.write(`[review-cycle] 回写重试 ${attempt}：${error.message}，${delay} ms 后\n`) });
    const summary = summarizeApplied(response);
    emit(argv, { mode: 'live', reviewed: results.length, ...summary, failures }, [
      `[review-cycle] 回写 ${summary.total} 条：应用 ${summary.applied.length}，重复 ${summary.duplicates.length}，失败 ${summary.failed.length}。`,
      ...summary.failed.map((entry) => `  失败 ${entry.id}：${entry.error || entry.status}`),
      ...(failures.length ? [`[review-cycle] 本地失败 ${failures.length} 条，下轮重试：${failures.map((f) => f.id).join(', ')}`] : []),
    ]);
    return (failures.length + summary.failed.length) > 0 ? 1 : 0;
  });
  if (locked && typeof locked === 'object' && locked.skipped) {
    process.stderr.write(`[review-cycle] ${locked.reason}\n`);
    return 0;
  }
  return locked;
}

export async function cmdPostResults(cfg, argv, deps) {
  const { fetchImpl, fsp, vocabulary = null } = deps;
  const fsPromises = fsp || (await import('node:fs/promises')).default;
  if (!argv.file) throw new Error('post-results 需要 --file <results.json>');
  const mode = resolveLiveMode('review', cfg, argv);
  if (mode.blocked) throw new Error(mode.reason);

  const raw = JSON.parse(await fsPromises.readFile(argv.file, 'utf8'));
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.results) ? raw.results : null;
  if (!list) throw new Error('结果文件必须是数组，或 { results: [...] }');
  const activeVocabulary = vocabulary && typeof vocabulary === 'object' ? vocabulary : loadContentVocabulary(REPO_ROOT);
  if (!activeVocabulary.ok) throw new Error('无法读取角色 / 分类枚举，拒绝校验（fail-closed）');

  const results = [];
  const rejected = [];
  for (const entry of list) {
    const checked = validateResult(entry, { vocabulary: activeVocabulary, minConfidence: cfg.minConfidence });
    if (!checked.ok) rejected.push({ id: (entry && (entry.submissionId || entry.id)) || null, error: checked.error });
    else results.push(checked.result);
  }
  if (!mode.live) {
    emit(argv, { mode: 'dry-run', reason: mode.reason, valid: results.length, rejected, payload: buildResultsPayload(results, cfg) }, [
      `[post-results] ${mode.reason}`,
      `[post-results] 可回写 ${results.length} 条，非法 ${rejected.length} 条。`,
      ...rejected.map((entry) => `  非法 ${entry.id}：${entry.error}`),
    ]);
    return rejected.length > 0 ? 1 : 0;
  }
  if (results.length === 0) {
    emit(argv, { mode: 'live', posted: 0, rejected }, ['[post-results] 没有可回写的结果。']);
    return rejected.length > 0 ? 1 : 0;
  }
  const response = await postReviewResults(cfg, results, { fetchImpl });
  const summary = summarizeApplied(response);
  emit(argv, { mode: 'live', posted: results.length, ...summary, rejected }, [
    `[post-results] 回写 ${summary.total} 条：应用 ${summary.applied.length}，重复 ${summary.duplicates.length}，失败 ${summary.failed.length}；非法 ${rejected.length} 条。`,
  ]);
  return (rejected.length + summary.failed.length) > 0 ? 1 : 0;
}

export async function cmdPullIssues(cfg, argv, deps) {
  const { fetchImpl, execImpl = defaultExec } = deps;
  const mode = resolveLiveMode('pull', cfg, argv);
  if (mode.blocked) throw new Error(mode.reason);
  const state = argv.state || 'open';

  if (!mode.live) {
    emit(argv, { mode: 'dry-run', reason: mode.reason, state, ssh: cfg.pull.ssh || null, cmd: cfg.pull.cmd }, [
      `[pull-issues] ${mode.reason}`,
      cfg.pull.ssh
        ? `[pull-issues] 将通过 SSH ${cfg.pull.ssh} 执行：${cfg.pull.cmd}`
        : `[pull-issues] 将通过管理口 POST /api/v1/pull-issues 触发（state=${state}）`,
    ]);
    return 0;
  }

  if (argv.viaSsh || cfg.pull.ssh) {
    const result = runCommand(cfg, cfg.pull.cmd, { ssh: cfg.pull.ssh || argv.viaSsh, execImpl });
    emit(argv, { mode: 'live', via: 'ssh', code: result.status }, [`[pull-issues] SSH 执行返回码 ${result.status}`]);
    return result.status;
  }

  requireToken(cfg, 'admin');
  const response = await requestJson(cfg, 'admin', '/api/v1/pull-issues', { method: 'POST', body: { state }, fetchImpl });
  expectOk(response, '触发拉取 Issue');
  const results = (response.json && response.json.results) || [];
  emit(argv, { mode: 'live', via: 'http', state, count: results.length, results }, [
    `[pull-issues] 管理口返回 ${results.length} 个附件结果。`,
  ]);
  if (argv.maxPages) process.stderr.write('[pull-issues] 注意：管理口接口不支持 --max-pages，需要分页控制请加 --via-ssh 走 server/cli.mjs。\n');
  return 0;
}

export async function cmdPublish(cfg, argv, deps) {
  const { execImpl = defaultExec } = deps;
  const mode = resolveLiveMode('publish', cfg, argv);
  if (mode.blocked) throw new Error(mode.reason);
  const limitArg = intOf(argv.limit, 0) ? ` --limit ${intOf(argv.limit, 0)}` : '';

  if (!mode.live) {
    const dryCmd = cfg.publish.dryCmd ? `${cfg.publish.dryCmd}${limitArg}` : null;
    const lines = [
      `[publish] ${mode.reason}`,
      cfg.publish.ssh
        ? `[publish] 真实模式将通过 SSH ${cfg.publish.ssh} 执行：${cfg.publish.cmd}${limitArg}`
        : `[publish] 真实模式将本地执行：${cfg.publish.cmd}${limitArg}`,
    ];
    let code = 0;
    if (dryCmd) {
      const result = runCommand(cfg, dryCmd, { ssh: cfg.publish.ssh, execImpl });
      code = result.status;
      lines.push(`[publish] dry-run 命令返回码 ${code}`);
    }
    emit(argv, { mode: 'dry-run', reason: mode.reason, cmd: cfg.publish.cmd + limitArg, dryCmd, code }, lines);
    return code;
  }

  const result = runCommand(cfg, `${cfg.publish.cmd}${limitArg}`, { ssh: cfg.publish.ssh, execImpl });
  emit(argv, { mode: 'live', via: cfg.publish.ssh ? 'ssh' : 'local', code: result.status }, [`[publish] 发布命令返回码 ${result.status}`]);
  return result.status;
}

function printHelp() {
  process.stdout.write(`ops/hermes/cli.mjs —— Hermes 侧定时任务（默认 dry-run）

用法：
  node ops/hermes/cli.mjs doctor [--probe] [--json]
  node ops/hermes/cli.mjs review-cycle [--live] [--limit N] [--include-needs-manual] [--json]
  node ops/hermes/cli.mjs post-results --file <results.json> [--live] [--json]
  node ops/hermes/cli.mjs pull-issues [--live] [--via-ssh] [--state open] [--json]
  node ops/hermes/cli.mjs publish [--live] [--via-ssh] [--limit N] [--json]

真实动作要同时给 --live 和对应开关：HERMES_REVIEW_LIVE / HERMES_PULL_LIVE / HERMES_PUBLISH_LIVE=true。
密钥与端点只从环境变量读（HERMES_REVIEW_TOKEN、HERMES_ADMIN_TOKEN、HERMES_VISION_* 等）。
详见 docs/Hermes审核与发布接线.md 与 ops/hermes/hermes.env.example。
`);
}

const COMMANDS = {
  doctor: cmdDoctor,
  'review-cycle': cmdReviewCycle,
  'post-results': cmdPostResults,
  'pull-issues': cmdPullIssues,
  publish: cmdPublish,
};

export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgv(argv);
  const command = options._.shift() || 'help';
  if (options.help || command === 'help') { printHelp(); return 0; }
  const action = COMMANDS[command];
  if (!action) {
    process.stderr.write(`未知命令：${command}（node ops/hermes/cli.mjs help 看用法）\n`);
    return 2;
  }
  const cfg = resolveHermesConfig({ env: deps.env || process.env });
  const context = { fetchImpl: deps.fetchImpl || globalThis.fetch, execImpl: deps.execImpl, fsp: deps.fsp, vocabulary: deps.vocabulary || null };
  try {
    return await action(cfg, options, context);
  } catch (error) {
    process.stderr.write(`[hermes] 错误：${error.message}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; });
}
