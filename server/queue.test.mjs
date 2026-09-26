// server/queue.test.mjs —— 持久队列、幂等、状态机与恢复
//
// 重点性质：
//   1. 两种幂等键（sourceId / sha256）都不会产生第二条记录；
//   2. 状态机只允许表内迁移，服务侧没有 published，永不自动发布；
//   3. 崩溃后能恢复：卡在 reviewing 的条目转人工，索引可从磁盘重建；
//   4. 并发入库被串行化，不丢条目、不写坏索引。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { AI_CONTENT_SCHEMA, resolveConfig } from './config.mjs';
import { STATES, TERMINAL_STATES, createQueue } from './queue.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

async function setup(t, { env = {}, now } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: path.join(base, 'private') }, { env });
  const queue = await createQueue(cfg, { now });
  return { base, cfg, queue };
}

test('入库后能取回原始字节与元数据', async (t) => {
  const { queue } = await setup(t);
  const { status, item } = await queue.enqueue({
    source: 'web',
    sourceId: 'web:abc',
    buffer: TINY_PNG,
    fields: { name: '测试图', character: 'deepseek', description: '' },
    origin: { ip: 'redacted' },
  });
  assert.equal(status, 'created');
  assert.equal(item.state, STATES.RECEIVED);
  assert.equal(item.sha256.length, 64);
  assert.equal(item.ext, '.png');
  assert.ok(item.id.startsWith('sub_'));

  const read = await queue.get(item.id);
  assert.equal(read.fields.name, '测试图');
  assert.deepEqual(await queue.readImage(item.id), TINY_PNG);
});

test('同 sourceId 重复入库不产生第二条记录', async (t) => {
  const { queue } = await setup(t);
  const first = await queue.enqueue({ source: 'qq', sourceId: 'qq:1:1:hash', buffer: TINY_PNG, fields: { name: 'a' } });
  const second = await queue.enqueue({ source: 'qq', sourceId: 'qq:1:1:hash', buffer: TINY_PNG, fields: { name: 'a' } });
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'duplicate_source');
  assert.equal(second.item.id, first.item.id);
  assert.equal((await queue.list()).length, 1);
});

test('同 sha256 不同来源合并到同一条且记录来源', async (t) => {
  const { queue } = await setup(t);
  const first = await queue.enqueue({ source: 'web', sourceId: 'web:1', buffer: TINY_PNG, fields: { name: 'x' } });
  const second = await queue.enqueue({ source: 'qq', sourceId: 'qq:2', buffer: TINY_PNG, fields: { name: 'x' } });
  assert.equal(second.status, 'duplicate_hash');
  assert.equal(second.item.id, first.item.id);
  assert.deepEqual(second.item.sourceIds.sort(), ['qq:2', 'web:1']);
  assert.equal((await queue.list()).length, 1);
});

test('非图片字节与超限图片被拒绝', async (t) => {
  const { queue } = await setup(t);
  await assert.rejects(
    () => queue.enqueue({ source: 'web', sourceId: 'web:bad', buffer: Buffer.from('PK\u0003\u0004 nope'), fields: { name: 'x' } }),
    /图片格式/,
  );
  assert.equal((await queue.list()).length, 0);

  const { queue: small } = await setup(t, { env: { SUBMISSION_MAX_BYTES: '8' } });
  await assert.rejects(
    () => small.enqueue({ source: 'web', sourceId: 'web:big', buffer: TINY_PNG, fields: { name: 'x' } }),
    /超过/,
  );
  assert.equal((await small.list()).length, 0);
});

test('状态机拒绝非法迁移，且不存在 published', async (t) => {
  const { queue } = await setup(t);
  const { item } = await queue.enqueue({ source: 'web', sourceId: 'web:s1', buffer: TINY_PNG, fields: { name: 'x' } });
  await assert.rejects(() => queue.transition(item.id, 'human.approve'), /非法/);
  assert.ok(!Object.values(STATES).includes('published'));
  assert.deepEqual(TERMINAL_STATES.sort(), ['approved', 'rejected']);

  await queue.transition(item.id, 'review.start', { actor: 'reviewer' });
  assert.equal((await queue.get(item.id)).state, STATES.REVIEWING);
  await assert.rejects(() => queue.transition(item.id, 'review.start'), /非法/);
});

test('审核通过只到 auto_passed，仍需人工决定；人工可批准或拒绝', async (t) => {
  const { queue } = await setup(t);
  const a = (await queue.enqueue({ source: 'web', sourceId: 'web:a', buffer: TINY_PNG, fields: { name: 'a' } })).item;
  await queue.transition(a.id, 'review.start', { actor: 'ai' });
  await queue.transition(a.id, 'review.pass', { actor: 'ai' });
  assert.equal((await queue.get(a.id)).state, STATES.AUTO_PASSED);
  await queue.decide(a.id, 'approved', { actor: 'maintainer', reason: '看图确认' });
  assert.equal((await queue.get(a.id)).state, STATES.APPROVED);

  const b = (await queue.enqueue({ source: 'web', sourceId: 'web:b', buffer: Buffer.concat([TINY_PNG, Buffer.from([1])]), fields: { name: 'b' } })).item;
  await queue.transition(b.id, 'review.start', { actor: 'ai' });
  await queue.transition(b.id, 'review.manual', { actor: 'ai', reason: 'timeout' });
  assert.equal((await queue.get(b.id)).state, STATES.NEEDS_MANUAL);
  await queue.decide(b.id, 'rejected', { actor: 'maintainer', reason: '重复' });
  assert.equal((await queue.get(b.id)).state, STATES.REJECTED);
  await assert.rejects(() => queue.decide(b.id, 'approved'), /非法/);
});

test('AI 原始结果只落私有目录，不进条目正文也不进公开响应', async (t) => {
  const { queue, cfg } = await setup(t);
  const { item } = await queue.enqueue({ source: 'web', sourceId: 'web:r', buffer: TINY_PNG, fields: { name: 'r' } });
  await queue.attachReview(item.id, { verdict: 'manual', confidence: 0.2, reason: 'low' }, { raw: { secret_ai_note: '内部推理' } });
  const stored = await queue.get(item.id);
  assert.equal(stored.review.verdict, 'manual');
  assert.ok(!JSON.stringify(stored).includes('内部推理'));
  const raw = JSON.parse(await fs.readFile(path.join(cfg.paths.ai, `${item.id}.json`), 'utf8'));
  assert.equal(raw.payload.secret_ai_note, '内部推理');
});

test('持久化可重载，索引能从磁盘重建', async (t) => {
  const { cfg, queue } = await setup(t);
  const { item } = await queue.enqueue({ source: 'web', sourceId: 'web:p', buffer: TINY_PNG, fields: { name: 'p' } });
  await fs.rm(path.join(cfg.paths.index, 'sha256.json'), { force: true });
  await fs.rm(path.join(cfg.paths.index, 'source.json'), { force: true });

  const reopened = await createQueue(cfg);
  const reloaded = await reopened.get(item.id);
  assert.equal(reloaded.fields.name, 'p');
  const dup = await reopened.enqueue({ source: 'web', sourceId: 'web:p', buffer: TINY_PNG, fields: { name: 'p' } });
  assert.equal(dup.status, 'duplicate_source');
});

test('恢复把卡住的 reviewing 条目转人工', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-rec-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: path.join(base, 'private') }, { env: {} });
  let clock = 1_000_000;
  const queue = await createQueue(cfg, { now: () => clock });
  const { item } = await queue.enqueue({ source: 'web', sourceId: 'web:t', buffer: TINY_PNG, fields: { name: 't' } });
  await queue.transition(item.id, 'review.start', { actor: 'ai' });

  clock += 10 * 60 * 1000; // 10 分钟后再启动
  const restarted = await createQueue(cfg, { now: () => clock, reviewTimeoutMs: 60 * 1000 });
  const result = await restarted.recover();
  assert.equal(result.recovered.length, 1);
  const after = await restarted.get(item.id);
  assert.equal(after.state, STATES.NEEDS_MANUAL);
  assert.match(after.stateHistory.at(-1).reason, /恢复|超时/);
});

test('并发入库被串行化，条目与索引都不丢', async (t) => {
  const { queue, cfg } = await setup(t);
  const buffers = Array.from({ length: 24 }, (_, i) => Buffer.concat([TINY_PNG, Buffer.from([i])]));
  const results = await Promise.all(buffers.map((buffer, i) => queue.enqueue({
    source: 'web',
    sourceId: `web:c${i}`,
    buffer,
    fields: { name: `c${i}` },
  })));
  assert.equal(results.filter((r) => r.status === 'created').length, 24);
  assert.equal((await queue.list()).length, 24);
  const sourceIndex = JSON.parse(await fs.readFile(path.join(cfg.paths.index, 'source.json'), 'utf8'));
  assert.equal(Object.keys(sourceIndex).length, 24);
});

test('stats 只给计数，不外泄内部字段', async (t) => {
  const { queue } = await setup(t);
  await queue.enqueue({ source: 'web', sourceId: 'web:st', buffer: TINY_PNG, fields: { name: 'st' } });
  const stats = await queue.stats();
  assert.equal(stats.total, 1);
  assert.equal(stats.byState[STATES.RECEIVED], 1);
  assert.equal(stats.bySource.web, 1);
  assert.ok(!JSON.stringify(stats).includes('sha256'));
});

test('attachReview 把受校验 content 写进私有摘要与 ai raw，剔除系统/未知字段', async (t) => {
  const { queue, cfg } = await setup(t);
  const { item } = await queue.enqueue({ source: 'web', sourceId: 'web:content', buffer: TINY_PNG, fields: { name: 'r' } });
  const content = {
    name: '探头的大肥鱼',
    description: '一句话说明',
    commentary: '第一人称评价',
    characterId: 'deepseek',
    categoryIds: ['meme'],
    tags: ['探头'],
    // 下面这些系统/法律字段绝不能落库
    id: 'hack',
    slug: 'hack',
    path: '/etc/passwd',
    submitter: 'evil',
    origin: 'evil',
    license: 'WTFPL',
    status: 'approved',
    freeform: { nested: true },
  };
  await queue.attachReview(item.id, {
    verdict: 'pass',
    confidence: 0.9,
    reason: 'ok',
    schema: AI_CONTENT_SCHEMA,
    content,
  }, { raw: { chain_of_thought: '内部推理' } });

  const stored = await queue.get(item.id);
  // content 只允许这六个字段，系统/法律/未知字段一律剔除。
  assert.deepEqual(Object.keys(stored.review.content).sort(), [
    'categoryIds', 'characterId', 'commentary', 'description', 'name', 'tags',
  ]);
  assert.equal(stored.review.schema, AI_CONTENT_SCHEMA);
  assert.equal(stored.review.content.verdict, undefined); // 审核结论不塞进 content
  assert.equal(stored.review.verdict, 'pass');
  assert.equal(stored.review.content.characterId, 'deepseek');
  assert.deepEqual(stored.review.content.tags, ['探头']);
  assert.equal(stored.content, undefined); // 顶层没有 content
  const serialized = JSON.stringify(stored);
  for (const leak of ['hack', '/etc/passwd', 'evil', 'WTFPL', 'freeform']) {
    assert.ok(!serialized.includes(leak), `摘要里不应出现 ${leak}`);
  }

  const raw = JSON.parse(await fs.readFile(path.join(cfg.paths.ai, `${item.id}.json`), 'utf8'));
  assert.equal(raw.payload.chain_of_thought, '内部推理');
  assert.equal(raw.schema, AI_CONTENT_SCHEMA);
  assert.ok(raw.content.categoryIds.includes('meme'));
  assert.equal(raw.content.status, undefined);
  assert.deepEqual(Object.keys(raw.content).sort(), [
    'categoryIds', 'characterId', 'commentary', 'description', 'name', 'tags',
  ]);
});

test('attachReview 没有 content 时只记摘要，不无中生有', async (t) => {
  const { queue, cfg } = await setup(t);
  const { item } = await queue.enqueue({ source: 'web', sourceId: 'web:nocontent', buffer: TINY_PNG, fields: { name: 'r' } });
  await queue.attachReview(item.id, { verdict: 'manual', confidence: 0, reason: '未配置', schema: null, content: null }, { raw: { not_configured: true } });
  const stored = await queue.get(item.id);
  assert.equal(stored.review.verdict, 'manual');
  assert.equal(stored.review.content, null);
  const raw = JSON.parse(await fs.readFile(path.join(cfg.paths.ai, `${item.id}.json`), 'utf8'));
  assert.equal(raw.content, null);
});
