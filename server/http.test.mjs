// server/http.test.mjs —— 公开投稿入口与管理员接口
//
// 重点性质：
//   1. 公开入口严格 Origin/CORS（无 *）、限流、字段/格式/魔数/大小校验；
//      **公开响应不泄露内部路径、sha256 或 AI 结果**；
//   2. 管理接口只允许回环 + Bearer 常量时间鉴权，没配令牌直接拒绝；
//   3. 管理端能看到条目、原图与审核结果，公开端看不到。
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { parseCidr, resolveConfig } from './config.mjs';
import { STATES, createQueue, sha256 } from './queue.mjs';
import { createReviewer } from './review.mjs';
import {
  TURNSTILE_VERIFY_URL,
  createAdminHandler,
  createPublicHandler,
  createRateLimiter,
  createTurnstileVerifier,
  parseMultipartForm,
  resolveClientIp,
  startServers,
} from './http.mjs';
import { createQqAdapter } from './adapters/qq.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const ORIGIN = 'https://xn--pssy23gqgbz2d718b.com';

async function setup(t, { env = {}, client = null, characters = ['deepseek', 'other'], turnstileVerify = null } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'http-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig(
    { storageRoot: path.join(base, 'private'), adminToken: 'admin-secret-value' },
    { env: { SUBMISSION_ALLOWED_ORIGINS: ORIGIN, ...env } },
  );
  const queue = await createQueue(cfg);
  const reviewer = createReviewer(cfg, { client });
  const qqAdapter = createQqAdapter(cfg, { queue, fetchImpl: async () => { throw new Error('不该出站'); } });
  const deps = { cfg, queue, reviewer, qqAdapter, characters, turnstileVerify, logger: { error() {}, warn() {} } };
  return { base, cfg, queue, reviewer, deps, publicHandler: createPublicHandler(deps), adminHandler: createAdminHandler(deps) };
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function call(port, { method = 'GET', routePath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: routePath, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartBody(fields, file) {
  const boundary = '----bluefishboundary7f3a';
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

async function submit(port, { fields = { name: '测试图', character: 'deepseek' }, file = { field: 'file', filename: 'a.png', type: 'image/png', data: TINY_PNG }, origin = ORIGIN, raw = false, headers = {} } = {}) {
  if (raw) {
    return call(port, {
      method: 'POST',
      routePath: '/api/v1/submissions',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
      body: Buffer.from(JSON.stringify(raw)),
    });
  }
  const { boundary, body } = multipartBody(fields, file);
  return call(port, {
    method: 'POST',
    routePath: '/api/v1/submissions',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Origin: origin, 'Content-Length': body.length, ...headers },
    body,
  });
}

test('公开健康检查不泄露密钥，且如实报告未配置项', async (t) => {
  const { publicHandler } = await setup(t);
  await withServer(publicHandler, async (port) => {
    const res = await call(port, { routePath: '/api/v1/health' });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.review, 'not_configured');
    assert.equal(body.qq, 'disabled');
    assert.ok(!res.body.toString().includes('admin-secret-value'));
    assert.ok(!res.body.toString().includes('private'));
  });
});

test('multipart 投稿成功，公开响应不含 sha / 内部路径', async (t) => {
  const { publicHandler, queue } = await setup(t);
  await withServer(publicHandler, async (port) => {
    const res = await submit(port, { fields: { name: '表情', character: 'deepseek', description: '测试' } });
    assert.equal(res.status, 201, res.body.toString());
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.status, 'received');
    assert.ok(body.id.startsWith('sub_'));
    assert.ok(!('sha256' in body));
    assert.ok(!res.body.toString().includes('objects'));
    assert.equal((await queue.list()).length, 1);
  });
});

test('JSON/base64 投稿同样入库', async (t) => {
  const { publicHandler, queue } = await setup(t);
  await withServer(publicHandler, async (port) => {
    const res = await submit(port, {
      raw: { name: 'base64 图', character: 'deepseek', filename: 'b.png', dataBase64: TINY_PNG.toString('base64') },
    });
    assert.equal(res.status, 201, res.body.toString());
    assert.equal((await queue.list()).length, 1);
  });
});

test('严格 Origin：未列入白名单的来源被拒绝', async (t) => {
  const { publicHandler } = await setup(t);
  await withServer(publicHandler, async (port) => {
    const res = await submit(port, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });
});

test('允许的 Origin 回显具体来源，且从不用 *', async (t) => {
  const { publicHandler } = await setup(t);
  await withServer(publicHandler, async (port) => {
    const res = await submit(port, {});
    assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
    assert.notEqual(res.headers['access-control-allow-origin'], '*');
  });
});

test('字段校验：缺名称、非法角色、缺图片', async (t) => {
  const { publicHandler } = await setup(t);
  await withServer(publicHandler, async (port) => {
    assert.equal((await submit(port, { fields: { character: 'deepseek' } })).status, 400);
    assert.equal((await submit(port, { fields: { name: 'x', character: 'not-a-character' } })).status, 400);
    assert.equal((await submit(port, { file: null })).status, 400);
  });
});

test('格式与大小校验：非图片、超限被拒绝', async (t) => {
  const { publicHandler } = await setup(t);
  await withServer(publicHandler, async (port) => {
    const bad = await submit(port, { file: { field: 'file', filename: 'x.png', type: 'image/png', data: Buffer.from('PK\u0003\u0004 not image') } });
    assert.equal(bad.status, 400);

    const tinyLimit = await setup(t, { env: { SUBMISSION_MAX_BYTES: '8' } });
    await withServer(tinyLimit.publicHandler, async (p) => {
      assert.equal((await submit(p, {})).status, 413);
    });
  });
});

test('限流：超过窗口配额返回 429', async (t) => {
  const { publicHandler } = await setup(t, { env: { SUBMISSION_RATE_MAX: '2', SUBMISSION_RATE_WINDOW_MS: '60000' } });
  await withServer(publicHandler, async (port) => {
    const one = await submit(port, { file: { field: 'file', filename: 'a.png', type: 'image/png', data: TINY_PNG } });
    const two = await submit(port, { file: { field: 'file', filename: 'b.png', type: 'image/png', data: Buffer.concat([TINY_PNG, Buffer.from([1])]) } });
    const three = await submit(port, { file: { field: 'file', filename: 'c.png', type: 'image/png', data: Buffer.concat([TINY_PNG, Buffer.from([2])]) } });
    assert.equal(one.status, 201);
    assert.equal(two.status, 201);
    assert.equal(three.status, 429);
  });
});

test('管理接口：没配令牌一律拒绝；令牌错 401；令牌对可读条目', async (t) => {
  const { adminHandler, queue, deps } = await setup(t);
  await withServer(adminHandler, async (port) => {
    const ok = await call(port, { routePath: '/api/v1/items', headers: { authorization: 'Bearer admin-secret-value' } });
    assert.equal(ok.status, 200);
    const bad = await call(port, { routePath: '/api/v1/items', headers: { authorization: 'Bearer nope' } });
    assert.equal(bad.status, 401);
    const none = await call(port, { routePath: '/api/v1/items' });
    assert.equal(none.status, 401);
  });

  const noToken = await setup(t);
  const stripped = { ...noToken.deps, cfg: { ...noToken.cfg, adminToken: '' } };
  await withServer(createAdminHandler(stripped), async (port) => {
    const res = await call(port, { routePath: '/api/v1/items' });
    assert.equal(res.status, 503);
  });
  void queue; void deps;
});

test('管理员能取原图（按附件下载）与条目，公开端做不到', async (t) => {
  const { publicHandler, adminHandler, queue } = await setup(t);
  await withServer(publicHandler, async (port) => {
    const res = await submit(port, {});
    assert.equal(res.status, 201);
  });
  const item = (await queue.list())[0];
  await withServer(adminHandler, async (port) => {
    const raw = await call(port, { routePath: `/api/v1/items/${item.id}/raw`, headers: { authorization: 'Bearer admin-secret-value' } });
    assert.equal(raw.status, 200);
    assert.ok(raw.body.equals(TINY_PNG));
    assert.match(raw.headers['content-disposition'], /attachment/);
    assert.equal(raw.headers['x-content-type-options'], 'nosniff');
  });
  await withServer(publicHandler, async (port) => {
    const res = await call(port, { routePath: `/api/v1/items/${item.id}/raw` });
    assert.equal(res.status, 404);
  });
});

test('管理端触发审核：未配置 AI 转人工，人工可批准', async (t) => {
  const { publicHandler, adminHandler, queue } = await setup(t);
  await withServer(publicHandler, async (port) => { await submit(port, {}); });
  const item = (await queue.list())[0];
  await withServer(adminHandler, async (port) => {
    const reviewed = await call(port, {
      method: 'POST',
      routePath: `/api/v1/items/${item.id}/review`,
      headers: { authorization: 'Bearer admin-secret-value' },
    });
    assert.equal(reviewed.status, 200, reviewed.body.toString());
    assert.equal(JSON.parse(reviewed.body).verdict, 'manual');
    assert.equal((await queue.get(item.id)).state, STATES.NEEDS_MANUAL);

    const approved = await call(port, {
      method: 'POST',
      routePath: `/api/v1/items/${item.id}/decision`,
      headers: { authorization: 'Bearer admin-secret-value', 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ decision: 'approved', reason: '看图确认' })),
    });
    assert.equal(approved.status, 200);
    assert.equal((await queue.get(item.id)).state, STATES.APPROVED);
  });
});

test('管理端能看到 AI 原始结果，公开端没有这个路由', async (t) => {
  const passClient = async () => ({ verdict: 'pass', confidence: 0.99, reason: 'ok', raw: { internal_note: '内部推理' } });
  const { publicHandler, adminHandler, queue } = await setup(t, { client: passClient });
  await withServer(publicHandler, async (port) => { await submit(port, {}); });
  const item = (await queue.list())[0];
  await withServer(adminHandler, async (port) => {
    await call(port, { method: 'POST', routePath: `/api/v1/items/${item.id}/review`, headers: { authorization: 'Bearer admin-secret-value' } });
    const raw = await call(port, { routePath: `/api/v1/items/${item.id}/review`, headers: { authorization: 'Bearer admin-secret-value' } });
    assert.equal(raw.status, 200);
    assert.match(raw.body.toString(), /internal_note/);
    assert.equal((await queue.get(item.id)).state, STATES.AUTO_PASSED);
  });
  await withServer(publicHandler, async (port) => {
    const res = await call(port, { routePath: `/api/v1/items/${item.id}/review` });
    assert.equal(res.status, 404);
  });
});

test('parseMultipartForm 缺 boundary / 结构不对时拒绝', () => {
  assert.throws(() => parseMultipartForm(Buffer.from('x'), 'multipart/form-data', { maxBytes: 1024 }), /boundary/);
  assert.throws(() => parseMultipartForm(Buffer.from('x'), 'application/json', { maxBytes: 1024 }), /multipart/);
});

test('startServers：管理端拒绝绑非回环地址', async (t) => {
  const { deps, cfg } = await setup(t);
  await assert.rejects(
    () => startServers({ ...cfg, adminHost: '0.0.0.0' }, deps),
    /回环/,
  );
  await assert.rejects(
    () => startServers({ ...cfg, adminHost: '127.0.0.1', adminToken: '' }, deps),
    /SUBMISSION_ADMIN_TOKEN/,
  );
});

test('startServers：可在回环随机端口启动并关闭', async (t) => {
  const { deps, cfg } = await setup(t);
  const servers = await startServers({ ...cfg, publicPort: 0, adminPort: 0 }, deps);
  try {
    const publicPort = servers.publicServer.address().port;
    const res = await call(publicPort, { routePath: '/api/v1/health' });
    assert.equal(res.status, 200);
  } finally {
    await servers.close();
  }
});

test('QQ 入站路由未开启时返回 503，不影响公开入口', async (t) => {
  const { publicHandler } = await setup(t);
  await withServer(publicHandler, async (port) => {
    const res = await call(port, {
      method: 'POST',
      routePath: '/api/v1/adapters/qq/events',
      headers: { authorization: 'Bearer whatever', 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ groupId: '1', messageId: 'm', image: { base64: TINY_PNG.toString('base64') } })),
    });
    assert.equal(res.status, 503);
  });
});

test('内部：公开投稿不会写入内容仓，只进私有队列', async (t) => {
  const { publicHandler, cfg, queue } = await setup(t);
  await withServer(publicHandler, async (port) => { await submit(port, {}); });
  const items = await queue.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'web');
  assert.equal(items[0].sha256, sha256(TINY_PNG));
  assert.ok(cfg.storageRoot.startsWith(os.tmpdir()));
});

/* ------------------------------------------------- 安全审查修复的回归测试 */

test('限流器：惰性过期清理 + key 上限（防 IPv6 轮换内存膨胀）', () => {
  let clock = 0;
  const allow = createRateLimiter({ max: 1, windowMs: 1000, maxKeys: 2, now: () => clock });
  assert.equal(allow('a').allowed, true);
  assert.equal(allow('a').allowed, false);
  assert.equal(allow.size, 1);
  assert.equal(allow('b').allowed, true);
  assert.equal(allow.size, 2);

  // 超过 key 上限时淘汰最旧键，内存不无界增长
  assert.equal(allow('c').allowed, true);
  assert.equal(allow.size, 2);
  // 被淘汰的 a 重新计数，证明它确实被清掉了
  assert.equal(allow('a').allowed, true);
  assert.equal(allow.size, 2);

  // 窗口过后惰性清理过期桶
  clock += 2000;
  assert.equal(allow('d').allowed, true);
  assert.equal(allow.size, 1);
});

test('未配置可信代理时绝不采信 X-Forwarded-For', () => {
  const req = { socket: { remoteAddress: '203.0.113.9' }, headers: { 'x-forwarded-for': '1.2.3.4' } };
  assert.equal(resolveClientIp(req, []), '203.0.113.9');
  assert.equal(resolveClientIp({ socket: { remoteAddress: '::ffff:203.0.113.9' }, headers: {} }, []), '203.0.113.9');
});

test('可信代理下取 XFF 最右非可信地址，忽略伪造的左端', () => {
  const trusted = [parseCidr('10.0.0.0/8')];
  const req = { socket: { remoteAddress: '10.0.0.5' }, headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.7' } };
  assert.equal(resolveClientIp(req, trusted), '203.0.113.7');
});

test('来源不是可信代理时仍不采信 XFF', () => {
  const trusted = [parseCidr('10.0.0.0/8')];
  const req = { socket: { remoteAddress: '198.51.100.2' }, headers: { 'x-forwarded-for': '1.2.3.4' } };
  assert.equal(resolveClientIp(req, trusted), '198.51.100.2');
});

test('可信代理下按解出的客户端 IP 限流；未信任时不采信 XFF', async (t) => {
  const trusted = await setup(t, {
    env: { SUBMISSION_RATE_MAX: '1', SUBMISSION_RATE_WINDOW_MS: '60000', SUBMISSION_TRUSTED_PROXY_CIDRS: '127.0.0.1/32' },
  });
  await withServer(trusted.publicHandler, async (port) => {
    const first = await submit(port, { headers: { 'x-forwarded-for': '203.0.113.1' } });
    assert.equal(first.status, 201);
    const sameIp = await submit(port, { headers: { 'x-forwarded-for': '203.0.113.1' } });
    assert.equal(sameIp.status, 429);
    const otherIp = await submit(port, {
      file: { field: 'file', filename: 'b.png', type: 'image/png', data: Buffer.concat([TINY_PNG, Buffer.from([7])]) },
      headers: { 'x-forwarded-for': '203.0.113.2' },
    });
    assert.equal(otherIp.status, 201);
  });

  const untrusted = await setup(t, { env: { SUBMISSION_RATE_MAX: '1', SUBMISSION_RATE_WINDOW_MS: '60000' } });
  await withServer(untrusted.publicHandler, async (port) => {
    assert.equal((await submit(port, { headers: { 'x-forwarded-for': '203.0.113.1' } })).status, 201);
    assert.equal((await submit(port, { headers: { 'x-forwarded-for': '203.0.113.2' } })).status, 429);
  });
});

test('Turnstile 开启：缺 token / 校验失败一律 403，校验通过才入库', async (t) => {
  const seen = [];
  const { publicHandler, queue } = await setup(t, {
    env: { SUBMISSION_TURNSTILE_SECRET: 'ts-secret' },
    turnstileVerify: async (token) => { seen.push(token); return token === 'good'; },
  });
  await withServer(publicHandler, async (port) => {
    assert.equal((await submit(port, {})).status, 403);
    assert.equal((await submit(port, { fields: { name: 'x', character: 'deepseek', turnstileToken: 'bad' } })).status, 403);
    const ok = await submit(port, { fields: { name: 'x', character: 'deepseek', turnstileToken: 'good' } });
    assert.equal(ok.status, 201, ok.body.toString());
  });
  assert.deepEqual(seen, ['bad', 'good']);
  assert.equal((await queue.list()).length, 1);
});

test('Turnstile 校验器抛错也 fail-closed（注入校验器，测试不外呼）', async (t) => {
  const throws = await setup(t, {
    env: { SUBMISSION_TURNSTILE_SECRET: 'ts-secret' },
    turnstileVerify: async () => { throw new Error('boom'); },
  });
  await withServer(throws.publicHandler, async (port) => {
    assert.equal((await submit(port, { fields: { name: 'x', character: 'deepseek', turnstileToken: 'good' } })).status, 403);
  });
  // 校验器返回 false（例如 siteverify 说 success=false）同样拒绝
  const denies = await setup(t, {
    env: { SUBMISSION_TURNSTILE_SECRET: 'ts-secret' },
    turnstileVerify: async () => false,
  });
  await withServer(denies.publicHandler, async (port) => {
    assert.equal((await submit(port, { fields: { name: 'x', character: 'deepseek', turnstileToken: 'good' } })).status, 403);
  });
});

test('createTurnstileVerifier 走真实 siteverify，用注入 fetch 不外呼', async () => {
  const calls = [];
  const okFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const verify = createTurnstileVerifier({ secret: 's', fetchImpl: okFetch, timeoutMs: 100 });
  assert.equal(await verify('token', { remoteip: '203.0.113.7' }), true);
  assert.equal(calls[0].url, TURNSTILE_VERIFY_URL);
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(calls[0].init.method, 'POST');
  assert.match(String(calls[0].init.body), /response=token/);
  assert.match(String(calls[0].init.body), /secret=s/);
  assert.match(String(calls[0].init.body), /remoteip=203\.0\.113\.7/);

  const failFetch = async () => new Response(JSON.stringify({ success: false }), { status: 200 });
  assert.equal(await createTurnstileVerifier({ secret: 's', fetchImpl: failFetch })('token'), false);
  assert.equal(await createTurnstileVerifier({ secret: '' })('token'), false);
  assert.equal(await createTurnstileVerifier({ secret: 's' })(''), false);

  const hangFetch = () => new Promise(() => {});
  assert.equal(await createTurnstileVerifier({ secret: 's', fetchImpl: hangFetch, timeoutMs: 20 })('token'), false);

  const throwFetch = async () => { throw new Error('network down'); };
  assert.equal(await createTurnstileVerifier({ secret: 's', fetchImpl: throwFetch })('token'), false);
});

test('JSON base64 严格校验：拒绝 data: 前缀 / 非法字符 / 超长', async (t) => {
  const { publicHandler, queue } = await setup(t);
  await withServer(publicHandler, async (port) => {
    const dataUri = await submit(port, {
      raw: { name: 'x', character: 'deepseek', dataBase64: `data:image/png;base64,${TINY_PNG.toString('base64')}` },
    });
    assert.equal(dataUri.status, 400);
    const illegal = await submit(port, { raw: { name: 'x', character: 'deepseek', dataBase64: '!!!not-base64!!!' } });
    assert.equal(illegal.status, 400);
    const whitespace = await submit(port, { raw: { name: 'x', character: 'deepseek', dataBase64: `${TINY_PNG.toString('base64')}\n` } });
    assert.equal(whitespace.status, 400);
    const valid = await submit(port, { raw: { name: 'x', character: 'deepseek', dataBase64: TINY_PNG.toString('base64') } });
    assert.equal(valid.status, 201, valid.body.toString());
  });
  assert.equal((await queue.list()).length, 1);

  const small = await setup(t, { env: { SUBMISSION_MAX_BYTES: '16' } });
  await withServer(small.publicHandler, async (port) => {
    const big = await submit(port, { raw: { name: 'x', character: 'deepseek', dataBase64: TINY_PNG.toString('base64') } });
    assert.equal(big.status, 413);
  });
});

test('character 超过长度上限被拒绝，边界内接受', async (t) => {
  const { publicHandler } = await setup(t, { characters: [] });
  await withServer(publicHandler, async (port) => {
    const tooLong = await submit(port, { fields: { name: 'n', character: 'x'.repeat(65) } });
    assert.equal(tooLong.status, 400);
    const boundary = await submit(port, { fields: { name: 'n', character: 'x'.repeat(64) } });
    assert.equal(boundary.status, 201, boundary.body.toString());
  });
});

test('QQ 入口超大 body 返回 413 而不是 400', async (t) => {
  const { publicHandler } = await setup(t, { env: { SUBMISSION_MAX_BYTES: '128' } });
  await withServer(publicHandler, async (port) => {
    const res = await call(port, {
      method: 'POST',
      routePath: '/api/v1/adapters/qq/events',
      headers: { authorization: 'Bearer whatever', 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ groupId: '1', messageId: 'm', blob: 'a'.repeat(4096) })),
    });
    assert.equal(res.status, 413);
  });
});
