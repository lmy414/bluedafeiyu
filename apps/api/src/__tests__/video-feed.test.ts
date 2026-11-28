import assert from 'node:assert/strict';
import test from 'node:test';
import { createBilibiliClient } from '../jobs/video-sync.js';

test('mixed RSSHub video links resolve to unique BVIDs for the registered creator', async () => {
  const uid = '10833190';
  const bvid = 'BV1Jt411S7BN';
  const client = createBilibiliClient(async input => {
    const url = new URL(String(input));
    if (url.pathname === `/bilibili/user/video/${uid}`) {
      return Response.json({ link: `https://space.bilibili.com/${uid}`, item: [bvid, 'av37556120', 'av123', 'av456'].map(id => ({ link: `https://www.bilibili.com/video/${id}` })) });
    }
    assert.equal(url.origin + url.pathname, 'https://api.bilibili.com/x/web-interface/view');
    const aid = url.searchParams.get('aid');
    if (aid === '123') return Response.json({ code: -404 });
    return Response.json({ code: 0, data: { aid: Number(aid), bvid: aid === '456' ? 'BV1Zy1WzbEct' : bvid, owner: { mid: aid === '456' ? 99 : Number(uid) } } });
  });
  assert.deepEqual(await client.feed(uid), [bvid]);
});
