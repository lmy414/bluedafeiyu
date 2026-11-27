#!/usr/bin/env -S tsx --conditions=development
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import type { Database, DbTransaction } from '../apps/api/src/db/client.js';
import type { LegacyWork, Manifest, Media } from './legacy-data.js';
import type { Wire } from '../apps/api/src/routes/hermes/protocol.js';
import { imageFormat, sha256 } from '../apps/api/src/routes/hermes/protocol.js';
import { runCli, requiredEnv } from '../apps/api/src/jobs/runtime.js';
import { digestPattern, exists, legacyPathsByWork, loadLegacy, options, readBrandTokens, readJson, stringIds } from './legacy-data.js';
import { parseArray, parseJson, readSqlite, sqliteWorks } from './legacy-sqlite.js';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const date = (value: unknown) => {
  if (!value) return null;
  const result = new Date(String(value));
  if (!Number.isFinite(result.valueOf())) throw new Error(`日期非法 ${String(value)}`);
  return result;
};
const epoch = new Date(0);
const timestamps = (row: Wire) => ({ createdAt: date(row.created_at ?? row.createdAt) || epoch, updatedAt: date(row.updated_at ?? row.updatedAt) || epoch });
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
};

function uuid(key: string) {
  const hex = createHash('sha256').update(`legacy:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function bareMedia(row: LegacyWork): Media | null {
  if (!['deleted', 'removed'].includes(row.status) || !digestPattern.test(row.sha256)) return null;
  return { sha256: row.sha256, r2OriginalKey: '', r2ThumbKey: '', r2DisplayKey: '', format: row.format || '', mimeType: row.mimeType || '',
    width: Number(row.width) || 0, height: Number(row.height) || 0, thumbWidth: 0, thumbHeight: 0, displayWidth: 0, displayHeight: 0,
    fileSize: Number(row.fileSize) || 0, isAnimated: Boolean(row.isAnimated),
  };
}

type Args = ReturnType<typeof options>;
export async function readImportPlan(args: Args) {
  const [legacy, brands, manifest] = await Promise.all([
    loadLegacy(args.legacy), readBrandTokens(args.legacy),
    exists(args.manifest).then(found => found ? readJson<Manifest>(args.manifest) : null),
  ]);
  if (!args.dryRun && (!manifest?.uploaded || manifest.missing.length)) throw new Error('导入需要上传完成且零缺图的 R2 清单');
  if (manifest && manifest.version !== 1) throw new Error('R2 清单版本不受支持');
  const sqlite = readSqlite(args.sqlite);
  const works = sqliteWorks(sqlite, legacy.works);
  const roleIds = new Set(legacy.roles.map(row => row.id));
  const categoryIds = new Set(legacy.categories.map(row => row.id));
  const workIds = new Set(works.map(row => row.id));
  const hashes = new Map<string, string>();
  const slugs = new Set<string>();
  const withoutMedia: string[] = [];
  for (const row of works) {
    if (slugs.has(row.slug)) throw new Error(`冻结 slug 重复 ${row.slug}`);
    slugs.add(row.slug);
    if (!roleIds.has(row.characterId) || row.characterIds.some((role: string) => !roleIds.has(role)) || row.categoryIds.length !== 1 || !categoryIds.has(row.categoryIds[0])) throw new Error(`角色或类型无效 ${row.id}`);
    const media = manifest?.works[row.id] || bareMedia(row);
    const hash = media?.sha256 || row.sha256;
    if (hash) {
      if (!digestPattern.test(hash) || hashes.has(hash)) throw new Error(`SHA-256 不能唯一对应冻结作品 ${row.id} 与 ${hashes.get(hash) || hash}`);
      hashes.set(hash, row.id);
    }
    if (!media) withoutMedia.push(row.id);
    else if (row.sha256 && media.sha256 !== row.sha256) throw new Error(`迁移摘要与源记录不匹配 ${row.id}`);
    if (media && row.status === 'published' && (!media.r2OriginalKey || !media.r2ThumbKey || !media.r2DisplayKey ||
        [media.width, media.height, media.thumbWidth, media.thumbHeight, media.displayWidth, media.displayHeight].some(value => !Number.isInteger(value) || value < 1))) throw new Error(`公开媒体未完整迁移 ${row.id}`);
  }
  if (withoutMedia.length && !args.dryRun) throw new Error(`缺少 ${withoutMedia.length} 项媒体清单：${withoutMedia.slice(0, 10).join(', ')}`);
  for (const topic of legacy.topics) {
    for (const page of topic.reader?.pages || []) {
      if (!workIds.has(page.workId) || !Number.isInteger(page.number) || page.number < 1) throw new Error(`连载关联无效 ${topic.id}/${page.number}`);
    }
    if (topic.coverWorkId && !workIds.has(topic.coverWorkId)) throw new Error(`专题封面作品不存在 ${topic.id}/${topic.coverWorkId}`);
  }
  const sources = sqlite.submissions.filter(row => row.submission_id && !['published', 'rejected', 'auto_rejected'].includes(row.state));
  const sqliteImages = new Map<string, { key: string; bytes: Buffer; mime: string }>();
  for (const row of sources) {
    if (row.state === 'published') continue;
    const media = sqlite.media.find(record => record.id === row.media_id);
    const candidates = [media?.filename && join(args.legacy, 'admin', 'media', media.filename),
      media?.filename && args.sqlite && join(resolve(args.sqlite, '..'), 'media', media.filename),
      media?.source_path && join(args.content, media.source_path),
    ].filter((value): value is string => typeof value === 'string');
    let file: string | undefined;
    for (const candidate of candidates) {
      const path = resolve(candidate);
      const roots = [resolve(args.legacy, 'admin', 'media'), resolve(args.content), ...(args.sqlite ? [resolve(args.sqlite, '..', 'media')] : [])];
      if (roots.some(root => path.startsWith(root + sep)) && await exists(path)) { file = path; break; }
    }
    if (!file) throw new Error(`未完成投稿缺少私有原图 ${row.submission_id}`);
    const bytes = await readFile(file);
    const format = imageFormat(bytes);
    if (!format || sha256(bytes) !== row.sha256) throw new Error(`旧投稿原图校验失败 ${row.submission_id}`);
    sqliteImages.set(row.submission_id, { key: `submissions/${row.submission_id}/${row.sha256}.${format.ext}`, bytes, mime: format.mime });
  }
  return { legacy, works, sqlite, sqliteImages, manifest, brands, withoutMedia };
}

async function upsert(tx: DbTransaction, table: Parameters<DbTransaction['insert']>[0], rows: Wire[], target: unknown, immutable: string[] = []) {
  if (!rows.length) return;
  const { getTableColumns, sql } = apiRequire('drizzle-orm');
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const fields = Object.keys(columns).filter(key => chunk.every(row => Object.hasOwn(row, key)) && !immutable.includes(key));
    const set = Object.fromEntries(fields.map(key => [key, sql.raw(`excluded."${columns[key]!.name}"`)]));
    // The application schema owns every table and conflict target passed here.
    if (fields.length) await tx.insert(table).values(chunk).onConflictDoUpdate({ target: target as never, set });
    else await tx.insert(table).values(chunk).onConflictDoNothing({ target: target as never });
  }
}

export async function importData(db: Database, plan: Awaited<ReturnType<typeof readImportPlan>>, args: Args) {
  const schema = await import('../apps/api/src/db/schema.js');
  const { legacyVideoId, videoHash } = await import('../apps/api/src/jobs/video-sync.js');
  const { openWorkWithRevision } = await import('../apps/api/src/services/work-data.js');
  const { and, eq, inArray, sql } = apiRequire('drizzle-orm');
  const { legacy, sqlite, manifest, brands, sqliteImages } = plan;
  const legacyPaths = await legacyPathsByWork(args.legacy, plan.works, legacy.works);
  const site = args.site || 'https://xn--pssy23gqgbz2d718b.com';
  const mediaBase = process.env.R2_PUBLIC_BASE_URL || 'https://img.xn--pssy23gqgbz2d718b.com';
  const asset = (id: string) => manifest?.assets[id];
  const assetUrl = (key: string) => `${mediaBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
  if (sqliteImages.size) {
    const { openR2, putObject } = await import('../apps/api/src/jobs/r2.js');
    const r2 = openR2();
    try {
      for (const image of sqliteImages.values()) await putObject(r2, process.env.R2_STAGING_BUCKET || 'dafeiyu-staging', image.key, image.bytes, image.mime);
    } finally { r2.destroy(); }
  }
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('dafeiyu-v2-legacy-import', 0))`);
    const roleRows = legacy.roles.map((row, index) => ({ id: row.id, name: row.name, aliases: stringIds(row.aliases), description: row.description || '', i18n: row.i18n || {},
      portraitKey: asset(`portrait:${row.id}`)?.key ?? null, portraitWidth: asset(`portrait:${row.id}`)?.width ?? null, portraitHeight: asset(`portrait:${row.id}`)?.height ?? null,
      brandTokens: { ...brands[row.id], ...(brands[row.id]?.light?.['--brand-accent'] && { '--character-accent': brands[row.id]!.light['--brand-accent'] }), ...row.brandTokens }, sortOrder: row.order ?? index, status: row.status || 'active',
    }));
    await upsert(tx, schema.characters, roleRows, schema.characters.id, ['id']);
    await upsert(tx, schema.categories, legacy.categories.map((row, index) => ({ id: row.id, name: row.name, description: row.description || '', i18n: row.i18n || {}, sortOrder: row.order ?? index, status: row.status || 'active' })), schema.categories.id, ['id']);
    await upsert(tx, schema.events, legacy.events.map(row => ({ id: row.id, slug: row.id, title: row.title?.[0] || row.title, summary: row.summary?.[0] || row.summary || '',
      i18n: Object.fromEntries(['en', 'ja'].map((lang, index) => [lang, { title: row.title?.[index + 1] || '', summary: row.summary?.[index + 1] || '', statusLabel: row.statusLabel?.[index + 1] || '', coverAlt: row.coverAlt?.[index + 1] || '' }])),
      payload: { ...row, ...(asset(`event:${row.id}`) && { cover: { ...row.cover, src: assetUrl(asset(`event:${row.id}`)!.key) } }) }, status: row.status || 'active', startsAt: date(row.startsAt), endsAt: date(row.endsAt || row.deadline),
    })), schema.events.id, ['id']);
    await upsert(tx, schema.friendLinks, legacy.links.map((row, index) => ({ id: row.id, kind: row.category === 'project' ? 'project' : 'friend', name: row.name, url: row.url, description: row.description || '',
      avatarKey: asset(`link:${row.id}`)?.key ?? null, i18n: row.i18n || {}, sortOrder: row.order ?? index, status: row.status || 'active',
    })), schema.friendLinks.id, ['id']);

    const userIds = new Map<unknown, string>();
    for (const row of sqlite.users) {
      if (!row.email || !['owner', 'bot'].includes(row.role)) continue;
      const email = String(row.email).trim().toLowerCase();
      const [existing] = await tx.select({ id: schema.adminUsers.id, role: schema.adminUsers.role }).from(schema.adminUsers).where(eq(schema.adminUsers.email, email));
      if (existing && existing.role === row.role) userIds.set(row.id, existing.id);
      else if (row.role === 'bot') {
        const id = `legacy-admin-${row.id}`;
        const [created] = await tx.insert(schema.adminUsers).values({ id, email, role: 'bot' }).onConflictDoNothing().returning({ id: schema.adminUsers.id });
        if (created) userIds.set(row.id, created.id);
      }
    }
    const workIds = new Map(sqlite.works.map(row => [row.id, row.work_id]));
    const submissionIds = new Map(sqlite.submissions.map(row => [row.id, row.submission_id]));
    const sourceIds = new Map<unknown, string[]>();
    for (const row of sqlite.submissions_source_ids) sourceIds.set(row._parent_id, [...sourceIds.get(row._parent_id) || [], row.value]);
    const submissionRows = sqlite.submissions.filter(row => row.submission_id).map(row => ({ id: row.submission_id,
      source: row.source, sourceIds: stringIds(sourceIds.get(row.id)), sha256: row.sha256, r2StagingKey: sqliteImages.get(row.submission_id)?.key || '',
      fields: parseJson(row.fields), editorial: parseJson(row.editorial), review: parseJson(row.review), origin: parseJson(row.origin), state: row.state,
      stateHistory: parseArray(row.state_history), agentProgress: { ...parseJson(row.agent_progress), token: null, expiresAt: 0 }, ...timestamps(row),
    }));
    await upsert(tx, schema.submissions, submissionRows, schema.submissions.id, ['id']);

    const publicWorks = new Set(plan.works.filter(row => row.status === 'published').map(row => row.id));
    const works = await Promise.all(plan.works.map(async row => {
      const media = manifest?.works[row.id] || bareMedia(row)!;
      const { sha256, r2OriginalKey, r2ThumbKey, r2DisplayKey, width, height, thumbWidth, thumbHeight, displayWidth, displayHeight, format, mimeType, fileSize, isAnimated } = media;
      const included = sqlite.works.find(item => item.work_id === row.id);
      const linked = submissionIds.get(included?.submission_id) || sqlite.submissions.find(item => item.work_id === included?.id)?.submission_id;
      const origin = { ...row.origin, ...(row.sourceIssue && { sourceIssue: row.sourceIssue }),
        ...(row.kind === 'blue-fish' && row.historicalOriginal && { legacy: { sourcePath: row.historicalOriginal, editorial: row.historicalEditorial } }),
        legacyPaths: legacyPaths.get(row.id)!,
      };
      const value: typeof schema.works.$inferSelect = { id: row.id, slug: row.slug, kind: row.kind, channel: row.channel || null, submissionId: linked || null,
        name: row.name ?? '', description: row.description ?? '', commentary: row.commentary ?? '', primaryCharacterId: row.characterId, categoryId: row.categoryIds[0],
        tags: stringIds(row.tags), submitter: row.submitter || {}, origin, license: row.license || {}, i18n: row.i18n || {}, status: row.status,
        sha256, r2OriginalKey, r2ThumbKey, r2DisplayKey, width, height, thumbWidth, thumbHeight, displayWidth, displayHeight, format, mimeType, fileSize, isAnimated,
        revision: '', viewCount: 0, downloadCount: 0, publishedAt: row.status === 'published' ? date(row.publishedAt || row.createdAt) : date(row.publishedAt), ...timestamps(row),
      };
      const groups = legacy.topics.filter(topic => topic.status === 'active' && (topic.workIds?.includes(row.id) || topic.coverWorkId === row.id));
      const creatorIds = groups.filter(topic => topic.author).map(topic => {
        const uid = (topic.author.channels || []).map((channel: Wire) => String(channel.url || '').match(/^https?:\/\/space\.bilibili\.com\/(\d+)(?:[/?#]|$)/)?.[1]).find(Boolean);
        return uid ? `bilibili-${uid}` : topic.id;
      });
      value.revision = r2OriginalKey ? (await openWorkWithRevision(value, row.characterIds, site, mediaBase, groups.map(topic => topic.id), creatorIds)).revision
        : createHash('sha256').update(JSON.stringify(stable({ id: row.id, slug: row.slug, sha256, status: row.status }))).digest('hex');
      return value;
    }));
    await upsert(tx, schema.works, works, schema.works.id, ['id', 'slug', 'sha256', 'viewCount', 'downloadCount']);
    const idList = works.map(row => row.id);
    if (idList.length) await tx.delete(schema.workCharacters).where(inArray(schema.workCharacters.workId, idList));
    await upsert(tx, schema.workCharacters, plan.works.flatMap(row => row.characterIds.map((id: string) => ({ workId: row.id, characterId: id }))), [schema.workCharacters.workId, schema.workCharacters.characterId], ['workId', 'characterId']);
    for (const entry of sqlite.submissions) {
      const id = workIds.get(entry.work_id);
      if (id && idList.includes(id)) await tx.update(schema.submissions).set({ workId: id }).where(eq(schema.submissions.id, entry.submission_id));
    }

    await upsert(tx, schema.topics, legacy.topics.map(row => ({ id: row.id, name: row.name, summary: row.summary || '', coverWorkId: row.coverWorkId || null,
      isSerial: legacy.serialIds.has(row.id), readerConfig: row.reader || {}, author: row.author ? { ...row.author, ...(asset(`topic:${row.id}`) && { avatarKey: asset(`topic:${row.id}`)!.key }) } : null,
      i18n: row.i18n || {}, status: row.status || 'draft', sortOrder: row.order || 0, ...timestamps(row),
    })), schema.topics.id, ['id']);
    const members = legacy.topics.flatMap(row => {
      const pages = new Map<string, number>((row.reader?.pages || []).map((page: Wire) => [page.workId, page.number]));
      return stringIds([...(row.workIds || []), ...pages.keys()]).filter(id => idList.includes(id)).map((workId, position) => ({ topicId: row.id, workId, position, pageNumber: pages.get(workId) ?? null }));
    });
    if (legacy.topics.length) await tx.delete(schema.topicWorks).where(inArray(schema.topicWorks.topicId, legacy.topics.map(row => row.id)));
    await upsert(tx, schema.topicWorks, members, [schema.topicWorks.topicId, schema.topicWorks.workId], ['topicId', 'workId']);

    const authorIds = new Map(sqlite.creators.map(row => [row.id, `bilibili-${row.uid}`]));
    const authors = new Map<string, Wire>();
    for (const row of sqlite.creators) authors.set(String(row.uid), { id: `bilibili-${row.uid}`, uid: String(row.uid), homepage: row.homepage || `https://space.bilibili.com/${row.uid}`,
      name: row.name || '', avatarKey: asset(`creator:${row.uid}`)?.key ?? null, intro: row.intro || '', status: row.status || 'queued', syncPage: row.sync_page || 1,
      syncLease: null, lastSyncedAt: date(row.last_synced_at), retryAt: date(row.retry_at), error: row.error || null, ...timestamps(row),
    });
    for (const row of legacy.creators) {
      const prev = authors.get(String(row.uid));
      authors.set(String(row.uid), { id: `bilibili-${row.uid}`, uid: String(row.uid), homepage: row.homepage, name: row.name, avatarKey: asset(`creator:${row.uid}`)?.key ?? null,
        intro: row.intro || '', status: 'active', syncPage: 1, syncLease: null, lastSyncedAt: null, retryAt: null, error: null, ...timestamps(row), ...prev,
      });
    }
    await upsert(tx, schema.creators, [...authors.values()], schema.creators.id, ['id', 'uid']);
    const videoRows = new Map<string, Wire>();
    for (const row of sqlite.videos) videoRows.set(row.bvid, { id: String(row.id), bvid: row.bvid, creatorId: authorIds.get(row.creator_id), title: row.title,
      source: parseJson(row.source), status: row.status, review: parseJson(row.review), lease: null, publishedAt: null, ...timestamps(row),
    });
    for (const row of legacy.videos) {
      const prev = videoRows.get(row.bvid);
      const { characterIds, i18n, ...fields } = row;
      const oldAuthor = legacy.creators.find(author => author.uid === row.uid);
      const source = { ...prev?.source, ...fields, creatorName: authors.get(String(row.uid))?.name || '', creatorIntro: authors.get(String(row.uid))?.intro || '',
        ...(oldAuthor?.i18n && { creatorI18n: oldAuthor.i18n }),
      };
      const review = { ...prev?.review, characterIds, i18n, reviewer: 'hermes', verdict: 'pass', isAiCharacter: true, isFanwork: true, confidence: prev?.review?.confidence ?? 1, sourceHash: videoHash(source) };
      const publishedAt = date(row.publishedAt);
      videoRows.set(row.bvid, { id: prev?.id || legacyVideoId(row.bvid), bvid: row.bvid, creatorId: `bilibili-${row.uid}`, title: row.title, source, review, status: 'approved', lease: null,
        publishedAt, createdAt: prev?.createdAt || publishedAt || epoch, updatedAt: prev?.updatedAt || publishedAt || epoch,
      });
    }
    await upsert(tx, schema.videos, [...videoRows.values()], schema.videos.bvid, ['id', 'bvid']);

    await upsert(tx, schema.takedownRequests, sqlite.takedown_requests.map(row => {
      const workId = workIds.get(row.work_id) || null;
      const work = works.find(entry => entry.id === workId);
      const progress = parseJson(row.agent_progress);
      const withLegacyPaths = (origin: Wire) => ({ ...origin, legacyPaths: work?.origin.legacyPaths });
      if (row.status === 'approved' && progress.stage === 'awaiting_publish' && progress.draft && work) {
        const removal = progress.decision?.requestType === 'takedown';
        const agrees = work.status === (removal ? 'removed' : 'published') &&
          JSON.stringify(stable(work.origin)) === JSON.stringify(stable(withLegacyPaths(progress.draft.origin))) &&
          JSON.stringify(stable(work.license)) === JSON.stringify(stable(progress.draft.license || {}));
        if (agrees) {
          progress.stage = 'reply_queued';
          progress.expected = { workId, slug: work.slug, status: work.status, origin: work.origin, license: work.license, sourceHash: (work.i18n as Wire).sourceHash, kind: work.kind };
        }
      } else if (row.status === 'approved' && progress.stage === 'reply_queued' && progress.expected?.origin && work) {
        progress.expected.origin = withLegacyPaths(progress.expected.origin);
      }
      return { id: row.request_id, requestType: row.request_type, workId,
        requester: { name: row.requester_name, contact: row.requester_contact, proof: row.requester_proof }, status: row.status,
        decisionNote: row.decision_note, issueData: parseJson(row.issue_data), agentProgress: { ...progress, token: null, expiresAt: 0 }, processedAt: date(row.processed_at), ...timestamps(row),
      };
    }), schema.takedownRequests.id, ['id']);
    await upsert(tx, schema.bulkJobs, sqlite.bulk_jobs.map(row => {
      const options = parseJson(row.options);
      const ids = parseArray(row.ids).map(String);
      const requestedBy = userIds.get(row.requested_by_id);
      if (!requestedBy && ['queued', 'running'].includes(row.status)) throw new Error(`请初始化与旧任务提交者邮箱一致的站长账号后再导入批任务 ${row.job_id}`);
      const versions = Object.fromEntries(ids.map(id => {
        const work = works.find(row => row.id === id);
        const topic = legacy.topics.find(row => row.id === id);
        const sub = submissionRows.find(row => row.id === id);
        return [id, work?.revision || (topic && createHash('sha256').update(JSON.stringify({ name: topic.name.trim(), summary: topic.summary.trim() })).digest('hex')) || sub?.updatedAt.toISOString()];
      }));
      return { id: row.job_id, kind: row.operation, payload: { operation: row.operation, target: row.target, ids, requestedBy, options: { ...options, versions } },
        status: row.status, progress: { cursor: row.cursor, agent: { ...options.agent, token: null, expiresAt: 0, version: undefined } }, result: { results: parseArray(row.results) }, ...timestamps(row),
      };
    }), schema.bulkJobs.id, ['id']);
    await upsert(tx, schema.auditEvents, sqlite.audit_events.map(row => ({ id: uuid(`audit:${row.id}`), actorType: ['owner', 'hermes', 'system'].includes(row.actor_type) ? row.actor_type : 'system',
      actorId: row.actor_id ?? null, action: row.action, entityType: row.target_type || 'legacy', entityId: row.target_id || String(row.id), createdAt: date(row.created_at) || epoch,
      diff: { before: parseJson(row.before), after: parseJson(row.after), actorName: row.actor_name, requestId: row.request_id },
    })), schema.auditEvents.id, ['id']);
    await upsert(tx, schema.notifyOutbox, sqlite.notify_outbox.map(row => ({ id: uuid(`notify:${row.id}`), eventType: row.event_type, payload: parseJson(row.payload), status: row.status,
      messageId: row.message_id ?? null, attempts: row.attempts || 0, nextRetryAt: date(row.next_retry_at), createdAt: date(row.created_at) || epoch,
    })), schema.notifyOutbox.id, ['id']);

    const stored = idList.length ? await tx.select({ id: schema.works.id, slug: schema.works.slug, sha256: schema.works.sha256, status: schema.works.status }).from(schema.works).where(inArray(schema.works.id, idList)) : [];
    const expected = new Map(works.map(row => [row.id, row]));
    if (stored.length !== works.length || stored.some(row => row.slug !== expected.get(row.id)?.slug || row.sha256 !== expected.get(row.id)?.sha256 || row.status !== expected.get(row.id)?.status)) throw new Error('数据库作品、冻结标识或状态与迁移计划不一致');
    const bvids = legacy.videos.map(row => row.bvid);
    const approved = bvids.length ? await tx.select({ bvid: schema.videos.bvid }).from(schema.videos).where(and(eq(schema.videos.status, 'approved'), inArray(schema.videos.bvid, bvids))) : [];
    if (approved.length !== bvids.length) throw new Error('数据库已发布视频数不一致');
    const serialIds = [...legacy.serialIds];
    const pages = serialIds.length ? await tx.select().from(schema.topicWorks).where(inArray(schema.topicWorks.topicId, serialIds)) : [];
    const pageMap = new Map(pages.map(row => [`${row.topicId}:${row.workId}`, row.pageNumber]));
    if (members.some(row => legacy.serialIds.has(row.topicId) && pageMap.get(`${row.topicId}:${row.workId}`) !== row.pageNumber)) throw new Error('数据库连载页码映射不一致');
    return { works: works.length, published: publicWorks.size, videos: approved.length, creators: authors.size, topics: legacy.topics.length, serials: serialIds.length, submissions: submissionRows.length, editorial: legacy.editorialCount };
  });
}

runCli(import.meta.url, async () => {
  const args = options();
  if (args.help) { console.log('import-data.ts [--legacy PATH] [--content PATH] [--manifest PATH] [--sqlite PATH] [--dry-run]'); return; }
  const plan = await readImportPlan(args);
  if (args.dryRun) {
    const legacyPaths = await legacyPathsByWork(args.legacy, plan.works, plan.legacy.works);
    const mapped = [...legacyPaths.values()];
    return { dryRun: true, works: plan.works.length, published: plan.works.filter(row => row.status === 'published').length,
      legacyPaths: { works: mapped.filter(paths => paths.thumb.length || paths.display.length || paths.original.length).length,
        thumb: mapped.filter(paths => paths.thumb.length).length, display: mapped.filter(paths => paths.display.length).length,
        original: mapped.filter(paths => paths.original.length).length },
      videos: plan.legacy.videos.length, characters: plan.legacy.roles.length, topics: plan.legacy.topics.length, serials: plan.legacy.serialIds.size,
      editorial: plan.legacy.editorialCount, mediaManifestMissing: plan.withoutMedia.length,
      sqliteTables: Object.fromEntries(Object.entries(plan.sqlite).map(([key, rows]) => [key, rows.length])),
    };
  }
  const { createDb } = await import('../apps/api/src/db/client.js');
  const connection = createDb(requiredEnv('DATABASE_URL'));
  try { return await importData(connection.db, plan, args); }
  finally { await connection.close(); }
});
