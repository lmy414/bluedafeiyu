import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { processOne } from '../admin/bulk-worker.mjs';

test('独立执行器只依赖服务器令牌，不依赖浏览器会话', async () => {
  const calls = [];
  const result = await processOne({ ADMIN_WORKER_TOKEN: 'test-token', ADMIN_API_URL: 'http://localhost:3100' }, async (url, init) => {
    calls.push({ url, init }); return Response.json({ idle: false, job: { cursor: 1 } });
  });
  assert.equal(result.job.cursor, 1);
  assert.equal(calls[0].url, 'http://localhost:3100/cms-api/bulk/process-next');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].init.method, 'POST');
});
test('忙碌时退避、鉴权异常失败；systemd 独立开机启动且单实例', async () => {
  assert.deepEqual(await processOne({ ADMIN_WORKER_TOKEN: 'test' }, async () => new Response('', { status: 409 })), { busy: true });
  await assert.rejects(() => processOne({}), /TOKEN missing/);
  await assert.rejects(() => processOne({ ADMIN_WORKER_TOKEN: 'test' }, async () => new Response('', { status: 401 })), /401/);
  const unit = await fs.readFile(new URL('../systemd/dafeiyu-admin-bulk.service', import.meta.url), 'utf8');
  assert.match(unit, /WantedBy=multi-user.target/);
  assert.match(unit, /bulk-worker.mjs/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /TimeoutStopSec=450s/);
});
