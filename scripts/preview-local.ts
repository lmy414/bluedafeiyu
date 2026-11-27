import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/api/src/app.js';
import type { Services } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config.js';
import type { Database } from '../apps/api/src/db/client.js';
import * as schema from '../apps/api/src/db/schema.js';
import { initializeOwner } from '../apps/api/src/routes/admin/auth.js';
import { imageFormat, readBytes } from '../apps/api/src/routes/hermes/protocol.js';
import { importData } from './import-data.js';
import { bounded, digestPattern, exists, loadLegacy, options, readBrandTokens } from './legacy-data.js';
import type { Asset, LegacyWork, Manifest } from './legacy-data.js';
import { readSqlite } from './legacy-sqlite.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { serve } = apiRequire('@hono/node-server') as { serve(options: { fetch: ReturnType<typeof createApp>['fetch']; port: number; hostname: string }, ready: () => void): Server };
const sharp = apiRequire('sharp') as (source: string | Buffer, options: { animated: boolean }) => {
  metadata(): Promise<{ width?: number; height?: number; pageHeight?: number; pages?: number; orientation?: number }>;
};
const host = '127.0.0.1';
const web = `http://${host}:4330`;
const api = `http://${host}:4331`;
const mediaPrefix = '/__preview-media';
const mediaBase = `${api}${mediaPrefix}`;
const owner = { email: 'admin@dafeiyu.local', password: process.env.PREVIEW_ADMIN_PASSWORD || randomBytes(32).toString('base64url') };
const avatarCache = join(root, '.build', 'preview-avatar-cache');
const mimeTypes = new Map([['.png', 'image/png'], ['.apng', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.avif', 'image/avif'], ['.ico', 'image/x-icon']]);

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const mediaUrl = (key: string) => `${mediaBase}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function previewDatabase() {
  // Standalone preview dependencies keep the workspace's production lockfile intact.
  const dir = join(root, '.build', 'preview-runtime');
  const packageFile = join(dir, 'package.json');
  const previewRequire = createRequire(packageFile);
  if (!await exists(join(dir, 'node_modules', '@electric-sql', 'pglite', 'package.json')) ||
      !await exists(join(dir, 'node_modules', 'drizzle-orm', 'package.json'))) {
    await mkdir(dir, { recursive: true });
    await writeFile(packageFile, `${JSON.stringify({ private: true, dependencies: { '@electric-sql/pglite': '0.3.15', 'drizzle-orm': '0.45.2' } }, null, 2)}\n`);
    const install = ['install', '--ignore-workspace', '--no-lockfile', '--ignore-scripts'];
    const child = process.platform === 'win32'
      ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'pnpm', ...install], { cwd: dir, stdio: 'inherit' })
      : spawn('pnpm', install, { cwd: dir, stdio: 'inherit' });
    await new Promise<void>((done, fail) => {
      child.once('error', fail);
      child.once('close', code => code === 0 ? done() : fail(new Error(`预览依赖安装失败（退出码 ${code}）`)));
    });
  }
  // Resolve the driver and its PGlite peer from the same standalone directory.
  const { PGlite } = previewRequire('@electric-sql/pglite') as { PGlite: new (options: { extensions: object }) => {
    exec(sql: string): Promise<unknown>; close(): Promise<void>;
  } };
  const { pg_trgm } = previewRequire('@electric-sql/pglite/contrib/pg_trgm') as { pg_trgm: object };
  const { drizzle } = previewRequire('drizzle-orm/pglite') as { drizzle(client: InstanceType<typeof PGlite>, options: { schema: typeof schema }): Database };
  const pg = new PGlite({ extensions: { pg_trgm } });
  try {
    await pg.exec(await readFile(join(root, 'apps/api/drizzle/0000_init.sql'), 'utf8'));
    await pg.exec(await readFile(join(root, 'apps/api/drizzle/0001_legacy_submission_digest.sql'), 'utf8'));
    return { db: drizzle(pg, { schema }), close: () => pg.close() };
  } catch (error) {
    await pg.close();
    throw error;
  }
}

type LocalImage = { path: string; mime: string; size: number; width: number; height: number; animated: boolean };
type StoredImage = { mime: string; size: number; path: string } | { mime: string; size: number; bytes: Buffer };
type Legacy = Awaited<ReturnType<typeof loadLegacy>>;

function localPart(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const prefixes = ['https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/', 'https://raw.githubusercontent.com/EDMOK/blue-fish-archive/main/'];
  const prefix = prefixes.find(item => value.startsWith(item));
  if (!prefix && /^[a-z][\w+.-]*:/i.test(value)) return null;
  try { return decodeURIComponent((prefix ? value.slice(prefix.length) : value).replace(/^\/+/, '')); }
  catch { return null; }
}

async function imageDimensions(source: string | Buffer, extension: string) {
  const meta = await sharp(source, { animated: true }).metadata();
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (!width || !height) return null;
  const rotated = [5, 6, 7, 8].includes(meta.orientation ?? 0);
  return { width: rotated ? height : width, height: rotated ? width : height,
    animated: (meta.pages ?? 1) > 1 || extension === '.apng' };
}

async function downloadCreatorAvatar(uid: string, value: unknown): Promise<LocalImage | null> {
  const url = typeof value === 'string' ? URL.parse(value) : null;
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)+(?:hdslb\.com|biliimg\.com)$/.test(url.hostname)) return null;
  try {
    const response = await fetch(url, { redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readBytes(response, 5 * 1024 * 1024);
    const format = imageFormat(bytes);
    if (!format) return null;
    const extension = `.${format.ext}`;
    const dimensions = await imageDimensions(bytes, extension);
    if (!dimensions) return null;

    await mkdir(avatarCache, { recursive: true });
    const path = join(avatarCache, `${uid}${extension}`);
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
    return { path, mime: format.mime, size: bytes.length, ...dimensions };
  } catch { return null; }
}

async function createLocalManifest(args: ReturnType<typeof options>, legacy: Legacy, media: Map<string, StoredImage>) {
  const content = await realpath(args.content);
  const allowedRoots = [content];
  for (const name of ['site-v2', 'site']) {
    const build = join(args.legacy, '.build', name);
    if (await exists(build)) allowedRoots.push(await realpath(build));
  }
  const inspected = new Map<string, Promise<LocalImage | null>>();
  const inspect = (dir: string, name: string) => {
    const mime = mimeTypes.get(extname(name).toLowerCase());
    const candidate = resolve(dir, name);
    const rel = relative(dir, candidate);
    if (!mime || !rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return Promise.resolve(null);
    const existing = inspected.get(candidate);
    if (existing) return existing;
    const result = (async () => {
      try {
        const path = await realpath(candidate);
        const actual = relative(dir, path);
        if (actual === '..' || actual.startsWith(`..${sep}`) || isAbsolute(actual)) return null;
        const info = await stat(path);
        if (!info.isFile() || info.size === 0) return null;
        const dimensions = await imageDimensions(path, extname(path).toLowerCase());
        return dimensions && { path, mime, size: info.size, ...dimensions };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code && !['ENOENT', 'ENOTDIR'].includes(code)) throw error;
        return null;
      }
    })();
    inspected.set(candidate, result);
    return result;
  };

  async function find(values: unknown[]) {
    for (const value of new Set(values)) {
      const key = localPart(value);
      if (!key) continue;
      for (const path of [key, `dist/${key}`]) {
        const image = await inspect(content, path);
        if (image) return image;
      }
      for (const build of allowedRoots.slice(1)) {
        const image = await inspect(build, key.replace(/^dist\//, ''));
        if (image) return image;
      }
    }
    return null;
  }

  const fallback = await find(['avatar.png', 'favicon.png']);
  if (!fallback) throw new Error('内容仓缺少站点占位图 dist/avatar.png');
  const manifest: Manifest = { version: 1, uploaded: false, generatedAt: new Date().toISOString(), works: {}, assets: {}, missing: [],
    summary: { expectedWorks: legacy.works.length, works: 0, assets: 0, missing: 0, verifiedHashes: 0, tombstones: 0 } };
  const stats = { originals: 0, derivativeOriginals: 0, placeholders: 0, portraits: 0, localAvatars: 0,
    cachedAvatars: 0, downloadedAvatars: 0, missingAvatars: 0, repeatedDigests: 0 };
  const digests = new Set<string>();

  function register(key: string, image: LocalImage) { media.set(key, image); return key; }

  const prepared = await bounded(legacy.works, 12, async row => {
    const upstreamName = typeof row.historicalOriginal === 'string' ? basename(row.historicalOriginal) : null;
    const [original, thumb, display] = await Promise.all([
      find([row.path, row.originalPath, row.historicalOriginal, upstreamName && `blue-fish-originals/${upstreamName}`]),
      find([row.thumbnailPath]), find([row.fullPath]),
    ]);
    const image = original ?? display ?? thumb ?? fallback;
    const thumbnail = thumb ?? original ?? display ?? fallback;
    const large = display ?? original ?? thumb ?? fallback;
    const hasArchivedDigest = typeof row.sha256 === 'string' && digestPattern.test(row.sha256);
    const digest = (original || ['removed', 'deleted'].includes(row.status)) && hasArchivedDigest ? row.sha256 as string :
      image !== fallback ? sha256(await readFile(image.path)) : sha256(`preview:${row.id}`);
    return { row, original, image, thumbnail, large, digest };
  });

  for (const { row, original, image, thumbnail, large, digest } of prepared) {
    const { id, status } = row;
    const tombstone = status === 'removed' || status === 'deleted';
    const hash = digests.has(digest) ? sha256(`preview:${id}:${digest}`) : digest;
    if (hash !== digest) stats.repeatedDigests++;
    digests.add(hash);
    const extension = extname(image.path).toLowerCase();
    if (status === 'published') {
      if (original) stats.originals++;
      else if (image === fallback) stats.placeholders++;
      else stats.derivativeOriginals++;
    }
    manifest.works[id] = { workId: id, status, sha256: hash,
      r2OriginalKey: tombstone ? '' : register(`originals/${id}${extension}`, image),
      r2ThumbKey: tombstone ? '' : register(`thumbs/${id}${extname(thumbnail.path)}`, thumbnail),
      r2DisplayKey: tombstone ? '' : register(`display/${id}${extname(large.path)}`, large),
      format: extension === '.apng' ? 'png' : extension.slice(1), mimeType: image.mime, isAnimated: Boolean(row.isAnimated || image.animated),
      width: image.width, height: image.height, thumbWidth: thumbnail.width, thumbHeight: thumbnail.height,
      displayWidth: large.width, displayHeight: large.height, fileSize: image.size,
    };
  }

  async function registerAsset(id: string, prefix: string, image: LocalImage) {
    const key = register(`${prefix}${extname(image.path)}`, image);
    const entry: Asset = { key, sha256: sha256(await readFile(image.path)), width: image.width, height: image.height, bytes: image.size };
    manifest.assets[id] = entry;
  }

  async function asset(id: string, prefix: string, candidates: unknown[]) {
    const image = await find(candidates);
    if (!image) return false;
    await registerAsset(id, prefix, image);
    return true;
  }

  const legacyPublic = join(args.legacy, 'frontend', 'public');
  await Promise.all([
    bounded(Object.entries(legacy.portraits), 8, async ([id, portrait]) => {
      if (await asset(`portrait:${id}`, `assets/portraits/${id}`, [portrait.path])) stats.portraits++;
    }),
    bounded(legacy.creators, 8, async row => {
      const uid = String(row.uid);
      if (!/^\d+$/.test(uid)) { stats.missingAvatars++; return; }
      const filenames = [...mimeTypes.keys()].map(extension => `${uid}${extension}`);
      const variants = filenames.map(filename => `creator-avatars/${filename}`);
      const id = `creator:${uid}`;
      const prefix = `assets/avatars/creators/bilibili-${uid}`;
      const local = await find(variants) ?? (await Promise.all(variants.map(path => inspect(legacyPublic, path)))).find(Boolean);
      if (local) {
        await registerAsset(id, prefix, local);
        stats.localAvatars++;
        return;
      }
      const cached = (await Promise.all(filenames.map(filename => inspect(avatarCache, filename)))).find(Boolean);
      if (cached) {
        await registerAsset(id, prefix, cached);
        stats.cachedAvatars++;
        return;
      }
      const downloaded = args.offline ? null : await downloadCreatorAvatar(uid, row.avatar);
      if (downloaded) {
        await registerAsset(id, prefix, downloaded);
        stats.downloadedAvatars++;
      } else stats.missingAvatars++;
    }),
    bounded(legacy.events, 4, row => asset(`event:${row.id}`, `assets/site/events/${row.id}`, [row.cover?.src])),
    bounded(legacy.links, 4, row => asset(`link:${row.id}`, `assets/site/links/${row.id}`, [row.avatar?.src, row.avatar])),
    bounded(legacy.topics, 4, row => asset(`topic:${row.id}`, `assets/avatars/topics/${row.id}`, [`author-avatars/${row.id}.webp`])),
  ]);
  manifest.summary.works = Object.keys(manifest.works).length;
  manifest.summary.assets = Object.keys(manifest.assets).length;
  return { manifest, stats };
}

function createPreviewStorage(publicImages: Map<string, StoredImage>, config: ReturnType<typeof loadConfig>) {
  const buckets = new Map<string, Map<string, StoredImage>>([[config.R2_MEDIA_BUCKET, publicImages]]);
  const reads = new Map<string, { image: StoredImage; until: number }>();
  const bucket = (name: string) => {
    const current = buckets.get(name);
    if (current) return current;
    const objects = new Map<string, StoredImage>();
    buckets.set(name, objects);
    return objects;
  };
  const localR2: Services['r2'] = {
    async putObject(name, key, bytes, mime) { bucket(name).set(key, { bytes: Buffer.from(bytes), size: bytes.byteLength, mime }); },
    async getObjectBuffer(name, key, maxBytes = 16 * 1024 * 1024) {
      const image = bucket(name).get(key);
      if (!image) throw Object.assign(new Error('预览媒体不存在'), { status: 404 });
      if (image.size > maxBytes) throw Object.assign(new Error('预览媒体超过大小上限'), { status: 413 });
      return 'path' in image ? readFile(image.path) : Buffer.from(image.bytes);
    },
    async headObject(name, key) {
      const image = bucket(name).get(key);
      return image ? { $metadata: {}, ContentLength: image.size, ContentType: image.mime } : null;
    },
    async deleteObject(name, key) { bucket(name).delete(key); },
    async copyObject(from, key, to, target) {
      const image = bucket(from).get(key);
      if (!image) throw Object.assign(new Error('预览媒体不存在'), { status: 404 });
      bucket(to).set(target, image);
    },
    async checkBucket() {},
    async signReadUrl(name, key, expiresIn = 300) {
      const now = Date.now();
      for (const [token, entry] of reads) if (entry.until < now) reads.delete(token);
      const image = bucket(name).get(key);
      const token = randomBytes(24).toString('base64url');
      if (image) reads.set(token, { image, until: now + expiresIn * 1000 });
      return `${api}/__preview-private/${token}`;
    },
    publicUrl: mediaUrl,
  };
  const response = (image: StoredImage | undefined, method: string, allowCors: boolean) => {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (allowCors) {
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    }
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!image) return new Response('预览媒体不存在', { status: 404, headers });
    headers.set('Content-Type', image.mime);
    headers.set('Content-Length', String(image.size));
    if (method === 'HEAD') return new Response(null, { headers });
    const body = 'path' in image ? Readable.toWeb(createReadStream(image.path)) as ReadableStream<Uint8Array> : new Uint8Array(image.bytes);
    return new Response(body, { headers });
  };
  return {
    r2: localR2,
    publicResponse(request: Request) {
      let key: string;
      try { key = decodeURIComponent(new URL(request.url).pathname.slice(mediaPrefix.length + 1)); }
      catch { return response(undefined, request.method, true); }
      return response(publicImages.get(key), request.method, true);
    },
    privateResponse(token: string, method: string) {
      const entry = reads.get(token);
      return response(entry && entry.until >= Date.now() ? entry.image : undefined, method, false);
    },
  };
}

async function checkResponse(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, `${url} returned HTTP ${response.status}`);
  return response;
}

function escapedHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function checkPreview(legacyWorks: LegacyWork[]) {
  assert.deepEqual(await (await checkResponse(`${api}/api/v1/health`)).json(), { ok: true });
  const [{ items }, home] = await Promise.all([
    checkResponse(`${api}/api/v1/works?pageSize=24`).then(response => response.json()) as Promise<{ items: { id: string; slug: string; name: string; image: { thumbnailUrl: string; originalUrl: string } }[] }>,
    checkResponse(`${web}/`).then(response => response.text()),
  ]);
  const first = items.find(item => legacyWorks.some(work => work.id === item.id && work.name === item.name) &&
    (home.includes(item.name) || home.includes(escapedHtml(item.name))) && home.includes(item.image.thumbnailUrl));
  assert(first, '首页没有渲染旧站的真实作品和本机缩略图');
  assert.match(home, /\bdata-preview=/);
  assert.match(home, /<dialog[^>]*\bid="preview-modal"/);
  for (const url of [first.image.thumbnailUrl, first.image.originalUrl]) {
    assert(url.startsWith(`${mediaBase}/`), `${url} is not a local preview image`);
    const response = await checkResponse(url, { headers: { Origin: web } });
    assert.match(response.headers.get('Content-Type') ?? '', /^image\//);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert((await response.arrayBuffer()).byteLength > 0);
  }
  const paths = ['/serials', '/videos', '/en/', '/zh-hant/', '/ja/', '/characters', '/topics', `/works/${first.slug}.html`];
  await Promise.all(paths.map(async path => {
    const response = await checkResponse(`${web}${path}`);
    assert.match(response.headers.get('Content-Type') ?? '', /^text\/html/);
    await response.arrayBuffer();
  }));
  const serials = await (await checkResponse(`${api}/api/v1/serials`)).json() as { items: { id: string }[] };
  assert(serials.items[0], '连载列表为空');
  const serialId = encodeURIComponent(serials.items[0].id);
  const { topic: serial } = await (await checkResponse(`${api}/api/v1/serials/${serialId}`)).json() as { topic: { pages: { pageNumber: number }[] } };
  assert(serial.pages[0], '连载没有正文页');
  const reader = await (await checkResponse(`${web}/topics/${serialId}/page/${serial.pages[0].pageNumber}`)).text();
  assert.match(reader, /\bdata-reader\b/);
  assert(reader.includes(`${mediaBase}/display/`));

  const topics = await (await checkResponse(`${api}/api/v1/topics`)).json() as { items: { id: string; workCount: number }[] };
  const smallest = topics.items.filter(topic => topic.workCount > 0).sort((a, b) => a.workCount - b.workCount)[0];
  assert(smallest, '缺少有作品的公开专题');
  const topicId = encodeURIComponent(smallest.id);
  const topicHtml = await (await checkResponse(`${web}/topics/${topicId}`)).text();
  assert.match(topicHtml, /\bdata-zip-start\b/);
  const { topic } = await (await checkResponse(`${api}/api/v1/topics/${topicId}`)).json() as { topic: { works: { work: { image: { originalUrl: string } } }[] } };
  for (const { work } of topic.works) {
    const response = await checkResponse(work.image.originalUrl, { headers: { Origin: web } });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert((await response.arrayBuffer()).byteLength > 0);
  }
  assert.match((await (await checkResponse(`${api}/admin/`)).text()), /<div id="root"/);
  const login = await checkResponse(`${api}/api/v1/admin/login`, {
    method: 'POST', headers: { Origin: api, 'Content-Type': 'application/json' }, body: JSON.stringify(owner),
  });
  const cookie = login.headers.get('Set-Cookie')?.split(';')[0];
  assert(cookie, '管理员登录缺少会话 Cookie');
  const me = await (await checkResponse(`${api}/api/v1/admin/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(me.user.email, owner.email);
  assert.equal(me.user.role, 'owner');
  await (await checkResponse(`${api}/api/v1/admin/dashboard`, { headers: { Cookie: cookie } })).arrayBuffer();
  console.log(`自检通过：健康检查、首页、看图台数据、四语言、连载阅读页、视频、角色、专题打包下载资源、详情、后台登录。作品「${first.name}」的原图与缩略图均可本地获取。`);
}

async function main() {
  const check = process.argv.includes('--check');
  const args = options(process.argv.slice(2).filter(arg => arg !== '--check'));
  if (args.help) { console.log('preview-local.ts [--legacy PATH] [--content PATH] [--check]'); return; }
  const adminDist = join(root, 'apps/admin/dist');
  const astroEntry = join(root, 'apps/web/dist/server/entry.mjs');
  if (!await exists(join(adminDist, 'index.html')) || !await exists(astroEntry)) throw new Error('缺少前后台构建产物，请先在仓库根目录运行 pnpm build');

  const connection = await previewDatabase();
  const stop = new AbortController();
  const stopped = new Promise<void>(done => stop.signal.addEventListener('abort', () => done(), { once: true }));
  const signal = () => stop.abort();
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  let server: ReturnType<typeof serve> | undefined;
  let frontend: ReturnType<typeof spawn> | undefined;
  let frontendExit: Promise<number | null> | undefined;
  try {
    const started = performance.now();
    const config = { ...loadConfig({ DATABASE_URL: 'postgres://preview@localhost/preview', R2_ACCOUNT_ID: '0'.repeat(32),
      R2_ACCESS_KEY_ID: 'preview', R2_SECRET_ACCESS_KEY: 'preview', SESSION_SECRET: randomBytes(32).toString('hex'),
      HOST: host, PORT: '4331', SITE_PUBLIC_URL: web, ALLOWED_ORIGINS: api, ADMIN_DIST_DIR: adminDist }), R2_PUBLIC_BASE_URL: mediaBase };
    const [legacy, brands] = await Promise.all([loadLegacy(args.legacy), readBrandTokens(args.legacy)]);
    const images = new Map<string, StoredImage>();
    const { manifest, stats } = await createLocalManifest(args, legacy, images);
    const legacyReadMs = performance.now() - started;
    const importStart = performance.now();
    // importData uses this variable only while projecting public asset URLs.
    const previousMediaBase = process.env.R2_PUBLIC_BASE_URL;
    process.env.R2_PUBLIC_BASE_URL = mediaBase;
    let imported: Awaited<ReturnType<typeof importData>>;
    try {
      imported = await importData(connection.db, { legacy, brands, works: legacy.works, manifest,
        sqlite: readSqlite(), sqliteImages: new Map(), withoutMedia: [], queue: new Map(), archiveLinks: new Map(), ga4: undefined }, { ...args, site: web });
    } finally {
      if (previousMediaBase === undefined) delete process.env.R2_PUBLIC_BASE_URL;
      else process.env.R2_PUBLIC_BASE_URL = previousMediaBase;
    }
    await initializeOwner(connection.db, owner.email, owner.password);
    console.log(`旧数据与本地媒体索引 ${(legacyReadMs / 1000).toFixed(2)} 秒，数据库导入及管理员初始化 ${((performance.now() - importStart) / 1000).toFixed(2)} 秒。`);
    console.log(JSON.stringify({ ...imported, roles: legacy.roles.length, categories: legacy.categories.length,
      events: legacy.events.length, friendLinks: legacy.links.length, ...stats }));
    const storage = createPreviewStorage(images, config);
    const app = createApp({ db: connection.db, config, services: { r2: storage.r2 } });
    app.on(['GET', 'HEAD', 'OPTIONS'], `${mediaPrefix}/*`, c => storage.publicResponse(c.req.raw));
    app.on(['GET', 'HEAD'], '/__preview-private/:token', c => storage.privateResponse(c.req.param('token'), c.req.method));
    await new Promise<void>((listening, failed) => {
      server = serve({ fetch: app.fetch, port: 4331, hostname: host }, listening);
      server.once('error', failed);
    });
    frontend = spawn(process.execPath, [astroEntry], { cwd: join(root, 'apps/web'), stdio: 'inherit', env: {
      ...process.env, HOST: host, PORT: '4330', API_BASE_URL: api, PUBLIC_SITE_URL: web,
    } });
    const child = frontend;
    frontendExit = new Promise(resolveExit => {
      child.once('error', error => { console.error('Astro SSR 启动失败', error); resolveExit(1); });
      child.once('close', resolveExit);
    });
    const unexpectedExit = frontendExit.then(code => { throw new Error(`Astro SSR 已退出（退出码 ${code}）`); });
    const ready = async () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const reply = await fetch(`${web}/`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
        if (reply?.ok) { await reply.arrayBuffer(); return; }
        await reply?.body?.cancel();
        await delay(200);
      }
      throw new Error('Astro SSR 未能及时提供首页');
    };
    const completed = async () => {
      await ready();
      console.log(`前台 ${web}/    后台 ${api}/admin/`);
      console.log(`本地管理员 ${owner.email}，交互登录请在启动预览前设置 PREVIEW_ADMIN_PASSWORD。`);
      if (check) await checkPreview(legacy.works);
      else await stopped;
    };
    await Promise.race([completed(), unexpectedExit, stopped]);
  } finally {
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
    if (frontend && frontend.exitCode === null && frontend.signalCode === null) frontend.kill();
    await frontendExit;
    if (server?.listening) {
      const closing = new Promise<void>(resolveClose => server!.close(() => resolveClose()));
      server.closeAllConnections();
      await closing;
    }
    await connection.close();
  }
}

await main();
