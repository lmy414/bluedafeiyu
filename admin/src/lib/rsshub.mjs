// Pinned RSSHub library route contract: feed.link + feed.item[].link.
export async function rsshubPage(uid, { fetchImpl = fetch, baseUrl = process.env.RSSHUB_URL || 'http://127.0.0.1:1200' } = {}) {
  const origin = new URL(baseUrl);
  if (origin.origin !== baseUrl || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('RSSHub 必须是本机服务');
  if (!/^[1-9]\d{0,16}$/.test(uid)) throw new Error('作者 UID 非法');
  const response = await fetchImpl(`${baseUrl}/bilibili/user/video/${uid}`, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`RSSHub HTTP ${response.status}，保留同步进度等待重试`);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('RSSHub 响应超过上限'); } chunks.push(value); }
  const feed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (feed.link !== `https://space.bilibili.com/${uid}` || !Array.isArray(feed.item) || feed.item.length > 200) throw new Error('RSSHub 作者或订阅结构不匹配');
  const ids = new Set();
  for (const item of feed.item) {
    const url = new URL(item.link), match = url.pathname.match(/^\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10})\/?$/);
    if (url.protocol !== 'https:' || url.hostname !== 'www.bilibili.com' || url.username || url.password || url.port || !match) throw new Error('RSSHub 视频链接非法');
    ids.add(match[1]);
  }
  return { items: [...ids].map(bvid => ({ bvid })), hasMore: false, scope: 'recent', historyComplete: false };
}
