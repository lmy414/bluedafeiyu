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

async function setup(t, { env = {}, fetchImpl, logger, stateFile, sleep, ...adapterOptions } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ghad-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig(
    { storageRoot: path.join(base, 'private'), githubApiBase: API, githubToken: 'gh-token-value' },
    { env },
  );
  const queue = await createQueue(cfg);
  const adapter = createGithubAdapter(cfg, { queue, fetchImpl, logger, stateFile, sleep, ...adapterOptions });
  return { base, cfg, queue, adapter };
}

/* 记录每一次出站请求（方法 / 地址），供「只读」「分页」「重试」等性质断言。 */
function recordingFetch(handler, calls = []) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), method: String(options.method || 'GET').toUpperCase(), headers: options.headers || {} });
    return handler(String(url), options, calls);
  };
}

/* 分页 Issue 列表模拟：pages 为 [{ issues, next }]，next 为完整 URL（缺省表示没有下一页）。 */
function pagedIssueFetch({ pages, downloads = [], attachment, calls = [] } = {}) {
  const fetchImpl = recordingFetch((url, options) => {
    const target = new URL(url);
    if (url.startsWith(`${API}/`)) {
      const page = Number(target.searchParams.get('page') || '1');
      const entry = pages[page - 1];
      if (!entry) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      const headers = { 'content-type': 'application/json' };
      if (entry.next) headers.link = `<${entry.next}>; rel="next"`;
      return new Response(JSON.stringify(entry.issues), { status: 200, headers });
    }
    downloads.push(url);
    if (attachment) return attachment(url);
    return new Response(TINY_PNG, { status: 200, headers: { 'content-length': String(TINY_PNG.length) } });
  }, calls);
  fetchImpl.calls = calls;
  return fetchImpl;
}

function listUrlFor(repo = 'lmy414/ai-girl-stickers', extra = '') {
  return `${API}/repos/${repo}/issues?state=open&labels=sticker-submission&per_page=100&sort=updated&direction=asc${extra}`;
}

function issueWithAsset({ number, assetId, updatedAt, name = `图${number}` }) {
  return {
    number,
    title: `[投稿] ${name}`,
    html_url: `https://github.com/lmy414/ai-girl-stickers/issues/${number}`,
    user: { login: 'someone' },
    labels: [{ name: 'sticker-submission' }],
    updated_at: updatedAt,
    body: `### 图片名称\n\n${name}\n\n### 角色\n\nDeepSeek娘（deepseek · 别名 蓝色大肥鱼）\n\n### 图片文件\n\n![image](https://github.com/user-attachments/assets/${assetId})`,
  };
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

/* ------------------------------------------------ 分页：Link rel=next、同源、页数上限 */

test('列表拉取按 Link rel="next" 分页，逐页处理附件', async (t) => {
  const first = issueWithAsset({ number: 21, assetId: 'aaaaaaa1-1111-4111-8111-aaaaaaaaaaa1', updatedAt: '2026-09-01T00:00:00Z', name: '第一页' });
  const second = issueWithAsset({ number: 22, assetId: 'bbbbbbb2-2222-4222-8222-bbbbbbbbbbb2', updatedAt: '2026-09-02T00:00:00Z', name: '第二页' });
  const downloads = [];
  const fetchImpl = pagedIssueFetch({
    pages: [
      { issues: [first], next: `${listUrlFor()}&page=2` },
      { issues: [second] },
    ],
    downloads,
    /* 两页附件内容必须不同，否则会命中 sha256 去重变成 duplicate_hash */
    attachment: (url) => new Response(
      Buffer.concat([TINY_PNG, Buffer.from(url.includes('aaaaaaa1') ? 'page-1' : 'page-2')]),
      { status: 200 },
    ),
  });
  const { queue, adapter } = await setup(t, { fetchImpl });
  const results = await adapter.pullIssues();

  assert.deepEqual(results.map((entry) => entry.status), ['staged', 'staged']);
  assert.equal((await queue.list()).length, 2);
  assert.equal(downloads.length, 2);
  assert.equal(fetchImpl.calls.filter((call) => call.url.startsWith(`${API}/`)).length, 2);
});

test('maxPages 限制翻页数量，不无限追 next', async (t) => {
  const downloads = [];
  const fetchImpl = pagedIssueFetch({
    pages: [
      { issues: [issueWithAsset({ number: 31, assetId: 'aaaaaaa3-1111-4111-8111-aaaaaaaaaaa3', updatedAt: '2026-09-01T00:00:00Z' })], next: `${listUrlFor()}&page=2` },
      { issues: [issueWithAsset({ number: 32, assetId: 'bbbbbbb4-2222-4222-8222-bbbbbbbbbbb4', updatedAt: '2026-09-02T00:00:00Z' })], next: `${listUrlFor()}&page=3` },
      { issues: [issueWithAsset({ number: 33, assetId: 'ccccccc5-3333-4333-8333-ccccccccccc5', updatedAt: '2026-09-03T00:00:00Z' })] },
    ],
    downloads,
  });
  const { queue, adapter } = await setup(t, { fetchImpl });
  const results = await adapter.pullIssues({ maxPages: 1 });

  assert.equal(results.length, 1);
  assert.equal((await queue.list()).length, 1);
  assert.equal(fetchImpl.calls.filter((call) => call.url.startsWith(`${API}/`)).length, 1);
});

test('Link 指向 API 同源之外时不跟随', async (t) => {
  const downloads = [];
  const fetchImpl = pagedIssueFetch({
    pages: [{ issues: [issueWithAsset({ number: 41, assetId: 'aaaaaaa6-1111-4111-8111-aaaaaaaaaaa6', updatedAt: '2026-09-01T00:00:00Z' })], next: 'https://evil.example/repos/x/issues?page=2' }],
    downloads,
  });
  const { queue, adapter } = await setup(t, { fetchImpl });
  const results = await adapter.pullIssues();

  assert.equal(results.length, 1);
  assert.equal((await queue.list()).length, 1);
  assert.ok(!fetchImpl.calls.some((call) => call.url.includes('evil.example')), '不得请求白名单外的主机');
});

/* ------------------------------------------------ since 增量游标：持久化到私有 state */

test('since 游标写入私有 storage state，并在下次拉取带上 since', async (t) => {
  const downloads = [];
  const early = issueWithAsset({ number: 51, assetId: 'aaaaaaa7-1111-4111-8111-aaaaaaaaaaa7', updatedAt: '2026-09-01T00:00:00Z' });
  const late = issueWithAsset({ number: 52, assetId: 'bbbbbbb8-2222-4222-8222-bbbbbbbbbbb8', updatedAt: '2026-09-05T00:00:00Z' });
  const fetchImpl = pagedIssueFetch({ pages: [{ issues: [early, late] }], downloads });
  const { cfg, adapter } = await setup(t, { fetchImpl });

  await adapter.pullIssues();
  assert.equal(fetchImpl.calls[0].url.includes('since='), false, '首次没有游标就不该带 since');

  assert.ok(adapter.stateFile.startsWith(cfg.paths.state), '游标必须落在私有 storage state 目录');
  const state = JSON.parse(await fs.readFile(adapter.stateFile, 'utf8'));
  assert.equal(state.since, '2026-09-05T00:00:00Z');
  assert.equal(state.repo, 'lmy414/ai-girl-stickers');
  assert.equal(state.label, 'sticker-submission');
  const text = await fs.readFile(adapter.stateFile, 'utf8');
  assert.ok(!text.includes('gh-token-value'), '游标文件不得含 token');
  assert.ok(!text.includes(JWT), '游标文件不得含签名串');

  fetchImpl.calls.length = 0;
  await adapter.pullIssues();
  assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('since'), '2026-09-05T00:00:00Z');
});

test('since=null 强制全量，忽略已存游标', async (t) => {
  const fetchImpl = pagedIssueFetch({ pages: [{ issues: [issueWithAsset({ number: 61, assetId: 'aaaaaaa9-1111-4111-8111-aaaaaaaaaaa9', updatedAt: '2026-09-01T00:00:00Z' })] }] });
  const { adapter } = await setup(t, { fetchImpl });
  await adapter.pullIssues();
  fetchImpl.calls.length = 0;
  await adapter.pullIssues({ since: null });
  assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('since'), null);
});

test('显式 since 覆盖已存游标', async (t) => {
  const fetchImpl = pagedIssueFetch({ pages: [{ issues: [issueWithAsset({ number: 71, assetId: 'aaaaaa10-1111-4111-8111-aaaaaaaaaa10', updatedAt: '2026-09-01T00:00:00Z' })] }] });
  const { adapter } = await setup(t, { fetchImpl });
  await adapter.pullIssues();
  fetchImpl.calls.length = 0;
  await adapter.pullIssues({ since: '2026-01-01T00:00:00Z' });
  assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('since'), '2026-01-01T00:00:00Z');
});

test('仓库 / 标签变化时忽略旧游标，避免跨仓串用', async (t) => {
  const fetchImpl = pagedIssueFetch({ pages: [{ issues: [issueWithAsset({ number: 81, assetId: 'aaaaaa11-1111-4111-8111-aaaaaaaaaa11', updatedAt: '2026-09-01T00:00:00Z' })] }] });
  const { adapter } = await setup(t, { fetchImpl });
  await fs.writeFile(adapter.stateFile, JSON.stringify({
    schema: 'submission-server/github-pull/1', repo: 'other/repo', label: 'sticker-submission', since: '2020-01-01T00:00:00Z',
  }));
  await adapter.pullIssues();
  assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('since'), null);
});

test('坏掉的游标文件不致命，退回全量拉取', async (t) => {
  const fetchImpl = pagedIssueFetch({ pages: [{ issues: [issueWithAsset({ number: 91, assetId: 'aaaaaa12-1111-4111-8111-aaaaaaaaaa12', updatedAt: '2026-09-01T00:00:00Z' })] }] });
  const { queue, adapter } = await setup(t, { fetchImpl });
  await fs.writeFile(adapter.stateFile, '{ this is not json');
  const results = await adapter.pullIssues();
  assert.equal(results[0].status, 'staged');
  assert.equal((await queue.list()).length, 1);
});

/* ------------------------------------------------ 429 / 5xx / 网络超时：有限退避重试 */

test('5xx 有限退避重试，退避指数增长且有上限', async (t) => {
  const delays = [];
  const sleep = async (ms) => { delays.push(ms); };
  let apiAttempts = 0;
  const issue = issueWithAsset({ number: 101, assetId: 'aaaaaa13-1111-4111-8111-aaaaaaaaaa13', updatedAt: '2026-09-01T00:00:00Z' });
  const fetchImpl = async (url) => {
    if (String(url).startsWith(`${API}/`)) {
      apiAttempts += 1;
      if (apiAttempts <= 2) return new Response('busy', { status: 503, statusText: 'Service Unavailable' });
      return new Response(JSON.stringify([issue]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(TINY_PNG, { status: 200, headers: { 'content-length': String(TINY_PNG.length) } });
  };
  const { adapter } = await setup(t, {
    fetchImpl,
    sleep,
    env: { SUBMISSION_GITHUB_MAX_RETRIES: '3', SUBMISSION_GITHUB_RETRY_BASE_MS: '100', SUBMISSION_GITHUB_RETRY_MAX_MS: '10000' },
  });
  const results = await adapter.pullIssues();
  assert.equal(apiAttempts, 3);
  assert.equal(results[0].status, 'staged');
  assert.deepEqual(delays, [100, 200]);
});

test('429 尊重 Retry-After，但受退避上限约束', async (t) => {
  const delays = [];
  const sleep = async (ms) => { delays.push(ms); };
  let apiAttempts = 0;
  const issue = issueWithAsset({ number: 111, assetId: 'aaaaaa14-1111-4111-8111-aaaaaaaaaa14', updatedAt: '2026-09-01T00:00:00Z' });
  const fetchImpl = async (url) => {
    if (String(url).startsWith(`${API}/`)) {
      apiAttempts += 1;
      if (apiAttempts === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '120' } });
      return new Response(JSON.stringify([issue]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(TINY_PNG, { status: 200 });
  };
  const { adapter } = await setup(t, {
    fetchImpl,
    sleep,
    env: { SUBMISSION_GITHUB_MAX_RETRIES: '2', SUBMISSION_GITHUB_RETRY_BASE_MS: '100', SUBMISSION_GITHUB_RETRY_MAX_MS: '1000' },
  });
  await adapter.pullIssues();
  assert.equal(apiAttempts, 2);
  assert.equal(delays.length, 1);
  assert.ok(delays[0] > 0 && delays[0] <= 1000, `退避要有限，实际 ${delays[0]}`);
});

test('网络错误 / 超时退避重试后成功', async (t) => {
  const delays = [];
  const sleep = async (ms) => { delays.push(ms); };
  let apiAttempts = 0;
  const issue = issueWithAsset({ number: 121, assetId: 'aaaaaa15-1111-4111-8111-aaaaaaaaaa15', updatedAt: '2026-09-01T00:00:00Z' });
  const fetchImpl = async (url) => {
    if (String(url).startsWith(`${API}/`)) {
      apiAttempts += 1;
      if (apiAttempts === 1) throw new Error('socket hang up');
      return new Response(JSON.stringify([issue]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(TINY_PNG, { status: 200 });
  };
  const { adapter } = await setup(t, { fetchImpl, sleep, env: { SUBMISSION_GITHUB_RETRY_BASE_MS: '50' } });
  const results = await adapter.pullIssues();
  assert.equal(apiAttempts, 2);
  assert.equal(results[0].status, 'staged');
  assert.equal(delays.length, 1);
});

test('重试耗尽后抛错；4xx（非 429）不重试', async (t) => {
  const sleep = async () => {};
  let apiAttempts = 0;
  const fail500 = async (url) => {
    if (String(url).startsWith(`${API}/`)) {
      apiAttempts += 1;
      return new Response('boom', { status: 500, statusText: 'Server Error' });
    }
    return new Response(TINY_PNG, { status: 200 });
  };
  const first = await setup(t, { fetchImpl: fail500, sleep, env: { SUBMISSION_GITHUB_MAX_RETRIES: '2' } });
  await assert.rejects(() => first.adapter.pullIssues(), /500/);
  assert.equal(apiAttempts, 3);

  apiAttempts = 0;
  const notFound = async (url) => {
    if (String(url).startsWith(`${API}/`)) {
      apiAttempts += 1;
      return new Response('nope', { status: 404, statusText: 'Not Found' });
    }
    return new Response(TINY_PNG, { status: 200 });
  };
  const second = await setup(t, { fetchImpl: notFound, sleep });
  await assert.rejects(() => second.adapter.pullIssues(), /404/);
  assert.equal(apiAttempts, 1, '4xx 不该重试');
});

/* ------------------------------------------------ 单附件失败：记录后继续，只读不关闭 */

test('同一 Issue 里单个附件失败只记该条，其余附件继续处理', async (t) => {
  const okAsset = 'https://github.com/user-attachments/assets/cccccc16-3333-4333-8333-cccccccccc16';
  const badAsset = 'https://github.com/user-attachments/assets/dddddd17-4444-4444-8444-dddddddddd17';
  const issue = {
    ...issueWithAsset({ number: 131, assetId: 'eeeeee18-5555-4555-8555-eeeeeeeeee18', updatedAt: '2026-09-01T00:00:00Z' }),
    body: `### 图片名称\n\n多附件\n\n### 图片文件\n\n![a](${badAsset})\n\n![b](${okAsset})`,
  };
  const fetchImpl = async (url) => {
    if (String(url).startsWith(`${API}/`)) {
      return new Response(JSON.stringify([issue]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === badAsset) return new Response('boom', { status: 500, statusText: 'Server Error' });
    return new Response(TINY_PNG, { status: 200, headers: { 'content-length': String(TINY_PNG.length) } });
  };
  const { queue, adapter } = await setup(t, { fetchImpl });
  const results = await adapter.pullIssues();

  assert.equal(results.length, 2);
  assert.ok(results.some((entry) => entry.status === 'failed'));
  assert.ok(results.some((entry) => entry.status === 'staged'));
  assert.equal((await queue.list()).length, 1, '失败附件不影响同一 Issue 的其他附件入队');
});

test('分页途中某页接口失败：整次抛错，但已处理页的附件不丢', async (t) => {
  const downloads = [];
  const baseFetch = pagedIssueFetch({
    pages: [
      { issues: [issueWithAsset({ number: 141, assetId: 'aaaaaa19-1111-4111-8111-aaaaaaaaaa19', updatedAt: '2026-09-01T00:00:00Z' })], next: `${listUrlFor()}&page=2` },
    ],
    downloads,
  });
  let apiCalls = 0;
  const wrapped = async (url, options) => {
    if (String(url).startsWith(`${API}/`)) {
      apiCalls += 1;
      if (apiCalls === 2) return new Response('gone', { status: 410, statusText: 'Gone' });
    }
    return baseFetch(url, options);
  };
  const { queue, adapter } = await setup(t, { fetchImpl: wrapped, sleep: async () => {} });
  await assert.rejects(() => adapter.pullIssues(), /410/);
  assert.equal((await queue.list()).length, 1, '第一页已处理的附件要留在队列里');
  assert.equal(downloads.length, 1);
});

test('整个拉取过程只读：绝不发非 GET 请求去关闭 / 改写 Issue', async (t) => {
  const fetchImpl = pagedIssueFetch({
    pages: [{ issues: [issueWithAsset({ number: 151, assetId: 'aaaaaa20-1111-4111-8111-aaaaaaaaaa20', updatedAt: '2026-09-01T00:00:00Z' })] }],
  });
  const { adapter } = await setup(t, { fetchImpl });
  await adapter.pullIssues();
  assert.ok(fetchImpl.calls.length > 0);
  assert.ok(fetchImpl.calls.every((call) => call.method === 'GET'), '拉取过程必须是只读的 GET');
});
