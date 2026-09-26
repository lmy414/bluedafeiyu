#!/usr/bin/env node
/* tools/intake/core.test.mjs —— intake 核心的安全与健壮性回归测试（零依赖）
 *
 *   node tools/intake/core.test.mjs        # 或 node --test tools/intake/core.test.mjs
 *
 * 覆盖安全审查要求的那几条性质：
 *   1. githubJson：AbortController 超时、redirect:'manual'、每跳只允许 apiBase 同源、
 *      Authorization 不泄漏到非 API 主机；
 *   2. downloadAttachment：超时、redirect:'manual'、每跳只过附件白名单、不带 API token；
 *   3. pull-issues：Issue labels 二次核对 sticker-submission；
 *   4. URL query 里的 jwt 等敏感参数在写 origin / 日志前被剥离；
 *   5. 坏 meta 不让 list / verify / pull 整体崩；
 *   6. 并发写同一目标不会因临时文件名冲突而失败；
 *   7. 内容仓自动发现不依赖任何 JSON 清单。
 *
 * 全程离线：GitHub 出站一律用注入的 fetchImpl 假实现，中转区落在系统临时目录。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  downloadAttachment,
  githubJson,
  hasStickerSubmissionLabel,
  listItems,
  looksLikeContentRepo,
  pullIssueAttachments,
  redactUrl,
  resolveConfig,
  stageBuffer,
  verifyItems,
} from './core.mjs';

/* 一个真的 1x1 PNG，用来造合法图片字节 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const ASSET_URL = 'https://github.com/user-attachments/assets/123e4567-e89b-12d3-a456-426614174000';

async function makeContentDir(base) {
  const dir = path.join(base, 'content');
  await fs.mkdir(path.join(dir, '.git'), { recursive: true });
  await fs.mkdir(path.join(dir, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  await fs.writeFile(path.join(dir, '.github', 'ISSUE_TEMPLATE', 'sticker-submission.yml'), 'name: 投稿\n');
  await fs.mkdir(path.join(dir, 'dist', 'submissions', 'originals'), { recursive: true });
  return dir;
}

/** 在临时目录里搭一份可用的 cfg（中转区在仓库外）。 */
async function makeCfg(t, overrides = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'intake-core-test-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const contentDir = await makeContentDir(tmp);
  return resolveConfig({ contentDir, root: path.join(tmp, 'intake'), ...overrides });
}

function pngResponse() {
  return new Response(TINY_PNG, { status: 200, headers: { 'content-length': String(TINY_PNG.length) } });
}

function hangingFetch(_url, opts = {}) {
  return new Promise((_, reject) => {
    opts.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')));
  });
}

/* ------------------------------------------------------- 1. githubJson */

test('githubJson 用 redirect:manual 且只跟随 apiBase 同源重定向', async (t) => {
  const calls = [];
  const cfg = await makeCfg(t, {
    apiBase: 'https://api.github.com',
    token: 'secret-token',
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      if (url === 'https://api.github.com/repos/o/r/issues/1') {
        return new Response(null, { status: 302, headers: { location: '/repos/o/r/issues/1?redirected=1' } });
      }
      return new Response(JSON.stringify({ number: 1 }), { status: 200 });
    },
  });

  const { json } = await githubJson(cfg, 'https://api.github.com/repos/o/r/issues/1');
  assert.equal(json.number, 1);
  assert.equal(calls.length, 2, '应跟随一次同源重定向');
  for (const call of calls) {
    assert.equal(call.opts.redirect, 'manual');
    assert.equal(call.opts.headers.Authorization, 'Bearer secret-token');
  }
});

test('githubJson 拒绝跳到非 apiBase 主机，且不会把 Authorization 送到那里', async (t) => {
  const calls = [];
  const cfg = await makeCfg(t, {
    apiBase: 'https://api.github.com',
    token: 'secret-token',
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
    },
  });

  await assert.rejects(
    () => githubJson(cfg, 'https://api.github.com/repos/o/r/issues/1'),
    /重定向|白名单|不允许/,
  );
  assert.equal(calls.length, 1, '跨站重定向必须在本跳被拦下，不能发出第二跳');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer secret-token');
});

test('githubJson 对初始就不同源的主机直接拒绝，且不发请求（更不会带 token）', async (t) => {
  let called = 0;
  const cfg = await makeCfg(t, {
    apiBase: 'https://api.github.com',
    token: 'secret-token',
    fetchImpl: async () => { called += 1; return new Response('{}', { status: 200 }); },
  });

  await assert.rejects(() => githubJson(cfg, 'https://evil.example/x'), /不允许|白名单/);
  assert.equal(called, 0);
});

test('githubJson 超时会中止请求', async (t) => {
  const cfg = await makeCfg(t, {
    apiBase: 'https://api.github.com',
    timeoutMs: 30,
    fetchImpl: hangingFetch,
  });
  await assert.rejects(() => githubJson(cfg, 'https://api.github.com/repos/o/r/issues'), /超时/);
});

/* --------------------------------------------- 2. downloadAttachment */

test('downloadAttachment 带 User-Agent、redirect:manual，且绝不带 API token', async (t) => {
  const calls = [];
  const cfg = await makeCfg(t, {
    token: 'secret-token',
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return pngResponse(); },
  });

  const buffer = await downloadAttachment(cfg, ASSET_URL);
  assert.deepEqual(buffer, TINY_PNG);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.redirect, 'manual');
  assert.equal(calls[0].opts.headers.Authorization, undefined);
  assert.ok(calls[0].opts.headers['User-Agent']);
});

test('downloadAttachment 每一跳都过白名单：白名单内跳转可跟随且仍不带 token', async (t) => {
  const calls = [];
  const redirectTarget = 'https://private-user-images.githubusercontent.com/1/a.png?jwt=SECRET';
  const cfg = await makeCfg(t, {
    token: 'secret-token',
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      if (url === ASSET_URL) return new Response(null, { status: 302, headers: { location: redirectTarget } });
      return pngResponse();
    },
  });

  const buffer = await downloadAttachment(cfg, ASSET_URL);
  assert.deepEqual(buffer, TINY_PNG);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, redirectTarget);
  assert.equal(calls[1].opts.headers.Authorization, undefined);
});

test('downloadAttachment 拒绝跳到白名单外的主机，且不发出第二跳', async (t) => {
  const calls = [];
  const cfg = await makeCfg(t, {
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal.png' } });
    },
  });

  await assert.rejects(() => downloadAttachment(cfg, ASSET_URL), /白名单|不允许|重定向/);
  assert.equal(calls.length, 1);
});

test('downloadAttachment 对白名单外的初始地址直接拒绝，不发请求', async (t) => {
  let called = 0;
  const cfg = await makeCfg(t, {
    fetchImpl: async () => { called += 1; return pngResponse(); },
  });
  await assert.rejects(() => downloadAttachment(cfg, 'https://evil.example/x.png'), /白名单|不允许/);
  assert.equal(called, 0);
});

test('downloadAttachment 超时会中止请求', async (t) => {
  const cfg = await makeCfg(t, { timeoutMs: 30, fetchImpl: hangingFetch });
  await assert.rejects(() => downloadAttachment(cfg, ASSET_URL), /超时/);
});

/* ---------------------------------------------- 3. sticker-submission 标签 */

test('hasStickerSubmissionLabel 同时认对象标签与字符串标签', () => {
  assert.equal(hasStickerSubmissionLabel({ labels: [{ name: 'sticker-submission' }] }), true);
  assert.equal(hasStickerSubmissionLabel({ labels: ['sticker-submission'] }), true);
  assert.equal(hasStickerSubmissionLabel({ labels: [{ name: 'bug' }] }), false);
  assert.equal(hasStickerSubmissionLabel({}), false);
});

test('列表路径：未打 sticker-submission 标签的 Issue 不下载附件', async (t) => {
  const downloads = [];
  const labeledUrl = 'https://github.com/user-attachments/assets/aaaaaa000000000000000000000000000001';
  const unlabeledUrl = 'https://github.com/user-attachments/assets/bbbbbb000000000000000000000000000002';
  const cfg = await makeCfg(t, {
    fetchImpl: async (url) => {
      if (url.includes('/issues?')) {
        return new Response(JSON.stringify([
          { number: 1, title: '投稿', html_url: 'u1', user: { login: 'x' }, labels: [{ name: 'sticker-submission' }], body: `### 图片名称\n\n图A\n\n![image](${labeledUrl})` },
          { number: 2, title: '闲聊', html_url: 'u2', user: { login: 'y' }, labels: [{ name: 'bug' }], body: `### 图片名称\n\n图B\n\n![image](${unlabeledUrl})` },
        ]), { status: 200 });
      }
      downloads.push(url);
      return pngResponse();
    },
  });

  const results = await pullIssueAttachments(cfg, {});
  const staged = results.filter((entry) => entry.status === 'staged');
  assert.equal(staged.length, 1);
  assert.equal(staged[0].issue, 1);
  assert.deepEqual(downloads, [labeledUrl], '未打标签的附件绝不能下载');
});

test('直接指定 Issue 时同样二次核对标签', async (t) => {
  const downloads = [];
  const cfg = await makeCfg(t, {
    fetchImpl: async (url) => {
      if (url.endsWith('/issues/42')) {
        return new Response(JSON.stringify({
          number: 42, title: '非投稿', html_url: 'u42', user: { login: 'y' },
          labels: [{ name: 'question' }],
          body: `### 图片名称\n\n图\n\n![image](${ASSET_URL})`,
        }), { status: 200 });
      }
      downloads.push(url);
      return pngResponse();
    },
  });

  const results = await pullIssueAttachments(cfg, { issue: 42 });
  assert.equal(downloads.length, 0);
  assert.ok(results.length >= 1);
  assert.ok(results.every((entry) => entry.status === 'skipped'));
});

/* ------------------------------------------------- 4. 敏感 query 剥离 */

test('redactUrl 剥离 jwt 等敏感参数，保留其它参数', () => {
  const out = redactUrl('https://private-user-images.githubusercontent.com/1/a.png?jwt=SECRET&x=1');
  assert.ok(!out.includes('SECRET'), out);
  assert.ok(!/[?&]jwt=/.test(out), out);
  assert.ok(out.includes('x=1'), out);
  assert.equal(redactUrl('dist/submissions/originals/x.png'), 'dist/submissions/originals/x.png');
});

test('redactUrl 同样剥离 fragment 里的敏感参数，但不动普通锚点', () => {
  const out = redactUrl('https://private-user-images.githubusercontent.com/1/a.png#jwt=SECRET&x=1');
  assert.ok(!out.includes('SECRET'), out);
  assert.ok(!/#jwt=/.test(out), out);
  assert.ok(out.includes('#x=1'), out);
  assert.equal(
    redactUrl('https://example.com/doc#section-2'),
    'https://example.com/doc#section-2',
    '普通锚点必须原样保留',
  );
  assert.equal(
    redactUrl('https://example.com/doc#token'),
    'https://example.com/doc#token',
    '不形如 key=value 的锚点不能当参数删掉',
  );
});

test('private-user-images 的 jwt 不会写进 origin / 结果 / 日志', async (t) => {
  const secret = 'SECRETJWT-abcdef';
  const assetUrl = `https://private-user-images.githubusercontent.com/123/abc.png?jwt=${secret}&foo=bar`;
  const cfg = await makeCfg(t, {
    fetchImpl: async (url) => {
      if (url.endsWith('/issues/7')) {
        return new Response(JSON.stringify({
          number: 7, title: '投稿', html_url: 'u7', user: { login: 'z' },
          labels: [{ name: 'sticker-submission' }],
          body: `### 图片名称\n\n带 jwt 的图\n\n![image](${assetUrl})`,
        }), { status: 200 });
      }
      return pngResponse();
    },
  });

  const results = await pullIssueAttachments(cfg, { issue: 7 });
  for (const entry of results) {
    assert.ok(!String(entry.url || '').includes(secret), `结果 url 泄漏了 jwt：${entry.url}`);
  }

  const items = await listItems(cfg);
  assert.equal(items.length, 1);
  assert.ok(!String(items[0].origin.assetUrl).includes(secret), 'origin.assetUrl 泄漏了 jwt');
  assert.ok(!String(items[0].origin.assetId).includes(secret), 'origin.assetId 泄漏了 jwt');

  const meta = await fs.readFile(
    path.join(cfg.metaDir, `${items[0].sha256}.json`),
    'utf8',
  );
  assert.ok(!meta.includes(secret), 'meta 文件里仍有 jwt');

  const log = await fs.readFile(path.join(cfg.logDir, 'intake.log'), 'utf8');
  assert.ok(!log.includes(secret), '日志里仍有 jwt');
});

test('fragment 里的 jwt 也不会写进 origin / 结果 / 日志', async (t) => {
  const secret = 'FRAGJWT-xyz789';
  const assetUrl = `https://private-user-images.githubusercontent.com/123/abc.png#jwt=${secret}`;
  const cfg = await makeCfg(t, {
    fetchImpl: async (url) => {
      if (url.endsWith('/issues/8')) {
        return new Response(JSON.stringify({
          number: 8, title: '投稿', html_url: 'u8', user: { login: 'z' },
          labels: [{ name: 'sticker-submission' }],
          body: `### 图片名称\n\nfragment 带 jwt 的图\n\n![image](${assetUrl})`,
        }), { status: 200 });
      }
      return pngResponse();
    },
  });

  const results = await pullIssueAttachments(cfg, { issue: 8 });
  for (const entry of results) {
    assert.ok(!String(entry.url || '').includes(secret), `结果 url 泄漏了 fragment jwt：${entry.url}`);
  }

  const items = await listItems(cfg);
  assert.equal(items.length, 1);
  assert.ok(!String(items[0].origin.assetUrl).includes(secret), 'origin.assetUrl 泄漏了 fragment jwt');
  assert.ok(!String(items[0].origin.assetId).includes(secret), 'origin.assetId 泄漏了 fragment jwt');

  const meta = await fs.readFile(path.join(cfg.metaDir, `${items[0].sha256}.json`), 'utf8');
  assert.ok(!meta.includes(secret), 'meta 文件里仍有 fragment jwt');

  const log = await fs.readFile(path.join(cfg.logDir, 'intake.log'), 'utf8');
  assert.ok(!log.includes(secret), '日志里仍有 fragment jwt');
});

/* ------------------------------------------- 5. 坏 meta 的健壮性 */

test('坏 meta 不会让 list / verify / pull 整体崩', async (t) => {
  const cfg = await makeCfg(t, {
    fetchImpl: async (url) => {
      if (url.endsWith('/issues/3')) {
        return new Response(JSON.stringify({
          number: 3, title: '投稿', html_url: 'u3', user: { login: 'z' },
          labels: [{ name: 'sticker-submission' }],
          body: `### 图片名称\n\n新图\n\n![image](${ASSET_URL})`,
        }), { status: 200 });
      }
      return pngResponse();
    },
  });

  await stageBuffer(cfg, TINY_PNG, { source: 'local', name: 'ok.png' });
  await fs.writeFile(path.join(cfg.metaDir, `${'a'.repeat(64)}.json`), '{ this is not json');
  await fs.writeFile(path.join(cfg.metaDir, `${'b'.repeat(64)}.json`), 'null');
  await fs.writeFile(path.join(cfg.metaDir, `${'c'.repeat(64)}.json`), '[1,2,3]');

  const items = await listItems(cfg);
  assert.equal(items.length, 1, '合法记录必须保留');

  const reports = await verifyItems(cfg);
  assert.equal(reports.length, 1);

  const results = await pullIssueAttachments(cfg, { issue: 3 });
  assert.ok(results.some((entry) => entry.status === 'staged' || entry.status === 'duplicate'));
});

/* ------------------------------------------- 6. 临时文件并发安全 */

test('并发写同一 sha256 不会因临时文件名冲突而失败', async (t) => {
  const cfg = await makeCfg(t);
  const results = await Promise.all(
    Array.from({ length: 8 }, () => stageBuffer(cfg, TINY_PNG, { source: 'local', name: 'race.png' })),
  );
  assert.ok(results.every((entry) => entry.status === 'staged' || entry.status === 'duplicate'));
  const items = await listItems(cfg);
  assert.equal(items.length, 1);
});

/* ------------------------------------------- 7. 内容仓自动发现不依赖 JSON */

test('内容仓自动发现不依赖任何 JSON 清单', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'intake-content-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const dir = path.join(tmp, 'content');
  await fs.mkdir(path.join(dir, '.git'), { recursive: true });
  await fs.mkdir(path.join(dir, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  await fs.writeFile(path.join(dir, '.github', 'ISSUE_TEMPLATE', 'sticker-submission.yml'), 'name: 投稿\n');
  await fs.mkdir(path.join(dir, 'dist', 'submissions', 'originals'), { recursive: true });

  assert.equal(await looksLikeContentRepo(dir), true, '没有 JSON 清单也应是内容仓');
});

test('只有 JSON 清单、缺图片目录的不算内容仓', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'intake-content-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const dir = path.join(tmp, 'content');
  await fs.mkdir(path.join(dir, '.git'), { recursive: true });
  await fs.mkdir(path.join(dir, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  await fs.writeFile(path.join(dir, '.github', 'ISSUE_TEMPLATE', 'sticker-submission.yml'), 'name: 投稿\n');
  await fs.mkdir(path.join(dir, 'data'), { recursive: true });
  await fs.writeFile(path.join(dir, 'data', 'works.json'), '[]\n');

  assert.equal(await looksLikeContentRepo(dir), false);
});
