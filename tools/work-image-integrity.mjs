// Work-image integrity gate (issue #33).
// A build machine whose dist/submissions is not populated yet used to publish the
// whole archive with placeholder images. Snapshotting is the last point where the
// real files are still visible, so it refuses to continue with too many gaps.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workImageURL} from '../frontend/public/components/work-image.js';


export const IMAGE_PLACEHOLDER = '/components/image-placeholder.svg';
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

// Validate the exact published overlay against the release after shared assets
// have been linked. This also covers releases that reuse a prebuilt artifact.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [overlayFile, imageRoot] = process.argv.slice(2);
  if (!overlayFile || !imageRoot || process.argv.length !== 4) {
    throw new Error('Usage: node tools/work-image-integrity.mjs <works-v2.json> <release-root>');
  }
  const root = path.resolve(imageRoot);
  const imageExists = value => {
    const pathname = decodeURIComponent(new URL(value, 'https://archive.invalid/').pathname);
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
    const entry = fs.statSync(file, {throwIfNoEntry: false});
    return !!entry?.isFile() && entry.size > 0;
  };
  if (!imageExists(IMAGE_PLACEHOLDER)) {
    throw new Error('[publish-images] Missing or empty ' + IMAGE_PLACEHOLDER);
  }
  const overlay = JSON.parse(fs.readFileSync(overlayFile, 'utf8'));
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    throw new Error('[publish-images] Expected the published works-v2.json overlay');
  }
  const works = Object.values(overlay);
  if (works.some(work => typeof work?.id !== 'string')) {
    throw new Error('[publish-images] Published works must have stable IDs');
  }
  const missing = assertWorkImages(works, {imageExists});
  console.log(`[publish-images] ${works.length - missing.length}/${works.length} works have an image in ${root}`);
}
