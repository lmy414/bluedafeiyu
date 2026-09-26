// server/adapters/github.test.mjs —— GitHub Issue 附件入站适配器
//
// 重点性质：
//   1. 只处理 ai-girl-stickers 上带 sticker-submission 标签的 Issue；
//   2. 附件只允许 GitHub 附件域名，https-only，重定向也只能落在白名单；
//   3. 大小 / 超时 / 跳转次数都有上限；
//   4. token 只发给 api.github.com，绝不带给附件域名；
//   5. 幂等：同一 Issue + 附件 id 重复拉取不重复下载、不产生第二条。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { resolveConfig } from '../config.mjs';
import { createQueue } from '../queue.mjs';
import { createGithubAdapter, fetchWithLimits, isAllowedAttachmentUrl } from './github.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const ASSET = 'https://github.com/user-attachments/assets/123e4567-e89b-12d3-a456-426614174000';
const API = 'https://api.github.test';

async function setup(t, { env = {}, fetchImpl, logger } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ghad-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig(
    { storageRoot: path.join(base, 'private'), githubApiBase: API, githubToken: 'gh-token-value' },
    { env },
  );
  const queue = await createQueue(cfg);
  const adapter = createGithubAdapter(cfg, { queue, fetchImpl, logger });
  return { base, cfg, queue, adapter };
}

test('附件地址白名单只认 GitHub 附件域名', () => {
  assert.ok(isAllowedAttachmentUrl(ASSET));
  assert.ok(isAllowedAttachmentUrl('https://user-images.githubusercontent.com/1/abc/x.png'));
  assert.ok(isAllowedAttachmentUrl('https://private-user-images.githubusercontent.com/1/abc/x.png'));
  for (const bad of [
    'http://github.com/user-attachments/assets/1',
    'https://evil.com/user-attachments/assets/1',
    'https://github.com.evil.com/user-attachments/assets/1',
    'https://github.com/lmy414/ai-girl-stickers/raw/main/x.png',
    'https://user-images.githubusercontent.com.evil.com/x.png',
    'https://github.com:8443/user-attachments/assets/1',
    'not a url',
  ]) {
    assert.equal(isAllowedAttachmentUrl(bad), false, bad);
  }
});

test('fetchWithLimits 拒绝跳到白名单外的重定向', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url === ASSET) return new Response(null, { status: 302, headers: { location: 'https://evil.example/x.png' } });
    throw new Error(`不该请求 ${url}`);
  };
  await assert.rejects(
    () => fetchWithLimits(fetchImpl, ASSET, {
      maxBytes: 1024, timeoutMs: 1000, maxRedirects: 3, allowUrl: isAllowedAttachmentUrl,
    }),
    /白名单|重定向/,
  );
  assert.deepEqual(requests, [ASSET]);
});

test('fetchWithLimits 对超大附件与超时都拒绝', async () => {
  const big = async () => new Response(TINY_PNG, { status: 200, headers: { 'content-length': '999999' } });
  await assert.rejects(
    () => fetchWithLimits(big, ASSET, { maxBytes: 10, timeoutMs: 1000, allowUrl: isAllowedAttachmentUrl }),
    /超过大小上限/,
  );
  const hang = () => new Promise(() => {});
  await assert.rejects(
    () => fetchWithLimits(hang, ASSET, { maxBytes: 1024, timeoutMs: 30, allowUrl: isAllowedAttachmentUrl }),
    /超时/,
  );
});

function issueFetch({ issues, downloads, tokenSeen }) {
  return async (url, options = {}) => {
    const headers = options.headers || {};
    const auth = headers.Authorization || headers.authorization || '';
    if (String(url).startsWith(`${API}/`)) {
      if (tokenSeen) tokenSeen.api = auth;
      return new Response(JSON.stringify(issues), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (tokenSeen) tokenSeen.attachment = auth;
    downloads.push(url);
    return new Response(TINY_PNG, { status: 200, headers: { 'content-length': String(TINY_PNG.length) } });
  };
}

const LABELED_ISSUE = {
  number: 7,
  title: '[投稿] 标签测试',
  html_url: 'https://github.com/lmy414/ai-girl-stickers/issues/7',
  user: { login: 'someone' },
  labels: [{ name: 'sticker-submission' }],
  body: `### 图片名称\n\n标签图\n\n### 角色\n\nDeepSeek娘（deepseek · 别名 蓝色大肥鱼）\n\n### 图片文件\n\n![image](${ASSET})`,
};

const UNLABELED_ISSUE = { ...LABELED_ISSUE, number: 8, title: '普通 bug', labels: [{ name: 'bug' }] };

test('只处理带 sticker-submission 标签的 Issue，并只发给白名单域名', async (t) => {
  const downloads = [];
  const tokenSeen = {};
  const { queue, adapter } = await setup(t, {
    fetchImpl: issueFetch({ issues: [LABELED_ISSUE, UNLABELED_ISSUE], downloads, tokenSeen }),
  });
  const results = await adapter.pullIssues();
  const staged = results.filter((entry) => entry.status === 'staged');
  assert.equal(staged.length, 1);
  const items = await queue.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'github-issue');
  assert.equal(items[0].fields.name, '标签图');
  assert.equal(items[0].fields.character, 'deepseek');
  assert.ok(items[0].sourceIds[0].startsWith('github:lmy414/ai-girl-stickers#7:'));
  assert.deepEqual(downloads, [ASSET]);
  assert.match(tokenSeen.api || '', /^Bearer gh-token-value$/);
  assert.equal(tokenSeen.attachment, '', '附件请求不能带 token');
});

test('重复拉取不重复下载、不产生第二条', async (t) => {
  const downloads = [];
  const { queue, adapter } = await setup(t, {
    fetchImpl: issueFetch({ issues: [LABELED_ISSUE], downloads, tokenSeen: {} }),
  });
  const first = await adapter.pullIssues();
  const second = await adapter.pullIssues();
  assert.equal(first[0].status, 'staged');
  assert.match(second[0].status, /duplicate/);
  assert.equal(downloads.length, 1);
  assert.equal((await queue.list()).length, 1);
});

test('非白名单附件地址直接失败，不发起下载', async (t) => {
  const downloads = [];
  const evil = {
    ...LABELED_ISSUE,
    body: '### 图片文件\n\n![image](https://evil.example/x.png)',
  };
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith(`${API}/`)) {
      return new Response(JSON.stringify([evil]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    downloads.push(url);
    return new Response(TINY_PNG, { status: 200 });
  };
  const { queue, adapter } = await setup(t, { fetchImpl });
  const results = await adapter.pullIssues();
  assert.equal(results.length, 0);
  assert.equal(downloads.length, 0);
  assert.equal((await queue.list()).length, 0);
});

test('附件下载超时记为失败而不是静默通过', async (t) => {
  const fetchImpl = async (url) => {
    if (String(url).startsWith(`${API}/`)) {
      return new Response(JSON.stringify([LABELED_ISSUE]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Promise(() => {});
  };
  const { queue, adapter } = await setup(t, { fetchImpl, env: { SUBMISSION_GITHUB_TIMEOUT_MS: '30' } });
  const results = await adapter.pullIssues();
  assert.equal(results[0].status, 'failed');
  assert.match(results[0].error, /超时/);
  assert.equal((await queue.list()).length, 0);
});

/* ------------------------------------------------ 出站安全：URL 脱敏与 token 作用域 */

const JWT = 'eyJhbGciOiJIUzI1NiJ9.SECRET-SIGNATURE-VALUE';

test('apiHeaders 只对 https 且 host 与 apiBase 完全一致的地址带 token', async (t) => {
  const { adapter } = await setup(t, { fetchImpl: async () => new Response('[]', { status: 200 }) });

  assert.match(adapter.apiHeaders(`${API}/repos/lmy414/ai-girl-stickers/issues`).Authorization || '', /^Bearer gh-token-value$/);

  for (const url of [
    'https://api.github.com/repos/x',            // 与配置的 apiBase host 不同
    'https://api.github.test.evil.com/x',        // 后缀仿冒
    'https://evil.com/api.github.test/x',        // 别的 host
    'http://api.github.test/x',                  // 非 https
    'https://api.github.test:8443/x',            // host（含端口）不完全一致
    'https://user:pass@api.github.test/x',       // 带凭据
    'not a url',
  ]) {
    assert.equal(adapter.apiHeaders(url).Authorization, undefined, url);
  }
  // 不传地址时绝不默认带 token
  assert.equal(adapter.apiHeaders().Authorization, undefined);
});

test('带 jwt query 的私有附件：原样下载，origin / 结果 / sourceId 只留脱敏地址', async (t) => {
  const downloads = [];
  const tokenSeen = {};
  const rawUrl = `https://private-user-images.githubusercontent.com/123/4567890-deadbeef.png?jwt=${JWT}&foo=bar`;
  const issue = {
    ...LABELED_ISSUE,
    number: 11,
    body: `### 图片名称\n\n私有签名图\n\n### 图片文件\n\n![image](${rawUrl})`,
  };
  const { queue, adapter } = await setup(t, {
    fetchImpl: issueFetch({ issues: [issue], downloads, tokenSeen }),
  });
  const results = await adapter.pullIssues();

  assert.equal(results[0].status, 'staged');
  assert.deepEqual(downloads, [rawUrl], '实际下载必须用带签名的原始地址');
  assert.equal(tokenSeen.attachment, '', '附件请求不能带 token');

  const items = await queue.list();
  assert.equal(items.length, 1);
  assert.ok(!String(items[0].origin.assetUrl).includes(JWT), 'origin.assetUrl 泄漏了 jwt');
  assert.ok(!JSON.stringify(items[0].origin).includes(JWT), 'origin 里泄漏了 jwt');
  assert.ok(!JSON.stringify(items[0].sourceIds).includes(JWT), 'sourceId 泄漏了 jwt');
  assert.ok(!JSON.stringify(results).includes(JWT), '返回结果里泄漏了 jwt');
  assert.ok(String(items[0].origin.assetUrl).includes('4567890-deadbeef.png'), '脱敏不能把图片地址删掉');
  assert.ok(String(items[0].origin.assetUrl).includes('foo=bar'), '不该顺手删掉非敏感参数');
});

test('带 jwt fragment 的私有附件同样只留脱敏地址', async (t) => {
  const downloads = [];
  const rawUrl = `https://private-user-images.githubusercontent.com/123/4567890-cafe.png#jwt=${JWT}`;
  const issue = {
    ...LABELED_ISSUE,
    number: 13,
    body: `### 图片名称\n\nfragment 签名图\n\n### 图片文件\n\n![image](${rawUrl})`,
  };
  const { queue, adapter } = await setup(t, {
    fetchImpl: issueFetch({ issues: [issue], downloads, tokenSeen: {} }),
  });
  await adapter.pullIssues();
  assert.deepEqual(downloads, [rawUrl]);
  const items = await queue.list();
  assert.equal(items.length, 1);
  assert.ok(!JSON.stringify(items[0]).includes(JWT), 'fragment jwt 泄漏进了条目');
  assert.ok(String(items[0].origin.assetUrl).includes('4567890-cafe.png'));
});

test('附件下载失败时，错误信息与日志都不带原始签名串', async (t) => {
  const secret = 'SECRET-JWT-VALUE-9000';
  const rawUrl = `https://private-user-images.githubusercontent.com/123/fail-9000.png?jwt=${secret}`;
  const logged = [];
  const logger = { error: (...args) => logged.push(args.join(' ')), log() {}, warn() {} };
  const issue = {
    ...LABELED_ISSUE,
    number: 12,
    body: `### 图片文件\n\n![image](${rawUrl})`,
  };
  const fetchImpl = async (url) => {
    if (String(url).startsWith(`${API}/`)) {
      return new Response(JSON.stringify([issue]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('nope', { status: 500, statusText: 'Server Error' });
  };
  const { queue, adapter } = await setup(t, { fetchImpl, logger });
  const results = await adapter.pullIssues();

  assert.equal(results[0].status, 'failed');
  assert.ok(!results[0].error.includes(secret), '错误信息泄漏了 jwt');
  assert.ok(!results[0].url.includes(secret), '结果 url 泄漏了 jwt');
  assert.ok(!logged.join('\n').includes(secret), '日志泄漏了 jwt');
  assert.equal((await queue.list()).length, 0);
});
