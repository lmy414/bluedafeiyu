// server/cli.test.mjs —— CLI 入口的参数口径
//
// 重点性质：
//   1. help 必须列出 pull-issues 的 --state / --since / --max-pages，参数可发现；
//   2. --max-pages 非法时快速失败，不进入网络拉取；
//   3. help 不需要存储根也能跑（不误触发配置校验）。
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { resolveConfig } from './config.mjs';
import { createQueue } from './queue.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/** 取一个当前空闲端口（配置层不接受 0）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30 * 1000,
  });
}

test('help 列出 pull-issues 的 state / since / max-pages 参数', () => {
  const result = runCli(['help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--state/);
  assert.match(result.stdout, /--since/);
  assert.match(result.stdout, /--max-pages/);
});

test('help 只列出 Hermes 内部审核令牌变量', () => {
  const result = runCli(['help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SUBMISSION_HERMES_REVIEW_TOKEN/);
  assert.doesNotMatch(result.stdout, /SUBMISSION_ASTRABOT_REVIEW_TOKEN/);
});

test('pull-issues 缺少存储根时快速失败（不联网）', () => {
  const result = runCli(['pull-issues'], { SUBMISSION_STORAGE_ROOT: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SUBMISSION_STORAGE_ROOT/);
});

test('pull-issues --max-pages 非正整数时校验失败，不发网络请求', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'click-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const result = runCli(['pull-issues', '--max-pages', '0'], { SUBMISSION_STORAGE_ROOT: path.join(base, 'private') });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--max-pages/);
});

test('prune-originals 默认 dry-run 不写，--apply 释放到期原图且不动未到期', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cliprune-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const storageRoot = path.join(base, 'private');
  const now = Date.now();
  const oldTime = now - 15 * 24 * 60 * 60 * 1000;
  const cfg = resolveConfig({ storageRoot }, { env: {} });

  const oldQueue = await createQueue(cfg, { now: () => oldTime });
  const oldItem = (await oldQueue.enqueue({
    source: 'web',
    sourceId: 'web:prune-old',
    buffer: TINY_PNG,
    fields: { name: '旧图' },
  })).item;
  const oldFile = path.join(cfg.paths.objects, `${oldItem.sha256}${oldItem.ext}`);

  const freshQueue = await createQueue(cfg, { now: () => now });
  const freshItem = (await freshQueue.enqueue({
    source: 'web',
    sourceId: 'web:prune-fresh',
    buffer: Buffer.concat([TINY_PNG, Buffer.from([1])]),
    fields: { name: '新图' },
  })).item;
  const freshFile = path.join(cfg.paths.objects, `${freshItem.sha256}${freshItem.ext}`);

  const env = { SUBMISSION_STORAGE_ROOT: storageRoot };
  const dryRun = runCli(['prune-originals', '--days', '14', '--json'], env);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.deepEqual(JSON.parse(dryRun.stdout), [{ id: oldItem.id, createdAt: oldItem.createdAt, status: 'dry-run' }]);
  assert.equal((await oldQueue.get(oldItem.id)).original, undefined);
  assert.equal((await fs.stat(oldFile)).isFile(), true);

  const applied = runCli(['prune-originals', '--days', '14', '--apply', '--json'], env);
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(JSON.parse(applied.stdout), [{ id: oldItem.id, createdAt: oldItem.createdAt, status: 'released' }]);
  const released = await oldQueue.get(oldItem.id);
  assert.equal(released.original.released, true);
  assert.equal(released.original.reason, 'expired');
  assert.equal(released.sha256, oldItem.sha256);
  assert.equal(released.ext, oldItem.ext);
  await assert.rejects(fs.stat(oldFile), { code: 'ENOENT' });

  const fresh = await oldQueue.get(freshItem.id);
  assert.equal(fresh.original, undefined);
  assert.equal((await fs.stat(freshFile)).isFile(), true);
});

test('serve 启动时构造桥接并如实报告未配置（缺 INTAKE 即 skipped，不影响启动）', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cliserve-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const [publicPort, adminPort] = await Promise.all([freePort(), freePort()]);
  const child = spawn(process.execPath, [CLI, 'serve'], {
    env: {
      ...process.env,
      SUBMISSION_STORAGE_ROOT: path.join(base, 'private'),
      SUBMISSION_ADMIN_TOKEN: 'serve-token',
      SUBMISSION_PUBLIC_PORT: String(publicPort),
      SUBMISSION_ADMIN_PORT: String(adminPort),
      SUBMISSION_ALLOWED_ORIGINS: 'https://xn--pssy23gqgbz2d718b.com',
      INTAKE_ROOT: '',
      INTAKE_CONTENT_DIR: '',
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const deadline = Date.now() + 15000;
    while (!stdout.includes('自动桥接') && Date.now() < deadline && child.exitCode === null) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(stdout, /公开投稿入口/, `serve 未启动：stdout=${stdout} stderr=${stderr}`);
    assert.match(stdout, /自动桥接/, 'serve 应报告桥接状态（由 buildContext 创建 bridge）');
    assert.match(stdout, /未启用|skipped/, '缺 INTAKE 配置时应如实报告桥接未启用');
  } finally {
    await new Promise((resolve) => {
      if (child.exitCode !== null) { resolve(); return; }
      child.once('exit', resolve);
      child.kill();
    });
  }
});
