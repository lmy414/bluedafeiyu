import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { publishedIssueGroups, reconcile, main, MARKER } from '../issue-reconcile.mjs';

const PUBLISHED_HASH = 'a'.repeat(64);
const REJECTED_HASH = 'b'.repeat(64);
const PUBLISHED_ASSET = 'aaaaaaa1-1111-4111-8111-aaaaaaaaaaa1';
const REJECTED_ASSET = 'bbbbbbb2-2222-4222-8222-bbbbbbbbbbb2';
const ISSUE_URL = 'https://github.com/lmy414/ai-girl-stickers/issues/64';
const NOW = Date.parse('2026-09-29T12:00:00Z');

function attachment(asset = PUBLISHED_ASSET) {
  return `https://github.com/user-attachments/assets/${asset}`;
}

function issue(overrides = {}) {
  return {
    number: 64,
    state: 'open',
    labels: [{ name: 'sticker-submission' }],
    body: `![图片](${attachment()})`,
    created_at: '2026-09-29T11:30:00Z',
    html_url: ISSUE_URL,
    ...overrides,
  };
}

function metaFor(hash, asset = PUBLISHED_ASSET) {
  return {
    sha256: hash,
    status: 'published',
    source: 'github-issue',
    origin: { issue: 64, issueUrl: ISSUE_URL, assetId: asset, assetUrl: attachment(asset) },
  };
}

function workFor(hash, slug = 'deepseek-test') {
  return { sha256: hash, id: `sticker_${hash.slice(0, 24)}`, slug, status: 'published' };
}

function queueItem({ hash = '', state = 'approved', asset = PUBLISHED_ASSET, reason = '', history = [] } = {}) {
  return {
    id: hash ? `sub_${hash.slice(0, 24)}` : 'sub_unknown',
    sha256: hash,
    state,
    source: 'github-issue',
    sourceIds: [`github:lmy414/ai-girl-stickers#64:${asset}`],
    origin: { issue: 64, issueUrl: ISSUE_URL, assetId: asset, assetUrl: attachment(asset) },
    review: reason ? { reason } : null,
    stateHistory: history,
  };
}

function fakeBackend({ issues = [], comments = {} } = {}) {
  const calls = [];
  const notifications = [];
  const states = new Map(issues.map((entry) => [entry.number, entry.state]));
  const commentMap = new Map(Object.entries(comments));
  async function request(route, options = {}) {
    const method = options.method || 'GET';
    calls.push({ route, method, body: options.body });
    if (route.includes('/issues?state=open')) return issues;
    const match = route.match(/^\/repos\/lmy414\/ai-girl-stickers\/issues\/(\d+)(\/comments)?(\?.*)?$/);
    if (!match) throw new Error(`unexpected route ${route}`);
    const number = Number(match[1]);
    if (match[2] === '/comments') {
      const current = commentMap.get(String(number)) || [];
      if (method === 'POST') {
        current.push({ user: { login: 'lmy414' }, body: options.body.body });
        commentMap.set(String(number), current);
        return {};
      }
      return current;
    }
    const source = issues.find((entry) => entry.number === number) || { ...issue(), number, state: states.get(number) || 'open' };
    if (method === 'PATCH') {
      states.set(number, 'closed');
      return { ...source, state: 'closed', ...options.body };
    }
    return { ...source, state: states.get(number) || source.state };
  }
  return { calls, notifications, states, request };
}

async function runReconcile({ issues = [issue()], items = [], meta = [], works = [], comments = {}, checkPage = async () => true } = {}) {
  const backend = fakeBackend({ issues, comments });
  const result = await reconcile({
    meta,
    works,
    request: backend.request,
    checkPage,
    fetchItems: async () => items,
    notify: async (text) => backend.notifications.push(text),
    now: () => NOW,
    log: () => {},
  });
  return { backend, result };
}

test('publishedIssueGroups 只认已发布且有效的作品', () => {
  assert.equal(publishedIssueGroups([metaFor(PUBLISHED_HASH)], [workFor(PUBLISHED_HASH)]).size, 1);
  assert.equal(publishedIssueGroups([{ ...metaFor(PUBLISHED_HASH), status: 'ready' }], [workFor(PUBLISHED_HASH)]).size, 0);
});

test('全部发布：回复后以 completed 关闭并通知', async () => {
  const { backend, result } = await runReconcile({
    items: [queueItem({ hash: PUBLISHED_HASH })],
    meta: [metaFor(PUBLISHED_HASH)],
    works: [workFor(PUBLISHED_HASH)],
  });
  assert.equal(result.candidates, 1);
  assert.equal(result.commented, 1);
  assert.equal(result.closed, 1);
  assert.equal(result.rejected, 0);
  const comment = backend.calls.find((call) => call.method === 'POST' && call.route.endsWith('/comments')).body.body;
  assert.match(comment, /已收录到「蓝色大肥鱼」，谢谢投稿！/);
  assert.match(comment, /作品页面/);
  assert.equal(backend.calls.find((call) => call.method === 'PATCH').body.state_reason, 'completed');
  assert.equal(backend.notifications.length, 1);
  assert.match(backend.notifications[0], /GitHub Issue #64 已回复并关闭｜收录 1｜未通过 0/);
});

test('AI 拒绝：评论包含 AI 审核与理由，并以 not_planned 关闭', async () => {
  const { backend, result } = await runReconcile({
    issues: [issue({ body: `![图片](${attachment(REJECTED_ASSET)})` })],
    items: [queueItem({ state: 'auto_rejected', asset: REJECTED_ASSET, reason: '画面不符合要求' })],
  });
  assert.equal(result.rejected, 1);
  const comment = backend.calls.find((call) => call.method === 'POST' && call.route.endsWith('/comments')).body.body;
  assert.match(comment, /第 1 张未通过（AI 审核）：画面不符合要求/);
  assert.equal(backend.calls.find((call) => call.method === 'PATCH').body.state_reason, 'not_planned');
});

test('混合结果：两部分都写入评论，并按 completed 关闭', async () => {
  const mixedIssue = issue({ body: `![一](${attachment(PUBLISHED_ASSET)})\n![二](${attachment(REJECTED_ASSET)})` });
  const { backend, result } = await runReconcile({
    issues: [mixedIssue],
    items: [
      queueItem({ hash: PUBLISHED_HASH }),
      queueItem({ state: 'rejected', asset: REJECTED_ASSET, history: [{ to: 'rejected', reason: '人工确认不合规' }] }),
    ],
    meta: [metaFor(PUBLISHED_HASH)],
    works: [workFor(PUBLISHED_HASH)],
  });
  assert.equal(result.rejected, 1);
  const comment = backend.calls.find((call) => call.method === 'POST' && call.route.endsWith('/comments')).body.body;
  assert.match(comment, /已收录到「蓝色大肥鱼」/);
  assert.match(comment, /第 2 张未通过（人工审核）：人工确认不合规/);
  assert.equal(backend.calls.find((call) => call.method === 'PATCH').body.state_reason, 'completed');
});

test('存在 pending：不评论也不关闭', async () => {
  const { backend, result } = await runReconcile({
    items: [queueItem({ hash: 'c'.repeat(64), state: 'auto_passed' })],
  });
  assert.equal(result.skipped, 1);
  assert.equal(result.commented, 0);
  assert.equal(result.closed, 0);
  assert.equal(backend.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
});

test('无附件：超过 1 小时以系统检查关闭，未超过则不动', async () => {
  const old = await runReconcile({ issues: [issue({ body: '没有附件', created_at: '2026-09-29T10:00:00Z' })] });
  assert.equal(old.result.closed, 1);
  const oldComment = old.backend.calls.find((call) => call.method === 'POST' && call.route.endsWith('/comments')).body.body;
  assert.match(oldComment, /未通过（系统检查）/);
  assert.match(oldComment, /未检测到图片附件/);
  assert.equal(old.backend.calls.find((call) => call.method === 'PATCH').body.state_reason, 'not_planned');

  const young = await runReconcile({ issues: [issue({ body: '没有附件', created_at: '2026-09-29T11:45:00Z' })] });
  assert.equal(young.result.skipped, 1);
  assert.equal(young.backend.calls.some((call) => call.method === 'POST' || call.method === 'PATCH'), false);
});

test('已有 MARKER 评论：不重复评论，但仍关闭', async () => {
  const { backend, result } = await runReconcile({
    items: [queueItem({ hash: PUBLISHED_HASH })],
    meta: [metaFor(PUBLISHED_HASH)],
    works: [workFor(PUBLISHED_HASH)],
    comments: { 64: [{ user: { login: 'lmy414' }, body: `已有${MARKER}` }] },
  });
  assert.equal(result.commented, 0);
  assert.equal(result.closed, 1);
  assert.equal(backend.calls.find((call) => call.method === 'PATCH').body.state_reason, 'completed');
});

test('--replies：校验失败移入 failed，成功评论、关闭并移入 done', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-replies-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'bad.json'), JSON.stringify({ schema: 'issue-reply/1', issue: 0, body: '', close: true, stateReason: 'completed' }));
  await fs.writeFile(path.join(dir, 'good.json'), JSON.stringify({
    schema: 'issue-reply/1', issue: 64, body: '后台补回复', close: true, stateReason: 'completed',
  }));

  const backend = fakeBackend({ issues: [issue()] });
  const code = await main(['--replies', dir], {
    request: backend.request,
    notify: async (text) => backend.notifications.push(text),
    log: () => {},
    env: {},
  });
  assert.equal(code, 1);
  const failed = await fs.readdir(path.join(dir, 'failed'));
  assert.ok(failed.includes('bad.json'));
  assert.ok(failed.includes('bad.json.error'));
  assert.match(await fs.readFile(path.join(dir, 'failed', 'bad.json.error'), 'utf8'), /issue 必须是正整数/);
  assert.deepEqual(await fs.readdir(path.join(dir, 'done')), ['good.json']);
  const comment = backend.calls.find((call) => call.method === 'POST' && call.route.endsWith('/comments')).body.body;
  assert.match(comment, /后台补回复/);
  assert.match(comment, new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(backend.calls.find((call) => call.method === 'PATCH').body.state_reason, 'completed');
  assert.match(backend.notifications[0], /已在后台回复 GitHub Issue #64（已关闭）/);
});
test('main 未注入 checkPage 时用 HEAD 检查作品页', async () => {
  const backend = fakeBackend({ issues: [issue()] });
  const heads = [];
  const code = await main([], {
    request: backend.request,
    fetchItems: async () => [queueItem({ hash: PUBLISHED_HASH })],
    meta: [metaFor(PUBLISHED_HASH)],
    works: [workFor(PUBLISHED_HASH)],
    fetchImpl: async (url, options) => { heads.push([url, options?.method]); return { ok: true }; },
    notify: null,
    log: () => {},
    env: {},
  });
  assert.equal(code, 0);
  assert.deepEqual(heads, [['https://xn--pssy23gqgbz2d718b.com/works/deepseek-test.html', 'HEAD']]);
  assert.equal(backend.calls.find((call) => call.method === 'PATCH').body.state_reason, 'completed');
});