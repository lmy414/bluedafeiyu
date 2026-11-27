#!/usr/bin/env -S tsx --conditions=development
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
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

export async function migrateMedia(args: Args) {
  const { works: publicWorks, portraits, creators, events, links, topics } = await loadLegacy(args.legacy);
  const works = sqliteWorks(readSqlite(args.sqlite), publicWorks);
  const sharp = apiRequire('sharp');
  const client = args.dryRun ? null : await import('../apps/api/src/jobs/r2.js');
  const r2 = client?.openR2();
  const bucket = process.env.R2_MEDIA_BUCKET || 'dafeiyu-media';
  const uploading = new Map<string, Promise<void>>();
  const put: Put = async (key, bytes, mime) => {
    if (!r2 || !client) return;
    const prior = uploading.get(key);
    if (prior) return prior;
    const request = client.putVerifiedMedia(r2, bucket, key, bytes, mime);
    uploading.set(key, request);
    try { await request; } catch (error) { uploading.delete(key); throw error; }
  };
  const report: Manifest = { version: 1, uploaded: Boolean(r2), generatedAt: new Date().toISOString(), works: {}, assets: {}, missing: [],
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
        const original = existingMedia || upstreamImage || (historical && sha256(historical) === row.sha256 ? historical : null) ||
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
    const assets: { id: string; key: string; path: string; sha?: string; convert?: boolean }[] = [
      ...Object.entries(portraits).map(([id, row]) => ({ id: `portrait:${id}`, key: `assets/portraits/${id}.webp`, path: row.path, sha: row.outputSha256 })),
      ...creators.filter(row => row.avatar).map(row => ({ id: `creator:${row.uid}`, key: `assets/avatars/creators/bilibili-${row.uid}.webp`, path: row.avatar, convert: true })),
      ...events.filter(row => row.cover?.src).map(row => ({ id: `event:${row.id}`, key: `assets/site/events/${row.id}${extname(row.cover.src)}`, path: row.cover.src })),
      ...links.filter(row => row.avatar?.src || row.avatar).map(row => ({ id: `link:${row.id}`, key: `assets/site/links/${row.id}.webp`, path: row.avatar?.src || row.avatar, convert: true })),
      ...topicAvatars.flat(),
      ...['avatar.png', 'favicon.ico', 'favicon.png', 'qq-group.png'].map(name => ({ id: `site:${name}`, key: `assets/site/${name}`, path: name })),
    ];
    const assetRows = await bounded(assets, args.concurrency, async item => {
      try {
        const creatorUid = item.id.startsWith('creator:') ? item.id.slice(8) : '';
        const avatarName = creators.find(row => String(row.uid) === creatorUid)?.name?.toLowerCase();
        let bytes = await source(item.path, creatorUid ? [`dist/author-avatars/bilibili-${creatorUid}.webp`, `dist/author-avatars/${creatorUid}.webp`,
          ...(/^[a-z0-9_-]+$/.test(avatarName || '') ? [`dist/author-avatars/${avatarName}.webp`] : [])] : [], true);
        if (item.sha && sha256(bytes) !== item.sha) throw new Error('资产 SHA-256 不符');
        if (item.convert) bytes = await sharp(bytes).rotate().resize(400, 400, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer();
        const ext = extname(item.key).slice(1);
        const dimensions = ext === 'ico' ? { width: null, height: null } : size(await sharp(bytes).metadata());
        await put(item.key, bytes, extMime(ext));
        const entry: Asset = { key: item.key, sha256: sha256(bytes), ...dimensions, bytes: bytes.length };
        return [item.id, entry] as const;
      } catch (error) { report.missing.push({ id: item.id, error: (error as Error).message }); return null; }
    });
    for (const row of assetRows) if (row) report.assets[row[0]] = row[1];
    report.missing.sort((a, b) => a.id.localeCompare(b.id));
    Object.assign(report.summary, { works: Object.keys(report.works).length, assets: Object.keys(report.assets).length, missing: report.missing.length,
      tombstones: Object.values(report.works).filter(row => !row.r2OriginalKey).length,
    });
    return report;
  } finally { r2?.destroy(); }
}

runCli(import.meta.url, async () => {
  const args = options();
  if (args.help) { console.log('migrate-r2.ts [--legacy PATH] [--content PATH] [--upstream PATH] [--manifest PATH] [--sqlite PATH] [--concurrency N] [--offline] [--dry-run]'); return; }
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
