#!/usr/bin/env node
/* ops/tests/publish-batch.test.mjs —— 自动批量发布器的回归测试（零依赖，node:test）
 *
 *   node --test ops/tests/publish-batch.test.mjs
 *
 * 覆盖自动发布必须守住的几条性质：
 *   1. 默认 dry-run：不写两个工作树、不提交、不推送、不部署、不把中转条目标成已发布；
 *   2. 只有 AUTO_PUBLISH_ENABLED=true 才允许改动；push / deploy 各自还要显式开关；
 *   3. ready 条目校验：图片、SHA-256、角色、分类、完整 AI 内容缺一不可，坏的留在 ready；
 *   4. 已发布同图按 SHA-256 查到后只标记、不重复写清单；
 *   5. 提交只显式列文件，绝不 git add -A / .；
 *   6. 批次原子：任一步失败都保留 ready，并写失败批次日志；
 *   7. 上一批次部分失败留下的工作树改动可被 reset 回收；计划外改动一律拒绝；
 *   8. 发布锁互斥；无 ready 条目时 no-op。
 *
 * 全程离线：git / 工具链 / 部署命令都用注入的假 exec，两个工作树与中转区都是临时目录。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  acquirePublishLock,
  loadManifests,
  planBatch,
  readReadyEntries,
  resolvePublishConfig,
  runBatch,
  sniffImage,
} from '../publish-batch.mjs';

/* 真的 1x1 PNG / GIF，用来造合法图片字节 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/* ---------------------------------------------------------------- fixture */

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function makeWorkspace(t, { works = [], ownerPicks = [], image = TINY_PNG, ext = '.png' } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'publish-batch-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const site = path.join(root, 'bluedafeiyu');
  const content = path.join(root, 'ai-girl-stickers');
  const intake = path.join(root, 'dafeiyu-intake');

  writeJson(path.join(site, 'data', 'characters.json'), [
    { id: 'deepseek', name: 'DeepSeek娘', aliases: [], status: 'active', inSubmissionForm: true },
    { id: 'other', name: '其他角色', aliases: [], status: 'active', inSubmissionForm: true },
    { id: 'hidden', name: '不出现在表单', aliases: [], status: 'active', inSubmissionForm: false },
  ]);
  writeJson(path.join(site, 'data', 'categories.json'), [
    { id: 'meme', name: '梗图', description: '', status: 'active' },
    { id: 'illustration', name: '插画', description: '', status: 'active' },
    { id: 'setting', name: '设定图', description: '', status: 'active' },
    { id: 'comic', name: '漫画', description: '', status: 'active' },
  ]);
  writeJson(path.join(site, 'data', 'works.json'), works);
  writeJson(path.join(site, 'data', 'owner-picks.json'), ownerPicks);

  for (const rel of ['dist/submissions/originals', 'dist/submissions/previews', 'dist/submissions/large']) {
    fs.mkdirSync(path.join(content, ...rel.split('/')), { recursive: true });
  }
  for (const rel of ['meta', 'inbox', 'logs', 'batches']) {
    fs.mkdirSync(path.join(intake, rel), { recursive: true });
  }

  const digest = sha256(image);
  return { root, site, content, intake, image, ext, digest };
}

/** 往中转区写一条 ready 记录（字段可覆盖）。 */
function writeReady(ws, overrides = {}) {
  const digest = overrides.sha256 || ws.digest;
  const ext = overrides.ext || ws.ext;
  const image = overrides.image || ws.image;
  fs.writeFileSync(path.join(ws.intake, 'inbox', `${digest}${ext}`), image);
  const item = {
    schema: 'intake/1',
    sha256: digest,
    ext,
    bytes: image.length,
    source: 'web',
    receivedAt: '2026-09-26T00:00:00.000Z',
    status: 'ready',
    fields: {
      name: '测试作品',
      description: '一句话说明',
      character: 'deepseek',
      tags: ['测试'],
      commentary: '这条是看图写的第一人称评价，长度足够。',
      categoryIds: ['meme'],
      originType: 'self-created',
      originAuthor: 'tester',
      originUrl: 'https://example.com/p/1',
      licenseType: 'submitter-permission',
      licenseNote: '',
    },
    origin: { submitter: 'tester' },
    ai: { verdict: 'pass', confidence: 0.92, reason: '属于 AI 娘二创', characterId: 'deepseek', categoryIds: ['meme'], tags: ['测试'] },
    targetPath: null,
    publishedAt: null,
    ...overrides.item,
  };
  writeJson(path.join(ws.intake, 'meta', `${digest}.json`), item);
  return item;
}

/* ---------------------------------------------------------------- 假 exec */

function ok(stdout = '') {
  return { status: 0, stdout, stderr: '' };
}
function fail(stderr = 'boom', status = 1) {
  return { status, stdout: '', stderr };
}

/**
 * 假 exec：模拟 git / node / python / bash 的行为。
 * state 里可预置 preDirtyByDir（toolchain 之前的脏文件）与 dirtyFilesByDir（toolchain 之后）。
 */
function makeExec(state = {}) {
  const calls = [];
  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    const isGit = cmd === 'git';
    const dir = isGit && args[0] === '-C' ? args[1] : undefined;
    const rest = isGit && args[0] === '-C' ? args.slice(2) : args;

    if (isGit) return gitHandler(state, dir, rest);
    if (cmd === 'node') {
      state.nodeRuns = (state.nodeRuns || 0) + 1;
      if (state.failNode) return fail('node tool failed');
      state.toolchainDone = true;
      return ok('');
    }
    if (cmd === 'python' || cmd === 'python3') {
      if (rest.includes('-c')) return ok(''); // import PIL 预检
      state.pythonRuns = (state.pythonRuns || 0) + 1;
      if (state.failPython) return fail('Pillow 转换失败');
      state.toolchainDone = true;
      return ok('');
    }
    if (cmd === 'bash' || cmd === 'sh') {
      state.deployRuns = (state.deployRuns || 0) + 1;
      if (state.failDeploy) return fail('deploy failed');
      return ok('');
    }
    return ok('');
  };
  exec.calls = calls;
  exec.state = state;
  return exec;
}

function gitHandler(state, dir, rest) {
  state.gitCalls = state.gitCalls || [];
  state.gitCalls.push({ dir, rest });
  const sub = rest[0];
  if (sub === 'fetch') return ok('');
  if (sub === 'rev-parse') {
    if (rest[1] === 'HEAD') return ok(state.head?.[dir] || 'sha0');
    return ok(state.originHead?.[dir] || 'sha0');
  }
  if (sub === 'status') {
    const files = state.toolchainDone
      ? (state.dirtyFilesByDir?.[dir] || [])
      : (state.preDirtyByDir?.[dir] || []);
    return ok(files.map((file) => `?? ${file}\0`).join(''));
  }
  if (sub === 'reset') {
    // 模拟 git reset --hard：把受跟踪文件恢复到基线内容。
    const baseline = state.baseline?.[dir] || {};
    for (const [rel, text] of Object.entries(baseline)) {
      const abs = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
    if (state.preDirtyByDir) state.preDirtyByDir[dir] = [];
    state.resets = (state.resets || 0) + 1;
    return ok('');
  }
  if (sub === 'ls-files') {
    const rel = rest[rest.length - 1];
    return state.tracked?.[dir]?.has(rel) ? ok(`${rel}\n`) : { status: 1, stdout: '', stderr: '' };
  }
  if (sub === 'add') {
    const files = rest.slice(2);
    if (files.some((file) => file === '-A' || file === '.' || file === '--all')) {
      throw new Error('禁止 git add -A / .');
    }
    state.added = state.added || [];
    state.added.push({ dir, files });
    return ok('');
  }
  if (sub === 'diff') {
    const files = state.stagedByDir?.[dir] || [];
    return ok(files.length ? `${files.join('\n')}\n` : '');
  }
  if (sub === 'commit') {
    state.commits = (state.commits || 0) + 1;
    return ok('');
  }
  if (sub === 'push') {
    state.pushes = (state.pushes || 0) + 1;
    return ok('');
  }
  return ok('');
}

function envFor(ws, extra = {}) {
  return {
    INTAKE_ROOT: ws.intake,
    PUBLISH_CONTENT_DIR: ws.content,
    PUBLISH_SITE_DIR: ws.site,
    PUBLISH_PYTHON: 'python',
    PUBLISH_BUILD_CHECK: 'false',
    PUBLISH_DEPLOY_CMD: 'true',
    ...extra,
  };
}

function configFor(ws, extraEnv = {}, argv = []) {
  return resolvePublishConfig({ env: envFor(ws, extraEnv), argv });
}

/* ================================================================ 图片嗅探 */

test('sniffImage 认 PNG / GIF 的尺寸与动画标记', () => {
  assert.deepEqual(sniffImage(TINY_PNG), { format: 'png', width: 1, height: 1, isAnimated: false });
  assert.deepEqual(sniffImage(TINY_GIF), { format: 'gif', width: 1, height: 1, isAnimated: false });
  assert.equal(sniffImage(Buffer.from('not an image')), null);
});

/* ================================================================ 读取 ready */

test('readReadyEntries 只看 status=ready，坏 meta 只跳过这一条', async (t) => {
  const ws = await makeWorkspace(t);
  writeReady(ws);
  writeReady(ws, { item: { ...{}, status: 'staged', sha256: sha256(Buffer.from('x')) }, sha256: sha256(Buffer.from('x')), image: Buffer.from('x') });
  fs.writeFileSync(path.join(ws.intake, 'meta', 'broken.json'), '{ not json');
  const cfg = configFor(ws);
  const { entries, bad } = await readReadyEntries(cfg.intake);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sha256, ws.digest);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].file, 'broken.json');
});

/* ================================================================ 校验 / 规划 */

test('planBatch：合格条目生成公开记录', async (t) => {
  const ws = await makeWorkspace(t);
  writeReady(ws);
  const cfg = configFor(ws);
  const { entries } = await readReadyEntries(cfg.intake);
  const manifests = loadManifests(cfg.siteDataDir);
  const plan = planBatch(cfg, entries, manifests);
  assert.equal(plan.publishable.length, 1);
  assert.equal(plan.skipped.length, 0);
  const item = plan.publishable[0];
  assert.equal(item.record.id, `sticker_${ws.digest.slice(0, 24)}`);
  assert.equal(item.record.characterId, 'deepseek');
  assert.deepEqual(item.record.categoryIds, ['meme']);
  assert.equal(item.record.status, 'published');
  assert.equal(item.record.sha256, ws.digest);
  assert.match(item.record.path, /dist\/submissions\/originals\/deepseek\/[0-9a-f]{16}\.png$/);
  assert.equal(item.record.createdAt, '2026-09-26T00:00:00.000Z');
  assert.equal(item.originalRel.startsWith('dist/submissions/originals/deepseek/'), true);
  assert.equal(item.previewRel.endsWith('.webp'), true);
});

test('planBatch：不完整内容一律留在 ready 并给出原因', async (t) => {
  const ws = await makeWorkspace(t);
  // 缺角色
  writeReady(ws, { item: { fields: { name: 'x', categoryIds: ['meme'], tags: ['t'], commentary: 'c', character: '' }, ai: { verdict: 'pass', confidence: 0.9 } }, sha256: sha256(Buffer.from('a')), image: Buffer.from('a'), ext: '.png' });
  // 未知分类
  writeReady(ws, { item: { fields: { name: 'x', character: 'deepseek', categoryIds: ['nope'], tags: ['t'], commentary: 'c' } }, sha256: sha256(Buffer.from('b')), image: Buffer.from('b'), ext: '.png' });
  // AI 未通过
  writeReady(ws, { item: { fields: { name: 'x', character: 'deepseek', categoryIds: ['meme'], tags: ['t'], commentary: 'c' }, ai: { verdict: 'manual', confidence: 0.1 } }, sha256: sha256(Buffer.from('c')), image: Buffer.from('c'), ext: '.png' });
  // HTML 字符
  writeReady(ws, { item: { fields: { name: '<script>bad</script>', character: 'deepseek', categoryIds: ['meme'], tags: ['t'], commentary: 'c' } }, sha256: sha256(Buffer.from('d')), image: Buffer.from('d'), ext: '.png' });
  // 缺 tags
  writeReady(ws, { item: { fields: { name: 'x', character: 'deepseek', categoryIds: ['meme'], tags: [], commentary: 'c' } }, sha256: sha256(Buffer.from('e')), image: Buffer.from('e'), ext: '.png' });
  // 缺 commentary
  writeReady(ws, { item: { fields: { name: 'x', character: 'deepseek', categoryIds: ['meme'], tags: ['t'], commentary: '' } }, sha256: sha256(Buffer.from('f')), image: Buffer.from('f'), ext: '.png' });

  const cfg = configFor(ws);
  const { entries } = await readReadyEntries(cfg.intake);
  const plan = planBatch(cfg, entries, loadManifests(cfg.siteDataDir));
  assert.equal(plan.publishable.length, 0);
  assert.equal(plan.skipped.length, 6);
});

test('planBatch：中转区图片与记录的 sha256 不一致时拒绝', async (t) => {
  const ws = await makeWorkspace(t);
  const digest = sha256(Buffer.from('claimed'));
  // 记录写 claimed 的摘要，但 inbox 里放的是别的字节
  writeReady(ws, { sha256: digest, image: TINY_PNG, ext: '.png' });
  const cfg = configFor(ws);
  const { entries } = await readReadyEntries(cfg.intake);
  const plan = planBatch(cfg, entries, loadManifests(cfg.siteDataDir));
  assert.equal(plan.publishable.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].problems.join('；'), /sha256/);
});

test('planBatch：已在清单里的同图只算重复，不重写', async (t) => {
  const ws = await makeWorkspace(t, {
    works: [{ id: 'sticker_old', slug: 'deepseek202601010001', characterId: 'deepseek', categoryIds: ['meme'], sha256: sha256(TINY_PNG), status: 'published' }],
  });
  writeReady(ws);
  const cfg = configFor(ws);
  const { entries } = await readReadyEntries(cfg.intake);
  const plan = planBatch(cfg, entries, loadManifests(cfg.siteDataDir));
  assert.equal(plan.publishable.length, 0);
  assert.equal(plan.duplicates.length, 1);
});

test('planBatch：桥接写入的真实 ready 形状（content 六字段、无 ai 块、license 字符串）可发布', async (t) => {
  const ws = await makeWorkspace(t);
  // 与 tools/intake/core.mjs 的 stageReadyItem / server/bridge.mjs 完全一致的字段形状。
  writeReady(ws, {
    item: {
      fields: { name: '桥接形状', description: '说明', character: 'deepseek', tags: ['桥接'] },
      content: {
        name: '桥接形状',
        description: '说明',
        commentary: '这是看图写的第一人称评价。',
        characterId: 'deepseek',
        categoryIds: ['illustration'],
        tags: ['桥接'],
      },
      license: 'unknown',
      origin: { via: 'web', submissionId: 'sub_abc' },
      submissionId: 'sub_abc',
      contentSchema: 'submission-ai-content/1',
    },
  });
  const cfg = configFor(ws);
  const { entries } = await readReadyEntries(cfg.intake);
  const plan = planBatch(cfg, entries, loadManifests(cfg.siteDataDir));
  assert.equal(plan.publishable.length, 1, JSON.stringify(plan.skipped));
  assert.deepEqual(plan.publishable[0].record.categoryIds, ['illustration']);
  assert.equal(plan.publishable[0].record.license.type, 'unknown');
  assert.equal(plan.publishable[0].record.origin.type, 'unknown');
});

/* ================================================================ 发布锁 */

test('发布锁互斥：第二次获取失败', async (t) => {
  const ws = await makeWorkspace(t);
  const cfg = configFor(ws);
  const release = await acquirePublishLock(cfg.intake, { now: () => Date.now() });
  await assert.rejects(() => acquirePublishLock(cfg.intake, { now: () => Date.now() }));
  await release();
  const release2 = await acquirePublishLock(cfg.intake, { now: () => Date.now() });
  await release2();
});

/* ================================================================ dry-run */

test('默认 dry-run：不写工作树、不提交、不推送、不部署、不标记', async (t) => {
  const ws = await makeWorkspace(t);
  writeReady(ws);
  const worksBefore = fs.readFileSync(path.join(ws.site, 'data', 'works.json'), 'utf8');
  const cfg = configFor(ws); // 没有 AUTO_PUBLISH_ENABLED
  const exec = makeExec({});
  const logs = [];
  const summary = await runBatch(cfg, { exec, log: (message) => logs.push(message) });
  assert.equal(summary.status, 'dry-run');
  assert.equal(summary.dryRun, true);
  assert.equal(summary.publishable, 1);
  assert.equal(exec.calls.length, 0, 'dry-run 不应执行任何外部命令');
  assert.ok(logs.some((line) => line.includes('dry-run')), 'dry-run 应打印计划说明');
  assert.ok(logs.some((line) => line.includes(`sticker_${ws.digest.slice(0, 24)}`)), 'dry-run 应列出将生成的记录');
  assert.equal(fs.readFileSync(path.join(ws.site, 'data', 'works.json'), 'utf8'), worksBefore);
  const meta = JSON.parse(fs.readFileSync(path.join(ws.intake, 'meta', `${ws.digest}.json`), 'utf8'));
  assert.equal(meta.status, 'ready');
});

test('AUTO_PUBLISH_ENABLED=true 但没有 ready 条目时 no-op', async (t) => {
  const ws = await makeWorkspace(t);
  const cfg = configFor(ws, { AUTO_PUBLISH_ENABLED: 'true' });
  const exec = makeExec({});
  const summary = await runBatch(cfg, { exec, log: () => {} });
  assert.equal(summary.status, 'noop');
  assert.equal(exec.calls.filter((c) => c.cmd === 'git').length, 0);
});

/* ================================================================ 完整发布 */

test('完整发布：写图、改清单、显式提交、推送、部署、标记已发布', async (t) => {
  const ws = await makeWorkspace(t);
  writeReady(ws);
  const cfg = configFor(ws, {
    AUTO_PUBLISH_ENABLED: 'true',
    PUBLISH_PUSH_ENABLED: 'true',
    PUBLISH_DEPLOY_ENABLED: 'true',
  });
  const dirty = {
    [ws.site]: ['data/works.json'],
    [ws.content]: ['dist/submissions/originals/deepseek/aaaaaaaaaaaaaaaa.png', 'dist/submissions/previews/deepseek/aaaaaaaaaaaaaaaa.webp', 'dist/submissions/large/deepseek/aaaaaaaaaaaaaaaa.webp'],
  };
  const exec = makeExec({ dirtyFilesByDir: dirty, stagedByDir: dirty });
  const summary = await runBatch(cfg, { exec, log: () => {} });

  assert.equal(summary.status, 'published', summary.error || '');
  assert.deepEqual(summary.published, [ws.digest]);
  assert.equal(summary.pushed, true);
  assert.equal(summary.deployed, true);
  assert.equal(exec.state.pushes, 2, '站点仓与内容仓各推送一次');
  assert.equal(exec.state.deployRuns, 1);

  // 原图已复制进内容仓
  const originalRel = summary.records[0].originalRel;
  const copied = path.join(ws.content, ...originalRel.split('/'));
  assert.equal(fs.existsSync(copied), true);
  assert.deepEqual(fs.readFileSync(copied), ws.image);

  // 清单里出现新记录，且没有任何 git add -A / .
  const works = JSON.parse(fs.readFileSync(path.join(ws.site, 'data', 'works.json'), 'utf8'));
  assert.equal(works.length, 1);
  assert.equal(works[0].id, `sticker_${ws.digest.slice(0, 24)}`);
  assert.equal(works[0].sha256, ws.digest);
  const addCalls = exec.calls.filter((c) => c.cmd === 'git' && c.args.includes('add'));
  assert.ok(addCalls.length >= 1, '应有 git add 调用');
  for (const call of addCalls) {
    const files = call.args.slice(call.args.indexOf('--') + 1);
    assert.ok(!files.includes('-A') && !files.includes('.'), '不得使用 git add -A / .');
    assert.ok(files.length > 0);
  }

  // 中转条目已标记为 published，且保留（未删除）
  const meta = JSON.parse(fs.readFileSync(path.join(ws.intake, 'meta', `${ws.digest}.json`), 'utf8'));
  assert.equal(meta.status, 'published');
  assert.ok(meta.publishedAt);
  assert.ok(meta.batchId);
  assert.equal(fs.existsSync(path.join(ws.intake, 'inbox', `${ws.digest}.png`)), true, '原图字节应保留');
  assert.equal(summary.journalPath && fs.existsSync(summary.journalPath), true);
  const journal = JSON.parse(fs.readFileSync(summary.journalPath, 'utf8'));
  assert.equal(journal.status, 'succeeded');
});

test('只开 AUTO 时属于「暂存」：提交但不推送、不部署、不标记', async (t) => {
  const ws = await makeWorkspace(t);
  writeReady(ws);
  const cfg = configFor(ws, { AUTO_PUBLISH_ENABLED: 'true' });
  const dirty = {
    [ws.site]: ['data/works.json'],
    [ws.content]: ['dist/submissions/originals/deepseek/aaaaaaaaaaaaaaaa.png'],
  };
  const exec = makeExec({ dirtyFilesByDir: dirty, stagedByDir: dirty });
  const summary = await runBatch(cfg, { exec, log: () => {} });
  assert.equal(summary.status, 'staged');
  assert.equal(summary.pushed, false);
  assert.equal(summary.deployed, false);
  assert.deepEqual(summary.published, []);
  const meta = JSON.parse(fs.readFileSync(path.join(ws.intake, 'meta', `${ws.digest}.json`), 'utf8'));
  assert.equal(meta.status, 'ready', '未推送/部署时不得标记已发布');
});

/* ================================================================ 失败保留 */

test('工具链失败：保留 ready 并记录失败批次', async (t) => {
  const ws = await makeWorkspace(t);
  writeReady(ws);
  const cfg = configFor(ws, { AUTO_PUBLISH_ENABLED: 'true', PUBLISH_PUSH_ENABLED: 'true', PUBLISH_DEPLOY_ENABLED: 'true' });
  const exec = makeExec({ failPython: true });
  const summary = await runBatch(cfg, { exec, log: () => {} });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.pushed, false);
  assert.equal(summary.deployed, false);
  const meta = JSON.parse(fs.readFileSync(path.join(ws.intake, 'meta', `${ws.digest}.json`), 'utf8'));
  assert.equal(meta.status, 'ready');
  assert.ok(summary.journalPath && fs.existsSync(summary.journalPath));
  const journal = JSON.parse(fs.readFileSync(summary.journalPath, 'utf8'));
  assert.equal(journal.status, 'failed');
});

test('部署失败：工作树已提交但条目标记仍保留为 ready', async (t) => {
  const ws = await makeWorkspace(t);
  writeReady(ws);
  const cfg = configFor(ws, { AUTO_PUBLISH_ENABLED: 'true', PUBLISH_PUSH_ENABLED: 'true', PUBLISH_DEPLOY_ENABLED: 'true' });
  const dirty = {
    [ws.site]: ['data/works.json'],
    [ws.content]: ['dist/submissions/originals/deepseek/aaaaaaaaaaaaaaaa.png'],
  };
  const exec = makeExec({ dirtyFilesByDir: dirty, stagedByDir: dirty, failDeploy: true });
  const summary = await runBatch(cfg, { exec, log: () => {} });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.pushed, true);
  assert.equal(summary.deployed, false);
  const meta = JSON.parse(fs.readFileSync(path.join(ws.intake, 'meta', `${ws.digest}.json`), 'utf8'));
  assert.equal(meta.status, 'ready');
});

/* ================================================================ 恢复 */

test('上一批次遗留的工作树改动可被 reset 回收', async (t) => {
  const ws = await makeWorkspace(t);
  writeReady(ws);
  const dirty = {
    [ws.site]: ['data/works.json'],
    [ws.content]: ['dist/submissions/originals/deepseek/aaaaaaaaaaaaaaaa.png'],
  };
  const worksBaseline = fs.readFileSync(path.join(ws.site, 'data', 'works.json'), 'utf8');
  // 第一次：derivatives 失败，留下 journal
  const failExec = makeExec({ failPython: true });
  const cfg = configFor(ws, { AUTO_PUBLISH_ENABLED: 'true', PUBLISH_PUSH_ENABLED: 'true', PUBLISH_DEPLOY_ENABLED: 'true' });
  const first = await runBatch(cfg, { exec: failExec, log: () => {} });
  assert.equal(first.status, 'failed');

  // 第二次：工作树脏，但脏文件正是上次批次记录的文件 → 允许 reset 后继续
  const state = {
    preDirtyByDir: structuredClone(dirty),
    dirtyFilesByDir: dirty,
    stagedByDir: dirty,
    // reset --hard 会把受跟踪的 data/works.json 恢复到 origin 基线
    baseline: { [ws.site]: { 'data/works.json': worksBaseline } },
    tracked: { [ws.site]: new Set(['data/works.json']), [ws.content]: new Set() },
  };
  const exec = makeExec(state);
  const second = await runBatch(cfg, { exec, log: () => {} });
  assert.equal(second.status, 'published', second.error || '');
  assert.ok((state.resets || 0) >= 1, '应执行 git reset --hard 回收上次批次');
  const works = JSON.parse(fs.readFileSync(path.join(ws.site, 'data', 'works.json'), 'utf8'));
  assert.equal(works.length, 1, '回收后只应留下本次新记录');
  assert.equal(works[0].sha256, ws.digest);
});

test('计划外的工作树改动一律拒绝，不 reset', async (t) => {
  const ws = await makeWorkspace(t);
  writeReady(ws);
  const cfg = configFor(ws, { AUTO_PUBLISH_ENABLED: 'true', PUBLISH_PUSH_ENABLED: 'true', PUBLISH_DEPLOY_ENABLED: 'true' });
  const exec = makeExec({ preDirtyByDir: { [ws.site]: ['README.md'] } });
  const summary = await runBatch(cfg, { exec, log: () => {} });
  assert.equal(summary.status, 'failed');
  assert.match(summary.error, /工作树|计划外/);
  assert.equal((exec.state.gitCalls || []).some((c) => c.rest[0] === 'reset'), false);
});

/* ================================================================ 重复批次 */

test('全部条目都已发布时：只标记为已发布，no-op 且不提交', async (t) => {
  const ws = await makeWorkspace(t, {
    works: [{ id: 'sticker_old', slug: 'deepseek202601010001', characterId: 'deepseek', categoryIds: ['meme'], sha256: sha256(TINY_PNG), status: 'published' }],
  });
  writeReady(ws);
  const cfg = configFor(ws, { AUTO_PUBLISH_ENABLED: 'true', PUBLISH_PUSH_ENABLED: 'true', PUBLISH_DEPLOY_ENABLED: 'true' });
  const exec = makeExec({});
  const summary = await runBatch(cfg, { exec, log: () => {} });
  assert.equal(summary.status, 'noop');
  assert.equal(summary.duplicates.length, 1);
  const meta = JSON.parse(fs.readFileSync(path.join(ws.intake, 'meta', `${ws.digest}.json`), 'utf8'));
  assert.equal(meta.status, 'published');
  assert.equal(exec.calls.filter((c) => c.cmd === 'git' && c.args.includes('commit')).length, 0);
});
