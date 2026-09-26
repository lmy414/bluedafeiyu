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
  createReviewCoordinator,
  createTurnstileVerifier,
  parseMultipartForm,
  resolveClientIp,
  reviewCoordinatorFor,
  startServers,
} from './http.mjs';
import { createQqAdapter } from './adapters/qq.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const ORIGIN = 'https://xn--pssy23gqgbz2d718b.com';
/* 内部审核 reviewer 的独立令牌（测试值，非真实密钥）。 */
const ASTRABOT_TOKEN = 'astrbot-review-token-value';
const HERMES_TOKEN = 'hermes-review-token-value';

/** 合法的 submission-ai-content/1 通过响应（审核层可解析为 pass）。 */
function passEnvelope(name = '测试表情') {
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          schema: 'submission-ai-content/1',
          verdict: 'pass',
          confidence: 0.99,
          reason: 'ok',
          content: {
            name,
            description: '',
            commentary: '一张测试图。',
            characterId: 'deepseek',
            categoryIds: ['meme'],
            tags: ['测试'],
          },
        }),
      },
    }],
  };
}

async function setup(t, {
  env = {},
  client = null,
  characters = ['deepseek', 'other'],
  turnstileVerify = null,
  bridge = null,
  logger = { error() {}, warn() {} },
} = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'http-'));
  const cfg = resolveConfig(
    { storageRoot: path.join(base, 'private'), adminToken: 'admin-secret-value' },
    { env: { SUBMISSION_ALLOWED_ORIGINS: ORIGIN, ...env } },
  );
  const queue = await createQueue(cfg);
  const reviewer = createReviewer(cfg, { client });
  const qqAdapter = createQqAdapter(cfg, { queue, fetchImpl: async () => { throw new Error('不该出站'); } });
  const deps = { cfg, queue, reviewer, qqAdapter, bridge, characters, turnstileVerify, logger };
  // 与两个 handler 共享同一协调器实例（同一队列），收尾时先等后台审核落定再删目录，
  // 否则 Windows 上后台任务还在写盘，rm 会因目录非空失败。
  const reviewCoordinator = reviewCoordinatorFor(deps);
  t.after(async () => {
    await reviewCoordinator.drain();
    await fs.rm(base, { recursive: true, force: true });
  });
  return {
    base,
    cfg,
    queue,
    reviewer,
    reviewCoordinator,
    deps,
    publicHandler: createPublicHandler(deps),
    adminHandler: createAdminHandler(deps),
  };
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
  // 严格 submission-ai-content/1 契约：受校验的 content 在正文里，
  // 内部推理挂在传输层包装上（未知字段不允许出现在契约正文）。
  const passClient = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          schema: 'submission-ai-content/1',
          verdict: 'pass',
          confidence: 0.99,
          reason: 'ok',
          content: {
            name: '测试表情',
            description: '',
            commentary: '一张测试图。',
            characterId: 'deepseek',
            categoryIds: ['meme'],
            tags: ['测试'],
          },
        }),
      },
    }],
    internal_note: '内部推理',
  });
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

/* ------------------------------- 内置 AI 自动审核默认关闭（入队不再触发） */

function qqEvent(port, { groupId = 'g1', messageId = 'm1', base64 } = {}) {
  return call(port, {
    method: 'POST',
    routePath: '/api/v1/adapters/qq/events',
    headers: { authorization: 'Bearer qq-token', 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({ groupId, messageId, image: { base64: base64 ?? TINY_PNG.toString('base64') } })),
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('公开投稿不再自动触发内置 AI 审核，条目停在 received', async (t) => {
  const calls = [];
  const { publicHandler, queue } = await setup(t, {
    client: async () => { calls.push(1); return passEnvelope(); },
  });
  await withServer(publicHandler, async (port) => {
    const res = await submit(port, {});
    assert.equal(res.status, 201, res.body.toString());
    const id = JSON.parse(res.body).id;
    await delay(50);
    assert.equal((await queue.get(id)).state, STATES.RECEIVED, '入队后不得自动跑审核');
  });
  assert.equal(calls.length, 0, '公开入队不得调用内置 AI 审核器');
});

test('QQ 入站不再自动审核；重复推送仍然幂等', async (t) => {
  const calls = [];
  const { publicHandler, queue } = await setup(t, {
    client: async () => { calls.push(1); return passEnvelope(); },
    env: {
      SUBMISSION_QQ_ENABLED: 'true',
      SUBMISSION_QQ_INBOUND_TOKEN: 'qq-token',
      SUBMISSION_QQ_GROUP_ALLOWLIST: 'g1',
    },
  });
  await withServer(publicHandler, async (port) => {
    const first = await qqEvent(port, {});
    assert.equal(first.status, 202, first.body.toString());
    const id = JSON.parse(first.body).id;
    await delay(50);
    assert.equal((await queue.get(id)).state, STATES.RECEIVED, 'QQ 入站不得自动跑审核');
    const dup = await qqEvent(port, {});
    assert.equal(dup.status, 200);
    assert.equal(JSON.parse(dup.body).id, id);
  });
  assert.equal(calls.length, 0, 'QQ 入站不得调用内置 AI 审核器');
});

/* ------------------------------------- 内部审核结果接口（独立令牌保护） */

/** 打开带内部审核令牌的测试环境。 */
function internalSetup(t, extra = {}) {
  return setup(t, {
    ...extra,
    env: {
      SUBMISSION_ASTRABOT_REVIEW_TOKEN: ASTRABOT_TOKEN,
      SUBMISSION_HERMES_REVIEW_TOKEN: HERMES_TOKEN,
      ...(extra.env || {}),
    },
  });
}

function postReviewResult(port, { token = HERMES_TOKEN, body } = {}) {
  return call(port, {
    method: 'POST',
    routePath: '/api/v1/internal/review-results',
    headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify(body || {})),
  });
}

/** 与站点 data/ 真实枚举一致（deepseek / meme 都存在）。 */
function validReviewContent(name = '测试表情') {
  return {
    name,
    description: '一张用于内部审核测试的图',
    commentary: '蓝色大肥鱼觉得这张图挺有意思。',
    characterId: 'deepseek',
    categoryIds: ['meme'],
    tags: ['测试'],
  };
}

function seedItem(queue, { source = 'github-issue', extra = 0, fields = {} } = {}) {
  return queue.enqueue({
    source,
    sourceId: `${source}:internal${extra}`,
    buffer: Buffer.concat([TINY_PNG, Buffer.from([extra & 0xff])]),
    fields: { name: '待审图', character: 'deepseek', ...fields },
  });
}

test('内部接口：未配置令牌 503，缺失 / 错误令牌 401', async (t) => {
  const off = await setup(t);
  await withServer(off.publicHandler, async (port) => {
    assert.equal((await call(port, { routePath: '/api/v1/internal/submissions' })).status, 503);
  });

  const on = await internalSetup(t);
  await withServer(on.publicHandler, async (port) => {
    assert.equal((await call(port, { routePath: '/api/v1/internal/submissions' })).status, 401);
    assert.equal((await call(port, { routePath: '/api/v1/internal/submissions', headers: { authorization: 'Bearer nope' } })).status, 401);
    assert.equal((await postReviewResult(port, { token: 'wrong', body: {} })).status, 401);
  });
});

test('内部列表：只给 web / github 的 received 条目、字段与原图，且不泄露令牌', async (t) => {
  const { publicHandler, queue } = await internalSetup(t);
  const web = (await seedItem(queue, { source: 'web', extra: 11 })).item;
  const gh = (await seedItem(queue, { source: 'github-issue', extra: 12 })).item;
  await seedItem(queue, { source: 'qq', extra: 13 });
  const reviewed = (await seedItem(queue, { source: 'web', extra: 14 })).item;
  await queue.transition(reviewed.id, 'review.start', { actor: 'hermes' });
  await queue.transition(reviewed.id, 'review.manual', { actor: 'hermes', reason: '拿不准' });

  await withServer(publicHandler, async (port) => {
    const res = await call(port, {
      routePath: '/api/v1/internal/submissions?state=received&sources=web,github-issue',
      headers: { authorization: `Bearer ${HERMES_TOKEN}` },
    });
    assert.equal(res.status, 200, res.body.toString());
    const text = res.body.toString();
    assert.ok(!text.includes(HERMES_TOKEN) && !text.includes(ASTRABOT_TOKEN), '响应不得泄露令牌');
    const body = JSON.parse(text);
    assert.deepEqual(body.items.map((item) => item.id).sort(), [web.id, gh.id].sort());
    for (const entry of body.items) {
      assert.equal(entry.state, STATES.RECEIVED);
      assert.ok(entry.fields.name);
    }

    const raw = await call(port, {
      routePath: `/api/v1/internal/submissions/${gh.id}/raw`,
      headers: { authorization: `Bearer ${HERMES_TOKEN}` },
    });
    assert.equal(raw.status, 200);
    assert.ok(raw.body.equals(await queue.readImage(gh.id)));
    assert.equal(raw.headers['x-content-type-options'], 'nosniff');
  });
});

test('内部审核结果：pass 且内容完整 → auto_passed 并桥接到 ready', async (t) => {
  const bridged = [];
  const bridge = { enabled: true, bridgeItem: async (id) => { bridged.push(id); return { id, status: 'ready', sha256: 'deadbeef' }; } };
  const { publicHandler, queue } = await internalSetup(t, { bridge });
  const { item } = await seedItem(queue, { extra: 21 });

  await withServer(publicHandler, async (port) => {
    const res = await postReviewResult(port, {
      body: {
        submissionId: item.id,
        verdict: 'pass',
        confidence: 0.93,
        reason: '属于 AI 娘二创表情包',
        content: validReviewContent(),
        reviewer: 'hermes',
        model: 'gpt-vision',
      },
    });
    assert.equal(res.status, 200, res.body.toString());
    const body = JSON.parse(res.body);
    assert.equal(body.state, STATES.AUTO_PASSED);
    assert.equal(body.duplicate, false);
    assert.equal(body.bridge.status, 'ready');
  });

  const stored = await queue.get(item.id);
  assert.equal(stored.state, STATES.AUTO_PASSED);
  assert.equal(stored.review.verdict, 'pass');
  assert.equal(stored.review.decidedBy, 'hermes');
  assert.equal(stored.review.model, 'gpt-vision');
  assert.equal(stored.review.content.characterId, 'deepseek');
  assert.deepEqual(bridged, [item.id]);
});

test('内部审核结果：重复提交幂等，返回原结果且不重复桥接', async (t) => {
  const bridged = [];
  const bridge = { enabled: true, bridgeItem: async (id) => { bridged.push(id); return { id, status: 'ready' }; } };
  const { publicHandler, queue } = await internalSetup(t, { bridge });
  const { item } = await seedItem(queue, { extra: 22 });
  const payload = {
    submissionId: item.id,
    verdict: 'pass',
    confidence: 0.9,
    reason: 'ok',
    content: validReviewContent(),
    reviewer: 'hermes',
    model: 'm',
  };

  await withServer(publicHandler, async (port) => {
    const first = await postReviewResult(port, { body: payload });
    assert.equal(first.status, 200, first.body.toString());
    assert.equal(JSON.parse(first.body).duplicate, false);

    const again = await postReviewResult(port, { body: payload });
    assert.equal(again.status, 200, again.body.toString());
    const body = JSON.parse(again.body);
    assert.equal(body.duplicate, true);
    assert.equal(body.state, STATES.AUTO_PASSED);
    assert.equal(body.verdict, 'pass');
    assert.equal(body.confidence, 0.9);
  });

  assert.equal((await queue.get(item.id)).state, STATES.AUTO_PASSED);
  assert.deepEqual(bridged, [item.id], '重复提交不得重复桥接');
});

test('内部审核结果：reject / manual 进人工审核区，绝不写待发布区', async (t) => {
  const bridged = [];
  const bridge = { enabled: true, bridgeItem: async (id) => { bridged.push(id); return { id, status: 'ready' }; } };
  const { publicHandler, queue } = await internalSetup(t, { bridge });
  const rejected = (await seedItem(queue, { extra: 23 })).item;
  const manual = (await seedItem(queue, { extra: 24 })).item;

  await withServer(publicHandler, async (port) => {
    const r1 = await postReviewResult(port, {
      body: { submissionId: rejected.id, verdict: 'reject', confidence: 0.88, reason: '真人照片', content: null, reviewer: 'hermes', model: 'm' },
    });
    assert.equal(r1.status, 200, r1.body.toString());
    assert.equal(JSON.parse(r1.body).state, STATES.AUTO_REJECTED);

    const r2 = await postReviewResult(port, {
      body: { submissionId: manual.id, verdict: 'manual', confidence: 0.4, reason: '拿不准', reviewer: 'hermes', model: 'm' },
    });
    assert.equal(r2.status, 200, r2.body.toString());
    assert.equal(JSON.parse(r2.body).state, STATES.NEEDS_MANUAL);
  });

  assert.equal((await queue.get(rejected.id)).state, STATES.AUTO_REJECTED);
  assert.equal((await queue.get(manual.id)).state, STATES.NEEDS_MANUAL);
  assert.deepEqual(bridged, [], 'reject / manual 绝不进入待发布区');
});

test('内部审核结果：令牌来源与 reviewer 必须一致，字段严格校验', async (t) => {
  const { publicHandler, queue } = await internalSetup(t);
  const { item } = await seedItem(queue, { extra: 25 });
  const base = { submissionId: item.id, verdict: 'manual', confidence: 0.5, reason: 'ok', reviewer: 'hermes', model: 'm' };

  await withServer(publicHandler, async (port) => {
    // astrbot 令牌不得冒充 hermes。
    assert.equal((await postReviewResult(port, { token: ASTRABOT_TOKEN, body: base })).status, 403);
    assert.equal((await postReviewResult(port, { body: { ...base, submissionId: 'not-an-id' } })).status, 400);
    assert.equal((await postReviewResult(port, { body: { ...base, verdict: 'approved' } })).status, 400);
    assert.equal((await postReviewResult(port, { body: { ...base, confidence: 2 } })).status, 400);
    assert.equal((await postReviewResult(port, { body: { ...base, reason: '' } })).status, 400);
    assert.equal((await postReviewResult(port, { body: { ...base, reviewer: 'unknown-agent' } })).status, 403);
    assert.equal((await postReviewResult(port, { body: { ...base, submissionId: `sub_${'0'.repeat(24)}` } })).status, 404);

    assert.equal((await queue.get(item.id)).state, STATES.RECEIVED, '非法请求不得改变状态');
  });
});

test('内部审核结果：pass 但 content 不合规一律 422，条目停在 received', async (t) => {
  const bridged = [];
  const bridge = { enabled: true, bridgeItem: async (id) => { bridged.push(id); return { id, status: 'ready' }; } };
  const { publicHandler, queue } = await internalSetup(t, { bridge });
  const { item } = await seedItem(queue, { extra: 26 });
  const base = { submissionId: item.id, verdict: 'pass', confidence: 0.9, reason: 'ok', reviewer: 'hermes', model: 'm' };

  await withServer(publicHandler, async (port) => {
    assert.equal((await postReviewResult(port, { body: { ...base, content: { ...validReviewContent(), categoryIds: undefined } } })).status, 422);
    assert.equal((await postReviewResult(port, { body: { ...base, content: { ...validReviewContent(), characterId: '不存在' } } })).status, 422);
    assert.equal((await postReviewResult(port, { body: { ...base, content: null } })).status, 422);
  });

  const stored = await queue.get(item.id);
  assert.equal(stored.state, STATES.RECEIVED, '内容不合规不得推进状态');
  assert.equal(stored.review, null);
  assert.deepEqual(bridged, []);
});

test('内部审核结果：非 received 且非本人已审的条目返回 409', async (t) => {
  const { publicHandler, queue } = await internalSetup(t);
  const { item } = await seedItem(queue, { extra: 27 });
  await queue.transition(item.id, 'review.start', { actor: 'other' });

  await withServer(publicHandler, async (port) => {
    const res = await postReviewResult(port, {
      body: { submissionId: item.id, verdict: 'manual', confidence: 0.5, reason: 'ok', reviewer: 'hermes', model: 'm' },
    });
    assert.equal(res.status, 409, res.body.toString());
  });
  assert.equal((await queue.get(item.id)).state, STATES.REVIEWING, '冲突请求不得改变状态');
});

test('内部审核：公开健康检查只报启用状态，不回显令牌', async (t) => {
  const { publicHandler } = await internalSetup(t);
  await withServer(publicHandler, async (port) => {
    const res = await call(port, { routePath: '/api/v1/health' });
    const text = res.body.toString();
    assert.ok(!text.includes(HERMES_TOKEN) && !text.includes(ASTRABOT_TOKEN));
    assert.equal(JSON.parse(text).internalReview, 'enabled');
  });
});

test('内部审核结果：管理口接受批量回写（Hermes 形态），逐条独立处理', async (t) => {
  const bridged = [];
  const bridge = { enabled: true, bridgeItem: async (id) => { bridged.push(id); return { id, status: 'ready' }; } };
  const { adminHandler, queue } = await internalSetup(t, { bridge });
  const passed = (await seedItem(queue, { extra: 31 })).item;
  const rejected = (await seedItem(queue, { extra: 32 })).item;
  const badContent = (await seedItem(queue, { extra: 33 })).item;

  await withServer(adminHandler, async (port) => {
    // 内部令牌不能读管理路由：管理口其余接口仍要管理令牌。
    assert.equal((await call(port, { routePath: '/api/v1/items', headers: { authorization: `Bearer ${HERMES_TOKEN}` } })).status, 401);

    const batch = {
      schema: 'submission-review-results/1',
      reviewer: 'hermes',
      promptVersion: 'v1',
      results: [
        { id: passed.id, verdict: 'pass', confidence: 0.9, reason: 'ok', content: validReviewContent('A'), model: 'm' },
        { id: rejected.id, verdict: 'reject', confidence: 0.8, reason: '真人照片', content: null, model: 'm' },
        { id: badContent.id, verdict: 'pass', confidence: 0.9, reason: 'ok', content: { ...validReviewContent('C'), characterId: '不存在' }, model: 'm' },
      ],
    };
    const res = await call(port, {
      method: 'POST',
      routePath: '/api/v1/internal/review-results',
      headers: { authorization: `Bearer ${HERMES_TOKEN}`, 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(batch)),
    });
    assert.equal(res.status, 200, res.body.toString());
    const body = JSON.parse(res.body);
    assert.equal(body.count, 3);
    assert.deepEqual(body.results.map((entry) => entry.status), [200, 200, 422]);

    // 信封 reviewer 与令牌不一致 → 403，整批不动。
    const mismatch = await call(port, {
      method: 'POST',
      routePath: '/api/v1/internal/review-results',
      headers: { authorization: `Bearer ${HERMES_TOKEN}`, 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ ...batch, reviewer: 'astrbot' })),
    });
    assert.equal(mismatch.status, 403);
  });

  assert.equal((await queue.get(passed.id)).state, STATES.AUTO_PASSED);
  assert.equal((await queue.get(rejected.id)).state, STATES.AUTO_REJECTED);
  assert.equal((await queue.get(badContent.id)).state, STATES.RECEIVED);
  assert.deepEqual(bridged, [passed.id]);
});

test('内部审核结果：空批次探测（doctor --probe 形态）返回 200 且不动条目', async (t) => {
  const { adminHandler, queue } = await internalSetup(t);
  const { item } = await seedItem(queue, { extra: 34 });
  await withServer(adminHandler, async (port) => {
    const res = await call(port, {
      method: 'POST',
      routePath: '/api/v1/internal/review-results',
      headers: { authorization: `Bearer ${HERMES_TOKEN}`, 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ schema: 'submission-review-results/1', reviewer: 'hermes', results: [] })),
    });
    assert.equal(res.status, 200, res.body.toString());
    const body = JSON.parse(res.body);
    assert.equal(body.count, 0);
    assert.equal(body.reviewer, 'hermes');
  });
  assert.equal((await queue.get(item.id)).state, STATES.RECEIVED);
});

test('并发保护：同一 id 飞行中重复触发只审核一次', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const { queue, reviewer } = await setup(t, {
    client: async () => { calls.push(1); await gate; return passEnvelope(); },
  });
  const { item } = await queue.enqueue({
    source: 'web',
    sourceId: 'web:concurrency',
    buffer: TINY_PNG,
    fields: { name: '并发测试', character: 'deepseek' },
    origin: { via: 'web' },
  });
  const coordinator = createReviewCoordinator({ queue, reviewer, bridge: null, logger: { error() {} } });
  try {
    const firstTask = coordinator.trigger(item.id);
    assert.ok(firstTask, '首次触发应返回后台任务');
    assert.equal(coordinator.trigger(item.id), null, '同一 id 在飞行中应被并发保护挡下');
    // 管理端显式审核复用同一飞行任务，不会另开一次审核。
    assert.equal(coordinator.run(item.id), firstTask);
    release();
    await firstTask;
    assert.equal((await queue.get(item.id)).state, STATES.AUTO_PASSED);
    assert.equal(calls.length, 1);
    assert.equal(coordinator.size(), 0, '完成后不再占用 in-flight 名额');
  } finally {
    release();
  }
});
