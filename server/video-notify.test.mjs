import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deliverNotification, flushNotifications } from './notify-outbox.mjs';
import { changes } from '../ops/admin/video-cycle.mjs';
import { rsshubPage } from '../admin/src/lib/rsshub.mjs';

test('failed notification survives restart, same UUID retries, delivered event is deduplicated', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-outbox-'));
  try {
    let uuid;
    assert.equal((await deliverNotification(dir, 'run:test', 'ready', async (_text, id) => { uuid = id; return { ok: false }; })).ok, false);
    await flushNotifications(dir, async (text, id) => { assert.equal(text, 'ready'); assert.equal(id, uuid); return { ok: true, messageId: 'om_receipt' }; });
    assert.equal((await deliverNotification(dir, 'run:test', 'ready', () => { throw Error('duplicate'); })).messageId, 'om_receipt');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('video queue events distinguish review approval from actual publication, quiet when unchanged', () => {
  const snapshot = { creators: [{ uid: '123', name: '作者', error: '' }], videos: [{ bvid: 'BV1bbeY6wE9x', title: '二创', status: 'approved' }] };
  const events = changes({}, snapshot);
  assert.equal(events.length, 2); assert.match(events[1].text, /等待自动发布/);
  assert.equal(changes(snapshot, snapshot).length, 0);
  assert.match(changes(snapshot, { ...snapshot, creators: [{ ...snapshot.creators[0], error: 'HTTP 412' }] })[0].text, /自动重试/);
});
test('RSSHub validates author, bounded feed and canonical video links, never claims full history', async () => {
  const good = { link: 'https://space.bilibili.com/123', item: [{ link: 'https://www.bilibili.com/video/BV1bbeY6wE9x/' }] };
  const call = feed => rsshubPage('123', { fetchImpl: async () => Response.json(feed) });
  const page = await call(good); assert.equal(page.items[0].bvid, 'BV1bbeY6wE9x'); assert.equal(page.historyComplete, false);
  await assert.rejects(call({ ...good, link: 'https://space.bilibili.com/456' }), /不匹配/);
  await assert.rejects(call({ ...good, item: [{ link: 'https://evil.test/video/BV1bbeY6wE9x/' }] }), /非法/);
  await assert.rejects(rsshubPage('123', { fetchImpl: async () => new Response('', { status: 502 }) }), /保留同步进度/);
});
