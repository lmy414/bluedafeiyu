// server/bridge.test.mjs —— auto_passed 到私有 intake 中转区的幂等桥接
//
// 要证明的性质（按批准的桥接计划）：
//   1. 只有 auto_passed 且完整 content schema 合法才写入 INTAKE_ROOT 的 inbox/ + meta/，
//      meta 状态为 ready；
//   2. needs_manual / auto_rejected / 内容不合法 / 异常一律不入中转；
//   3. 按 submission id + sha256 幂等：重复桥接只返回 duplicate，不产生第二条记录；
//   4. 缺 INTAKE_ROOT / INTAKE_CONTENT_DIR 时是「可观测 skipped」，不抛错、不丢队列；
//   5. 中转区必须在公开仓与 git 工作树之外（由 intake 配置校验兜底）；
//   6. 桥接不写内容仓、不写 dist/、不跑 git、不把 AI 原始推理写进中转元数据。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { AI_CONTENT_SCHEMA, resolveConfig } from './config.mjs';
import { STATES, createQueue } from './queue.mjs';
import { CONTENT_SCHEMA, createBridge, resolveBridgeOptions, validateContent } from './bridge.mjs';
import { SITE_ROOT } from '../tools/intake/core.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/* 与 server/review.mjs 的 submission-ai-content/1 一致：只有这六个字段。 */
const VALID_CONTENT = {
  name: '测试表情',
  description: '一张用于测试的图',
  commentary: '这张图看起来像在质疑什么。',
  characterId: 'deepseek',
  categoryIds: ['meme'],
  tags: ['测试', '吐槽'],
};

const VOCABULARY = {
  characterIds: new Set(['deepseek', 'doubao']),
  categoryIds: new Set(['meme', 'illustration', 'setting', 'comic']),
  loaded: true,
  ok: true,
};

async function setup(t, { env = {}, overrides = {}, intakeOverrides = {}, vocabulary = VOCABULARY, withIntake = true, contentDirFiles = true } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: path.join(base, 'private') }, { env: {} });
  const queue = await createQueue(cfg);

  let intakeRoot = '';
  let contentDir = '';
  let bridgeOverrides = overrides;
  if (withIntake) {
    contentDir = path.join(base, 'content');
    await fs.mkdir(contentDir, { recursive: true });
    if (contentDirFiles) {
      await fs.mkdir(path.join(contentDir, '.git'), { recursive: true });
      await fs.writeFile(path.join(contentDir, 'sentinel.txt'), 'do not touch\n');
    }
    intakeRoot = path.join(base, 'intake');
    bridgeOverrides = { root: intakeRoot, contentDir, ...overrides };
  }
  const bridge = await createBridge({ queue, env, overrides: bridgeOverrides, intakeOverrides, vocabulary });
  return { base, cfg, queue, bridge, intakeRoot, contentDir };
}

async function seedPassed(queue, { content = VALID_CONTENT, suffix = '' } = {}) {
  const { item } = await queue.enqueue({
    source: 'web',
    sourceId: `web:bridge${suffix}`,
    buffer: Buffer.concat([TINY_PNG, Buffer.from(suffix || '0')]),
    fields: { name: 'r', character: 'deepseek' },
  });
  await queue.transition(item.id, 'review.start', { actor: 'ai' });
  await queue.attachReview(
    item.id,
    { verdict: 'pass', confidence: 0.95, reason: 'ok', schema: AI_CONTENT_SCHEMA, content },
    { raw: { chain_of_thought: '内部推理-不许外泄' } },
  );
  await queue.transition(item.id, 'review.pass', { actor: 'ai' });
  return item;
}

async function snapshotDir(dir) {
  const out = [];
  async function walk(current) {
    let entries = [];
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  }
  await walk(dir);
  return out.sort();
}

/* ------------------------------------------------------------ 配置开关 */

test('resolveBridgeOptions 要求同时显式配置 INTAKE_ROOT 与 INTAKE_CONTENT_DIR', () => {
  assert.equal(resolveBridgeOptions({ env: {} }).enabled, false);
  assert.equal(resolveBridgeOptions({ env: { INTAKE_ROOT: '/x' } }).enabled, false);
  assert.equal(resolveBridgeOptions({ env: { INTAKE_CONTENT_DIR: '/y' } }).enabled, false);
  const both = resolveBridgeOptions({ env: { INTAKE_ROOT: '/x', INTAKE_CONTENT_DIR: '/y' } });
  assert.equal(both.enabled, true);
  assert.equal(both.root, '/x');
  assert.equal(both.contentDir, '/y');
});

test('缺配置时是可观测 skipped：不写中转区、不丢队列、不抛错', async (t) => {
  const { queue, bridge } = await setup(t, { withIntake: false, env: {} });
  assert.equal(bridge.enabled, false);
  assert.match(bridge.reason, /INTAKE_ROOT|INTAKE_CONTENT_DIR/);

  const item = await seedPassed(queue, { suffix: 'off' });
  const result = await bridge.bridgeItem(item.id);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /INTAKE_ROOT|INTAKE_CONTENT_DIR/);

  const stored = await queue.get(item.id);
  assert.equal(stored.state, STATES.AUTO_PASSED, '队列条目必须保留');
  assert.equal(stored.bridge, undefined, '停用时不应在条目上留下桥接标记');

  const pending = await bridge.bridgePending({});
  assert.equal(pending.enabled, false);
  assert.deepEqual(pending.results, []);
  assert.deepEqual(await bridge.listReady(), []);
});

test('INTAKE_ROOT 落在公开仓内时桥接停用（绝不把中转区写进 git）', async (t) => {
  const { queue } = await setup(t, { withIntake: false });
  const bridge = await createBridge({
    queue,
    env: {},
    overrides: { root: path.join(SITE_ROOT, 'submission-bridge-intake-should-not-exist'), contentDir: path.join(SITE_ROOT, 'content-never') },
    vocabulary: VOCABULARY,
  });
  assert.equal(bridge.enabled, false);
  assert.match(bridge.reason, /站点公开仓|git 工作树|内容公开仓/);
  const item = await seedPassed(queue, { suffix: 'badroot' });
  assert.equal((await bridge.bridgeItem(item.id)).status, 'skipped');
  assert.equal(await fs.stat(path.join(SITE_ROOT, 'submission-bridge-intake-should-not-exist')).catch(() => null), null);
});

test('角色 / 分类枚举不可用时 fail-closed，桥接停用', async (t) => {
  const { queue } = await setup(t, { withIntake: false });
  const broken = await createBridge({
    queue,
    env: { INTAKE_ROOT: '/tmp/x', INTAKE_CONTENT_DIR: '/tmp/y' },
    vocabulary: { characterIds: new Set(), categoryIds: new Set(), loaded: false, ok: false },
  });
  assert.equal(broken.enabled, false);
  assert.match(broken.reason, /枚举/);
});

/* ---------------------------------------------------- 通过条目写入中转区 */

test('auto_passed 且内容完整时写入 inbox + meta，状态 ready', async (t) => {
  const { queue, bridge, intakeRoot } = await setup(t);
  const item = await seedPassed(queue, { suffix: 'ready' });

  const result = await bridge.bridgeItem(item.id);
  assert.equal(result.status, 'ready');
  assert.equal(result.sha256, item.sha256);

  const inbox = await fs.readFile(path.join(intakeRoot, 'inbox', `${item.sha256}${item.ext}`));
  assert.deepEqual(inbox, await queue.readImage(item.id), '中转区字节必须与私有原图一致');

  const meta = JSON.parse(await fs.readFile(path.join(intakeRoot, 'meta', `${item.sha256}.json`), 'utf8'));
  assert.equal(meta.status, 'ready');
  assert.equal(meta.sha256, item.sha256);
  assert.equal(meta.submissionId, item.id);
  assert.equal(meta.contentSchema, CONTENT_SCHEMA);
  assert.equal(meta.contentSchema, AI_CONTENT_SCHEMA);
  assert.equal(meta.fields.name, VALID_CONTENT.name);
  assert.equal(meta.fields.character, 'deepseek');
  assert.deepEqual(meta.content.categoryIds, ['meme']);
  assert.deepEqual(Object.keys(meta.content).sort(), ['categoryIds', 'characterId', 'commentary', 'description', 'name', 'tags']);

  const stored = await queue.get(item.id);
  assert.equal(stored.state, STATES.AUTO_PASSED, '桥接不改动公开投稿状态机');
  assert.equal(stored.bridge.status, 'ready');
  assert.equal(stored.bridge.sha256, item.sha256);
});

test('按 submission id + sha256 幂等：重复桥接只返回 duplicate', async (t) => {
  const { queue, bridge, intakeRoot } = await setup(t);
  const item = await seedPassed(queue, { suffix: 'idem' });

  assert.equal((await bridge.bridgeItem(item.id)).status, 'ready');
  const metaBefore = await fs.readFile(path.join(intakeRoot, 'meta', `${item.sha256}.json`), 'utf8');
  const inboxStatBefore = await fs.stat(path.join(intakeRoot, 'inbox', `${item.sha256}${item.ext}`));

  const again = await bridge.bridgeItem(item.id);
  assert.equal(again.status, 'duplicate');
  assert.equal(again.sha256, item.sha256);

  const metas = (await fs.readdir(path.join(intakeRoot, 'meta'))).filter((f) => f.endsWith('.json'));
  assert.equal(metas.length, 1, '不能产生第二条中转记录');
  assert.equal(await fs.readFile(path.join(intakeRoot, 'meta', `${item.sha256}.json`), 'utf8'), metaBefore);
  assert.equal((await fs.stat(path.join(intakeRoot, 'inbox', `${item.sha256}${item.ext}`))).mtimeMs, inboxStatBefore.mtimeMs);

  const stored = await queue.get(item.id);
  assert.equal(stored.bridge.status, 'ready', '重复桥接不得把已就绪记录降级');
});

test('中转区已有同 sha256 记录时不覆盖，返回 duplicate', async (t) => {
  const { queue, bridge, intakeRoot } = await setup(t);
  const item = await seedPassed(queue, { suffix: 'foreign' });

  /* 模拟中转区里已经有一条同 sha256、但属于别处的记录（人工 staged 或旧来源）。 */
  const metaDir = path.join(intakeRoot, 'meta');
  const inboxDir = path.join(intakeRoot, 'inbox');
  await fs.mkdir(metaDir, { recursive: true });
  await fs.mkdir(inboxDir, { recursive: true });
  const foreign = {
    schema: 'intake/1',
    sha256: item.sha256,
    ext: item.ext,
    bytes: 12,
    source: 'manual',
    status: 'staged',
    submissionId: 'sub_manual_other',
    fields: { name: '别人的图' },
    content: null,
    origin: {},
  };
  const foreignBytes = Buffer.from('foreign-bytes');
  await fs.writeFile(path.join(metaDir, `${item.sha256}.json`), JSON.stringify(foreign));
  await fs.writeFile(path.join(inboxDir, `${item.sha256}${item.ext}`), foreignBytes);

  const result = await bridge.bridgeItem(item.id);
  assert.equal(result.status, 'duplicate');

  const meta = JSON.parse(await fs.readFile(path.join(metaDir, `${item.sha256}.json`), 'utf8'));
  assert.equal(meta.submissionId, 'sub_manual_other', '既有中转记录的持有者不能被改写');
  assert.equal(meta.status, 'staged', '既有中转记录状态不能被改写');
  assert.deepEqual(await fs.readFile(path.join(inboxDir, `${item.sha256}${item.ext}`)), foreignBytes, '既有中转字节不能被覆盖');
});

/* ------------------------------------------------- auto_rejected / manual */

test('needs_manual 与 auto_rejected 都不进中转区', async (t) => {
  const { queue, bridge, intakeRoot } = await setup(t);

  const manual = (await queue.enqueue({ source: 'web', sourceId: 'web:m', buffer: Buffer.concat([TINY_PNG, Buffer.from('m')]), fields: { name: 'm' } })).item;
  await queue.transition(manual.id, 'review.start', { actor: 'ai' });
  await queue.transition(manual.id, 'review.manual', { actor: 'ai', reason: '拿不准' });
  const manualResult = await bridge.bridgeItem(manual.id);
  assert.equal(manualResult.status, 'skipped');
  assert.match(manualResult.reason, /needs_manual/);

  const rejected = (await queue.enqueue({ source: 'web', sourceId: 'web:rj', buffer: Buffer.concat([TINY_PNG, Buffer.from('rj')]), fields: { name: 'r' } })).item;
  await queue.transition(rejected.id, 'review.start', { actor: 'ai' });
  await queue.attachReview(rejected.id, { verdict: 'reject', confidence: 0.9, reason: '真人照片', schema: AI_CONTENT_SCHEMA, content: VALID_CONTENT });
  await queue.transition(rejected.id, 'review.reject', { actor: 'ai' });
  const rejectedResult = await bridge.bridgeItem(rejected.id);
  assert.equal(rejectedResult.status, 'skipped');
  assert.match(rejectedResult.reason, /auto_rejected/);

  assert.deepEqual(await snapshotDir(intakeRoot), [], '审核未通过不得留下任何中转文件');
});

test('auto_passed 但内容 schema 不完整时补齐前不入中转', async (t) => {
  const { queue, bridge, intakeRoot } = await setup(t);

  const noContent = (await queue.enqueue({ source: 'web', sourceId: 'web:nc', buffer: Buffer.concat([TINY_PNG, Buffer.from('nc')]), fields: { name: 'n' } })).item;
  await queue.transition(noContent.id, 'review.start', { actor: 'ai' });
  /* 审核判 pass 但没有完整 content（例如 AI 没生成）时必须停在审核区。 */
  await queue.attachReview(noContent.id, { verdict: 'pass', confidence: 0.95, reason: 'ok', schema: AI_CONTENT_SCHEMA, content: null });
  await queue.transition(noContent.id, 'review.pass', { actor: 'ai' });
  const result = await bridge.bridgeItem(noContent.id);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /schema|content/);
  assert.deepEqual(await snapshotDir(intakeRoot), []);
});

/* ----------------------------------------------------------- 内容校验 */

test('validateContent 严格拒绝缺字段、未知字段、错类型、越界枚举、注入文本与重复项', () => {
  assert.equal(validateContent(VALID_CONTENT, VOCABULARY).ok, true);
  assert.deepEqual(validateContent(VALID_CONTENT, VOCABULARY).value.tags, ['测试', '吐槽']);

  const cases = [
    ['缺字段', { ...VALID_CONTENT, commentary: undefined }],
    ['未知字段', { ...VALID_CONTENT, verdict: 'pass' }],
    ['名称不是字符串', { ...VALID_CONTENT, name: 123 }],
    ['名称为空', { ...VALID_CONTENT, name: '   ' }],
    ['名称过长', { ...VALID_CONTENT, name: 'x'.repeat(201) }],
    ['名称含控制字符', { ...VALID_CONTENT, name: `坏${String.fromCharCode(0)}名` }],
    ['名称含 HTML', { ...VALID_CONTENT, name: '<b>图</b>' }],
    ['评价含脚本协议', { ...VALID_CONTENT, commentary: 'javascript:alert(1)' }],
    ['角色越界', { ...VALID_CONTENT, characterId: '不存在' }],
    ['角色为空', { ...VALID_CONTENT, characterId: '' }],
    ['分类越界', { ...VALID_CONTENT, categoryIds: ['nope'] }],
    ['分类为空', { ...VALID_CONTENT, categoryIds: [] }],
    ['分类不是数组', { ...VALID_CONTENT, categoryIds: 'meme' }],
    ['标签重复', { ...VALID_CONTENT, tags: ['a', 'a'] }],
    ['标签含 HTML', { ...VALID_CONTENT, tags: ['<script>'] }],
    ['标签不是数组', { ...VALID_CONTENT, tags: 'x' }],
  ];
  for (const [label, content] of cases) {
    const result = validateContent(content, VOCABULARY);
    assert.equal(result.ok, false, `${label} 应判为非法`);
    assert.ok(result.errors.length > 0, `${label} 应给出原因`);
  }
  assert.equal(validateContent(null, VOCABULARY).ok, false);
  assert.equal(validateContent(VALID_CONTENT, { characterIds: new Set(), categoryIds: new Set(), ok: false }).ok, false, '枚举不可用必须 fail-closed');
});

/* --------------------------------------------------------- 批量与就绪列表 */

test('bridgePending 只桥接 auto_passed，且给出逐条可观测结果', async (t) => {
  const { queue, bridge } = await setup(t);
  const passed = await seedPassed(queue, { suffix: 'b1' });
  const r2 = await seedPassed(queue, { suffix: 'b2' });

  const manual = (await queue.enqueue({ source: 'web', sourceId: 'web:b-m', buffer: Buffer.concat([TINY_PNG, Buffer.from('bm')]), fields: { name: 'm' } })).item;
  await queue.transition(manual.id, 'review.start', { actor: 'ai' });
  await queue.transition(manual.id, 'review.manual', { actor: 'ai', reason: '拿不准' });

  const pending = await bridge.bridgePending({});
  assert.equal(pending.enabled, true);
  assert.equal(pending.results.length, 2, '只有 auto_passed 会被处理');
  assert.deepEqual(pending.results.map((r) => r.sha256).sort(), [passed.sha256, r2.sha256].sort());
  assert.ok(pending.results.every((r) => r.status === 'ready'));
  assert.equal(pending.ready, 2);

  const ready = await bridge.listReady();
  assert.equal(ready.length, 2);
  assert.ok(ready.every((item) => item.status === 'ready'));
  assert.ok(ready.every((item) => item.submissionId));
});

/* ------------------------------------------------------- 边界与不落盘 */

test('中转元数据不含 AI 原始推理，且桥接不写内容仓', async (t) => {
  const { queue, bridge, intakeRoot, contentDir } = await setup(t);
  const before = await snapshotDir(contentDir);

  const item = await seedPassed(queue, { suffix: 'secret' });
  await bridge.bridgeItem(item.id);

  const metaText = await fs.readFile(path.join(intakeRoot, 'meta', `${item.sha256}.json`), 'utf8');
  assert.ok(!metaText.includes('内部推理-不许外泄'), 'AI 原始推理不得进入中转元数据');
  assert.ok(!metaText.includes('chain_of_thought'));

  assert.deepEqual(await snapshotDir(contentDir), before, '桥接绝不写内容仓');
});

test('intake 布局里只有 inbox / meta / logs，不创建任何公开产物', async (t) => {
  const { queue, bridge, intakeRoot } = await setup(t);
  const item = await seedPassed(queue, { suffix: 'layout' });
  await bridge.bridgeItem(item.id);
  const top = (await fs.readdir(intakeRoot)).sort();
  assert.deepEqual(top, ['inbox', 'logs', 'meta']);
});

test('全部 ready 条目都在公开仓与 git 工作树之外', async (t) => {
  const { queue, bridge } = await setup(t);
  const item = await seedPassed(queue, { suffix: 'outside' });
  await bridge.bridgeItem(item.id);
  const items = await bridge.listReady();
  assert.equal(items.length, 1);
  assert.equal(items[0].sha256, item.sha256);
  const rel = path.relative(SITE_ROOT, path.join(bridge.intake.inboxDir, `${item.sha256}${item.ext}`));
  const insideSiteRepo = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  assert.equal(insideSiteRepo, false, '中转区必须位于站点公开仓之外');
});

/* ------------------------------------------------- 队列桥接字段持久化 */

test('attachReview 持久化受校验的 content 供桥接使用', async (t) => {
  const { queue } = await setup(t, { withIntake: false });
  const item = await seedPassed(queue, { suffix: 'persist' });
  const stored = await queue.get(item.id);
  assert.equal(stored.review.content.commentary, VALID_CONTENT.commentary);
  assert.ok(!JSON.stringify(stored).includes('内部推理-不许外泄'), '原始推理仍只落私有 AI 文件');
});
