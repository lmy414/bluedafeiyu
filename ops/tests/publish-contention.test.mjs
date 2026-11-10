import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acquirePublishLock } from '../publish-batch.mjs';
import { enqueuePublishRequest } from '../../admin/src/lib/publish-request.mjs';
import { main, waitForPublishLock } from '../admin/publish-worker.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-contention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logDir = path.join(root, 'logs');
  fs.mkdirSync(logDir);
  return { root, logDir, file: path.join(logDir, 'publish.lock') };
}

test('old live legacy lock is never evicted by age', async t => {
  const f = fixture(t);
  const original = JSON.stringify({ pid: process.pid, at: 1 });
  fs.writeFileSync(f.file, original);
  fs.utimesSync(f.file, new Date(0), new Date(0));
  await assert.rejects(acquirePublishLock(f, { staleMs: 1 }), { code: 'PUBLISH_LOCK_BUSY' });
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
});

test('dead or malformed stale lock is preserved for reviewed recovery', async t => {
  const f = fixture(t);
  for (const original of ['{', JSON.stringify({ pid: 2147483647, at: 1 })]) {
    fs.writeFileSync(f.file, original);
    fs.utimesSync(f.file, new Date(0), new Date(0));
    await assert.rejects(acquirePublishLock(f, { staleMs: 1 }), { code: 'PUBLISH_LOCK_BUSY' });
    assert.equal(fs.readFileSync(f.file, 'utf8'), original);
  }
});

test('release refuses externally replaced lock and cannot release twice', async t => {
  const f = fixture(t);
  const release = await acquirePublishLock(f);
  const owned = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  assert.equal(typeof owned.token, 'string');
  fs.rmSync(f.file);
  fs.writeFileSync(f.file, JSON.stringify({ ...owned, token: 'successor' }));
  await assert.rejects(release(), { code: 'PUBLISH_LOCK_OWNERSHIP_LOST' });
  assert.equal(JSON.parse(fs.readFileSync(f.file)).token, 'successor');
  await assert.rejects(release(), { code: 'PUBLISH_LOCK_OWNERSHIP_LOST' });
});

test('concurrent admission accepts one complete request, never overwrites it', async t => {
  const f = fixture(t);
  const requests = Array.from({ length: 20 }, (_, i) => ({ runId: `run_${i}`, actor: 'test' }));
  const results = await Promise.allSettled(requests.map(request => enqueuePublishRequest(f.root, request)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.findIndex(r => r.status === 'fulfilled');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'publish.request'))), requests[winner]);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'EEXIST'));
  assert.equal(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')).length, 0);
});

test('wait holds request queued, sleeps rather than spinning, then acquires once', async t => {
  const f = fixture(t);
  const owner = await acquirePublishLock(f);
  await enqueuePublishRequest(f.root, { runId: 'queued' });
  let time = 0;
  let waits = 0;
  const logs = [];
  const unlock = await waitForPublishLock({ intake: f }, {
    now: () => time, log: message => logs.push(message),
    delay: async ms => {
      assert.equal(ms, 5000);
      assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'publish.request'))).runId, 'queued');
      time += ms;
      if (++waits === 3) await owner();
    },
  });
  assert.equal(waits, 3);
  assert.equal(logs.length, 1);
  await unlock();
});

test('main timeout never takes request or writes failure, and next path activation sleeps again', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'data'));
  for (const name of ['works', 'characters', 'categories']) fs.writeFileSync(path.join(f.root, 'data', `${name}.json`), '[]');
  const owner = await acquirePublishLock(f);
  await enqueuePublishRequest(f.root, { runId: 'queued' });
  const env = { INTAKE_ROOT: f.root, ADMIN_PUBLISH_REQUEST_DIR: f.root, PUBLISH_SITE_DIR: f.root,
    PUBLISH_CONTENT_DIR: path.join(f.root, "content"), ADMIN_WORKER_TOKEN: 'test-only', SUBMISSION_ADMIN_TOKEN: 'test-only' };
  for (let activation = 0; activation < 2; activation++) {
    let time = 0;
    let waits = 0;
    const result = await main([], { env, log: () => {},
      fetchImpl: () => { throw new Error('No HTTP before claim'); },
      exec: () => { throw new Error('No execution before claim'); },
      lockWait: { now: () => time, delay: async ms => { time += ms; waits++; } },
    });
    assert.equal(result, 75);
    assert.equal(time, 55 * 60 * 1000);
    assert.equal(waits, 660);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'publish.request'))).runId, 'queued');
    assert.ok(!fs.existsSync(path.join(f.root, 'publish.request.queued.taken')));
    assert.ok(!fs.existsSync(path.join(f.root, 'batches')));
  }
  await owner();
});

test('cancellation before claim preserves request and incumbent lock', async t => {
  const f = fixture(t);
  const owner = await acquirePublishLock(f);
  await enqueuePublishRequest(f.root, { runId: 'queued' });
  const controller = new AbortController();
  await assert.rejects(waitForPublishLock({ intake: f }, { signal: controller.signal,
    delay: async () => { controller.abort(); },
  }), { name: 'AbortError' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'publish.request'))).runId, 'queued');
  assert.ok(fs.existsSync(f.file));
  await owner();
});

test('terminated worker waiting on a lock leaves durable request and incumbent untouched', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'data'));
  for (const name of ['works', 'characters', 'categories']) fs.writeFileSync(path.join(f.root, 'data', `${name}.json`), '[]');
  const owner = await acquirePublishLock(f);
  await enqueuePublishRequest(f.root, { runId: 'survives-termination' });
  const originalLock = fs.readFileSync(f.file, 'utf8');
  const moduleUrl = new URL('../admin/publish-worker.mjs', import.meta.url).href;
  const env = { INTAKE_ROOT: f.root, ADMIN_PUBLISH_REQUEST_DIR: f.root, PUBLISH_SITE_DIR: f.root,
    PUBLISH_CONTENT_DIR: path.join(f.root, 'content'), ADMIN_WORKER_TOKEN: 'test-only', SUBMISSION_ADMIN_TOKEN: 'test-only' };
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { main } from ${JSON.stringify(moduleUrl)}; await main([], { env: ${JSON.stringify(env)}, log: () => process.stdout.write('waiting\\n') });`],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const closed = once(child, 'close');
  try {
    await once(child.stdout, 'data', { signal: AbortSignal.timeout(10000) });
    child.kill('SIGTERM');
    await closed;
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'publish.request'))).runId, 'survives-termination');
    assert.equal(fs.readFileSync(f.file, 'utf8'), originalLock);
    assert.ok(!fs.existsSync(path.join(f.root, 'publish.request.survives-termination.taken')));
    assert.ok(!fs.existsSync(path.join(f.root, 'batches')));
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await closed; }
    await owner();
  }
});

test('configuration failure retains request and throttles the next path activation', async t => {
  const f = fixture(t);
  await enqueuePublishRequest(f.root, { runId: 'bad-config' });
  const waits = [];
  const code = await main([], { env: { ADMIN_PUBLISH_REQUEST_DIR: f.root },
    lockWait: { delay: async ms => { waits.push(ms); } },
  });
  assert.equal(code, 75);
  assert.deepEqual(waits, [5000]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'publish.request'))).runId, 'bad-config');
});
