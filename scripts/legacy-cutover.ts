import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Wire } from '../apps/api/src/routes/hermes/protocol.js';
import { imageFormat, sha256 } from '../apps/api/src/routes/hermes/protocol.js';
import { digestPattern, exists, readJson } from './legacy-data.js';

export async function readExcludedSubmissions(backup: string, submissions: Wire[]) {
  const bytes = await readFile(join(backup, 'pending-originals-outstanding.json'));
  // The approved A2 list is part of the immutable pre-cutover backup.
  if (sha256(bytes) !== 'f9876f2c5d68d3879fd7da6786dcce594b38d51872e2c978b26d6c2044c178af') throw new Error('A2 排除清单与批准的备份不一致');
  const excluded = new Map<string, string>();
  const known = new Map(submissions.map(row => [row.submission_id, row]));
  for (const { submission_id: id, sha256: digest } of JSON.parse(bytes.toString('utf8'))) {
    const row = known.get(id);
    if (!row || row.sha256 !== digest || row.work_id != null || row.state === 'published' || excluded.has(id)) throw new Error(`A2 排除记录与 SQLite 不符 ${id}`);
    excluded.set(id, digest);
  }
  if (excluded.size !== 36) throw new Error('A2 排除清单数量不符');
  return excluded;
}

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

export async function readBackupAttachment(backup: string, row: Wire) {
  const digest = row.sha256;
  if (!digestPattern.test(digest) || !/^sub_[A-Za-z0-9_-]+$/.test(row.submission_id)) throw new Error('私有投稿标识或摘要无效');
  const original = join(backup, 'recovered-originals', digest);
  if (await exists(original)) {
    const bytes = await readFile(original);
    const format = imageFormat(bytes);
    if (!format || sha256(bytes) !== digest) throw new Error(`恢复原图校验失败 ${row.submission_id}`);
    return { key: `submissions/${row.submission_id}/${digest}.${format.ext}`, bytes, mime: format.mime };
  }
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
