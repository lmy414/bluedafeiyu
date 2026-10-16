import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { recoverInterruptedPublishes } from '../admin/recover-interrupted-publish.mjs';
import { downloadOriginals } from '../admin/publish-worker.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-interrupted-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { INTAKE_ROOT: root, ADMIN_PUBLISH_REQUEST_DIR: path.join(root, 'run'), ADMIN_BOT_API_KEY: 'bot-secret', ADMIN_WORKER_TOKEN: 'worker-secret' };
  const posts = [];
  const run = { runId: 'run-interrupted', status: 'in_progress', startedAt: '2026-10-15T04:00:00Z' };
  const deps = {
    now: () => Date.parse('2026-10-16T01:00:00Z'), workerInactive: () => true, processAlive: () => false,
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') { posts.push({ url: String(url), ...options }); return Response.json({ ok: true }); }
      assert.equal(options.headers.Authorization, 'users API-Key bot-secret');
      return Response.json({ docs: [run], hasNextPage: false });
    },
  };
  return { root, env, deps, posts, run };
}

test('进程已退出且超过上限：回收批次，保留提交、taken 请求和待发布作品', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'batches'));
  fs.mkdirSync(f.env.ADMIN_PUBLISH_REQUEST_DIR);
  const taken = path.join(f.env.ADMIN_PUBLISH_REQUEST_DIR, 'publish.request.run-interrupted.taken');
  fs.writeFileSync(taken, JSON.stringify({ runId: f.run.runId }));
  const journalFile = path.join(f.root, 'batches', f.run.runId + '.json');
  fs.writeFileSync(journalFile, JSON.stringify({ runId: f.run.runId, commits: { site: 'saved-commit' }, files: { site: ['data/works.json'] } }));
  assert.deepEqual(await recoverInterruptedPublishes({ env: f.env, apply: true, deps: f.deps }), [f.run.runId]);
  assert.equal(f.posts.length, 1);
  const body = JSON.parse(f.posts[0].body);
  assert.deepEqual(Object.keys(body).sort(), ['error', 'log', 'status', 'step']);
  assert.equal(body.status, 'failed');
  assert.equal(body.step, 'interrupted');
  assert.equal(f.posts[0].headers.Authorization, 'Bearer worker-secret');
  const journal = JSON.parse(fs.readFileSync(journalFile));
  assert.equal(journal.commits.site, 'saved-commit');
  assert.deepEqual(journal.files.site, ['data/works.json']);
  assert.ok(fs.existsSync(taken));
  assert.ok(!fs.existsSync(path.join(f.root, 'logs', 'publish.lock')));
});

for (const reason of ['service-running', 'owner-running', 'new-request', 'young-run', 'service-started-after-lock', 'plan-only']) {
  test(`不回收有效发布：${reason}`, async t => {
    const f = fixture(t);
    if (reason === 'service-running') f.deps.workerInactive = () => false;
    if (reason === 'owner-running') {
      fs.mkdirSync(path.join(f.root, 'logs'));
      fs.writeFileSync(path.join(f.root, 'logs', 'publish.lock'), JSON.stringify({ pid: 123 }));
      f.deps.processAlive = () => true;
    }
    if (reason === 'new-request') {
      fs.mkdirSync(f.env.ADMIN_PUBLISH_REQUEST_DIR);
      fs.writeFileSync(path.join(f.env.ADMIN_PUBLISH_REQUEST_DIR, 'publish.request'), '{}');
    }
    if (reason === 'young-run') f.run.startedAt = '2026-10-16T00:30:00Z';
    if (reason === 'service-started-after-lock') {
      let checks = 0;
      f.deps.workerInactive = () => ++checks === 1;
    }
    await recoverInterruptedPublishes({ env: f.env, apply: reason !== 'plan-only', deps: f.deps });
    assert.equal(f.posts.length, 0);
  });
}

test('中断重试：原图在 Git 提交中但不在稀疏工作树时，按 SHA-256 恢复', async t => {
  const f = fixture(t);
  const bytes = Buffer.from([0, 255, 12, 90, 128]);
  const rel = 'dist/submissions/originals/deepseek/retry.png';
  const file = path.join(f.root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  for (const args of [['init'], ['add', '--', rel], ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'original']]) {
    const result = spawnSync('git', args, { cwd: f.root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  fs.unlinkSync(file);
  const item = { targetPath: rel, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), submissionId: 'sub_retry' };
  const cfg = { contentDir: f.root };
  const fetchImpl = () => { throw new Error('已释放的临时原图不应再请求'); };
  await downloadOriginals(cfg, { originals: [item] }, { fetchImpl });
  assert.deepEqual(fs.readFileSync(file), bytes);
  fs.unlinkSync(file);
  await assert.rejects(downloadOriginals(cfg, { originals: [{ ...item, sha256: '0'.repeat(64) }] }, { fetchImpl }), /sha256/);
  assert.ok(!fs.existsSync(file));
});

test('后台状态回写失败时停止恢复并释放发布锁', async t => {
  const f = fixture(t);
  const fetchImpl = f.deps.fetchImpl;
  f.deps.fetchImpl = (url, options) => options.method === 'POST' ? Response.json({ error: 'offline' }, { status: 503 }) : fetchImpl(url, options);
  await assert.rejects(recoverInterruptedPublishes({ env: f.env, apply: true, deps: f.deps }), /HTTP 503/);
  assert.ok(!fs.existsSync(path.join(f.root, 'logs', 'publish.lock')));
});
