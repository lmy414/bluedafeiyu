#!/usr/bin/env -S tsx --conditions=development
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli } from '../apps/api/src/jobs/runtime.js';
import type { Database } from '../apps/api/src/db/client.js';
import type { Wire } from '../apps/api/src/routes/hermes/protocol.js';
import { readBytes, sha256 } from '../apps/api/src/routes/hermes/protocol.js';
import { bounded, exists, legacyPath, legacyPathsByWork, loadLegacy, options, readJson, stringIds } from './legacy-data.js';
import type { LegacyPaths, LegacyWork, Manifest } from './legacy-data.js';
import { readSqlite, sqliteWorks } from './legacy-sqlite.js';

type Args = ReturnType<typeof options>;
const languages = ['', '/zh-hant', '/en', '/ja'];
const ids = (rows: Wire[], key = 'id') => rows.map(row => String(row[key])).sort();
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
const htmlText = (html: string) => normalized(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&#39;', "'").replaceAll('&apos;', "'"));

async function request(base: string, path: string, method = 'GET') {
  return fetch(new URL(path, base), { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
}

async function json(base: string, path: string) {
  const response = await request(base, path);
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json() as Promise<Wire>;
}

async function pages(base: string, path: string) {
  const all: Wire[] = [];
  for (let page = 1; page <= 500; page++) {
    const batch = await json(base, `${path}?page=${page}&pageSize=100`);
    if (!Array.isArray(batch.items)) throw new Error(`${path} 没有 items`);
    all.push(...batch.items);
    if (!batch.nextPage || !batch.items.length) return all;
  }
  throw new Error(`分页未结束 ${path}`);
}

const googleVerification = '/google653ce5fe960a5fb0.html';

async function legacyMediaPaths(args: Args, legacy: Awaited<ReturnType<typeof loadLegacy>>, published: LegacyWork[], works: Map<string, LegacyPaths>, manifest: Manifest | null) {
  const paths = new Set(['/avatar.png', '/favicon.png', '/favicon.ico', '/qq-group.png', '/community/qq-join-6d07ffd364068fdf.png', googleVerification]);
  for (const row of published) {
    const { thumb, display, original } = works.get(row.id)!;
    for (const path of [...thumb, ...display, ...original]) paths.add(path);
    const detail = `/works/${encodeURIComponent(row.slug)}.html`;
    paths.add(`/og/archive-${detail.replace(/[^a-z0-9-]/gi, '-')}.jpg`);
  }
  const add = (value: unknown) => {
    const path = legacyPath(value);
    if (path) paths.add(path);
  };
  for (const portrait of Object.values(legacy.portraits)) add(portrait.path);
  for (const creator of legacy.creators) add(creator.avatar);
  for (const topic of legacy.topics) {
    add(topic.author?.avatar?.src || topic.author?.avatar);
    if (manifest?.assets[`topic:${topic.id}`]) paths.add(`/author-avatars/${encodeURIComponent(topic.id)}.webp`);
  }
  const creatorIndex = join(args.legacy, 'frontend/src/lib/creator-avatars.json');
  if (await exists(creatorIndex)) {
    for (const value of Object.values(await readJson<Record<string, string>>(creatorIndex))) add(value);
  }
  const roots = ['frontend/public', 'dist', '.build/site', '.build/site-v2'].map(path => join(args.legacy, path));
  roots.push(join(args.content, 'dist'));
  await Promise.all(roots.flatMap(root => ['character-portraits', 'creator-avatars', 'author-avatars', 'community'].map(async directory => {
    const folder = join(root, directory);
    if (!await exists(folder)) return;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isFile() && /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(entry.name)) paths.add(`/${directory}/${encodeURIComponent(entry.name)}`);
    }
  })));
  return [...paths].sort();
}

async function checkLegacyMedia(site: string, path: string, mediaOrigin: string, stop: AbortSignal) {
  let current = new URL(path, site);
  const siteOrigin = current.origin;
  const seen = new Set<string>();
  const isImage = path !== googleVerification;
  for (let hop = 0; hop <= 10; hop++) {
    const context = `老站图片路径 ${path}${hop ? ` → ${current.href}` : ''}`;
    if (seen.has(current.href)) throw new Error(`${context} 重定向循环`);
    seen.add(current.href);
    const response = await fetch(current, { method: 'HEAD', cache: 'no-store', redirect: 'manual', signal: AbortSignal.any([stop, AbortSignal.timeout(15_000)]) })
      .catch((error: unknown) => { throw new Error(`${context} 请求失败`, { cause: error }); });
    if (response.status === 200) {
      const mime = response.headers.get('content-type')?.toLowerCase();
      if (isImage && !mime?.startsWith('image/')) throw new Error(`${context} HTTP 200 返回了非图片内容`);
      if (isImage && hop && current.origin !== mediaOrigin) throw new Error(`${context} 301 最终未指向 R2 公开地址`);
      return hop ? 301 : 200;
    }
    if (response.status !== 301) throw new Error(`${context} HTTP ${response.status}（要求 200 或 301）`);
    const location = response.headers.get('location');
    const target = location && URL.parse(location, current);
    if (!target || !['http:', 'https:'].includes(target.protocol) || target.username || target.password || ![siteOrigin, mediaOrigin].includes(target.origin)) throw new Error(`${context} 301 Location 无效或超出站点 / R2 公开域名`);
    current = target;
  }
  throw new Error(`老站图片路径 ${path} 301 跳转次数超限`);
}

export async function verifyParity(args: Args, db?: Database) {
  if (!args.dryRun && !args.offline && !args.site) throw new Error('在线验收需要 --site 或 SITE_PUBLIC_URL，以核验旧图片路径');
  const legacy = await loadLegacy(args.legacy);
  const historicWorks = sqliteWorks(readSqlite(args.sqlite), legacy.works);
  const manifest = await exists(args.manifest) ? await readJson<Manifest>(args.manifest) : null;
  const expected = historicWorks.filter(row => row.status === 'published');
  const historicalPaths = await legacyPathsByWork(args.legacy, historicWorks, legacy.works);
  const historicalMedia = await legacyMediaPaths(args, legacy, expected, historicalPaths, manifest);
  const legacyWorks = new Map(expected.map(row => [row.id, row]));
  const failures: { area: string; id: string; message: string }[] = [];
  const fail = (area: string, id: string, message: string) => failures.push({ area, id, message });
  const sets = (area: string, before: string[], after: string[]) => {
    const old = new Set(before);
    const current = new Set(after);
    for (const id of old) if (!current.has(id)) fail(area, id, '缺失');
    for (const id of current) if (!old.has(id)) fail(area, id, '额外记录');
    if (after.length !== current.size) fail(area, '*', '存在重复记录');
  };
  let checkedMedia = 0;
  let checkedPages = 0;
  const media = new Map<string, { id: string; sha?: string }>();
  const mediaBase = process.env.R2_PUBLIC_BASE_URL || 'https://img.xn--pssy23gqgbz2d718b.com';
  const mediaUrl = (key: string) => `${mediaBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const legacyMedia = { paths: historicalMedia.length, ok: 0, redirected: 0 };
  if (args.site && !args.offline) {
    const site = args.site;
    const mediaOrigin = new URL(mediaBase).origin;
    const stop = new AbortController();
    try {
      await bounded(historicalMedia, args.concurrency, async path => {
        if (await checkLegacyMedia(site, path, mediaOrigin, stop.signal) === 200) legacyMedia.ok++;
        else legacyMedia.redirected++;
      });
    } finally { stop.abort(); }
  }
  if (manifest?.missing.length) for (const error of manifest.missing) fail('manifest', error.id, error.error);
  if (manifest) {
    sets('manifest/works', ids(historicWorks), Object.keys(manifest.works));
    for (const row of expected) {
      const entry = manifest.works[row.id];
      if (!entry) { fail('manifest', row.id, '公开作品无媒体'); continue; }
      if (row.sha256 && entry.sha256 !== row.sha256) fail('manifest', row.id, '原图摘要不一致');
      if ([entry.width, entry.height, entry.thumbWidth, entry.thumbHeight, entry.displayWidth, entry.displayHeight].some(value => value < 1)) fail('manifest', row.id, '宽高为零');
      for (const key of [entry.r2OriginalKey, entry.r2ThumbKey, entry.r2DisplayKey]) {
        if (!key) fail('manifest', row.id, 'R2 对象键缺失');
        else media.set(mediaUrl(key), { id: row.id, ...(key === entry.r2OriginalKey && { sha: entry.sha256 }) });
      }
    }
    for (const [id, entry] of Object.entries(manifest.assets)) media.set(mediaUrl(entry.key), { id });
  } else if (!args.dryRun) fail('manifest', '*', '缺少 r2-migration-manifest.json');
  for (const row of expected) for (const language of ['en', 'ja']) {
    if (!row.i18n?.[language]?.name || !row.i18n[language].description) fail('legacy/i18n', row.id, `旧站缺少 ${language} 标题或说明`);
  }

  if (db) {
    const { works, videos, categories, characters, creators, topics, topicWorks } = await import('../apps/api/src/db/schema.js');
    const [rows, videoRows, types, roles, authorRows, topicRows, members] = await Promise.all([
      db.select().from(works), db.select().from(videos), db.select().from(categories), db.select().from(characters), db.select().from(creators),
      db.select().from(topics), db.select().from(topicWorks),
    ]);
    sets('db/works', ids(expected), ids(rows.filter(row => row.status === 'published')));
    sets('db/video', ids(legacy.videos, 'bvid'), ids(videoRows.filter(row => row.status === 'approved'), 'bvid'));
    sets('db/characters', ids(legacy.roles), ids(roles));
    sets('db/categories', ids(legacy.categories), ids(types));
    sets('db/topics', ids(legacy.topics), ids(topicRows));
    sets('db/serials', [...legacy.serialIds].sort(), ids(topicRows.filter(row => row.isSerial)));
    for (const uid of ids(legacy.creators, 'uid')) if (!authorRows.some(row => row.uid === uid)) fail('db/creators', uid, '作者缺失');
    const allStored = new Map(rows.map(row => [row.id, row]));
    for (const row of historicWorks) {
      const current = allStored.get(row.id);
      if (!current || current.slug !== row.slug || current.status !== row.status) { fail('db/work-identity', row.id, '冻结 slug 或状态不同'); continue; }
      if (!isDeepStrictEqual(current.origin.legacyPaths, historicalPaths.get(row.id))) fail('db/legacy-paths', row.id, '旧图片路径映射不同');
      if (row.status !== 'published') continue;
      if (row.name !== current.name || (row.description || '') !== current.description || (row.commentary || '') !== current.commentary) fail('db/work-zh', row.id, '简中内容不同');
      for (const language of ['en', 'ja']) if (!isDeepStrictEqual(row.i18n?.[language], current.i18n[language])) fail('db/i18n', row.id, `${language} 内容不同`);
      const entry = manifest?.works[row.id];
      if (entry && (entry.sha256 !== current.sha256 || entry.r2OriginalKey !== current.r2OriginalKey || entry.r2ThumbKey !== current.r2ThumbKey || entry.r2DisplayKey !== current.r2DisplayKey)) fail('db/media', row.id, '对象键或摘要不同');
    }
    for (const row of legacy.topics) {
      const current = topicRows.find(topic => topic.id === row.id);
      if (!current || current.coverWorkId !== (row.coverWorkId || null)) fail('db/topics', row.id, '封面不同');
      const list = members.filter(member => member.topicId === row.id).sort((a, b) => a.position - b.position);
      const pages = new Map<string, number>((row.reader?.pages || []).map((page: Wire) => [page.workId, page.number]));
      const expectedIds = stringIds([...(row.workIds || []), ...pages.keys()]).filter(id => historicWorks.some(work => work.id === id));
      if (!isDeepStrictEqual(expectedIds, list.map(member => member.workId))) fail('db/topic-order', row.id, '成员次序不同');
      for (const member of list) if (member.pageNumber !== (pages.get(member.workId) ?? null)) fail('db/serial-page', `${row.id}/${member.workId}`, '原稿页码不同');
    }
    const byBvid = new Map(videoRows.map(row => [row.bvid, row]));
    for (const video of legacy.videos) {
      const current = byBvid.get(video.bvid);
      if (!current || current.title !== video.title || current.source.uid !== video.uid || !isDeepStrictEqual(current.review.i18n, video.i18n)) fail('db/video', video.bvid, '视频中文、作者或英日译文不同');
    }
  }

  if (args.api && !args.offline) {
    const api = args.api;
    const [index, roleResult, topicResult, serialResult, videoResult] = await Promise.all([
      json(api, '/open-api/v1/works.json'), json(api, '/api/v1/characters'), pages(api, '/api/v1/topics'), pages(api, '/api/v1/serials'), pages(api, '/api/v1/videos'),
    ]);
    let indexRows = index.items || index.works;
    if (!Array.isArray(indexRows)) indexRows = await pages(api, '/api/v1/works');
    sets('api/works', ids(expected), ids(indexRows));
    sets('api/characters', ids(legacy.roles.filter(row => row.status === 'active')), ids(roleResult.items));
    sets('api/topics', ids(legacy.topics.filter(row => !legacy.serialIds.has(row.id) && row.status === 'active' && row.workIds?.some((id: string) => legacyWorks.has(id)))), ids(topicResult));
    sets('api/serials', [...legacy.serialIds].sort(), ids(serialResult));
    sets('api/videos', ids(legacy.videos, 'bvid'), ids(videoResult, 'bvid'));
    await bounded(expected, args.concurrency, async row => {
      try {
        const result = await json(api, `/open-api/v1/works/${encodeURIComponent(row.id)}.json`);
        const current = result.work || result.item || result;
        if (current.id !== row.id || current.slug !== row.slug) fail('api/work-identity', row.id, '冻结 ID 或 slug 不同');
        for (const language of ['en', 'ja']) for (const field of ['name', 'description', 'commentary', 'tags']) {
          if (!isDeepStrictEqual(row.i18n?.[language]?.[field], current.i18n?.[language]?.[field])) fail('api/i18n', row.id, `${language}.${field} 不同`);
        }
        const entry = manifest?.works[row.id];
        for (const [field, key] of [['originalUrl', entry?.r2OriginalKey], ['thumbnailUrl', entry?.r2ThumbKey], ['displayUrl', entry?.r2DisplayKey]] as const) {
          const url = current.image?.[field];
          if (typeof url !== 'string' || new URL(url).origin !== new URL(mediaBase).origin || (key && url !== mediaUrl(key))) fail('api/media', row.id, `${field} 未指向预期 R2 地址`);
          else if (!media.has(url)) media.set(url, { id: row.id });
        }
      } catch (error) { fail('api/work', row.id, (error as Error).message); }
    });
    for (const topic of legacy.topics.filter(row => legacy.serialIds.has(row.id))) {
      for (const page of topic.reader?.pages || []) {
        try {
          const live = await json(api, `/api/v1/serials/${encodeURIComponent(topic.id)}/pages/${page.number}`);
          if (live.pageNumber !== page.number || live.work?.id !== page.workId) fail('api/serial-page', `${topic.id}/${page.number}`, '连载作品或原稿页码不同');
        } catch (error) { fail('api/serial-page', `${topic.id}/${page.number}`, (error as Error).message); }
      }
    }
  }

  if (args.site && !args.offline) {
    const site = args.site;
    const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
    const { Converter } = webRequire('opencc-js') as { Converter(config: { from: string; to: string }): (value: string) => string };
    const traditional = Converter({ from: 'cn', to: 'twp' });
    await bounded(expected, args.concurrency, async row => {
      for (const prefix of languages) {
        try {
          const response = await request(site, `${prefix}/works/${encodeURIComponent(row.slug)}.html`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const html = await response.text();
          const lang = html.match(/<html\b[^>]*\blang=["']([^"']+)/i)?.[1]?.toLowerCase();
          const expectedLang = prefix === '/zh-hant' ? /^zh-(?:hant|tw)$/ : prefix ? new RegExp(`^${prefix.slice(1)}(?:-|$)`) : /^zh(?:-cn)?$/;
          if (!lang || !expectedLang.test(lang)) fail('site/lang', `${row.id}${prefix}`, '页面 lang 不符');
          const localization = prefix === '/en' || prefix === '/ja' ? row.i18n?.[prefix.slice(1)]
            : prefix === '/zh-hant' ? { name: traditional(row.name), description: traditional(row.description || '') } : row;
          const body = htmlText(html);
          if (localization && (!body.includes(normalized(localization.name || '')) || !body.includes(normalized(localization.description || '')))) fail('site/content', `${row.id}${prefix}`, '页面标题或说明不同');
          checkedPages++;
        } catch (error) { fail('site/page', `${row.id}${prefix}`, (error as Error).message); }
      }
    });
  }

  if ((!args.dryRun || args.site || args.api) && !args.offline) await bounded([...media], args.concurrency, async ([url, asset]) => {
    try {
      const response = await request(url, '', 'HEAD');
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/') || Number(response.headers.get('content-length')) < 1) throw new Error(`不可访问或非图片 HTTP ${response.status}`);
      if (asset.sha && process.env.DAFEIYU_VERIFY_MEDIA_SHA256 === 'true') {
        const body = await request(url, '');
        if (!body.ok || sha256(await readBytes(body, 100 * 1024 * 1024)) !== asset.sha) throw new Error('公开原图 SHA-256 不符');
      }
      checkedMedia++;
    } catch (error) { fail('r2/reachability', asset.id, `${url} ${(error as Error).message}`); }
  });
  return { dryRun: args.dryRun, expected: { works: expected.length, videos: legacy.videos.length, characters: legacy.roles.length, topics: legacy.topics.length, serials: legacy.serialIds.size },
    checked: { database: Boolean(db), api: Boolean(args.api && !args.offline), pages: checkedPages, media: checkedMedia, legacyMedia }, failures,
  };
}

runCli(import.meta.url, async () => {
  const args = options();
  if (args.help) { console.log('verify-parity.ts [--legacy PATH] [--manifest PATH] [--sqlite PATH] [--api URL] [--site URL] [--offline] [--dry-run]'); return; }
  if (!args.dryRun && !args.api && !args.site && !process.env.DATABASE_URL) throw new Error('请提供 DATABASE_URL、--api 或 --site，或以 --dry-run 校验本地清单');
  const connection = process.env.DATABASE_URL && !args.offline ? await import('../apps/api/src/db/client.js').then(module => module.createDb(process.env.DATABASE_URL!)) : undefined;
  try {
    const report = await verifyParity(args, connection?.db);
    if (report.failures.length) process.exitCode = 1;
    return report;
  } finally { await connection?.close(); }
});
