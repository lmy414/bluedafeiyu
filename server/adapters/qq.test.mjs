// server/adapters/qq.test.mjs —— QQ 群入站适配器
//
// 核心性质：**没显式打开、没配令牌、没配群白名单，就一律拒绝，且不发起任何出站连接。**
// 适配器只接受 QQ 机器人侧主动推入的图片，自己从不连接未配置的机器人。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { resolveConfig } from '../config.mjs';
import { createQueue } from '../queue.mjs';
import { createQqAdapter } from './qq.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

async function setup(t, { env = {}, fetchImpl } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'qqad-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: path.join(base, 'private') }, { env });
  const queue = await createQueue(cfg);
  const adapter = createQqAdapter(cfg, { queue, fetchImpl: fetchImpl || (async () => { throw new Error('不该出站'); }) });
  return { base, cfg, queue, adapter };
}

const ENABLED_ENV = {
  SUBMISSION_QQ_ENABLED: 'true',
  SUBMISSION_QQ_INBOUND_TOKEN: 'qq-secret-value',
  SUBMISSION_QQ_GROUP_ALLOWLIST: '111,222',
};

function base64Payload(overrides = {}) {
  return {
    groupId: '111',
    userId: 'u1',
    messageId: 'm1',
    image: { base64: TINY_PNG.toString('base64') },
    name: '群图',
    character: 'deepseek',
    ...overrides,
  };
}

test('未显式开启时拒绝，且不发起任何出站连接', async (t) => {
  let calls = 0;
  const { adapter } = await setup(t, { fetchImpl: async () => { calls += 1; throw new Error('不该出站'); } });
  assert.equal(adapter.enabled, false);
  const result = await adapter.handleInbound({ authorization: 'Bearer anything', payload: base64Payload() });
  assert.equal(result.status, 'disabled');
  assert.equal(result.code, 503);
  assert.equal(calls, 0);
});

test('开启但缺令牌或群白名单时拒绝', async (t) => {
  for (const env of [
    { SUBMISSION_QQ_ENABLED: 'true' },
    { SUBMISSION_QQ_ENABLED: 'true', SUBMISSION_QQ_INBOUND_TOKEN: 'qq-secret-value' },
    { SUBMISSION_QQ_ENABLED: 'true', SUBMISSION_QQ_GROUP_ALLOWLIST: '111' },
  ]) {
    const { adapter } = await setup(t, { env });
    const result = await adapter.handleInbound({ authorization: 'Bearer qq-secret-value', payload: base64Payload() });
    assert.equal(result.status, 'not_configured', JSON.stringify(env));
    assert.equal(result.code, 503);
  }
});

test('令牌不对时 401', async (t) => {
  const { queue, adapter } = await setup(t, { env: ENABLED_ENV });
  for (const authorization of ['', 'Bearer wrong', 'qq-secret-value']) {
    const result = await adapter.handleInbound({ authorization, payload: base64Payload() });
    assert.equal(result.status, 'unauthorized', authorization);
    assert.equal(result.code, 401);
  }
  assert.equal((await queue.list()).length, 0);
});

test('群不在白名单时 403', async (t) => {
  const { queue, adapter } = await setup(t, { env: ENABLED_ENV });
  const result = await adapter.handleInbound({ authorization: 'Bearer qq-secret-value', payload: base64Payload({ groupId: '999' }) });
  assert.equal(result.status, 'forbidden');
  assert.equal(result.code, 403);
  assert.equal((await queue.list()).length, 0);
});

test('白名单群 + base64 图片入库，幂等键含群与消息号', async (t) => {
  const { queue, adapter } = await setup(t, { env: ENABLED_ENV });
  const first = await adapter.handleInbound({ authorization: 'Bearer qq-secret-value', payload: base64Payload() });
  assert.equal(first.status, 'accepted');
  assert.equal(first.code, 202);
  const items = await queue.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'qq');
  assert.ok(items[0].sourceIds[0].startsWith('qq:111:m1:'));
  assert.equal(items[0].fields.name, '群图');

  const second = await adapter.handleInbound({ authorization: 'Bearer qq-secret-value', payload: base64Payload() });
  assert.equal(second.status, 'duplicate');
  assert.equal((await queue.list()).length, 1);
});

test('非图片 base64 被拒绝', async (t) => {
  const { queue, adapter } = await setup(t, { env: ENABLED_ENV });
  const result = await adapter.handleInbound({
    authorization: 'Bearer qq-secret-value',
    payload: base64Payload({ image: { base64: Buffer.from('not an image at all').toString('base64') } }),
  });
  assert.equal(result.status, 'invalid_image');
  assert.equal(result.code, 400);
  assert.equal((await queue.list()).length, 0);
});

test('未配图片域名白名单时拒绝 URL 图片，不发请求', async (t) => {
  let calls = 0;
  const { adapter } = await setup(t, { env: ENABLED_ENV, fetchImpl: async () => { calls += 1; return new Response(TINY_PNG); } });
  const result = await adapter.handleInbound({
    authorization: 'Bearer qq-secret-value',
    payload: base64Payload({ image: { url: 'https://gchat.qpic.cn/gchatpic_new/x/0' } }),
  });
  assert.equal(result.status, 'forbidden');
  assert.equal(calls, 0);
});

test('域名白名单内的 URL 图片可以入库', async (t) => {
  const requested = [];
  const { queue, adapter } = await setup(t, {
    env: { ...ENABLED_ENV, SUBMISSION_QQ_IMAGE_HOST_ALLOWLIST: 'gchat.qpic.cn' },
    fetchImpl: async (url) => {
      requested.push(url);
      return new Response(TINY_PNG, { status: 200, headers: { 'content-length': String(TINY_PNG.length) } });
    },
  });
  const result = await adapter.handleInbound({
    authorization: 'Bearer qq-secret-value',
    payload: base64Payload({ image: { url: 'https://gchat.qpic.cn/gchatpic_new/x/0' } }),
  });
  assert.equal(result.status, 'accepted');
  assert.deepEqual(requested, ['https://gchat.qpic.cn/gchatpic_new/x/0']);
  assert.equal((await queue.list()).length, 1);
});
