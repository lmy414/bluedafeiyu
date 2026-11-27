import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Wire } from '../apps/api/src/routes/hermes/protocol.js';
import { imageFormat, sha256 } from '../apps/api/src/routes/hermes/protocol.js';
import { digestPattern, exists, readJson } from './legacy-data.js';

export const previewNote = '原图在旧站迁移前已缺失，已保留旧 CMS WebP 预览供人工复核';

export async function readFileQueue(root?: string) {
  const items = new Map<string, Wire>();
  if (!root) return items;
  for (const name of await readdir(join(root, 'items'))) {
    if (!name.endsWith('.json')) continue;
    const row = await readJson<Wire>(join(root, 'items', name));
    const extension = String(row.ext).replace(/^\./, '');
    if (!digestPattern.test(row.sha256) || row.id !== `sub_${row.sha256.slice(0, 24)}` || name !== `${row.id}.json` ||
        !['web', 'github-issue', 'qq', 'manual'].includes(row.source) || !/^(?:png|jpe?g|gif|webp)$/i.test(extension)) throw new Error('独立投稿队列标识、渠道或文件类型无效');
    const bytes = await readFile(join(root, 'objects', `${row.sha256}.${extension}`));
    const format = imageFormat(bytes);
    if (!format || format.mime !== row.mime || bytes.length !== row.bytes || sha256(bytes) !== row.sha256) throw new Error(`独立投稿队列原图不符 ${row.id}`);
    items.set(row.id, { ...row, attachment: { key: `submissions/${row.id}/${row.sha256}.${format.ext}`, bytes, mime: format.mime } });
  }
  return items;
}

export async function readBackupAttachment(backup: string, row: Wire, media: Wire | undefined, allowedPreviews: Map<string, string>) {
  const digest = row.sha256;
  if (!digestPattern.test(digest) || !/^sub_[A-Za-z0-9_-]+$/.test(row.submission_id)) throw new Error('私有投稿标识或摘要无效');
  const original = join(backup, 'recovered-originals', digest);
  if (await exists(original)) {
    const bytes = await readFile(original);
    const format = imageFormat(bytes);
    if (!format || sha256(bytes) !== digest) throw new Error(`恢复原图校验失败 ${row.submission_id}`);
    return { key: `submissions/${row.submission_id}/${digest}.${format.ext}`, bytes, mime: format.mime };
  }
  if (allowedPreviews.get(row.submission_id) !== digest) return;
  const path = join(backup, 'verified-cms-previews', `${digest}.webp`);
  if (!await exists(path)) throw new Error(`缺少可归属该投稿的旧 CMS WebP 预览 ${row.submission_id}`);
  const bytes = await readFile(path);
  const sharp = createRequire(new URL('../apps/api/package.json', import.meta.url))('sharp');
  const metadata = await sharp(bytes).metadata();
  if (media?.filename !== `${digest}.webp` || metadata.format !== 'webp' || bytes.length !== media.filesize || metadata.width !== media.width || metadata.height !== media.height) throw new Error(`旧 CMS WebP 元数据不符 ${row.submission_id}`);
  const previewSha = sha256(bytes);
  return { key: `submissions/${row.submission_id}/legacy-preview-${previewSha}.webp`, bytes, mime: 'image/webp', previewSha };
}

type Counts = { views: number; downloads: number };
type Snapshot = { syncedAt: string; limited: boolean; unassigned: number; works: Record<string, Counts> };

export async function readGa4(path: string, works: { id: string; status: string }[]) {
  const snapshot = await readJson<Snapshot>(path);
  if (snapshot.limited !== false || snapshot.unassigned !== 0 || !Number.isFinite(Date.parse(snapshot.syncedAt)) || !snapshot.works || Array.isArray(snapshot.works)) throw new Error('GA4 快照不完整');
  for (const counts of Object.values(snapshot.works)) {
    if (![counts.views, counts.downloads].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('GA4 快照有无效计数');
  }
  for (const row of works) if (['published', 'hidden'].includes(row.status) && !Object.hasOwn(snapshot.works, row.id)) throw new Error(`GA4 快照缺少作品 ${row.id}`);
  return snapshot;
}
