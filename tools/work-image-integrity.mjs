// Work-image integrity gate (issue #33).
// A build machine whose dist/submissions is not populated yet used to publish the
// whole archive with placeholder images. Snapshotting is the last point where the
// real files are still visible, so it refuses to continue with too many gaps.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {IMAGE_PLACEHOLDER, workImageURL} from '../frontend/public/components/work-image.js';

export {IMAGE_PLACEHOLDER};
export const LEGACY_PREVIEW_DIR = 'data/blue-fish/previews';
export const MISSING_IMAGE_LIMIT = 0.01;

const remoteImage = value => /^https?:\/\//i.test(value);

export function isPlaceholderImage(value) {
  if (typeof value !== 'string') return true;
  const source = value.trim();
  if (!source) return true;
  const pathname = source.split(/[?#]/, 1)[0];
  return pathname.split('/').pop() === 'image-placeholder.svg';
}

/**
 * A published work has a usable image when its thumbnail or display image is
 * a real file. The two fields fall back to each other, so either one is enough.
 * Remote URLs are real images, but they are never probed as local files; a
 * local path only counts when imageExists() confirms it is on this build.
 */
export function workImagePresent(work, {imageExists = () => true} = {}) {
  // Final snapshot fields are authoritative; raw metadata cannot rescue a
  // normalized placeholder. Raw catalogs and the published compact overlay
  // still use their own thumbnail/display field names.
  const normalized = work?.thumbUrl !== undefined || work?.displayUrl !== undefined;
  const values = normalized
    ? [work.thumbUrl, work.displayUrl]
    : [work?.thumbnailPath, work?.previewPath, work?.i, work?.fullPath, work?.largePath, work?.l];
  for (const value of values) {
    const source = workImageURL(value, '');
    if (isPlaceholderImage(source)) continue;
    if (remoteImage(source) || imageExists(source)) return true;
  }
  return false;
}

/** Published works whose thumb and full image are both unavailable. */
export function missingWorkImages(works, options = {}) {
  return (Array.isArray(works) ? works : []).filter(work => !workImagePresent(work, options));
}

/**
 * Few missing images stay a warning that lists every affected work; more than
 * 1% aborts before the snapshot is written. Returns the missing works so
 * callers and tests can inspect them.
 */
export function assertWorkImages(works, {log = console, limit = MISSING_IMAGE_LIMIT, imageExists} = {}) {
  const missing = missingWorkImages(works, {imageExists});
  if (!missing.length) return missing;
  const total = Array.isArray(works) ? works.length : 0;
  const ratio = missing.length / Math.max(1, total);
  const ids = missing.map(work => work.id).join(', ');
  if (ratio > limit) {
    throw new Error(`[snapshot] 缺图作品 ${missing.length}/${total}（${(ratio * 100).toFixed(2)}%）超过 ${(limit * 100).toFixed(0)}%，构建中止；` +
      `请先完成内容仓图片同步（tools/sync_content.mjs）：${ids}`);
  }
  log.warn(`[snapshot] 缺图作品 ${missing.length}/${total}（${(ratio * 100).toFixed(2)}%）：${ids}`);
  return missing;
}

// The published overlay already contains the resolved thumbnail and display URLs.
// Each serves a different surface, so check both even when one still works.
export function assertReleaseWorkImages(imageRoot, overlayFile = path.join(imageRoot, 'works-v2.json')) {
  const root = path.resolve(imageRoot);
  const files = new Map();
  const releaseImage = value => {
    const url = new URL(value, 'https://archive.invalid/');
    const pathname = decodeURIComponent(url.pathname);
    if (files.has(pathname)) return files.get(pathname);
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    const entry = fs.statSync(file, {throwIfNoEntry: false});
    const image = entry?.isFile() && entry.size > 0 ? {url: url.pathname, file} : null;
    files.set(pathname, image);
    return image;
  };
  const placeholder = releaseImage(IMAGE_PLACEHOLDER);
  if (!placeholder) {
    throw new Error('[publish-images] Missing or empty ' + IMAGE_PLACEHOLDER);
  }
  const overlay = JSON.parse(fs.readFileSync(overlayFile, 'utf8'));
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    throw new Error('[publish-images] Expected the published works-v2.json overlay');
  }
  const works = Object.values(overlay);
  if (!works.length || works.some(work => typeof work?.id !== 'string' || !work.id)) {
    throw new Error('[publish-images] Expected a nonempty list of works with stable IDs');
  }
  const samples = new Map([['placeholder', placeholder]]);
  const missing = [];
  for (const work of works) {
    const broken = [];
    for (const [field, value] of [['thumb', work.i], ['display', work.l]]) {
      const source = workImageURL(value, '');
      if (!isPlaceholderImage(source) && remoteImage(source)) continue;
      const image = isPlaceholderImage(source) ? null : releaseImage(source);
      if (!image) {
        broken.push(`${field}=${source || '(missing)'}`);
        continue;
      }
      const group = image.url.startsWith('/' + LEGACY_PREVIEW_DIR + '/')
        ? LEGACY_PREVIEW_DIR
        : image.url.split('/').slice(0, 3).join('/');
      if (!samples.has(group)) samples.set(group, image);
    }
    if (broken.length) missing.push(`${work.id}: ${broken.join(', ')}`);
  }
  if (missing.length) {
    throw new Error(`[publish-images] 缺图作品 ${missing.length}/${works.length}\n${missing.join('\n')}`);
  }
  return {total: works.length, samples: [...samples.values()]};
}

export async function checkReleaseImageResponses(healthUrl, samples) {
  const probe = randomUUID();
  await Promise.all(samples.map(async ({url, file}) => {
    const target = new URL(url, healthUrl);
    target.searchParams.set('__deploy_image_probe', probe);
    const response = await fetch(target, {signal: AbortSignal.timeout(20_000)});
    const type = response.headers.get('content-type')?.split(';', 1)[0].trim();
    const expectedType = {'.webp': 'image/webp', '.svg': 'image/svg+xml'}[path.extname(url).toLowerCase()];
    if (response.status !== 200 || !type?.startsWith('image/') || (expectedType && type !== expectedType)) {
      await response.body?.cancel();
      throw new Error(`[publish-images] ${target.pathname}: HTTP ${response.status}, Content-Type ${type || '(missing)'}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.equals(fs.readFileSync(file))) {
      throw new Error(`[publish-images] ${target.pathname}: HTTP body differs from release file`);
    }
    console.log(`[publish-images] HTTP ${response.status} ${type} ${body.length} bytes ${target.pathname}`);
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [overlayFile, imageRoot, option, healthUrl] = process.argv.slice(2);
  if (!overlayFile || !imageRoot || (option && (option !== '--http' || !healthUrl)) || process.argv.length > 6) {
    throw new Error('Usage: node tools/work-image-integrity.mjs <works-v2.json> <release-root> [--http <health-url>]');
  }
  try {
    const {total, samples} = assertReleaseWorkImages(imageRoot, overlayFile);
    console.log(`[publish-images] ${total}/${total} works have thumbnail and display images in ${imageRoot}`);
    if (healthUrl) await checkReleaseImageResponses(healthUrl, samples);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
