#!/usr/bin/env node
/*
 * ops/admin/hermes-publish.mjs —— Hermes 定时任务到后台发布 API 的薄桥接
 *
 * Hermes 的定时任务只调用本文件。它使用 bot API Key 读取发布计划、发起发布并轮询结果。
 * 没有变更时保持 stdout 为空；有结果时输出一段适合飞书阅读的中文摘要。
 */
import { pathToFileURL } from 'node:url';

export const DEFAULT_API_URL = 'http://127.0.0.1:3100';

function parseArgs(argv = []) {
  const args = { syncFirst: false, syncOnly: false, help: false };
  for (const arg of argv) {
    if (arg === '--sync-first') { args.syncFirst = true; continue; }
    if (arg === '--sync-only') { args.syncOnly = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    throw new Error(`无法识别的参数：${arg}`);
  }
  return args;
}

export function resolveHermesPublishConfig(env = process.env) {
  const apiKey = String(env.ADMIN_BOT_API_KEY || '');
  if (!apiKey) throw new Error('必须指定 ADMIN_BOT_API_KEY');
  const pollMs = Number(env.ADMIN_PUBLISH_POLL_MS || 15000);
  const timeoutMs = Number(env.ADMIN_PUBLISH_TIMEOUT_MS || 60 * 60 * 1000);
  if (!Number.isSafeInteger(pollMs) || pollMs <= 0) throw new Error('ADMIN_PUBLISH_POLL_MS 必须是正整数');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('ADMIN_PUBLISH_TIMEOUT_MS 必须是正整数');
  return {
    apiUrl: String(env.ADMIN_API_URL || DEFAULT_API_URL).replace(/\/+$/, ''),
    apiKey,
    siteUrl: String(env.ADMIN_SITE_URL || '').replace(/\/+$/, ''),
    pollMs,
    timeoutMs,
    httpTimeoutMs: Number(env.ADMIN_PUBLISH_HTTP_TIMEOUT_MS || 30000),
  };
}

function headers(cfg, withBody = false) {
  return {
    Authorization: `users API-Key ${cfg.apiKey}`,
    Accept: 'application/json',
    ...(withBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

function timeoutSignal(ms) {
  return typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

async function apiRequest(cfg, pathname, options = {}, fetchImpl = globalThis.fetch) {
  const url = new URL(pathname, cfg.apiUrl).toString();
  const response = await fetchImpl(url, {
    ...options,
    headers: { ...headers(cfg, Boolean(options.body)), ...(options.headers || {}) },
    signal: timeoutSignal(cfg.httpTimeoutMs),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { response, data, url };
}

async function getJson(cfg, pathname, fetchImpl) {
  const { response, data, url } = await apiRequest(cfg, pathname, { method: 'GET' }, fetchImpl);
  if (!response.ok) {
    const detail = typeof data === 'object' && data ? (data.error || data.message || '') : data;
    throw new Error(`后台 GET ${new URL(url).pathname} HTTP ${response.status}${detail ? `：${detail}` : ''}`);
  }
  return data;
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function normalizeSummary(value) {
  const source = value && typeof value === 'object' ? value : {};
  const nested = source.summary && typeof source.summary === 'object' ? source.summary : null;
  const changes = source.changes && typeof source.changes === 'object' ? source.changes : null;
  const pick = (key, aliases = []) => {
    for (const candidate of [key, ...aliases]) {
      if (source[candidate] !== undefined) return numeric(source[candidate]);
      if (nested?.[candidate] !== undefined) return numeric(nested[candidate]);
      if (changes?.[candidate] !== undefined) return numeric(changes[candidate]);
    }
    return 0;
  };
  return {
    added: pick('added', ['new', 'created']),
    updated: pick('updated', ['modified']),
    hidden: pick('hidden'),
    restored: pick('restored'),
    deleted: pick('deleted', ['removed']),
    topics: pick('topics'),
  };
}

export function planHasChanges(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (typeof plan.hasChanges === 'boolean') return plan.hasChanges;
  if (typeof plan.changed === 'boolean') return plan.changed;
  if (Number.isFinite(Number(plan.count)) && Number(plan.count) > 0) return true;
  if (Number.isFinite(Number(plan.total)) && Number(plan.total) > 0) return true;
  if (plan.summary && typeof plan.summary === 'object') {
    return Object.values(normalizeSummary(plan.summary)).some((value) => value > 0);
  }
  if (plan.changes && typeof plan.changes === 'object' && !Array.isArray(plan.changes)) {
    return Object.values(normalizeSummary(plan.changes)).some((value) => value > 0);
  }
  if (Array.isArray(plan.changes)) return plan.changes.length > 0;
  return false;
}

function unwrapRun(payload) {
  if (payload && typeof payload === 'object') {
    if (payload.run && typeof payload.run === 'object') return payload.run;
    if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  }
  return payload && typeof payload === 'object' ? payload : {};
}

function commitValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.hash || value.sha || value.commit || null;
  return null;
}

function shortHash(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 7) : '未记录';
}

function onlineUrl(run, cfg) {
  return run.healthCheck?.url
    || run.healthCheck?.baseUrl
    || run.siteUrl
    || run.healthUrl
    || cfg.siteUrl
    || '未配置';
}

function resultSummary(run) {
  return normalizeSummary(run.summary || run.plannedChanges || run.changes || {});
}

function successText(run, summary, cfg) {
  const siteCommit = commitValue(run.commits?.site) || commitValue(run.commits?.siteHash) || commitValue(run.siteCommit);
  const lines = [
    `发布成功：新增 ${summary.added}、修改 ${summary.updated}、隐藏 ${summary.hidden}、删除 ${summary.deleted}、专题 ${summary.topics}。`,
    `站点提交：${shortHash(siteCommit)}`,
    `线上地址：${onlineUrl(run, cfg)}`,
  ];
  return `${lines.join('\n')}\n`;
}

function failureText(run) {
  const step = run.step || run.failedStep || '未知步骤';
  const error = run.error || run.message || '未知错误';
  return `发布失败：步骤 ${step}；错误：${error}\n`;
}

async function pollRun(cfg, runId, fetchImpl, deps = {}) {
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now || (() => Date.now());
  const deadline = now() + cfg.timeoutMs;
  let attempts = Math.ceil(cfg.timeoutMs / cfg.pollMs) + 1;
  while (attempts > 0) {
    attempts -= 1;
    const payload = await getJson(cfg, `/cms-api/publish/runs/${encodeURIComponent(runId)}`, fetchImpl);
    const run = unwrapRun(payload);
    const status = String(run.status || payload.status || '');
    if (['succeeded', 'failed', 'cancelled', 'canceled'].includes(status)) return run;
    if (now() >= deadline || attempts <= 0) break;
    await sleep(cfg.pollMs);
  }
  throw new Error('发布结果轮询超时');
}

async function syncSubmissions(cfg, fetchImpl) {
  const sync = await apiRequest(cfg, '/cms-api/submissions/sync', { method: 'POST', body: JSON.stringify({}) }, fetchImpl);
  if (!sync.response.ok) {
    const detail = typeof sync.data === 'object' && sync.data ? (sync.data.error || sync.data.message || '') : sync.data;
    throw new Error(`后台同步投稿 HTTP ${sync.response.status}${detail ? `：${detail}` : ''}`);
  }
  const errors = sync.data?.stats?.errors;
  if (sync.data?.ok === false || (Array.isArray(errors) && errors.length)) {
    throw new Error(`后台同步投稿部分失败：${Array.isArray(errors) ? errors.join('；') : '未知错误'}`);
  }
}

async function requestPublish(cfg, fetchImpl) {
  const { response, data, url } = await apiRequest(cfg, '/cms-api/publish/request', {
    method: 'POST',
    body: JSON.stringify({ trigger: 'bot' }),
  }, fetchImpl);
  if (response.status === 409) return { conflict: true };
  if (!response.ok) {
    const detail = typeof data === 'object' && data ? (data.error || data.message || '') : data;
    throw new Error(`后台 POST ${new URL(url).pathname} HTTP ${response.status}${detail ? `：${detail}` : ''}`);
  }
  const run = unwrapRun(data);
  const runId = run.runId || run.id || data?.runId || data?.id;
  if (!runId) throw new Error('发布请求成功但没有返回 runId');
  return { conflict: false, runId: String(runId) };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const env = deps.env || process.env;
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write('用法：node ops/admin/hermes-publish.mjs [--sync-first] [--sync-only]\n');
    return 0;
  }
  const cfg = resolveHermesPublishConfig(env);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  try {
    if (args.syncOnly) {
      await syncSubmissions(cfg, fetchImpl);
      return 0;
    }
    if (args.syncFirst) await syncSubmissions(cfg, fetchImpl);
    const plan = await getJson(cfg, '/cms-api/publish/plan', fetchImpl);
    if (!planHasChanges(plan)) return 0;
    const requested = await requestPublish(cfg, fetchImpl);
    if (requested.conflict) return 0;
    const run = await pollRun(cfg, requested.runId, fetchImpl, deps);
    const status = String(run.status || '').toLowerCase();
    if (status === 'succeeded') {
      stdout.write(successText(run, resultSummary(run), cfg));
      return 0;
    }
    stdout.write(failureText(run));
    return 1;
  } catch (error) {
    stderr.write(`[hermes-publish] ${error.message}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    stderr.write(`[hermes-publish] ${error.message}\n`);
    process.exitCode = 1;
  });
}
