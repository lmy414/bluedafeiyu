#!/usr/bin/env node
/* ops/hermes/tests/hermes.test.mjs —— Hermes 任务脚本的回归测试（零依赖，node:test）
 *
 *   node --test ops/hermes/tests/hermes.test.mjs
 *
 * 覆盖接线必须守住的几条性质：
 *   1. 默认 dry-run：不发模型请求、不写队列、不触发发布；
 *   2. 真实动作要 --live 与环境开关同时满足，缺一个就拒绝（blocked）；
 *   3. 审核结论复用 submission-ai-content/1 校验，非法内容降级成 manual，绝不上报 pass；
 *   4. 回写走公开口的 POST /api/v1/internal/review-results，用 Hermes 专属令牌，
 *      批次形状 { schema, reviewer, promptVersion, results:[{submissionId,...}] }；
 *   5. 本地锁互斥、可回收陈旧锁；QQ 与已由 Hermes 审过的条目跳过；
 *   6. 提示词与 server/review.mjs 的 SYSTEM_PROMPT 不漂移；环境变量示例不含真实密钥。
 *
 * 全程离线：fetch / exec / 枚举都注入假实现，临时目录在系统 tmp。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_SOURCES,
  LIVE_ENV,
  REPO_ROOT,
  REVIEW_RESULTS_PATH,
  REVIEW_RESULTS_SCHEMA,
  buildResultsPayload,
  main,
  parseArgv,
  postReviewResults,
  resolveHermesConfig,
  resolveLiveMode,
  retry,
  summarizeApplied,
  validateResult,
  withLocalLock,
} from '../cli.mjs';

/* 真的 1x1 PNG，用来给「原图」当字节 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const VOCABULARY = Object.freeze({
  ok: true,
  loaded: true,
  characterIds: new Set(['deepseek']),
  categoryIds: new Set(['meme']),
});

const VALID_CONTENT = Object.freeze({
  name: '不是……而是……大学习',
  description: '表达被反驳后的无语',
  commentary: '一看这表情我就知道又是没听进去。',
  characterId: 'deepseek',
  categoryIds: ['meme'],
  tags: ['无语', '反差'],
});

/* ---------------------------------------------------------------- 测试工具 */

async function tempStateDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hermes-test-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

function baseEnv(overrides = {}) {
  return {
    HERMES_REVIEW_API_URL: 'http://127.0.0.1:8790',
    HERMES_REVIEW_TOKEN: 'hermes-token',
    HERMES_ADMIN_API_URL: 'http://127.0.0.1:8788',
    HERMES_ADMIN_TOKEN: 'admin-token',
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function rawResponse(buffer, status = 200) {
  return new Response(buffer, { status });
}

function makeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    for (const [match, handler] of routes) {
      if (target.includes(match)) return handler(target, options);
    }
    throw new Error(`测试未预期的请求：${target}`);
  };
  impl.calls = calls;
  return impl;
}

async function capture(fn) {
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  let out = '';
  let err = '';
  process.stdout.write = (chunk) => { out += String(chunk); return true; };
  process.stderr.write = (chunk) => { err += String(chunk); return true; };
  try {
    const code = await fn();
    return { code, out, err };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

const visionPayload = (content, { verdict = 'pass', confidence = 0.9, reason = '画面合规' } = {}) => ({
  choices: [{
    message: {
      content: JSON.stringify({ schema: 'submission-ai-content/1', verdict, confidence, reason, content }),
    },
  }],
});

const receivedItem = (id = 'sub_abc123') => ({
  id,
  source: 'github-issue',
  state: 'received',
  mime: 'image/png',
  ext: '.png',
  sha256: 'a'.repeat(64),
  fields: { name: '作品名', character: 'deepseek' },
  rawPath: `/api/v1/internal/submissions/${id}/raw`,
});

const batchResponse = (entries) => jsonResponse({
  ok: true,
  schema: REVIEW_RESULTS_SCHEMA,
  reviewer: 'hermes',
  count: entries.length,
  results: entries.map((entry) => ({ status: 200, ok: true, duplicate: false, ...entry })),
});

/* ---------------------------------------------------------------- 参数与开关 */

test('parseArgv 识别子命令与开关', () => {
  const parsed = parseArgv(['review-cycle', '--live', '--limit', '7', '--json']);
  assert.deepEqual(parsed._, ['review-cycle']);
  assert.equal(parsed.live, true);
  assert.equal(parsed.limit, '7');
  assert.equal(parsed.json, true);
});

test('resolveHermesConfig 默认值安全', () => {
  const cfg = resolveHermesConfig({ env: {} });
  assert.equal(cfg.review.apiUrl, 'http://127.0.0.1:8790');
  assert.equal(cfg.admin.apiUrl, 'http://127.0.0.1:8788');
  assert.equal(cfg.review.token, '');
  assert.equal(cfg.sources, DEFAULT_SOURCES);
  assert.equal(cfg.live.review, false);
  assert.equal(cfg.live.pull, false);
  assert.equal(cfg.live.publish, false);
});

test('resolveLiveMode：默认 dry-run，缺开关时 blocked', () => {
  const cfg = resolveHermesConfig({ env: {} });
  assert.equal(resolveLiveMode('review', cfg, {}).live, false);
  const blocked = resolveLiveMode('review', cfg, { live: true });
  assert.equal(blocked.live, false);
  assert.equal(blocked.blocked, true);
  const on = resolveHermesConfig({ env: { HERMES_REVIEW_LIVE: 'true' } });
  assert.equal(resolveLiveMode('review', on, { live: true }).live, true);
  assert.equal(resolveLiveMode('review', on, { live: true, dryRun: true }).live, false);
  assert.equal(LIVE_ENV.publish, 'HERMES_PUBLISH_LIVE');
});

/* ---------------------------------------------------------------- 结果校验 */

test('validateResult：合法 pass 保留 content', () => {
  const checked = validateResult({ submissionId: 'sub_abc123', verdict: 'pass', confidence: 0.9, reason: '没问题', content: VALID_CONTENT }, { vocabulary: VOCABULARY });
  assert.equal(checked.ok, true);
  assert.equal(checked.downgraded, false);
  assert.equal(checked.result.verdict, 'pass');
  assert.equal(checked.result.content.characterId, 'deepseek');
});

test('validateResult：pass 的 content 非法时降级为 manual，不丢弃', () => {
  const checked = validateResult({
    submissionId: 'sub_abc123',
    verdict: 'pass',
    confidence: 0.9,
    reason: '没问题',
    content: { ...VALID_CONTENT, slug: 'x' },
  }, { vocabulary: VOCABULARY });
  assert.equal(checked.ok, true);
  assert.equal(checked.downgraded, true);
  assert.equal(checked.result.verdict, 'manual');
  assert.equal(checked.result.content, null);
});

test('validateResult：reject 不需要 content，低置信度降级，非法字段拒绝', () => {
  const reject = validateResult({ submissionId: 'sub_abc123', verdict: 'reject', confidence: 0.8, reason: '真人肖像' }, { vocabulary: VOCABULARY });
  assert.equal(reject.ok, true);
  assert.equal(reject.result.verdict, 'reject');
  assert.equal(reject.result.content, null);

  const lowConfidence = validateResult({ submissionId: 'sub_abc123', verdict: 'pass', confidence: 0.2, reason: 'r', content: VALID_CONTENT }, { vocabulary: VOCABULARY, minConfidence: 0.6 });
  assert.equal(lowConfidence.result.verdict, 'manual');
  assert.match(lowConfidence.result.reason, /低于阈值/);

  assert.equal(validateResult({ submissionId: 'bad', verdict: 'pass', confidence: 0.9, reason: 'r', content: VALID_CONTENT }, { vocabulary: VOCABULARY }).ok, false);
  assert.equal(validateResult({ submissionId: 'sub_x', verdict: 'approved', confidence: 0.9, reason: 'r' }, { vocabulary: VOCABULARY }).ok, false);
  assert.equal(validateResult({ submissionId: 'sub_x', verdict: 'pass', confidence: 2, reason: 'r', content: VALID_CONTENT }, { vocabulary: VOCABULARY }).ok, false);
});

test('validateResult：manual 结果清洗非法 reason 但保留结论', () => {
  const checked = validateResult({ submissionId: 'sub_abc123', verdict: 'manual', reason: '<script>x</script>' }, { vocabulary: VOCABULARY });
  assert.equal(checked.ok, true);
  assert.equal(checked.result.verdict, 'manual');
  assert.equal(checked.result.content, null);
  assert.doesNotMatch(checked.result.reason, /script/);
});

test('buildResultsPayload：批次形状对齐内部接口', () => {
  const cfg = resolveHermesConfig({ env: baseEnv() });
  const payload = buildResultsPayload([
    { id: 'sub_a', verdict: 'pass', confidence: 0.9, reason: 'ok', content: VALID_CONTENT, model: 'm' },
    { id: 'sub_b', verdict: 'manual', confidence: 0, reason: '拿不准', content: null, model: 'm' },
  ], cfg);
  assert.equal(payload.schema, REVIEW_RESULTS_SCHEMA);
  assert.equal(payload.reviewer, 'hermes');
  assert.equal(payload.results[0].submissionId, 'sub_a');
  assert.deepEqual(payload.results[0].content, VALID_CONTENT);
  assert.equal(payload.results[1].content, undefined);
});

/* ---------------------------------------------------------------- 重试与锁 */

test('retry：可重试错误重试到成功，不可重试立即失败', async () => {
  let attempts = 0;
  const result = await retry(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('boom'), { retryable: true });
    return 'ok';
  }, { retries: 5, sleepImpl: async () => {} });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);

  let hardAttempts = 0;
  await assert.rejects(async () => retry(async () => {
    hardAttempts += 1;
    throw Object.assign(new Error('nope'), { retryable: false });
  }, { retries: 5, sleepImpl: async () => {} }), /nope/);
  assert.equal(hardAttempts, 1);
});

test('withLocalLock：互斥与陈旧锁回收', async (t) => {
  const dir = await tempStateDir(t);
  const inner = await withLocalLock(dir, 'review-cycle', async () => withLocalLock(dir, 'review-cycle', async () => 'inner'), { staleMs: 1000 });
  assert.equal(inner.skipped, true);

  await fsp.writeFile(path.join(dir, 'review-cycle.lock'), '{}');
  const old = new Date(Date.now() - 3600_000);
  await fsp.utimes(path.join(dir, 'review-cycle.lock'), old, old);
  const reclaimed = await withLocalLock(dir, 'review-cycle', async () => 'ran', { staleMs: 1000 });
  assert.equal(reclaimed, 'ran');
});

test('postReviewResults：403 判 reviewer 不匹配且不重试', async () => {
  const cfg = resolveHermesConfig({ env: baseEnv() });
  const fetchImpl = async () => jsonResponse({ ok: false, error: 'reviewer 与令牌不匹配' }, 403);
  await assert.rejects(
    () => postReviewResults(cfg, [{ id: 'sub_abc123', verdict: 'manual', confidence: 0, reason: 'r', content: null }], { fetchImpl, retries: 3 }),
    /reviewer 与令牌不匹配/,
  );
});

test('summarizeApplied：区分应用 / 重复 / 失败', () => {
  const summary = summarizeApplied({ results: [
    { id: 'sub_a', status: 200, duplicate: false },
    { id: 'sub_b', status: 200, duplicate: true },
    { id: 'sub_c', status: 409, error: '状态不允许' },
  ] });
  assert.equal(summary.applied.length, 1);
  assert.equal(summary.duplicates.length, 1);
  assert.equal(summary.failed.length, 1);
});

/* ---------------------------------------------------------------- 子命令 */

test('review-cycle 默认 dry-run：只读列表，不发模型、不回写', async (t) => {
  const stateDir = await tempStateDir(t);
  const fetchImpl = makeFetch([
    ['/api/v1/internal/submissions', () => jsonResponse({ ok: true, count: 1, items: [receivedItem()] })],
  ]);
  const env = baseEnv({ HERMES_STATE_DIR: stateDir });
  const { code, out } = await capture(() => main(['review-cycle', '--json'], { env, fetchImpl, vocabulary: VOCABULARY }));
  assert.equal(code, 0);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(!fetchImpl.calls.some((call) => call.url.includes('/raw')));
  assert.ok(!fetchImpl.calls.some((call) => call.url.includes(REVIEW_RESULTS_PATH)));
  assert.match(out, /dry-run/);
});

test('review-cycle：--live 但缺 HERMES_REVIEW_LIVE 时拒绝', async (t) => {
  const stateDir = await tempStateDir(t);
  const fetchImpl = makeFetch([['/api/v1/internal/submissions', () => jsonResponse({ ok: true, count: 0, items: [] })]]);
  const env = baseEnv({ HERMES_STATE_DIR: stateDir });
  const { code, err } = await capture(() => main(['review-cycle', '--live'], { env, fetchImpl, vocabulary: VOCABULARY }));
  assert.equal(code, 1);
  assert.match(err, /HERMES_REVIEW_LIVE/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('review-cycle：跳过 QQ 与已由 Hermes 审过的 needs_manual', async (t) => {
  const stateDir = await tempStateDir(t);
  const fetchImpl = makeFetch([
    ['state=received', () => jsonResponse({ ok: true, count: 2, items: [
      { ...receivedItem('sub_web001'), source: 'web' },
      { ...receivedItem('sub_qq0001'), source: 'qq' },
    ] })],
    ['state=needs_manual', () => jsonResponse({ ok: true, count: 1, items: [
      { ...receivedItem('sub_manual1'), source: 'web', state: 'needs_manual', review: { decidedBy: 'hermes', verdict: 'manual' } },
    ] })],
  ]);
  const env = baseEnv({ HERMES_STATE_DIR: stateDir });
  const { code, out } = await capture(() => main(['review-cycle', '--include-needs-manual', '--json'], { env, fetchImpl, vocabulary: VOCABULARY }));
  assert.equal(code, 0);
  const summary = JSON.parse(out);
  assert.deepEqual(summary.ids, ['sub_web001']);
  assert.equal(summary.skipped, 2);
});

test('review-cycle --live：看图、调模型、批量回写 pass 结果', async (t) => {
  const stateDir = await tempStateDir(t);
  const fetchImpl = makeFetch([
    [REVIEW_RESULTS_PATH, () => batchResponse([{ id: 'sub_abc123', state: 'auto_passed', verdict: 'pass' }])],
    ['/raw', () => rawResponse(TINY_PNG)],
    ['/api/v1/internal/submissions', () => jsonResponse({ ok: true, count: 1, items: [receivedItem()] })],
    ['/v1/chat/completions', () => jsonResponse(visionPayload(VALID_CONTENT))],
  ]);
  const env = baseEnv({
    HERMES_STATE_DIR: stateDir,
    HERMES_REVIEW_LIVE: 'true',
    HERMES_VISION_ENDPOINT: 'https://vision.invalid/v1/chat/completions',
    HERMES_VISION_API_KEY: 'vision-key',
    HERMES_VISION_MODEL: 'vision-model',
  });
  const { code } = await capture(() => main(['review-cycle', '--live'], { env, fetchImpl, vocabulary: VOCABULARY }));
  assert.equal(code, 0);

  const visionCall = fetchImpl.calls.find((call) => call.url.includes('/v1/chat/completions'));
  assert.match(visionCall.options.headers.Authorization, /^Bearer vision-key$/);

  const postCall = fetchImpl.calls.find((call) => call.url.includes(REVIEW_RESULTS_PATH));
  assert.match(postCall.options.headers.Authorization, /^Bearer hermes-token$/);
  assert.ok(postCall.options.headers['Idempotency-Key']);
  const body = JSON.parse(postCall.options.body);
  assert.equal(body.schema, REVIEW_RESULTS_SCHEMA);
  assert.equal(body.reviewer, 'hermes');
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].submissionId, 'sub_abc123');
  assert.equal(body.results[0].verdict, 'pass');
  assert.equal(body.results[0].content.characterId, 'deepseek');
  // 原图走内部 raw 路径，不是管理口
  const rawCall = fetchImpl.calls.find((call) => call.url.includes('/raw'));
  assert.match(rawCall.url, /\/api\/v1\/internal\/submissions\/sub_abc123\/raw$/);
});

test('review-cycle --live：模型报错时回写 manual，不上报 pass', async (t) => {
  const stateDir = await tempStateDir(t);
  const fetchImpl = makeFetch([
    [REVIEW_RESULTS_PATH, () => batchResponse([{ id: 'sub_abc123', state: 'needs_manual', verdict: 'manual' }])],
    ['/raw', () => rawResponse(TINY_PNG)],
    ['/api/v1/internal/submissions', () => jsonResponse({ ok: true, count: 1, items: [receivedItem()] })],
    ['/v1/chat/completions', () => jsonResponse({ error: 'boom' }, 500)],
  ]);
  const env = baseEnv({
    HERMES_STATE_DIR: stateDir,
    HERMES_REVIEW_LIVE: 'true',
    HERMES_VISION_ENDPOINT: 'https://vision.invalid/v1/chat/completions',
    HERMES_VISION_API_KEY: 'vision-key',
  });
  const { code } = await capture(() => main(['review-cycle', '--live'], { env, fetchImpl, vocabulary: VOCABULARY }));
  assert.equal(code, 0);
  const body = JSON.parse(fetchImpl.calls.find((call) => call.url.includes(REVIEW_RESULTS_PATH)).options.body);
  assert.equal(body.results[0].verdict, 'manual');
  assert.equal(body.results[0].content, undefined);
});

test('review-cycle --live：未配视觉模型直接报错', async (t) => {
  const stateDir = await tempStateDir(t);
  const fetchImpl = makeFetch([
    ['/api/v1/internal/submissions', () => jsonResponse({ ok: true, count: 1, items: [receivedItem()] })],
  ]);
  const env = baseEnv({ HERMES_STATE_DIR: stateDir, HERMES_REVIEW_LIVE: 'true' });
  const { code, err } = await capture(() => main(['review-cycle', '--live'], { env, fetchImpl, vocabulary: VOCABULARY }));
  assert.equal(code, 1);
  assert.match(err, /视觉模型未配置/);
});

test('post-results：校验外部结果文件后批量回写', async (t) => {
  const stateDir = await tempStateDir(t);
  const file = path.join(stateDir, 'results.json');
  await fsp.writeFile(file, JSON.stringify({ results: [
    { submissionId: 'sub_abc123', verdict: 'pass', confidence: 0.9, reason: 'ok', content: VALID_CONTENT },
    { submissionId: 'sub_bad', verdict: 'pass', confidence: 0.9, reason: 'ok', content: { ...VALID_CONTENT, slug: 'x' } },
  ] }));

  const dryFetch = makeFetch([]);
  const env = baseEnv({ HERMES_STATE_DIR: stateDir });
  const dry = await capture(() => main(['post-results', '--file', file, '--json'], { env, fetchImpl: dryFetch, vocabulary: VOCABULARY }));
  assert.equal(dry.code, 0);
  assert.equal(dryFetch.calls.length, 0);

  const liveFetch = makeFetch([[
    REVIEW_RESULTS_PATH,
    () => batchResponse([
      { id: 'sub_abc123', state: 'auto_passed', verdict: 'pass' },
      { id: 'sub_bad', state: 'needs_manual', verdict: 'manual' },
    ]),
  ]]);
  const liveEnv = baseEnv({ HERMES_STATE_DIR: stateDir, HERMES_REVIEW_LIVE: 'true' });
  const live = await capture(() => main(['post-results', '--file', file, '--live'], { env: liveEnv, fetchImpl: liveFetch, vocabulary: VOCABULARY }));
  assert.equal(live.code, 0);
  const body = JSON.parse(liveFetch.calls[0].options.body);
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].verdict, 'pass');
  assert.equal(body.results[1].verdict, 'manual');
  assert.equal(body.results[1].content, undefined);
});

test('pull-issues：dry-run 不发请求，live 走管理口', async () => {
  const dryFetch = makeFetch([]);
  const dry = await capture(() => main(['pull-issues', '--json'], { env: baseEnv(), fetchImpl: dryFetch }));
  assert.equal(dry.code, 0);
  assert.equal(dryFetch.calls.length, 0);

  const liveFetch = makeFetch([['http://127.0.0.1:8788/api/v1/pull-issues', () => jsonResponse({ ok: true, results: [{ issue: 1, status: 'created' }] })]]);
  const env = baseEnv({ HERMES_PULL_LIVE: 'true' });
  const live = await capture(() => main(['pull-issues', '--live'], { env, fetchImpl: liveFetch }));
  assert.equal(live.code, 0);
  assert.equal(liveFetch.calls.length, 1);
  assert.match(liveFetch.calls[0].options.headers.Authorization, /^Bearer admin-token$/);
  assert.equal(JSON.parse(liveFetch.calls[0].options.body).state, 'open');
});

test('pull-issues：--via-ssh 走 ssh，不碰管理口', async () => {
  const calls = [];
  const execImpl = (program, args) => { calls.push({ program, args }); return { status: 0 }; };
  const env = baseEnv({ HERMES_PULL_LIVE: 'true', HERMES_PULL_SSH: 'ops@example.invalid', HERMES_SERVER_DIR: '/srv/www/dafeiyu/bluedafeiyu' });
  const { code } = await capture(() => main(['pull-issues', '--live', '--via-ssh'], { env, execImpl }));
  assert.equal(code, 0);
  assert.equal(calls[0].program, 'ssh');
  assert.match(calls[0].args.at(-1), /pull-issues/);
});

test('publish：默认跑 dry-run 命令，--live 才跑真实命令', async () => {
  const dryCalls = [];
  const dryExec = (program, args) => { dryCalls.push({ program, args }); return { status: 0 }; };
  const dry = await capture(() => main(['publish'], { env: baseEnv(), execImpl: dryExec }));
  assert.equal(dry.code, 0);
  assert.match(dryCalls[0].args.at(-1), /--dry-run/);

  const liveCalls = [];
  const liveExec = (program, args) => { liveCalls.push({ program, args }); return { status: 0 }; };
  const env = baseEnv({ HERMES_PUBLISH_LIVE: 'true' });
  const live = await capture(() => main(['publish', '--live', '--limit', '3'], { env, execImpl: liveExec }));
  assert.equal(live.code, 0);
  assert.match(liveCalls[0].args.at(-1), /--live --limit 3/);
});

test('publish：--live 但缺 HERMES_PUBLISH_LIVE 时拒绝且不执行', async () => {
  const calls = [];
  const execImpl = (program, args) => { calls.push({ program, args }); return { status: 0 }; };
  const { code, err } = await capture(() => main(['publish', '--live'], { env: baseEnv(), execImpl }));
  assert.equal(code, 1);
  assert.match(err, /HERMES_PUBLISH_LIVE/);
  assert.equal(calls.length, 0);
});

test('doctor：探测内部列表，--probe 再探回写接口', async () => {
  const fetchImpl = makeFetch([
    ['/api/v1/internal/submissions', () => jsonResponse({ ok: true, count: 0, items: [] })],
    [REVIEW_RESULTS_PATH, () => jsonResponse({ ok: true, count: 0, results: [] })],
  ]);
  const first = await capture(() => main(['doctor', '--json'], { env: baseEnv(), fetchImpl }));
  assert.equal(first.code, 0);
  assert.equal(fetchImpl.calls.length, 1);

  const probeFetch = makeFetch([
    ['/api/v1/internal/submissions', () => jsonResponse({ ok: true, count: 0, items: [] })],
    [REVIEW_RESULTS_PATH, () => jsonResponse({ ok: true, count: 0, results: [] })],
  ]);
  const second = await capture(() => main(['doctor', '--probe', '--json'], { env: baseEnv(), fetchImpl: probeFetch }));
  assert.equal(second.code, 0);
  assert.equal(probeFetch.calls.length, 2);
  assert.equal(JSON.parse(second.out).probe, 200);
});

/* ---------------------------------------------------------------- 静态校验 */

test('提示词与 server/review.mjs 的 SYSTEM_PROMPT 不漂移', async () => {
  const serverSource = await fsp.readFile(path.join(REPO_ROOT, 'server', 'review.mjs'), 'utf8');
  const block = /const SYSTEM_PROMPT = \[([\s\S]*?)\]\.join\('\\n'\)/.exec(serverSource);
  assert.ok(block, '没能从 server/review.mjs 提取 SYSTEM_PROMPT');

  const fragments = [...block[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1].replace(/\\'/g, "'"));
  const canonical = fragments.join('\n');
  assert.ok(fragments.length >= 7, 'SYSTEM_PROMPT 行数异常');

  const prompt = await fsp.readFile(path.join(REPO_ROOT, 'ops', 'hermes', 'prompt-review.md'), 'utf8');
  assert.ok(prompt.includes(canonical), 'ops/hermes/prompt-review.md 的 System 段与 server/review.mjs 不一致，需要同步');
});

test('环境变量示例与脚本不含真实密钥，也不碰被禁的接口', async () => {
  const envExample = await fsp.readFile(path.join(REPO_ROOT, 'ops', 'hermes', 'hermes.env.example'), 'utf8');
  assert.match(envExample, /HERMES_REVIEW_TOKEN=REPLACE_WITH_HERMES_REVIEW_TOKEN/);
  assert.match(envExample, /HERMES_VISION_API_KEY=REPLACE_WITH_VISION_KEY/);
  assert.match(envExample, /HERMES_REVIEW_LIVE=false/);
  assert.doesNotMatch(envExample, /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})/);

  const cli = await fsp.readFile(path.join(REPO_ROOT, 'ops', 'hermes', 'cli.mjs'), 'utf8');
  assert.doesNotMatch(cli, /tools\/intake/, 'Hermes 脚本不得调用 tools/intake');
  assert.doesNotMatch(cli, /\/decision/, 'Hermes 脚本不得调用人工决定接口');
  assert.doesNotMatch(cli, /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,})/);
});
