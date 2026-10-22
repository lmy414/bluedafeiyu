import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createPublicHandler } from './http.mjs';
import { forwardCreatorRegistration } from './creator-registration.mjs';
const input = { homepage: 'https://space.bilibili.com/4168597', intro: 'AI 娘同人手书', confirm: true };
test('作者登记严格校验平台和本人确认，使用固定回环接口且不公开后台记录', async () => {
  let calls = 0;
  const client = async (url, options) => {
    calls++; assert.equal(url, 'http://127.0.0.1:3100/cms-api/video-registrations');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer test-private-token');
    return Response.json({ ok: true, id: 'private-db-id', previousIntro: 'private' }, { status: 202 });
  };
  await assert.rejects(forwardCreatorRegistration({ ...input, homepage: 'https://evil.test/1' }, { adminToken: 'test-private-token' }, client));
  await assert.rejects(forwardCreatorRegistration({ ...input, confirm: false }, { adminToken: 'test-private-token' }, client));
  assert.equal(calls, 0);
  assert.deepEqual(await forwardCreatorRegistration(input, { adminToken: 'test-private-token' }, client), { ok: true, status: 'queued' });
});
test('公开作者入口沿用 Origin、人机验证与限流；后台失败不伪装为登记成功', async t => {
  const cfg = { allowedOrigins: ['https://example.test'], trustedProxyCidrs: [], rateLimit: { max: 4, windowMs: 60_000, maxKeys: 20 }, turnstile: { enabled: true } };
  let calls = 0;
  const handler = createPublicHandler({ cfg, queue: {}, turnstileVerify: async token => token === 'valid', creatorRegistrar: async data => { calls++; return forwardCreatorRegistration(data, { adminToken: 'test-private-token' }, async () => Response.json({}, { status: 503 })); } });
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (body, origin = 'https://example.test') => fetch(`http://127.0.0.1:${server.address().port}/api/v1/creators`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post(input, 'https://evil.test')).status, 403);
  assert.equal((await post(input)).status, 403);
  assert.equal(calls, 0);
  const response = await post({ ...input, turnstileToken: 'valid' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  await post(input); await post(input);
  assert.equal((await post(input)).status, 429);
});
