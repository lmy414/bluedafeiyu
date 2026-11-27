import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { createDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import { creators, videos } from '../db/schema.js';
import { hash, imageFormat, readBytes, sha256 } from '../routes/hermes/protocol.js';
import type { Wire } from '../routes/hermes/protocol.js';
import { openR2, putObject } from './r2.js';
import { requiredEnv, runCli } from './runtime.js';

export const bvidPattern = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
export const legacyVideoId = (id: string) => /^[1-9]\d*$/.test(id) ? id : String(BigInt(`0x${sha256(Buffer.from(id)).slice(0, 24)}`));
const uidPattern = /^[1-9]\d{0,16}$/;
const imageHost = /^(?:[a-z0-9-]+\.)*(?:hdslb\.com|biliimg\.com)$/;

function biliImage(value: string) {
  const url = new URL(value.startsWith('//') ? `https:${value}` : value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !imageHost.test(url.hostname)) throw new Error('Bilibili 图片地址非法');
  url.protocol = 'https:';
  return url.href;
}

function optionalImage(value: string) {
  try { return biliImage(value); } catch { return ''; }
}

export function videoHash(source: Wire) {
  // PostgreSQL JSONB changes insertion order. Normalize recursively before hashing.
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, stable(field)]));
    return value;
  };
  return hash(stable(source));
}

export async function readVideoImage(url: string, fetcher = fetch) {
  const response = await fetcher(biliImage(url), { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`视频审核图片读取失败（HTTP ${response.status}）`);
  const bytes = await readBytes(response, 8 * 1024 * 1024);
  const format = imageFormat(bytes);
  if (!format || format.ext === 'gif') throw new Error('视频审核图片格式非法');
  return { bytes, mime: format.mime };
}

export function createBilibiliClient(fetcher = fetch) {
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://space.bilibili.com/', Origin: 'https://space.bilibili.com',
    ...(process.env.BILIBILI_PUBLIC_COOKIE && { Cookie: process.env.BILIBILI_PUBLIC_COOKIE }) };
  async function api(path: string, params: Record<string, string>) {
    const response = await fetcher(`https://api.bilibili.com${path}?${new URLSearchParams(params)}`, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Bilibili HTTP ${response.status}`);
    const row = JSON.parse((await readBytes(response, 3 * 1024 * 1024)).toString('utf8')) as Wire;
    if (row.code !== 0) throw Object.assign(new Error(`Bilibili 返回 ${row.code}`), { code: row.code });
    return row.data;
  }
  return {
    async feed(uid: string) {
      if (!uidPattern.test(uid)) throw new Error('作者 UID 非法');
      const origin = process.env.RSSHUB_URL || 'http://127.0.0.1:1200';
      const url = new URL(origin);
      if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('RSSHub 必须是本机服务');
      const response = await fetcher(`${origin}/bilibili/user/video/${uid}`, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`RSSHub HTTP ${response.status}`);
      const feed = JSON.parse((await readBytes(response, 2 * 1024 * 1024)).toString('utf8')) as Wire;
      if (feed.link !== `https://space.bilibili.com/${uid}` || !Array.isArray(feed.item) || feed.item.length > 200) throw new Error('RSSHub 作者或订阅结构不匹配');
      const ids = new Set<string>();
      for (const item of feed.item) {
        const link = new URL(item.link);
        const bvid = link.pathname.match(/^\/video\/([^/]+)\/?$/)?.[1];
        if (link.origin !== 'https://www.bilibili.com' || link.username || link.password || !bvid || !bvidPattern.test(bvid)) throw new Error('RSSHub 视频链接非法');
        ids.add(bvid);
      }
      return [...ids];
    },
    async profile(uid: string) {
      if (!uidPattern.test(uid)) throw new Error('作者 UID 非法');
      const result = await api('/x/web-interface/card', { mid: uid });
      const card = result?.card;
      if (String(card?.mid) !== uid) throw new Error('平台返回作者与登记 UID 不符');
      return { name: String(card.name || '').slice(0, 120), avatar: optionalImage(card.face || '') };
    },
    async detail(bvid: string, uid: string) {
      if (!bvidPattern.test(bvid) || !uidPattern.test(uid)) throw new Error('视频编号或作者 UID 非法');
      let video: Wire;
      try { video = await api('/x/web-interface/view', { bvid }); }
      catch (error) { if ([-404, 62002, 62012].includes((error as { code: number }).code)) return null; throw error; }
      if (video?.bvid !== bvid || String(video.owner?.mid) !== uid || video.state !== 0 || !video.title || !video.cid) return null;
      let storyboard = null;
      try {
        const frames = await api('/x/player/videoshot', { bvid, cid: String(video.cid), index: '1' });
        if (frames?.image?.[0] && Array.isArray(frames.index) && frames.index.length > 1) storyboard = {
          image: biliImage(frames.image[0]), frames: frames.index.length, columns: Number(frames.img_x_len), rows: Number(frames.img_y_len),
        };
      } catch { /* Evidence is optional for rejection and manual review. */ }
      return { bvid, uid, title: String(video.title).slice(0, 200), description: String(video.desc || '').slice(0, 4000),
        cover: biliImage(video.pic), url: `https://www.bilibili.com/video/${bvid}/`, creatorName: String(video.owner.name || '').slice(0, 120),
        creatorAvatar: optionalImage(video.owner.face || ''), publishedAt: new Date(video.pubdate * 1000).toISOString(), duration: Math.max(0, Number(video.duration) || 0), storyboard,
      };
    },
    image: (url: string) => readVideoImage(url, fetcher),
  };
}

export async function syncVideoCreators(db: Database, putPublic: (key: string, bytes: Uint8Array, mime: string) => Promise<unknown>, client = createBilibiliClient(), now = new Date()) {
  const token = randomUUID();
  const creator = await db.transaction(async tx => {
    const [row] = await tx.select().from(creators).where(and(inArray(creators.status, ['queued', 'active']),
      sql`(${creators.retryAt} is null or ${creators.retryAt} <= ${now.toISOString()}::timestamptz)`,
      sql`coalesce((${creators.syncLease}->>'expiresAt')::bigint, 0) <= ${now.valueOf()}`,
    )).orderBy(sql`${creators.lastSyncedAt} asc nulls first`, creators.id).limit(1).for('update', { skipLocked: true });
    if (row) await tx.update(creators).set({ syncLease: { token, expiresAt: now.valueOf() + 600_000 } }).where(eq(creators.id, row.id));
    return row;
  });
  const stats = { creators: Number(Boolean(creator)), discovered: 0, errors: [] as { uid: string; error: string }[] };
  if (!creator) return stats;
  const own = and(eq(creators.id, creator.id), inArray(creators.status, ['queued', 'active']), sql`${creators.syncLease}->>'token' = ${token}`);
  try {
    if (creator.homepage !== `https://space.bilibili.com/${creator.uid}`) throw new Error('作者主页与 UID 不符');
    let profile = await client.profile(creator.uid).catch(() => null);
    const ids = await client.feed(creator.uid);
    const known = ids.length ? await db.select({ id: videos.bvid }).from(videos).where(inArray(videos.bvid, ids)) : [];
    const existing = new Set(known.map(row => row.id));
    const fresh = ids.filter(id => !existing.has(id));
    const deadline = Date.now() + 25_000;
    let deferred = false;
    for (const bvid of fresh) {
      if (stats.discovered >= 3 || Date.now() > deadline) { deferred = true; break; }
      const item = await client.detail(bvid, creator.uid);
      if (!item) continue;
      const { creatorAvatar, ...source } = item;
      profile ??= { name: item.creatorName, avatar: creatorAvatar };
      await db.transaction(async tx => {
        const [current] = await tx.select({ id: creators.id }).from(creators).where(own).for('update');
        if (!current) return;
        const saved = await tx.insert(videos).values({ id: legacyVideoId(bvid), bvid, title: item.title, creatorId: creator.id, source: { ...source, creatorIntro: creator.intro } })
          .onConflictDoNothing({ target: videos.bvid }).returning({ id: videos.id });
        stats.discovered += saved.length;
      });
    }
    let avatarKey = creator.avatarKey;
    if (profile?.avatar) {
      const image = await client.image(profile.avatar);
      const bytes = await sharp(image.bytes).rotate().resize(400, 400, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer();
      const key = `assets/avatars/creators/${creator.id}/${sha256(bytes).slice(0, 16)}.webp`;
      if (key !== avatarKey) {
        const [current] = await db.select({ id: creators.id }).from(creators).where(own);
        if (!current) return stats;
        await putPublic(key, bytes, 'image/webp');
      }
      avatarKey = key;
    }
    await db.update(creators).set({ status: 'active', syncPage: 1, name: profile?.name || creator.name, avatarKey,
      syncLease: null, lastSyncedAt: now, retryAt: new Date(now.valueOf() + (deferred ? 5 : 30) * 60_000), error: null, updatedAt: new Date(),
    }).where(own);
  } catch (error) {
    const message = (error as Error).message.slice(0, 300);
    stats.errors.push({ uid: creator.uid, error: message });
    await db.update(creators).set({ syncLease: null, lastSyncedAt: now, retryAt: new Date(now.valueOf() + 60 * 60_000), error: message, updatedAt: new Date() }).where(own);
  }
  return stats;
}

runCli(import.meta.url, async () => {
  const r2 = openR2();
  const connection = createDb(requiredEnv('DATABASE_URL'));
  try {
    const stats = await syncVideoCreators(connection.db, (key, bytes, mime) => putObject(r2, process.env.R2_MEDIA_BUCKET || 'dafeiyu-media', key, bytes, mime));
    if (stats.errors.length) process.exitCode = 1;
    return stats;
  } finally { r2.destroy(); await connection.close(); }
});
