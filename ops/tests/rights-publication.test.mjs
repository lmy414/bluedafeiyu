import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyRightsPublication, rightsIssueHash, rightsIssueSnapshot } from '../rights-publication.mjs';
import { processReplies } from '../issue-reconcile.mjs';

const expected = { workId: 'sticker_a', slug: 'deepseek-fixed', status: 'published', origin: { author: '小鱼' }, license: {}, sourceHash: 'a'.repeat(64), kind: 'submission' };
const actual = { id: expected.workId, ...expected, i18n: { sourceHash: expected.sourceHash, en: { licenseNote: '' }, ja: { licenseNote: '' } } };
test('四语言页面和公开清单同时验证，旧内容不能关闭', async () => {
  const paths = [];
  const fetchImpl = async url => { paths.push(url); return url.endsWith('site-data.json') ? Response.json({ works: [actual] }) : new Response('小鱼'); };
  assert.equal(await verifyRightsPublication({ expected }, fetchImpl), true);
  assert.equal(paths.length, 5);
  await assert.rejects(() => verifyRightsPublication({ expected }, async () => Response.json({ works: [{ ...actual, origin: {} }] })), /尚未匹配/);
});
test('下架需要公开清单排除与四页404，200或跳转都拒绝', async () => {
  const payload = { expected: { ...expected, status: 'removed' } };
  assert.equal(await verifyRightsPublication(payload, async url => url.endsWith('site-data.json') ? Response.json({ works: [] }) : new Response('', { status: 404 })), true);
  await assert.rejects(() => verifyRightsPublication(payload, async url => url.endsWith('site-data.json') ? Response.json({ works: [] }) : new Response('')), /验证失败/);
});
test('评论成功关闭失败后重试不重复评论，并在完成回写后归档', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rights-worker-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const issue = { number: 42, title: '[署名/删除]', body: '作品申请', state: 'open', labels: [{ name: 'takedown' }], user: { login: 'creator' } };
  const comments = [];
  const payload = { schema: 'issue-reply/2', requestId: 'github-rights-42', issue: 42, expected, issueHash: rightsIssueHash(rightsIssueSnapshot(issue)), body: '完成', close: true, stateReason: 'completed' };
  const file = path.join(dir, 'request.json');
  await fs.writeFile(file, JSON.stringify(payload));
  let posts = 0, closeFailed = true, acks = 0;
  const request = async (route, options = {}) => {
    if (options.method === 'POST') { posts++; const c = { user: { login: 'lmy414' }, body: options.body.body, html_url: 'https://github.com/example/comment' }; comments.push(c); return c; }
    if (options.method === 'PATCH') { if (closeFailed) { closeFailed = false; throw new Error('network'); } issue.state = 'closed'; return issue; }
    return route.includes('/comments') ? comments : issue;
  };
  const options = { dir, request, notify: null, log: () => {}, verifyRights: async () => true, acknowledge: async () => { acks++; } };
  assert.equal((await processReplies(options)).failed.length, 1);
  assert.equal(acks, 0);
  await fs.copyFile(path.join(dir, 'retry/request.json'), file);
  assert.equal((await processReplies(options)).failed.length, 0);
  assert.equal(posts, 1);
  assert.equal(acks, 1);
  assert.equal(issue.state, 'closed');
  assert.deepEqual(await fs.readdir(path.join(dir, 'done')), ['request.json']);
});
test('请求原文变化时既不评论也不关闭', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rights-changed-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const issue = { number: 42, title: '[署名/删除]', body: 'edited', labels: [{ name: 'takedown' }], user: { login: 'creator' } };
  await fs.writeFile(path.join(dir, 'request.json'), JSON.stringify({ schema: 'issue-reply/2', requestId: 'github-rights-42', issue: 42, expected, issueHash: '0'.repeat(64), body: '完成', close: true, stateReason: 'completed' }));
  const writes = [];
  const result = await processReplies({ dir, request: async (route, options = {}) => { if (options.method) writes.push(options); return route.includes('/comments') ? [] : issue; }, notify: null, log: () => {} });
  assert.equal(result.failed.length, 1); assert.deepEqual(writes, []);
});
