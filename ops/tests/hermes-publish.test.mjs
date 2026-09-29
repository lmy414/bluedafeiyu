#!/usr/bin/env node
/* ops/tests/hermes-publish.test.mjs —— Hermes 发布桥接的离线回归测试。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { main } from '../admin/hermes-publish.mjs';

async function startBackend(t, state) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({ method: req.method, path: url.pathname, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && url.pathname === '/cms-api/submissions/sync') {
      return send(state.syncStatus || 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/cms-api/publish/plan') {
      return send(200, state.plan);
    }
    if (req.method === 'POST' && url.pathname === '/cms-api/publish/request') {
      return send(state.requestStatus || 200, state.requestBody || { runId: 'run-1' });
    }
    if (req.method === 'GET' && /^\/cms-api\/publish\/runs\/[^/]+$/.test(url.pathname)) {
      return send(200, state.run);
    }
    return send(404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, state, calls };
}

function envFor(backend, extra = {}) {
  return {
    ADMIN_API_URL: backend.url,
    ADMIN_BOT_API_KEY: 'bot-key',
    ADMIN_SITE_URL: 'https://example.invalid',
    ...extra,
  };
}

async function capture(fn) {
  let out = '';
  let err = '';
  const io = {
    stdout: { write: (chunk) => { out += String(chunk); return true; } },
    stderr: { write: (chunk) => { err += String(chunk); return true; } },
  };
  const code = await fn(io);
  return { code, out, err };
}

test('没有变更：静默退出 0，不发起发布请求', async (t) => {
  const backend = await startBackend(t, { plan: { hasChanges: false } });
  const result = await capture((io) => main([], { env: envFor(backend), stdout: io.stdout, stderr: io.stderr }));
  assert.equal(result.code, 0);
  assert.equal(result.out, '');
  assert.equal(backend.calls.filter((call) => call.path === '/cms-api/publish/request').length, 0);
});

test('成功：输出飞书摘要，含数量、短提交和线上地址', async (t) => {
  const backend = await startBackend(t, {
    plan: { hasChanges: true },
    requestBody: { runId: 'run-success' },
    run: {
      runId: 'run-success',
      status: 'succeeded',
      summary: { added: 2, updated: 1, hidden: 1, deleted: 3, topics: 4 },
      commits: { site: 'abcdef1234567890' },
      healthCheck: { url: 'https://example.invalid' },
    },
  });
  const result = await capture((io) => main([], { env: envFor(backend), stdout: io.stdout, stderr: io.stderr }));
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /新增 2、修改 1、隐藏 1、删除 3、专题 4/);
  assert.match(result.out, /站点提交：abcdef1/);
  assert.match(result.out, /线上地址：https:\/\/example\.invalid/);
  const requestCall = backend.calls.find((call) => call.path === '/cms-api/publish/request');
  assert.equal(requestCall.body.trigger, 'bot');
  assert.match(requestCall.headers.authorization, /^users API-Key bot-key$/);
});

test('失败：输出失败步骤和错误，退出码非零', async (t) => {
  const backend = await startBackend(t, {
    plan: { hasChanges: true },
    requestBody: { runId: 'run-failed' },
    run: { runId: 'run-failed', status: 'failed', step: 'deploy', error: '健康检查失败' },
  });
  const result = await capture((io) => main([], { env: envFor(backend), stdout: io.stdout, stderr: io.stderr }));
  assert.equal(result.code, 1);
  assert.match(result.out, /发布失败/);
  assert.match(result.out, /deploy/);
  assert.match(result.out, /健康检查失败/);
});

test('--sync-first：先同步投稿再读发布计划', async (t) => {
  const backend = await startBackend(t, { plan: { hasChanges: false }, syncStatus: 200 });
  const result = await capture((io) => main(['--sync-first'], { env: envFor(backend), stdout: io.stdout, stderr: io.stderr }));
  assert.equal(result.code, 0);
  assert.equal(result.out, '');
  assert.equal(backend.calls[0].path, '/cms-api/submissions/sync');
  assert.equal(backend.calls[0].body.constructor, Object);
});