// server/review.test.mjs —— AI 审核的失败关闭性质
//
// 核心要求：**真实 AI 服务没配 / 超时 / 报错 / 返回看不懂，都转人工，
// 绝不当作通过，绝不自动发布。** 测试全部注入假客户端，不发生真实外呼。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { resolveConfig } from './config.mjs';
import { STATES, createQueue } from './queue.mjs';
import { createReviewer, parseReviewResponse, reviewQueuedItem } from './review.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

async function setup(t, { env = {}, now, client } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'review-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: path.join(base, 'private') }, { env });
  const queue = await createQueue(cfg, { now });
  const reviewer = createReviewer(cfg, { client, now });
  return { base, cfg, queue, reviewer };
}

async function seeded(queue, suffix = '') {
  return (await queue.enqueue({
    source: 'web',
    sourceId: `web:review${suffix}`,
    buffer: Buffer.concat([TINY_PNG, Buffer.from(suffix || '0')]),
    fields: { name: 'r', character: 'deepseek' },
  })).item;
}

test('未配置 AI 客户端时判为待人工，绝不通过', async (t) => {
  const { reviewer, queue } = await setup(t);
  assert.equal(reviewer.configured, false);
  const item = await seeded(queue);
  const result = await reviewQueuedItem(queue, reviewer, item.id);
  assert.equal(result.verdict, 'manual');
  assert.match(result.reason, /未配置|not_configured/);
  assert.equal((await queue.get(item.id)).state, STATES.NEEDS_MANUAL);
});

test('AI 返回通过只到 auto_passed，仍需人工，服务不发布', async (t) => {
  const { reviewer, queue } = await setup(t, {
    client: async () => ({ verdict: 'pass', confidence: 0.95, reason: '看起来是合规二创' }),
  });
  const item = await seeded(queue, 'a');
  const result = await reviewQueuedItem(queue, reviewer, item.id);
  assert.equal(result.verdict, 'pass');
  const stored = await queue.get(item.id);
  assert.equal(stored.state, STATES.AUTO_PASSED);
  assert.notEqual(stored.state, STATES.APPROVED);
  assert.ok(!['published', 'approved'].includes(stored.state));
});

test('AI 高置信度拒绝进入 auto_rejected，仍可人工翻案', async (t) => {
  const { reviewer, queue } = await setup(t, {
    client: async () => ({ verdict: 'reject', confidence: 0.9, reason: '真人照片' }),
  });
  const item = await seeded(queue, 'b');
  const result = await reviewQueuedItem(queue, reviewer, item.id);
  assert.equal(result.verdict, 'reject');
  assert.equal((await queue.get(item.id)).state, STATES.AUTO_REJECTED);
  await queue.decide(item.id, 'approved', { actor: 'maintainer', reason: '人工复核通过' });
  assert.equal((await queue.get(item.id)).state, STATES.APPROVED);
});

test('AI 低置信度通过转人工', async (t) => {
  const { reviewer, queue } = await setup(t, {
    client: async () => ({ verdict: 'pass', confidence: 0.1, reason: '拿不准' }),
  });
  const item = await seeded(queue, 'c');
  const result = await reviewQueuedItem(queue, reviewer, item.id);
  assert.equal(result.verdict, 'manual');
  assert.match(result.reason, /置信度/);
  assert.equal((await queue.get(item.id)).state, STATES.NEEDS_MANUAL);
});

test('AI 报错转人工而不是通过', async (t) => {
  const { reviewer, queue } = await setup(t, {
    client: async () => { throw new Error('上游 500'); },
  });
  const item = await seeded(queue, 'd');
  const result = await reviewQueuedItem(queue, reviewer, item.id);
  assert.equal(result.verdict, 'manual');
  assert.equal((await queue.get(item.id)).state, STATES.NEEDS_MANUAL);
});

test('AI 超时转人工而不是通过', async (t) => {
  const { reviewer, queue } = await setup(t, {
    env: { SUBMISSION_AI_TIMEOUT_MS: '40' },
    client: () => new Promise(() => {}), // 永不返回
  });
  const item = await seeded(queue, 'e');
  const result = await reviewQueuedItem(queue, reviewer, item.id);
  assert.equal(result.verdict, 'manual');
  assert.match(result.reason, /超时/);
  assert.equal((await queue.get(item.id)).state, STATES.NEEDS_MANUAL);
});

test('AI 返回看不懂的结论一律转人工', async (t) => {
  for (const payload of [null, {}, { verdict: 'maybe' }, 'not json', { verdict: 'pass' }]) {
    const parsed = parseReviewResponse(payload);
    assert.equal(parsed.verdict, 'manual', `${JSON.stringify(payload)} 应转人工`);
  }
});

test('OpenAI 兼容响应能被解析，坏 JSON 转人工', () => {
  const good = parseReviewResponse({
    choices: [{ message: { content: JSON.stringify({ verdict: 'pass', confidence: 0.8, reason: 'ok' }) } }],
  });
  assert.equal(good.verdict, 'pass');
  const bad = parseReviewResponse({ choices: [{ message: { content: '抱歉，我无法判断' } }] });
  assert.equal(bad.verdict, 'manual');
});

test('原始 AI 结果只写私有文件，条目里只有摘要', async (t) => {
  const { reviewer, queue, cfg } = await setup(t, {
    client: async () => ({ verdict: 'pass', confidence: 0.99, reason: 'ok', raw: { chain_of_thought: '内部推理' } }),
  });
  const item = await seeded(queue, 'f');
  await reviewQueuedItem(queue, reviewer, item.id);
  const stored = await queue.get(item.id);
  assert.ok(!JSON.stringify(stored).includes('内部推理'));
  const raw = JSON.parse(await fs.readFile(path.join(cfg.paths.ai, `${item.id}.json`), 'utf8'));
  assert.equal(raw.payload.raw.chain_of_thought, '内部推理');
});

test('已终态的条目不会再被审核覆盖', async (t) => {
  const { reviewer, queue } = await setup(t, {
    client: async () => ({ verdict: 'pass', confidence: 0.99, reason: 'ok' }),
  });
  const item = await seeded(queue, 'g');
  await queue.transition(item.id, 'review.start', { actor: 'ai' });
  await queue.transition(item.id, 'review.reject', { actor: 'ai', reason: '人工前先拒' });
  await queue.decide(item.id, 'rejected', { actor: 'maintainer', reason: '不要' });
  assert.equal((await queue.get(item.id)).state, STATES.REJECTED);
  await assert.rejects(() => reviewQueuedItem(queue, reviewer, item.id), /非法/);
});
