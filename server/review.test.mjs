// server/review.test.mjs —— AI 审核的失败关闭性质 + submission-ai-content/1 严格契约
//
// 核心要求：**真实 AI 服务没配 / 超时 / 报错 / 返回看不懂，都转人工，
// 绝不当作通过，绝不自动发布。** 测试全部注入假客户端，不发生真实外呼。
//
// 新增要求：AI 响应必须是严格的 submission-ai-content/1 ——
// 未知字段、错误类型、重复 tags、HTML/脚本/控制字符、非法角色/分类、低置信度，
// 一律转人工；只有受校验的 content 能进私有摘要与 ai raw，绝不进公开响应。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { AI_CONTENT_SCHEMA, resolveConfig } from './config.mjs';
import { STATES, createQueue } from './queue.mjs';
import {
  containsForbiddenText,
  createReviewer,
  parseReviewResponse,
  reviewQueuedItem,
} from './review.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/* 注入的枚举表，避免测试依赖真实 data/ 内容。 */
const VOCABULARY = Object.freeze({
  ok: true,
  characterIds: new Set(['deepseek', 'kimi', 'glm', 'other']),
  categoryIds: new Set(['meme', 'illustration', 'setting', 'comic']),
});
const NO_VOCABULARY = Object.freeze({ ok: false, characterIds: new Set(), categoryIds: new Set() });

/** 组装一份合法的 submission-ai-content/1 响应；overrides 浅合并到顶层。 */
function payload(overrides = {}) {
  const { content: contentOverride, ...rest } = overrides;
  return {
    schema: AI_CONTENT_SCHEMA,
    verdict: 'pass',
    confidence: 0.95,
    reason: '符合二创表情包主题',
    content: {
      name: '探头的大肥鱼',
      description: '一张可用于聊天的二创表情',
      commentary: '这条我很喜欢，聊天时用得上。',
      characterId: 'deepseek',
      categoryIds: ['meme'],
      tags: ['探头', '可爱'],
      ...(contentOverride || {}),
    },
    ...rest,
  };
}

async function setup(t, { env = {}, now, client, vocabulary = VOCABULARY } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'review-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: path.join(base, 'private') }, { env });
  const queue = await createQueue(cfg, { now });
  const reviewer = createReviewer(cfg, { client, now, vocabulary });
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
  assert.equal(result.content, null);
  assert.match(result.reason, /未配置|not_configured/);
  assert.equal((await queue.get(item.id)).state, STATES.NEEDS_MANUAL);
});

test('AI 返回通过只到 auto_passed，仍需人工，服务不发布', async (t) => {
  const { reviewer, queue } = await setup(t, { client: async () => payload() });
  const item = await seeded(queue, 'a');
  const result = await reviewQueuedItem(queue, reviewer, item.id);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.content.name, '探头的大肥鱼');
  const stored = await queue.get(item.id);
  assert.equal(stored.state, STATES.AUTO_PASSED);
  assert.notEqual(stored.state, STATES.APPROVED);
  assert.ok(!['published', 'approved'].includes(stored.state));
});

test('AI 高置信度拒绝进入 auto_rejected，仍可人工翻案', async (t) => {
  const { reviewer, queue } = await setup(t, {
    client: async () => payload({ verdict: 'reject', reason: '真人照片' }),
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
    client: async () => payload({ confidence: 0.1 }),
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

/* ---------------------------------------------- submission-ai-content/1 契约 */

test('合法的 pass/reject 响应解析出受校验 content', () => {
  const passed = parseReviewResponse(payload(), { vocabulary: VOCABULARY });
  assert.equal(passed.verdict, 'pass');
  assert.equal(passed.confidence, 0.95);
  assert.deepEqual(passed.content, {
    name: '探头的大肥鱼',
    description: '一张可用于聊天的二创表情',
    commentary: '这条我很喜欢，聊天时用得上。',
    characterId: 'deepseek',
    categoryIds: ['meme'],
    tags: ['探头', '可爱'],
  });

  const rejected = parseReviewResponse(payload({ verdict: 'reject' }), { vocabulary: VOCABULARY });
  assert.equal(rejected.verdict, 'reject');
  assert.ok(rejected.content);
});

test('schema 字段若出现必须匹配 submission-ai-content/1，缺失可容忍', () => {
  assert.equal(parseReviewResponse({ ...payload(), schema: undefined }, { vocabulary: VOCABULARY }).verdict, 'pass');
  assert.equal(parseReviewResponse({ ...payload(), schema: 'submission-ai-content/2' }, { vocabulary: VOCABULARY }).verdict, 'manual');
});

test('未知字段一律转人工（顶层与 content 内）', () => {
  const topLevel = parseReviewResponse({ ...payload(), approved: true }, { vocabulary: VOCABULARY });
  assert.equal(topLevel.verdict, 'manual');
  assert.match(topLevel.reason, /未知字段/);

  const inContent = parseReviewResponse(
    payload({ content: { status: 'approved' } }),
    { vocabulary: VOCABULARY },
  );
  assert.equal(inContent.verdict, 'manual');
  assert.match(inContent.reason, /未知字段/);
});

test('AI 不得生成 id/slug/path/submitter/origin/license/status 等系统与法律字段', () => {
  for (const key of ['id', 'slug', 'path', 'submitter', 'origin', 'license', 'status']) {
    const result = parseReviewResponse(payload({ content: { [key]: 'evil' } }), { vocabulary: VOCABULARY });
    assert.equal(result.verdict, 'manual', `content.${key} 必须被拒绝`);
    assert.equal(result.content, null);
  }
});

test('confidence 必须是 0..1 的 JSON number，字符串/布尔/null 一律转人工', () => {
  for (const confidence of ['0.9', true, null, undefined, {}, Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.5]) {
    const result = parseReviewResponse(payload({ confidence }), { vocabulary: VOCABULARY });
    assert.equal(result.verdict, 'manual', `confidence=${String(confidence)} 应转人工`);
  }
  assert.equal(parseReviewResponse(payload({ confidence: 0 }), { vocabulary: VOCABULARY }).verdict, 'pass');
  assert.equal(parseReviewResponse(payload({ confidence: 1 }), { vocabulary: VOCABULARY }).verdict, 'pass');
});

test('verdict 只能是 pass / reject，其他值转人工', () => {
  for (const verdict of ['maybe', 'approved', 'published', '', null, 1]) {
    const result = parseReviewResponse(payload({ verdict }), { vocabulary: VOCABULARY });
    assert.equal(result.verdict, 'manual', `verdict=${String(verdict)} 应转人工`);
  }
});

test('content 缺字段、错类型或空字段一律转人工', () => {
  const full = payload();
  for (const key of ['name', 'description', 'commentary', 'characterId', 'categoryIds', 'tags']) {
    const content = { ...full.content };
    delete content[key];
    const result = parseReviewResponse({ ...full, content }, { vocabulary: VOCABULARY });
    assert.equal(result.verdict, 'manual', `缺 content.${key} 应转人工`);
  }
  const wrongTypes = [
    { name: 123 },
    { description: [] },
    { commentary: {} },
    { characterId: null },
    { categoryIds: 'meme' },
    { tags: '探头' },
  ];
  for (const content of wrongTypes) {
    const result = parseReviewResponse(payload({ content }), { vocabulary: VOCABULARY });
    assert.equal(result.verdict, 'manual', `content ${JSON.stringify(content)} 应转人工`);
  }
  assert.equal(parseReviewResponse(payload({ content: { name: '   ' } }), { vocabulary: VOCABULARY }).verdict, 'manual');
  assert.equal(parseReviewResponse(payload({ content: { categoryIds: [] } }), { vocabulary: VOCABULARY }).verdict, 'manual');
});

test('重复 tags 与重复 categoryIds 一律转人工', () => {
  const dupTags = parseReviewResponse(payload({ content: { tags: ['可爱', '可爱'] } }), { vocabulary: VOCABULARY });
  assert.equal(dupTags.verdict, 'manual');
  assert.match(dupTags.reason, /重复/);

  const dupCategories = parseReviewResponse(payload({ content: { categoryIds: ['meme', 'meme'] } }), { vocabulary: VOCABULARY });
  assert.equal(dupCategories.verdict, 'manual');
  assert.match(dupCategories.reason, /重复/);
});

test('非法角色或分类不在枚举内一律转人工', () => {
  const badCharacter = parseReviewResponse(payload({ content: { characterId: 'gpt-5' } }), { vocabulary: VOCABULARY });
  assert.equal(badCharacter.verdict, 'manual');
  assert.match(badCharacter.reason, /角色/);

  const badCategory = parseReviewResponse(payload({ content: { categoryIds: ['nsfw'] } }), { vocabulary: VOCABULARY });
  assert.equal(badCategory.verdict, 'manual');
  assert.match(badCategory.reason, /分类/);
});

test('HTML / 脚本 / 控制字符出现在任何文本字段都转人工', () => {
  const vectors = [
    { name: '<script>alert(1)</script>' },
    { description: '普通文本 <img src=x onerror=alert(1)>' },
    { commentary: '点这里 javascript:alert(1)' },
    { tags: ['<b>加粗</b>'] },
    { name: '换行\u0000控制符' },
  ];
  for (const content of vectors) {
    const result = parseReviewResponse(payload({ content }), { vocabulary: VOCABULARY });
    assert.equal(result.verdict, 'manual', `${JSON.stringify(content)} 应转人工`);
  }
  const reasonVector = parseReviewResponse(payload({ reason: '</script><x>' }), { vocabulary: VOCABULARY });
  assert.equal(reasonVector.verdict, 'manual');

  assert.equal(containsForbiddenText('正常中文，带标点。'), false);
  assert.equal(containsForbiddenText('<div>'), true);
  assert.equal(containsForbiddenText('\u0007'), true);
  assert.equal(containsForbiddenText('javascript:x'), true);
});

test('枚举无法加载时 fail-closed，pass/reject 一律转人工', () => {
  const result = parseReviewResponse(payload(), { vocabulary: NO_VOCABULARY });
  assert.equal(result.verdict, 'manual');
  assert.match(result.reason, /枚举/);
  const alsoNoVocabulary = parseReviewResponse(payload(), {});
  assert.equal(alsoNoVocabulary.verdict, 'manual');
});

test('AI 返回看不懂的结论一律转人工', () => {
  for (const bad of [null, {}, { verdict: 'maybe' }, 'not json', { verdict: 'pass' }]) {
    const parsed = parseReviewResponse(bad, { vocabulary: VOCABULARY });
    assert.equal(parsed.verdict, 'manual', `${JSON.stringify(bad)} 应转人工`);
  }
});

test('OpenAI 兼容响应能被解析，坏 JSON 转人工', () => {
  const good = parseReviewResponse(
    { choices: [{ message: { content: JSON.stringify(payload()) } }] },
    { vocabulary: VOCABULARY },
  );
  assert.equal(good.verdict, 'pass');
  assert.equal(good.content.characterId, 'deepseek');
  const bad = parseReviewResponse({ choices: [{ message: { content: '抱歉，我无法判断' } }] }, { vocabulary: VOCABULARY });
  assert.equal(bad.verdict, 'manual');
});

test('审核器默认从 data/ 动态加载枚举，真实角色与分类可用', async (t) => {
  const { reviewer, queue } = await setup(t, {
    client: async () => payload({ content: { characterId: 'deepseek', categoryIds: ['meme'] } }),
    vocabulary: null, // 不注入，走 loadContentVocabulary(cfg.siteRoot)
  });
  const item = await seeded(queue, 'v');
  const result = await reviewQueuedItem(queue, reviewer, item.id);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.content.characterId, 'deepseek');
});

test('promptVersion 已升级到 submission-ai-content/1', async (t) => {
  const { reviewer, queue } = await setup(t, { client: async () => payload() });
  const item = await seeded(queue, 'pv');
  const result = await reviewQueuedItem(queue, reviewer, item.id);
  assert.equal(result.promptVersion, AI_CONTENT_SCHEMA);
  const stored = await queue.get(item.id);
  assert.equal(stored.review.promptVersion, AI_CONTENT_SCHEMA);
});

test('受校验 content 只写私有摘要与 ai raw，不进公开条目顶层', async (t) => {
  const { reviewer, queue, cfg } = await setup(t, {
    // 内部推理挂在传输层包装上，严格契约的正文仍是合法的 submission-ai-content/1。
    client: async () => ({ choices: [{ message: { content: JSON.stringify(payload()) } }], chain_of_thought: '内部推理' }),
  });
  const item = await seeded(queue, 'f');
  await reviewQueuedItem(queue, reviewer, item.id);

  const stored = await queue.get(item.id);
  assert.ok(!JSON.stringify(stored).includes('内部推理'));
  assert.equal(stored.fields.name, 'r'); // 系统字段仍是投稿者填的，未被 AI 覆盖
  assert.equal(stored.content, undefined); // 顶层绝不出现 AI content
  assert.equal(stored.review.content.characterId, 'deepseek');
  assert.deepEqual(stored.review.content.tags, ['探头', '可爱']);

  const raw = JSON.parse(await fs.readFile(path.join(cfg.paths.ai, `${item.id}.json`), 'utf8'));
  assert.equal(raw.chain_of_thought, undefined);
  assert.equal(raw.payload.chain_of_thought, '内部推理');
  assert.equal(raw.content.characterId, 'deepseek');
  assert.equal(raw.schema, AI_CONTENT_SCHEMA);
});

test('已终态的条目不会再被审核覆盖', async (t) => {
  const { reviewer, queue } = await setup(t, { client: async () => payload() });
  const item = await seeded(queue, 'g');
  await queue.transition(item.id, 'review.start', { actor: 'ai' });
  await queue.transition(item.id, 'review.reject', { actor: 'ai', reason: '人工前先拒' });
  await queue.decide(item.id, 'rejected', { actor: 'maintainer', reason: '不要' });
  assert.equal((await queue.get(item.id)).state, STATES.REJECTED);
  await assert.rejects(() => reviewQueuedItem(queue, reviewer, item.id), /非法/);
});
