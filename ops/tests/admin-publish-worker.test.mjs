#!/usr/bin/env node
/* ops/tests/admin-publish-worker.test.mjs —— 后台发布执行器的离线回归测试。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { SNAPSHOT_SITE_FILES, main, releasePublishedOriginals, resolveWorkerConfig } from '../admin/publish-worker.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${result.stderr || result.stdout}`);
  return result.stdout || '';
}

function makeGitRepo(root, name, files) {
  const bare = path.join(root, `${name}.git`);
  const work = path.join(root, name);
  runGit(root, ['init', '--bare', '--initial-branch=main', bare]);
  runGit(root, ['init', '--initial-branch=main', work]);
  runGit(work, ['config', 'user.name', 'test']);
  runGit(work, ['config', 'user.email', 'test@example.invalid']);
  runGit(work, ['config', 'core.autocrlf', 'false']);
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(work, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
  }
  runGit(work, ['add', '--', ...Object.keys(files)]);
  runGit(work, ['commit', '-m', 'initial']);
  runGit(work, ['remote', 'add', 'origin', bare]);
  runGit(work, ['push', '-u', 'origin', 'main']);
  runGit(bare, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { bare, work };
}

function baselineRecord(overrides = {}) {
  return {
    id: 'sticker_aaaaaaaaaaaaaaaaaaaaaaaa',
    slug: 'existing-work',
    name: '已有作品',
    characterId: 'deepseek',
    categoryIds: ['meme'],
    tags: ['测试'],
    path: '/submissions/originals/deepseek/existing.png',
    thumbnailPath: '/submissions/previews/existing.webp',
    fullPath: '/submissions/large/existing.webp',
    width: 1,
    height: 1,
    fileSize: 1,
    format: 'webp',
    mimeType: 'image/webp',
    status: 'published',
    ...overrides,
  };
}

async function makeWorkspace(t, { works = [], contentFiles = {} } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'admin-publish-worker-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const siteFiles = {
    'data/works.json': `${JSON.stringify(works, null, 2)}\n`,
    'data/owner-picks.json': '[]\n',
    'data/characters.json': `${JSON.stringify([{ id: 'deepseek', name: 'DeepSeek娘', status: 'active', inSubmissionForm: true }], null, 2)}\n`,
    'data/categories.json': `${JSON.stringify([{ id: 'meme', name: '梗图', status: 'active' }], null, 2)}\n`,
    'data/topics.json': '[]\n',
    'data/blue-fish-editorial.json': '[]\n',
    'data/blue-fish-ids.json': '[]\n',
  };
  const contentBase = {
    'dist/submissions/originals/.keep': 'keep\n',
    'dist/submissions/previews/.keep': 'keep\n',
    'dist/submissions/large/.keep': 'keep\n',
    ...contentFiles,
  };
  const site = makeGitRepo(root, 'site', siteFiles);
  const content = makeGitRepo(root, 'content', contentBase);
  const intake = path.join(root, 'intake');
  const requestDir = path.join(root, 'run');
  const deployRoot = path.join(root, 'deploy');
  for (const dir of ['meta', 'inbox', 'logs', 'batches', 'work']) fs.mkdirSync(path.join(intake, dir), { recursive: true });
  for (const dir of [requestDir, deployRoot, path.join(deployRoot, 'releases')]) fs.mkdirSync(dir, { recursive: true });
  return { root, site: site.work, siteBare: site.bare, content: content.work, contentBare: content.bare, intake, requestDir, deployRoot, works };
}

function snapshotFrom(ws, runId, overrides = {}) {
  const files = {};
  for (const rel of SNAPSHOT_SITE_FILES) files[rel] = fs.readFileSync(path.join(ws.site, ...rel.split('/')), 'utf8');
  return {
    runId,
    files,
    originals: [],
    deletions: [],
    summary: { added: 0, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
    ...overrides,
    files: { ...files, ...(overrides.files || {}) },
  };
}

function writeRequest(ws, runId) {
  writeJson(path.join(ws.requestDir, 'publish.request'), {
    runId,
    requestedAt: '2026-09-29T00:00:00.000Z',
    actor: 'test',
  });
}

function ok(stdout = '') { return { status: 0, stdout, stderr: '' }; }
function fail(stderr = 'failed', status = 1) { return { status, stdout: '', stderr }; }

function makeFakeExec(state = {}) {
  const calls = [];
  const exec = (cmd, args = [], options = {}) => {
    calls.push({ cmd, args: [...args], cwd: options.cwd });
    if (cmd === 'git') {
      const result = spawnSync('git', args, {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env || process.env,
        maxBuffer: 64 * 1024 * 1024,
      });
      return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
    }
    if (cmd === 'node' && args[0] === 'tools/prepare_works.mjs') {
      const file = path.join(options.cwd, 'data', 'works.json');
      const records = readJson(file);
      for (const record of records) if (!record.slug) record.slug = `test-${record.id}`;
      writeJson(file, records);
      return ok();
    }
    if (cmd === 'node' && args[0] === 'tools/sync_issue_template.mjs') return ok();
    if (cmd === 'node' && args[0] === 'tools/build_site.mjs') {
      if (state.failBuild) return fail('build failed');
      const outIndex = args.indexOf('--out');
      if (outIndex >= 0) fs.mkdirSync(args[outIndex + 1], { recursive: true });
      if (state.extraDirty) fs.writeFileSync(path.join(options.cwd, 'README.md'), 'outside allowlist\n', 'utf8');
      return ok();
    }
    if (cmd === 'node' && String(args[0]).endsWith('issue-reconcile.mjs')) return ok();
    if ((cmd === 'python' || cmd === 'python3') && args.includes('-c')) return ok();
    if ((cmd === 'python' || cmd === 'python3') && args[0] === 'tools/generate_image_derivatives.py') {
      for (const name of ['works.json', 'owner-picks.json']) {
        const file = path.join(options.cwd, 'data', name);
        const records = readJson(file);
        let changed = false;
        for (const record of records) {
          if (!record.slug) { record.slug = `test-${record.id}`; changed = true; }
          if (!record.thumbnailPath) {
            record.thumbnailPath = `/submissions/previews/${record.id}.webp`;
            record.fullPath = `/submissions/large/${record.id}.webp`;
            record.width = 1;
            record.height = 1;
            record.fileSize = TINY_PNG.length;
            record.format = 'webp';
            record.mimeType = 'image/webp';
            changed = true;
            const preview = path.join(options.cwd, '..', 'content', 'dist', 'submissions', 'previews', `${record.id}.webp`);
            const large = path.join(options.cwd, '..', 'content', 'dist', 'submissions', 'large', `${record.id}.webp`);
            fs.mkdirSync(path.dirname(preview), { recursive: true });
            fs.writeFileSync(preview, TINY_PNG);
            fs.writeFileSync(large, TINY_PNG);
          }
        }
        if (changed) writeJson(file, records);
      }
      return ok();
    }
    if (cmd === 'bash' || cmd === 'sh') {
      state.deployRuns = (state.deployRuns || 0) + 1;
      if (state.failDeploy) return fail('deploy failed');
      return ok();
    }
    return ok();
  };
  exec.calls = calls;
  exec.state = state;
  return exec;
}

async function startBackend(t, state) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/cms-api/publish/snapshot') {
      state.snapshotCalls = (state.snapshotCalls || 0) + 1;
      if (state.snapshotError) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: state.snapshotError })); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(state.snapshot)); return;
    }
    if (req.method === 'POST' && /^\/cms-api\/publish\/runs\/[^/]+\/status$/.test(url.pathname)) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      state.statuses.push(raw ? JSON.parse(raw) : null);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function startSubmissionService(t, state) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && /^\/api\/v1\/items\/sub_[A-Za-z0-9_]+\/release-original$/.test(url.pathname)) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      state.releaseCalls = state.releaseCalls || [];
      state.releaseCalls.push({ path: url.pathname, auth: req.headers.authorization || '', body: raw ? JSON.parse(raw) : null });
      const status = state.releaseStatus || 200;
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(status < 400 ? { ok: true, released: true } : { error: 'release failed' })); return;
    }
    if (req.method !== 'GET' || !/^\/api\/v1\/items\/sub_[A-Za-z0-9_]+\/raw$/.test(url.pathname)) {
      res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return;
    }
    state.submissionCalls = (state.submissionCalls || 0) + 1;
    state.submissionPaths = state.submissionPaths || [];
    state.submissionPaths.push(url.pathname);
    state.submissionAuth = req.headers.authorization || '';
    res.writeHead(200, { 'content-type': state.submissionMime || 'image/png' }); res.end(state.submissionBody || TINY_PNG);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, state };
}

function envFor(ws, backend, extra = {}) {
  return {
    INTAKE_ROOT: ws.intake,
    PUBLISH_SITE_DIR: ws.site,
    PUBLISH_CONTENT_DIR: ws.content,
    PUBLISH_PYTHON: 'python3',
    PUBLISH_NODE: 'node',
    PUBLISH_BUILD_CHECK: 'true',
    PUBLISH_DEPLOY_CMD: 'fake deploy',
    PUBLISH_DEPLOY_ROOT: ws.deployRoot,
    PUBLISH_GIT_NAME: 'test-bot',
    PUBLISH_GIT_EMAIL: 'test-bot@example.invalid',
    ADMIN_API_URL: backend.url,
    ADMIN_WORKER_TOKEN: 'worker-token',
    ADMIN_PUBLISH_REQUEST_DIR: ws.requestDir,
    SUBMISSION_ADMIN_API_URL: extra.submissionServiceUrl || 'http://127.0.0.1:1',
    SUBMISSION_ADMIN_TOKEN: 'submission-token',
    PUBLISH_ORIGINAL_BASE_URL: 'https://raw.test',
    ...extra,
  };
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
function makePublishFetch(state) {
  return async (input, options = {}) => {
    const url = String(input);
    if (url === 'https://raw.test' || url.startsWith('https://raw.test/')) {
      state.rawHeadCalls = state.rawHeadCalls || [];
      state.rawHeadCalls.push({ method: options.method || 'GET', url });
      return new Response('', { status: state.rawStatus || 404 });
    }
    return globalThis.fetch(input, options);
  };
}

async function runOriginalPublish(t, { runId, submissionId, workId, rawStatus = 404, releaseStatus = 200, healthUrl = 'https://health.test/', notifier }) {
  const record = {
    id: workId,
    name: '原图发布测试',
    characterId: 'deepseek',
    categoryIds: ['meme'],
    tags: ['测试'],
    status: 'published',
  };
  const ws = await makeWorkspace(t);
  const digest = sha256(TINY_PNG);
  const targetPath = `dist/submissions/originals/deepseek/${digest.slice(0, 16)}.png`;
  const snapshot = snapshotFrom(ws, runId, {
    files: { 'data/works.json': `${JSON.stringify([record], null, 2)}\n` },
    originals: [{ workId: record.id, sha256: digest, characterId: 'deepseek', ext: 'png', targetPath, submissionId }],
    summary: { added: 1, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
  });
  const state = { statuses: [], snapshot, submissionBody: TINY_PNG, rawStatus, releaseStatus };
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);
  const result = await capture(() => main(['--run', runId], {
    env: envFor(ws, backend, { submissionServiceUrl: submission.url, HEALTH_URL: healthUrl }),
    exec,
    fetchImpl: makePublishFetch(state),
    notifier,
    runIssueReconcile: () => {},
  }));
  return { result, state, targetPath, ws, exec };
}

test('发布成功后通知飞书', async (t) => {
  const published = [];
  const fixture = await runOriginalPublish(t, {
    runId: 'run-notify-ok',
    submissionId: 'sub_notify_ok',
    workId: 'sticker_eeeeeeeeeeeeeeeeeeeeeeee',
    rawStatus: 200,
    notifier: { published: async (payload) => { published.push(payload); throw new Error('notify down'); } },
  });
  assert.equal(fixture.result.code, 0, fixture.result.err);
  assert.ok(fixture.exec.calls.some(({ cmd, args }) => cmd === 'git' && args.includes('add') && args.includes('--sparse') && args.at(-1) === fixture.targetPath));
  assert.match(fixture.result.err, /发布结果通知失败.*notify down/);
  assert.deepEqual(published, [{
    ok: true,
    runId: 'run-notify-ok',
    summary: { added: 1, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
    siteUrl: 'https://health.test/',
  }]);
});

test('推送成功后 HEAD 校验 Raw，再通知投稿服务释放原图', async (t) => {
  const fixture = await runOriginalPublish(t, { runId: 'run-release-ok', submissionId: 'sub_release_ok', workId: 'sticker_ffffffffffffffffffffffff', rawStatus: 200 });
  assert.equal(fixture.result.code, 0, fixture.result.err);
  assert.equal(JSON.parse(fixture.result.out).status, 'succeeded');
  assert.deepEqual(fixture.state.rawHeadCalls, [{ method: 'HEAD', url: `https://raw.test/${fixture.targetPath}` }]);
  assert.equal(fixture.state.releaseCalls.length, 1);
  assert.equal(fixture.state.releaseCalls[0].path, '/api/v1/items/sub_release_ok/release-original');
  assert.equal(fixture.state.releaseCalls[0].auth, 'Bearer submission-token');
  assert.deepEqual(fixture.state.releaseCalls[0].body, { reason: 'published', rawUrl: `https://raw.test/${fixture.targetPath}` });
});

test('Raw 不可访问时只记录警告，不调用释放接口', async (t) => {
  const fixture = await runOriginalPublish(t, { runId: 'run-release-raw-missing', submissionId: 'sub_release_raw_missing', workId: 'sticker_aaaaaaaaaaaaaaaaaaaaaaab' });
  assert.equal(fixture.result.code, 0, fixture.result.err);
  assert.equal(JSON.parse(fixture.result.out).status, 'succeeded');
  assert.equal(fixture.state.releaseCalls, undefined);
  assert.match(fixture.result.err, /原图 Raw 不可访问/);
});

test('释放失败不影响发布成功结果', async (t) => {
  const fixture = await runOriginalPublish(t, { runId: 'run-release-fail', submissionId: 'sub_release_fail', workId: 'sticker_aaaaaaaaaaaaaaaaaaaaaaac', rawStatus: 200, releaseStatus: 500 });
  assert.equal(fixture.result.code, 0, fixture.result.err);
  assert.equal(JSON.parse(fixture.result.out).status, 'succeeded');
  assert.equal(fixture.state.releaseCalls.length, 1);
  assert.match(fixture.result.err, /通知投稿服务释放原图失败/);
});

test('未配置 PUBLISH_ORIGINAL_BASE_URL 时使用 GitHub 默认基址', async (t) => {
  const ws = await makeWorkspace(t);
  const env = envFor(ws, { url: 'http://127.0.0.1:1' });
  delete env.PUBLISH_ORIGINAL_BASE_URL;
  const cfg = resolveWorkerConfig(env);
  assert.equal(cfg.originalBaseUrl, 'https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main');

  const calls = [];
  await releasePublishedOriginals(cfg, {
    originals: [{ submissionId: 'sub_default_base', targetPath: 'dist/submissions/originals/deepseek/default.png' }],
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ method: options.method, url: String(url) });
      return new Response('', { status: 404 });
    },
    log: () => {},
  });

  assert.equal(calls[0].method, 'HEAD');
  assert.equal(calls[0].url, 'https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/dist/submissions/originals/deepseek/default.png');
  assert.doesNotMatch(calls[0].url, /undefined/);
});

test('无变更 noop：跳过提交、推送和部署，状态上报 succeeded', async (t) => {
  const runId = 'run-noop';
  const ws = await makeWorkspace(t, { works: [baselineRecord()] });
  const state = { statuses: [], snapshot: null };
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  state.snapshot = snapshotFrom(ws, runId);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);

  const result = await capture(() => main(['--run', runId], {
    env: envFor(ws, backend, { submissionServiceUrl: submission.url }),
    exec,
    fetchImpl: makePublishFetch(state), runIssueReconcile: () => {},
  }));
  assert.equal(result.code, 0, result.err);
  const output = JSON.parse(result.out);
  assert.equal(output.status, 'succeeded');
  assert.deepEqual(output.commits, { site: null, content: null });
  assert.equal(state.deployRuns || 0, 0);
  assert.equal(state.statuses.at(-1).status, 'succeeded');
  assert.match(state.statuses.at(-1).log, /无变更/);
});

test('新增一张图：下载、派生、构建校验、提交白名单、推送和部署成功', async (t) => {
  const runId = 'run-add';
  const record = {
    id: 'sticker_bbbbbbbbbbbbbbbbbbbbbbbb',
    name: '新作品',
    characterId: 'deepseek',
    categoryIds: ['meme'],
    tags: ['测试'],
    status: 'published',
  };
  const ws = await makeWorkspace(t);
  const digest = sha256(TINY_PNG);
  const targetPath = `dist/submissions/originals/deepseek/${digest.slice(0, 16)}.png`;
  const snapshot = snapshotFrom(ws, runId, {
    files: { 'data/works.json': `${JSON.stringify([record], null, 2)}\n` },
    originals: [{ workId: record.id, sha256: digest, characterId: 'deepseek', ext: 'png', targetPath, submissionId: 'sub_one' }],
    summary: { added: 1, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
  });
  const state = { statuses: [], snapshot, submissionBody: TINY_PNG };
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);

  const result = await capture(() => main(['--run', runId], {
    env: envFor(ws, backend, { submissionServiceUrl: submission.url }),
    exec,
    fetchImpl: makePublishFetch(state), runIssueReconcile: () => {},
  }));
  assert.equal(result.code, 0, result.err);
  const output = JSON.parse(result.out);
  assert.equal(output.status, 'succeeded');
  assert.equal(output.summary.added, 1);
  assert.ok(output.commits.site);
  assert.ok(output.commits.content);
  assert.equal(state.deployRuns, 1);
  assert.equal(state.submissionCalls, 1);
  assert.deepEqual(state.submissionPaths, ['/api/v1/items/sub_one/raw']);
  assert.equal(state.submissionAuth, 'Bearer submission-token');

  const works = readJson(path.join(ws.site, 'data', 'works.json'));
  assert.equal(works[0].slug, `test-${record.id}`);
  assert.equal(works[0].thumbnailPath, `/submissions/previews/${record.id}.webp`);
  assert.ok(fs.existsSync(path.join(ws.content, ...targetPath.split('/'))));
  assert.ok(fs.existsSync(path.join(ws.content, 'dist', 'submissions', 'previews', `${record.id}.webp`)));
  assert.ok(fs.existsSync(path.join(ws.content, 'dist', 'submissions', 'large', `${record.id}.webp`)));

  const lastStatus = state.statuses.at(-1);
  assert.equal(lastStatus.status, 'succeeded');
  assert.equal(lastStatus.results.works[0].workId, record.id);
  assert.equal(lastStatus.results.works[0].slug, `test-${record.id}`);
  assert.equal(lastStatus.results.works[0].fileSize, TINY_PNG.length);
  assert.match(runGit(ws.site, ['log', '-1', '--pretty=%s']), /后台发布 run-add/);
  assert.match(runGit(ws.content, ['log', '-1', '--pretty=%s']), /新增 1/);
});

test('内容仓已有哈希一致的原图：跳过投稿服务下载', async (t) => {
  const runId = 'run-skip-existing';
  const record = {
    id: 'sticker_eeeeeeeeeeeeeeeeeeeeeeee',
    name: '跳过下载作品',
    characterId: 'deepseek',
    categoryIds: ['meme'],
    tags: ['测试'],
    status: 'published',
  };
  const digest = sha256(TINY_PNG);
  const targetPath = `dist/submissions/originals/deepseek/${digest.slice(0, 16)}.png`;
  const ws = await makeWorkspace(t, { contentFiles: { [targetPath]: TINY_PNG } });
  const snapshot = snapshotFrom(ws, runId, {
    files: { 'data/works.json': `${JSON.stringify([record], null, 2)}\n` },
    originals: [{ workId: record.id, sha256: digest, characterId: 'deepseek', ext: 'png', targetPath, submissionId: 'sub_skip' }],
    summary: { added: 1, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
  });
  const state = { statuses: [], snapshot };
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);

  const result = await capture(() => main(['--run', runId], {
    env: envFor(ws, backend, { submissionServiceUrl: submission.url }),
    exec,
    fetchImpl: makePublishFetch(state), runIssueReconcile: () => {},
  }));
  assert.equal(result.code, 0, result.err);
  assert.equal(JSON.parse(result.out).status, 'succeeded');
  assert.equal(state.submissionCalls || 0, 0);
  assert.ok(fs.existsSync(path.join(ws.content, ...targetPath.split('/'))));
});

test('删除路径：只删除允许前缀下的内容文件并提交', async (t) => {
  const runId = 'run-delete';
  const rel = 'dist/submissions/originals/deepseek/old.png';
  const ws = await makeWorkspace(t, { contentFiles: { [rel]: 'old image\n' } });
  const snapshot = snapshotFrom(ws, runId, {
    deletions: [{ workId: 'old', kind: 'submission', contentPaths: [rel] }],
    summary: { added: 0, updated: 0, hidden: 0, restored: 0, deleted: 1, topics: 0 },
  });
  const state = { statuses: [], snapshot };
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);

  const result = await capture(() => main(['--run', runId], {
    env: envFor(ws, backend, { submissionServiceUrl: submission.url }),
    exec,
    fetchImpl: makePublishFetch(state), runIssueReconcile: () => {},
  }));
  assert.equal(result.code, 0, result.err);
  assert.equal(JSON.parse(result.out).status, 'succeeded');
  assert.equal(fs.existsSync(path.join(ws.content, ...rel.split('/'))), false);
  assert.match(runGit(ws.content, ['log', '-1', '--pretty=%s']), /删除 1/);
  assert.equal(state.statuses.at(-1).status, 'succeeded');
});

test('稀疏检出下：缺失但已跟踪的删除进入提交并在推送后 reapply', async (t) => {
  const runId = 'run-delete-sparse';
  const rel = 'dist/submissions/originals/deepseek/old.png';
  const ws = await makeWorkspace(t, { contentFiles: { [rel]: 'old image\n' } });
  runGit(ws.content, ['sparse-checkout', 'init', '--no-cone']);
  runGit(ws.content, ['sparse-checkout', 'set', '--no-cone', '/*', '!/dist/submissions/originals/']);
  assert.equal(runGit(ws.content, ['status', '--porcelain']).trim(), '');
  assert.equal(runGit(ws.content, ['ls-files', '--error-unmatch', '--', rel]).trim(), rel);
  assert.equal(fs.existsSync(path.join(ws.content, ...rel.split('/'))), false);
  const snapshot = snapshotFrom(ws, runId, {
    deletions: [{ workId: 'old', kind: 'submission', contentPaths: [rel] }],
    summary: { added: 0, updated: 0, hidden: 0, restored: 0, deleted: 1, topics: 0 },
  });
  const state = { statuses: [], snapshot };
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);

  const result = await capture(() => main(['--run', runId], {
    env: envFor(ws, backend, { submissionServiceUrl: submission.url }),
    exec,
    fetchImpl: makePublishFetch(state), runIssueReconcile: () => {},
  }));
  assert.equal(result.code, 0, result.err);
  assert.equal(JSON.parse(result.out).status, 'succeeded');
  assert.ok(exec.calls.some(({ cmd, args }) => cmd === 'git' && args.includes('rm') && args.includes('--cached') && args.includes('--sparse') && args.includes('--ignore-unmatch') && args.at(-1) === rel));
  assert.ok(exec.calls.some(({ cmd, args }) => cmd === 'git' && args.includes('sparse-checkout') && args.includes('reapply')));
  assert.equal(runGit(ws.content, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').includes(rel), false);
  assert.equal(runGit(ws.content, ['status', '--porcelain']).trim(), '');
  assert.equal(state.statuses.at(-1).status, 'succeeded');
});

test('sha256 不匹配：下载阶段失败并写失败状态和 journal', async (t) => {
  const runId = 'run-bad-sha';
  const ws = await makeWorkspace(t);
  const targetPath = 'dist/submissions/originals/deepseek/bad.png';
  const snapshot = snapshotFrom(ws, runId, {
    originals: [{ workId: 'bad', sha256: 'c'.repeat(64), characterId: 'deepseek', ext: 'png', targetPath, submissionId: 'sub_bad' }],
    summary: { added: 1, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
  });
  const state = { statuses: [], snapshot, submissionBody: TINY_PNG };
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);

  const result = await capture(() => main(['--run', runId], {
    env: envFor(ws, backend, { submissionServiceUrl: submission.url }),
    exec,
    fetchImpl: makePublishFetch(state), runIssueReconcile: () => {},
  }));
  assert.equal(result.code, 1);
  const output = JSON.parse(result.out);
  assert.equal(output.status, 'failed');
  assert.match(output.error, /sha256 不匹配/);
  assert.equal(state.statuses.at(-1).status, 'failed');
  assert.equal(state.statuses.at(-1).step, 'download');
  assert.ok(fs.existsSync(path.join(ws.intake, 'batches', `${runId}.json`)));
});

test('白名单外改动：发现阶段失败，不提交、不覆盖脏文件', async (t) => {
  const runId = 'run-dirty';
  const record = {
    id: 'sticker_cccccccccccccccccccccccc',
    name: '新作品',
    characterId: 'deepseek',
    categoryIds: ['meme'],
    tags: ['测试'],
    status: 'published',
  };
  const ws = await makeWorkspace(t);
  const digest = sha256(TINY_PNG);
  const snapshot = snapshotFrom(ws, runId, {
    files: { 'data/works.json': `${JSON.stringify([record], null, 2)}\n` },
    originals: [{ workId: record.id, sha256: digest, characterId: 'deepseek', ext: 'png', targetPath: 'dist/submissions/originals/deepseek/dirty.png', submissionId: 'sub_dirty' }],
    summary: { added: 1, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
  });
  const state = { statuses: [], snapshot, submissionBody: TINY_PNG, extraDirty: true };
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);

  const result = await capture(() => main(['--run', runId], {
    env: envFor(ws, backend, { submissionServiceUrl: submission.url }),
    exec,
    fetchImpl: makePublishFetch(state), runIssueReconcile: () => {},
  }));
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.out).status, 'failed');
  assert.equal(state.statuses.at(-1).step, 'discover');
  assert.match(runGit(ws.site, ['status', '--porcelain']), /\?\? README\.md/);
  assert.equal(runGit(ws.site, ['rev-list', '--count', 'HEAD']).trim(), '1');
});

test('部署失败：状态上报 failed，不标记中转条目', async (t) => {
  const runId = 'run-deploy-fail';
  const record = {
    id: 'sticker_dddddddddddddddddddddddd',
    name: '部署失败作品',
    characterId: 'deepseek',
    categoryIds: ['meme'],
    tags: ['测试'],
    status: 'published',
  };
  const ws = await makeWorkspace(t);
  const digest = sha256(TINY_PNG);
  const snapshot = snapshotFrom(ws, runId, {
    files: { 'data/works.json': `${JSON.stringify([record], null, 2)}\n` },
    originals: [{ workId: record.id, sha256: digest, characterId: 'deepseek', ext: 'png', targetPath: 'dist/submissions/originals/deepseek/deploy.png', submissionId: 'sub_deploy' }],
    summary: { added: 1, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
  });
  writeJson(path.join(ws.intake, 'meta', `${digest}.json`), { sha256: digest, status: 'ready' });
  const state = { statuses: [], snapshot, submissionBody: TINY_PNG, failDeploy: true };
  const published = [];
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);

  const result = await capture(() => main(['--run', runId], {
    env: envFor(ws, backend, { submissionServiceUrl: submission.url, HEALTH_URL: 'https://health.test/' }),
    exec,
    fetchImpl: makePublishFetch(state),
    notifier: { published: async (payload) => published.push(payload) },
    runIssueReconcile: () => {},
  }));
  assert.equal(result.code, 1);
  const output = JSON.parse(result.out);
  assert.equal(output.status, 'failed');
  assert.equal(state.statuses.at(-1).step, 'deploy');
  assert.ok(output.commits.site);
  assert.deepEqual(published, [{
    ok: false,
    runId: 'run-deploy-fail',
    summary: { added: 1, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
    siteUrl: 'https://health.test/',
    error: 'bash -lc fake deploy 退出码 1：deploy failed',
  }]);
  assert.equal(readJson(path.join(ws.intake, 'meta', `${digest}.json`)).status, 'ready');
  assert.equal(readJson(path.join(ws.intake, 'batches', `${runId}.json`)).status, 'failed');
});

test('重复触发：publish.request 已改名时第二次只跳过，不再请求快照', async (t) => {
  const runId = 'run-once';
  const ws = await makeWorkspace(t, { works: [baselineRecord()] });
  const state = { statuses: [], snapshot: null };
  const backend = await startBackend(t, state);
  const submission = await startSubmissionService(t, state);
  state.snapshot = snapshotFrom(ws, runId);
  const exec = makeFakeExec(state);
  writeRequest(ws, runId);

  const first = await capture(() => main(['--run', runId], { env: envFor(ws, backend, { submissionServiceUrl: submission.url }), exec, fetchImpl: makePublishFetch(state), runIssueReconcile: () => {} }));
  assert.equal(first.code, 0, first.err);
  const second = await capture(() => main(['--run', runId], { env: envFor(ws, backend, { submissionServiceUrl: submission.url }), exec, fetchImpl: makePublishFetch(state), runIssueReconcile: () => {} }));
  assert.equal(second.code, 0);
  assert.equal(JSON.parse(second.out).status, 'skipped');
  assert.equal(state.snapshotCalls, 1);
  assert.equal(state.statuses.length, 2);
});
