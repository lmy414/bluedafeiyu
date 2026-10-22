import crypto from 'node:crypto';
import { rsshubPage } from './rsshub.mjs';

// Public read API contract cross-checked against yt-dlp's maintained Bilibili extractor.
// https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py
const MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export const BVID = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
export function normalizeCreator(input) {
  const value = String(input?.homepage || input?.uid || '').trim();
  const raw = /^[1-9]\d{0,16}$/.test(value) ? `https://space.bilibili.com/${value}` : value;
  if (raw.length > 300 || /[\\\s]/.test(raw)) throw new Error('请填写 Bilibili 作者主页链接');
  let url; try { url = new URL(raw); } catch { throw new Error('请填写完整的 Bilibili 作者主页链接'); }
  const match = url.pathname.match(/^\/([1-9]\d{0,16})(?:\/(?:upload\/)?video)?\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'space.bilibili.com' || url.port || url.username || url.password || !match)
    throw new Error('当前仅开放 Bilibili，请填写 https://space.bilibili.com/数字UID');
  const intro = typeof input.intro === 'string' ? input.intro.trim() : '';
  if (!intro || [...intro].length > 200 || /[\u0000-\u001f\u007f<>]/.test(intro)) throw new Error('请用 1～200 字说明你创作的内容');
  return { uid: match[1], homepage: `https://space.bilibili.com/${match[1]}`, intro };
}
export function safeBiliImage(value) {
  const raw = String(value || '');
  const url = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)*(?:hdslb\.com|biliimg\.com)$/.test(url.hostname)) throw new Error('Bilibili 图片地址非法');
  url.protocol = 'https:';
  return url.href;
}
export function signWbi(params, img, sub, timestamp = Math.round(Date.now() / 1000)) {
  const key = [img, sub].map(v => new URL(v).pathname.split('/').pop().split('.')[0]).join('');
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Bilibili 签名信息不可用');
  const mix = MIXIN.map(i => key[i]).join('').slice(0, 32);
  const values = { ...params, wts: timestamp };
  const query = new URLSearchParams(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, String(v).replace(/[!'()*]/g, '')]));
  query.set('w_rid', crypto.createHash('md5').update(query.toString() + mix).digest('hex'));
  return query;
}
export function createBilibiliClient({ fetchImpl = fetch, cookie = process.env.BILIBILI_PUBLIC_COOKIE || '' } = {}) {
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://space.bilibili.com/', Origin: 'https://space.bilibili.com', ...(cookie ? { Cookie: cookie } : {}) };
  async function json(pathname, params = '') {
    const response = await fetchImpl('https://api.bilibili.com' + pathname + (String(params) ? '?' + params : ''), { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Bilibili 暂不可访问（HTTP ${response.status}），稍后重试`);
    const text = await response.text();
    if (text.length > 3 * 1024 * 1024) throw new Error('Bilibili 响应超过上限');
    const result = JSON.parse(text);
    if (result.code !== 0 && !(pathname.endsWith('/nav') && result.data?.wbi_img)) throw Object.assign(new Error(`Bilibili 返回 ${Number(result.code)}，稍后重试`), { code: Number(result.code) });
    return result.data;
  }
  return {
    async page(uid, page = 1) {
      if (!/^[1-9]\d{0,16}$/.test(uid) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('作者或分页参数非法');
      return rsshubPage(uid, { fetchImpl });
    },
    async video(bvid, uid) {
      if (!BVID.test(bvid)) throw new Error('视频编号非法');
      let v;
      try { v = await json('/x/web-interface/view', new URLSearchParams({ bvid })); }
      catch (error) { if (error.code === -404 || error.code === 62002 || error.code === 62012) error.code = 'VIDEO_UNAVAILABLE'; throw error; }
      if (String(v?.owner?.mid) !== uid || v.bvid !== bvid || v.state !== 0 || !v.title || !v.cid) throw Object.assign(new Error('视频不可用或不属于登记作者'), { code: 'VIDEO_UNAVAILABLE' });
      let storyboard = null;
      try {
        const shots = await json('/x/player/videoshot', new URLSearchParams({ bvid, cid: String(v.cid), index: '1' }));
        if (shots?.image?.length && Array.isArray(shots.index) && shots.index.length > 1)
          storyboard = { image: safeBiliImage(shots.image[0]), frames: shots.index.length, columns: Number(shots.img_x_len), rows: Number(shots.img_y_len) };
      } catch { /* Evidence stays absent; AI may reject/manual, never approve without frames. */ }
      return { bvid, uid, title: String(v.title).slice(0,200), description: String(v.desc || '').slice(0,4000),
        cover: safeBiliImage(v.pic), url: `https://www.bilibili.com/video/${bvid}/`, creatorName: String(v.owner.name).slice(0,120),
        publishedAt: new Date(v.pubdate * 1000).toISOString(), duration: Math.max(0, Number(v.duration) || 0), storyboard };
    },
    async image(url) {
      const response = await fetchImpl(safeBiliImage(url), { headers: { 'User-Agent': headers['User-Agent'], Referer: 'https://www.bilibili.com/' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(response.headers.get('content-type')?.split(';')[0] || '')) throw new Error('视频审核图片读取失败');
      const reader = response.body.getReader(); const chunks = []; let length = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('审核图片超过 8 MiB'); } chunks.push(value); }
      return { bytes: Buffer.concat(chunks), mime: response.headers.get('content-type').split(';')[0] };
    },
  };
}
