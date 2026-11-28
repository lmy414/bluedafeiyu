import { DatabaseSync } from 'node:sqlite';
import type { Wire } from '../apps/api/src/routes/hermes/protocol.js';
import type { LegacyWork } from './legacy-data.js';

export function parseJson(value: unknown, fallback: Wire = {}): Wire {
  if (typeof value !== 'string' || !value) return fallback;
  const result: unknown = JSON.parse(value);
  return result && typeof result === 'object' && !Array.isArray(result) ? result as Wire : fallback;
}

export function parseArray(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  const result: unknown = JSON.parse(value);
  return Array.isArray(result) ? result : [];
}

export function readSqlite(path?: string) {
  const tables = ['works', 'works_rels', 'works_tags', 'characters', 'categories', 'media', 'submissions', 'submissions_source_ids', 'creators', 'videos', 'takedown_requests', 'bulk_jobs', 'audit_events', 'users', 'notify_outbox'] as const;
  const output = Object.fromEntries(tables.map(name => [name, [] as Wire[]])) as Record<typeof tables[number], Wire[]>;
  if (!path) return output;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const found = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map(row => row.name));
    for (const name of tables) if (found.has(name)) output[name] = db.prepare(`select ${name === 'users' ? 'id, email, role' : '*'} from ${name}`).all();
    return output;
  } finally { db.close(); }
}

export function sqliteWorks(sqlite: ReturnType<typeof readSqlite>, base: LegacyWork[]) {
  const status = new Set(['published', 'pending', 'hidden', 'removed', 'deleted']);
  const result = new Map(base.map(row => [row.id, row]));
  for (const row of sqlite.works) {
    const prev = result.get(row.work_id);
    if (prev && (row.status === prev.status || !['hidden', 'removed', 'deleted'].includes(row.status) || Date.parse(row.updated_at) < Date.parse(prev.updatedAt))) continue;
    if (!row.work_id || !row.slug || !status.has(row.status)) throw new Error(`旧 SQLite 作品 ID、slug 或状态缺失 ${row.id}`);
    const relations = sqlite.works_rels.filter(item => item.parent_id === row.id).sort((a, b) => Number(a.order) - Number(b.order));
    const role = (id: unknown) => sqlite.characters.find(item => item.id === id)?.character_id;
    const category = (id: unknown) => sqlite.categories.find(item => item.id === id)?.category_id;
    const data = parseJson(row.legacy_data);
    const media = sqlite.media.find(item => item.id === row.preview_id);
    result.set(row.work_id, {
      ...prev, id: row.work_id, slug: prev?.slug ?? row.slug, kind: ['owner-picks', 'blue-fish'].includes(row.kind) ? row.kind : 'submission',
      channel: row.channel, status: row.status, name: row.name, description: row.description || '', commentary: row.commentary || '',
      sha256: row.sha256 || prev?.sha256, path: row.legacy_paths_external_original_url || row.legacy_paths_path || media?.external_url || media?.source_path || prev?.path,
      thumbnailPath: row.legacy_paths_thumbnail_path || prev?.thumbnailPath, fullPath: row.legacy_paths_full_path || prev?.fullPath,
      localMediaFile: media?.filename, width: row.width, height: row.height, format: row.format, mimeType: row.mime_type, fileSize: row.file_size,
      isAnimated: Boolean(row.is_animated), characterId: role(row.character_id) || prev?.characterId,
      characterIds: [...new Set([role(row.character_id), ...relations.map(item => role(item.characters_id))].filter(Boolean))],
      categoryIds: [...new Set(relations.map(item => category(item.categories_id)).filter(Boolean))],
      tags: sqlite.works_tags.filter(item => item._parent_id === row.id).sort((a, b) => a._order - b._order).map(item => item.value),
      submitter: { name: row.submitter_name || '', github: row.submitter_github || '', credit: row.submitter_credit ?? null, url: row.submitter_url ?? null },
      origin: parseJson(row.origin, prev?.origin), license: parseJson(row.license, prev?.license), i18n: data.i18n || prev?.i18n || {},
      createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at || row.last_published_at, sourceIssue: data.sourceIssue || prev?.sourceIssue,
    });
    const work = result.get(row.work_id)!;
    if (!work.characterIds.length && prev) work.characterIds = prev.characterIds;
    if (!work.categoryIds.length && prev) work.categoryIds = prev.categoryIds;
    if (!work.characterIds.length || work.categoryIds.length !== 1) throw new Error(`旧 SQLite 作品的角色或类型无效 ${work.id}`);
  }
  return [...result.values()];
}
