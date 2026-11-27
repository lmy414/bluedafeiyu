#!/usr/bin/env -S tsx --conditions=development
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { readBytes, sha256 } from '../apps/api/src/routes/hermes/protocol.js';
import { runCli } from '../apps/api/src/jobs/runtime.js';
import { bounded, digestPattern, exists, loadLegacy, options } from './legacy-data.js';
import type { Asset, LegacyWork, Manifest } from './legacy-data.js';
import { readSqlite, sqliteWorks } from './legacy-sqlite.js';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const exec = promisify(execFile);
const maxBytes = 100 * 1024 * 1024;
const contentPrefix = 'https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/';
type Args = ReturnType<typeof options>;
type Put = (key: string, bytes: Buffer, mime: string) => Promise<void>;
type Metadata = { width?: number; height?: number; pageHeight?: number; pages?: number; orientation?: number; format?: string };

function localPart(value: string) {
  const url = value.startsWith(contentPrefix) ? value.slice(contentPrefix.length) : /^https?:/.test(value) ? '' : value;
  return decodeURIComponent(url.replace(/^\/+/, ''));
}

async function local(base: string, key: string, git = false) {
  const path = resolve(base, key);
  if (!path.startsWith(resolve(base) + sep)) throw new Error(`媒体路径超出目录 ${key}`);
  try { return await readFile(path); }
  catch (error) { if (!['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code || '')) throw error; }
  if (git) {
    try { return (await exec('git', ['-C', base, 'show', `HEAD:${key.replaceAll('\\', '/')}`], { encoding: 'buffer', maxBuffer: maxBytes, timeout: 8000 })).stdout; }
    catch { /* Sparse checkout may omit this object. */ }
  }
  return null;
}

async function history(base: string, key: string) {
  const path = key.replaceAll('\\', '/');
  try {
    const { stdout } = await exec('git', ['-C', base, 'log', '--all', '--diff-filter=AMCR', '-n', '1', '--format=%H', '--', path], { timeout: 8000 });
    const commit = stdout.trim();
    if (!/^[a-f0-9]{40,64}$/.test(commit)) return null;
    return (await exec('git', ['-C', base, 'show', `${commit}:${path}`], { encoding: 'buffer', maxBuffer: maxBytes, timeout: 8000 })).stdout;
  } catch { return null; }
}

async function download(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^(?:raw\.githubusercontent\.com|(?:[a-z0-9-]+\.)*(?:hdslb\.com|biliimg\.com))$/.test(url.hostname)) throw new Error('未核准的媒体来源');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`媒体 HTTP ${response.status} ${url.pathname}`);
  return readBytes(response, maxBytes);
}

function extMime(ext: string) {
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
}

function size(meta: Metadata) {
  const frame = meta.pageHeight || meta.height || 0;
  const rotate = [5, 6, 7, 8].includes(meta.orientation ?? 0);
  return { width: rotate ? frame : meta.width || 0, height: rotate ? meta.width || 0 : frame };
}

function iconSize(bytes: Buffer) {
  if (bytes.length < 6 || bytes.readUInt32LE(0) !== 65536) throw new Error('ICO 文件头无效');
  const count = bytes.readUInt16LE(4);
  if (!count || bytes.length < 6 + count * 16) throw new Error('ICO 图像目录无效');
  let largest = { width: 0, height: 0 };
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i;
    const width = bytes[at] || 256, height = bytes[at + 1] || 256;
    const length = bytes.readUInt32LE(at + 8), offset = bytes.readUInt32LE(at + 12);
    if (!length || offset < 6 + count * 16 || offset + length > bytes.length) throw new Error('ICO 图像范围无效');
    if (width * height > largest.width * largest.height) largest = { width, height };
  }
  return largest;
}

export async function migrateMedia(args: Args) {
  const { works: publicWorks, portraits, creators, events, links, topics } = await loadLegacy(args.legacy);
  const works = sqliteWorks(readSqlite(args.sqlite), publicWorks);
  const ogRoot = args.release && join(args.release, 'og');
  const ogFiles = ogRoot ? (await readdir(ogRoot, { withFileTypes: true })).filter(item => item.isFile() && /\.(?:jpe?g|png|webp)$/i.test(item.name)) : [];
  if (ogRoot || !args.dryRun) {
    const names = new Set(ogFiles.map(file => file.name));
    for (const row of works) {
      if (names.has(`archive--works-${row.slug}-html.jpg`) !== (row.status === 'published')) throw new Error(`现行发布目录的 OG 图与作品状态不一致 ${row.id}`);
    }
  }
  const sharp = apiRequire('sharp');
  const client = args.dryRun ? null : await import('../apps/api/src/jobs/r2.js');
  const r2 = client?.openR2();
  const bucket = process.env.R2_MEDIA_BUCKET || 'dafeiyu-media';
  if (bucket !== 'dafeiyu-media') throw new Error('正式媒体迁移仅允许 dafeiyu-media 桶');
  const uploading = new Map<string, Promise<void>>();
  const objects: NonNullable<Manifest['objects']> = {};
  const put: Put = async (key, bytes, mime) => {
    const digest = sha256(bytes);
    if (objects[key] && objects[key]!.sha256 !== digest) throw new Error(`相同对象键对应不同字节 ${key}`);
    objects[key] = { sha256: digest, bytes: bytes.length, mime };
    if (!r2 || !client) return;
    const prior = uploading.get(key);
    if (prior) return prior;
    const request = client.putVerifiedMedia(r2, bucket, key, bytes, mime);
    uploading.set(key, request);
    try { await request; } catch (error) { uploading.delete(key); throw error; }
  };
  const report: Manifest = { version: 1, uploaded: false, generatedAt: new Date().toISOString(), works: {}, assets: {}, objects, missing: [],
    summary: { expectedWorks: works.length, works: 0, assets: 0, missing: 0, verifiedHashes: 0, tombstones: 0 },
  };
  const source = async (value: string, fallbacks: string[] = [], preferGit = false) => {
    const name = localPart(value);
    for (const key of [...new Set([name, ...(name && !name.startsWith('dist/') ? [`dist/${name}`] : []), ...fallbacks].filter(Boolean))]) {
      const bytes = await local(args.content, key, preferGit);
      if (bytes) return bytes;
    }
    if (!args.offline && /^https:/.test(value)) return download(value);
    throw new Error(`本机找不到 ${value}`);
  };
  const derivative = async (row: LegacyWork, bytes: Buffer, phase: 'thumb' | 'display', animated: boolean) => {
    const fallbackWidth = phase === 'thumb' ? 480 : 1600;
    const path = localPart(phase === 'thumb' ? row.thumbnailPath || '' : row.fullPath || '');
    let candidate: Buffer | null = null;
    if (path && Number(row.width) > 0 && Number(row.height) > 0) candidate = await local(args.content, `dist/${path}`) || await local(args.content, path);
    const meta: Metadata | undefined = candidate ? await sharp(candidate, { animated: true }).metadata().catch(() => undefined) : undefined;
    if (candidate && meta?.format === 'webp' && (!animated || (meta.pages || 1) > 1)) return { bytes: candidate, ...size(meta) };
    const result = await sharp(bytes, { animated }).rotate().resize({ width: fallbackWidth, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    return { bytes: result as Buffer, ...size(await sharp(result, { animated }).metadata()) };
  };
  try {
    const rows = await bounded(works, args.concurrency, async row => {
      try {
        const tombstone = ['removed', 'deleted'].includes(row.status);
        if (tombstone && digestPattern.test(row.sha256)) {
          const ext = row.format === 'jpeg' ? 'jpg' : row.format || extname(row.path || '').slice(1) || 'png';
          return { workId: row.id, status: row.status, sha256: row.sha256, r2OriginalKey: '', r2ThumbKey: '', r2DisplayKey: '',
            width: Number(row.width) || 0, height: Number(row.height) || 0, thumbWidth: 0, thumbHeight: 0, displayWidth: 0, displayHeight: 0,
            format: ext, mimeType: row.mimeType || extMime(ext), fileSize: Number(row.fileSize) || 0, isAnimated: Boolean(row.isAnimated),
          };
        }
        const existingMedia = row.localMediaFile && await local(resolve(args.legacy, 'admin/media'), row.localMediaFile);
        const upstreamPrefix = 'https://raw.githubusercontent.com/EDMOK/blue-fish-archive/main/';
        const upstreamImage = args.upstream && row.path?.startsWith(upstreamPrefix)
          ? await local(args.upstream, decodeURIComponent(row.path.slice(upstreamPrefix.length)), true) || await local(args.upstream, row.historicalOriginal, true) : null;
        const historical = row.status === 'hidden' && row.sha256 && row.path?.startsWith(contentPrefix) ? await history(args.content, localPart(row.path)) : null;
        const verifiedLocal = existingMedia && row.sha256 && sha256(existingMedia) === row.sha256 ? existingMedia : null;
        const original = verifiedLocal || upstreamImage || (historical && sha256(historical) === row.sha256 ? historical : null) ||
          await source(row.path || '', row.historicalOriginal ? [row.historicalOriginal, `blue-fish-originals/${row.historicalOriginal.split('/').at(-1)}`] : [], true);
        if (!Buffer.isBuffer(original)) throw new Error('旧后台图片不可读');
        const digest = sha256(original);
        if (row.sha256 && (!digestPattern.test(row.sha256) || digest !== row.sha256)) throw new Error(`原图 SHA-256 不符 ${digest} ≠ ${row.sha256}`);
        const meta: Metadata = await sharp(original, { animated: true }).metadata();
        const format = meta.format === 'jpeg' ? 'jpg' : meta.format;
        if (!format || !['png', 'jpg', 'webp', 'gif'].includes(format)) throw new Error(`不支持的原图格式 ${format}`);
        const { width, height } = size(meta);
        if (!width || !height) throw new Error('无法读取原图真实像素尺寸');
        const isAnimated = (meta.pages || 1) > 1;
        const part = `${digest.slice(0, 2)}/${digest}`;
        const r2OriginalKey = `originals/${part}.${format}`;
        const r2ThumbKey = `thumbs/${part}.webp`;
        const r2DisplayKey = `display/${part}.webp`;
        const mimeType = extMime(format);
        const thumb = await derivative(row, original, 'thumb', isAnimated);
        const display = await derivative(row, original, 'display', isAnimated);
        if (!thumb.width || !thumb.height || !display.width || !display.height) throw new Error('派生图尺寸无效');
        await Promise.all([put(r2OriginalKey, original, mimeType), put(r2ThumbKey, thumb.bytes, 'image/webp'), put(r2DisplayKey, display.bytes, 'image/webp')]);
        if (row.sha256) report.summary.verifiedHashes++;
        return { workId: row.id, status: row.status, sha256: digest, r2OriginalKey, r2ThumbKey, r2DisplayKey, width, height, format, mimeType,
          thumbWidth: thumb.width, thumbHeight: thumb.height, displayWidth: display.width, displayHeight: display.height, fileSize: original.length, isAnimated,
        };
      } catch (error) { report.missing.push({ id: row.id, error: (error as Error).message }); return null; }
    });
    for (const row of rows) if (row) report.works[row.workId] = row;
    const topicAvatars = await Promise.all(topics.map(async row => {
      const path = `dist/author-avatars/${row.id}.webp`;
      return await exists(resolve(args.content, path)) ? [{ id: `topic:${row.id}`, key: `assets/avatars/topics/${row.id}.webp`, path }] : [];
    }));
    const siteAssets = [];
    for (const directory of ['community', 'credits']) {
      const dir = join(args.content, 'dist', directory);
      if (!await exists(dir)) continue;
      for (const file of await readdir(dir, { withFileTypes: true })) {
        if (!file.isFile() || !/\.(?:jpe?g|png|webp)$/i.test(file.name)) continue;
        const path = `${directory}/${file.name}`;
        siteAssets.push({ id: `site:${path}`, key: `assets/site/${path}`, path });
      }
    }
    const assets: { id: string; key: string; path: string; root?: string; sha?: string; convert?: boolean }[] = [
      ...ogFiles.map(file => ({ id: `og:${file.name}`, key: `og/legacy/${file.name}`, path: file.name, root: ogRoot })),
      ...siteAssets,
      ...Object.entries(portraits).map(([id, row]) => ({ id: `portrait:${id}`, key: `assets/portraits/${id}.webp`, path: row.path, sha: row.outputSha256 })),
      ...creators.map(row => ({ id: `creator:${row.uid}`, key: `assets/avatars/creators/bilibili-${row.uid}.webp`, path: row.avatar || '', convert: true })),
      ...events.filter(row => row.cover?.src).map(row => ({ id: `event:${row.id}`, key: `assets/site/events/${row.id}${extname(row.cover.src)}`, path: row.cover.src })),
      ...links.filter(row => row.avatar?.src || row.avatar).map(row => ({ id: `link:${row.id}`, key: `assets/site/links/${row.id}.webp`, path: row.avatar?.src || row.avatar, convert: true })),
      ...topicAvatars.flat(),
      ...['avatar.png', 'favicon.ico', 'favicon.png', 'qq-group.png'].map(name => ({ id: `site:${name}`, key: `assets/site/${name}`, path: name })),
    ];
    const assetRows = await bounded(assets, args.concurrency, async item => {
      try {
        const creatorUid = item.id.startsWith('creator:') ? item.id.slice(8) : '';
        let bytes: Buffer | null = item.root ? await local(item.root, item.path) : null;
        if (creatorUid && /^\d+$/.test(creatorUid)) {
          const roots = [join(args.legacy, 'frontend/public/creator-avatars'), args.creatorAvatars].filter((dir): dir is string => !!dir);
          for (const dir of roots) {
            for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']) {
              bytes = await local(dir, `${creatorUid}.${ext}`);
              if (bytes) break;
            }
            if (bytes) break;
          }
        }
        bytes ??= await source(item.path, creatorUid ? [`dist/author-avatars/bilibili-${creatorUid}.webp`, `dist/author-avatars/${creatorUid}.webp`] : [], true);
        if (item.sha && sha256(bytes) !== item.sha) throw new Error('资产 SHA-256 不符');
        if (item.convert) bytes = await sharp(bytes).rotate().resize(400, 400, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer() as Buffer;
        const ext = extname(item.key).slice(1);
        const dimensions = ext === 'ico' ? iconSize(bytes) : size(await sharp(bytes).metadata());
        if (!dimensions.width || !dimensions.height) throw new Error('无法读取资产尺寸');
        await put(item.key, bytes, extMime(ext));
        const entry: Asset = { key: item.key, sha256: sha256(bytes), ...dimensions, bytes: bytes.length };
        return [item.id, entry] as const;
      } catch (error) { report.missing.push({ id: item.id, error: (error as Error).message }); return null; }
    });
    for (const row of assetRows) if (row) report.assets[row[0]] = row[1];
    report.missing.sort((a, b) => a.id.localeCompare(b.id));
    report.uploaded = Boolean(r2) && !report.missing.length;
    Object.assign(report.summary, { works: Object.keys(report.works).length, assets: Object.keys(report.assets).length, missing: report.missing.length,
      tombstones: Object.values(report.works).filter(row => !row.r2OriginalKey).length,
    });
    return report;
  } finally { r2?.destroy(); }
}

runCli(import.meta.url, async () => {
  const args = options();
  if (args.help) { console.log('migrate-r2.ts [--legacy PATH] [--content PATH] [--upstream PATH] [--legacy-release PATH] [--creator-avatars PATH] [--manifest PATH] [--sqlite PATH] [--concurrency N] [--offline] [--dry-run]'); return; }
  const report = await migrateMedia(args);
  if (!args.dryRun) {
    await mkdir(dirname(args.manifest), { recursive: true });
    const temp = `${args.manifest}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`);
    await rename(temp, args.manifest);
  }
  if (report.missing.length) process.exitCode = 1;
  return { dryRun: args.dryRun, manifest: args.dryRun ? null : args.manifest, ...report.summary, missingEntries: report.missing };
});
