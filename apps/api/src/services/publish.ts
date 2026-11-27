import { buildR2Keys, categoryIdSchema, computeWorkRevision, validateTrilingualCompleteness } from '@dafeiyu/shared';
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Database, DbTransaction } from '../db/client.js';
import { categories, characters, submissions, topicWorks, topics, workCharacters, works } from '../db/schema.js';
import type { JsonObject, SubmissionRow, WorkRow } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { writeAudit } from './audit.js';
import type { AuditEntry } from './audit.js';
import type { createCloudflare } from './cloudflare.js';
import type { createFeishu } from './feishu.js';
import { MAX_IMAGE_BYTES, prepareImage } from './image.js';
import { immutableMedia } from './r2.js';
import type { R2Service } from './r2.js';
import { object, openWorkWithRevision, safeUrl, slugCandidate, text, uniqueStrings } from './work-data.js';

export type Actor = Pick<AuditEntry, 'actorType' | 'actorId'>;
export type PublishDeps = { db: Database; config: Config; r2: R2Service; cloudflare: ReturnType<typeof createCloudflare>; feishu: ReturnType<typeof createFeishu> };
export type DirectWorkInput = { bytes: Buffer; fields: JsonObject; origin?: JsonObject; kind?: WorkRow['kind']; channel?: string };
const systemActor: Actor = { actorType: 'system' };
const background = (task: Promise<unknown>) => { void task.catch(error => console.error('Post-publication operation failed', error)); };
const isNotFound = (error: unknown) => error instanceof ApiError ? error.status === 404 :
  typeof error === 'object' && error !== null && '$metadata' in error && (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404;

export async function lockHash(tx: DbTransaction, sha256: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`submission:${sha256}`}, 0))`);
}

export function submissionChange(item: SubmissionRow, state: SubmissionRow['state'], actor: string, now = new Date(), reason = '') {
  return { state, updatedAt: now, stateHistory: [...item.stateHistory, { event: state, from: item.state, to: state, actor, at: now.toISOString(), reason }] };
}

export async function resolveTaxonomy(db: Database | DbTransaction, primary: string, ids: string[], category: string, active = true) {
  if (!primary || !ids.includes(primary) || ids.some(id => id.length > 64) || ids.length > 24 || !categoryIdSchema.safeParse(category).success) {
    throw new ApiError(422, 'invalid_taxonomy', '请选择有效主角色与单一分类', [{ path: ['primaryCharacterId', 'categoryId'], message: '角色或分类无效' }]);
  }
  const roles = await db.select({ id: characters.id }).from(characters).where(and(inArray(characters.id, ids), active ? eq(characters.status, 'active') : undefined));
  const [type] = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, category), active ? eq(categories.status, 'active') : undefined));
  if (!type || roles.length !== ids.length) throw new ApiError(422, 'invalid_taxonomy', '角色或分类无效', [{ path: [!type ? 'categoryId' : 'characterIds'], message: '选择不存在或已停用' }]);
}

function checkedFields(raw: JsonObject, origin: JsonObject = {}) {
  const { en, ja, sourceHash } = object(raw.i18n);
  const parsed = validateTrilingualCompleteness({ ...raw, commentary: raw.commentary ?? '', i18n: { en, ja } });
  if (!parsed.success) throw new ApiError(422, 'invalid_translations', '作品三语内容不完整', parsed.error.issues);
  const primary = text(raw.primaryCharacterId || raw.characterId || raw.character) || uniqueStrings(raw.characterIds)[0] || '';
  const characterIds = uniqueStrings(raw.characterIds ?? [primary]);
  const submittedType = uniqueStrings(raw.categoryIds);
  if ((Array.isArray(raw.categoryIds) && raw.categoryIds.length !== 1) || (submittedType[0] && raw.categoryId && submittedType[0] !== raw.categoryId)) {
    throw new ApiError(422, 'invalid_category', '分类必须单选', [{ path: ['categoryIds'], message: '请选择一个分类' }]);
  }
  const inputSubmitter = object(raw.submitter);
  const credit = text(inputSubmitter.credit || raw.credit);
  if (credit && !['named', 'anonymous'].includes(credit)) throw new ApiError(422, 'invalid_credit', '署名方式无效');
  const rawCreditUrl = inputSubmitter.url ?? raw.creditUrl;
  const creditUrl = safeUrl(rawCreditUrl);
  if (credit === 'named' && rawCreditUrl && !creditUrl) throw new ApiError(422, 'invalid_credit', '署名主页链接无效', [{ path: ['submitter', 'url'], message: '请输入 HTTP 或 HTTPS 链接' }]);
  const submitter = credit === 'anonymous' ? { credit } : {
    ...inputSubmitter, ...(credit && { credit, name: text(inputSubmitter.name || raw.creditName).trim(), url: creditUrl ?? '' }),
  };
  if (credit === 'named' && (!text(submitter.name) || text(submitter.name).length > 120)) throw new ApiError(422, 'invalid_credit', '署名名称无效');
  const tags = uniqueStrings(raw.tags);
  if (tags.length > 20 || tags.some(tag => tag.length > 40)) throw new ApiError(422, 'invalid_tags', '作品标签超过长度或数量上限');
  return { ...parsed.data, i18n: { ...parsed.data.i18n, ...(typeof sourceHash === 'string' && /^[a-f0-9]{64}$/.test(sourceHash) && { sourceHash }) },
    commentary: parsed.data.commentary ?? '', characterIds, primaryCharacterId: primary,
    categoryId: text(raw.categoryId) || submittedType[0] || '', tags, submitter, origin: { ...origin, ...object(raw.origin) }, license: object(raw.license) };
}

export async function workRelations(db: Database | DbTransaction, work: WorkRow) {
  const roles = await db.select({ id: workCharacters.characterId }).from(workCharacters).where(eq(workCharacters.workId, work.id)).orderBy(asc(workCharacters.characterId));
  const groups = await db.select({ id: topics.id, author: topics.author, serial: topics.isSerial, member: topicWorks.workId }).from(topics).leftJoin(topicWorks, and(eq(topics.id, topicWorks.topicId), eq(topicWorks.workId, work.id)))
    .where(and(eq(topics.status, 'active'), or(eq(topicWorks.workId, work.id), eq(topics.coverWorkId, work.id)))).orderBy(asc(topics.sortOrder), asc(topics.id));
  const included = groups.filter(group => group.serial || group.member);
  const creatorIds = uniqueStrings(included.filter(group => group.author).map(group => topicCreatorId(group.id, group.author))).sort();
  return { roles: uniqueStrings([work.primaryCharacterId, ...roles.map(role => role.id)]), topicIds: included.map(group => group.id), creatorIds };
}

export function topicCreatorId(id: string, author: JsonObject | null) {
  const channels = author?.channels;
  const uid = Array.isArray(channels) ? channels.map(channel => safeUrl(object(channel).url)?.match(/^https?:\/\/space\.bilibili\.com\/(\d+)(?:[/?#]|$)/)?.[1]).find(Boolean) : undefined;
  return uid ? `bilibili-${uid}` : id;
}

export async function refreshWorkRevision(db: Database | DbTransaction, config: Config, work: WorkRow) {
  const { roles, topicIds, creatorIds } = await workRelations(db, work);
  const revision = work.r2OriginalKey ? (await openWorkWithRevision(work, roles, config.SITE_PUBLIC_URL, config.R2_PUBLIC_BASE_URL, topicIds, creatorIds)).revision :
    await computeWorkRevision({ id: work.id, slug: work.slug, status: work.status, sha256: work.sha256 });
  await db.update(works).set({ revision }).where(eq(works.id, work.id));
  return { ...work, revision };
}

export async function purgeWorkCaches({ db, cloudflare, r2 }: PublishDeps, work: WorkRow, previous?: WorkRow, previousCharacters: string[] = [], media = false): Promise<void> {
  const relation = await workRelations(db, work);
  const paths = ['/', '/index.html', '/gallery', '/gallery.html', '/search', '/search.html', '/topics', '/topics.html', '/serials', '/serials.html',
    '/characters', '/characters.html', '/category', '/category.html', '/gifs', '/gifs.html',
    `/works/${work.slug}.html`, `/works/${work.slug}`, ...uniqueStrings([work.categoryId, previous?.categoryId]).map(id => `/categories/${id}.html`),
    ...uniqueStrings([...relation.roles, ...previousCharacters, previous?.primaryCharacterId]).flatMap(id => [`/characters/${id}`, `/characters/${id}.html`]),
    ...relation.topicIds.flatMap(id => [`/topics/${id}`, `/topics/${id}.html`]), ...relation.creatorIds.flatMap(id => [`/creators/${id}`, `/creators/${id}.html`])];
  const variants = ['', '/zh-hant', '/en', '/ja'].flatMap(prefix => paths.map(path => prefix + path));
  const mediaUrls = media ? mediaKeys(work).map(key => r2.publicUrl(key)) : [];
  const readerPaths = ['', '/zh-hant', '/en', '/ja'].flatMap(prefix => relation.topicIds.map(id => `${prefix}/topics/${id}/page/`));
  await Promise.all([cloudflare.purgePaths([...variants, ...mediaUrls, '/sitemap.xml', '/llms.txt', '/llms-full.txt']), cloudflare.purgePrefixes(['/open-api/v1/', ...readerPaths])]);
}

function mediaKeys(work: WorkRow) {
  return uniqueStrings([work.r2OriginalKey, work.r2ThumbKey, work.r2DisplayKey, `og/works/${work.id}.png`]);
}

async function publish(deps: PublishDeps, input: DirectWorkInput | { submissionId: string; editorial?: JsonObject }, actor: Actor): Promise<WorkRow> {
  const { db, config, r2, feishu } = deps;
  const directImage = 'bytes' in input ? await prepareImage(input.bytes) : undefined;
  let uploaded: { sha256: string; keys: string[] } | undefined;
  const run = () => db.transaction(async tx => {
    let item: SubmissionRow | undefined;
    if ('submissionId' in input) {
      const [candidate] = await tx.select({ sha256: submissions.sha256 }).from(submissions).where(eq(submissions.id, input.submissionId));
      if (!candidate) throw new ApiError(404, 'submission_not_found', '投稿不存在');
      await lockHash(tx, candidate.sha256);
      [item] = await tx.select().from(submissions).where(eq(submissions.id, input.submissionId)).for('update');
      if (!item) throw new ApiError(404, 'submission_not_found', '投稿不存在');
      if (item.state === 'published' && item.workId) {
        const [work] = await tx.select().from(works).where(eq(works.id, item.workId));
        if (work) return { work, stagingKey: item.r2StagingKey };
      }
      if (!['auto_passed', 'approved'].includes(item.state) && !(actor.actorType === 'owner' && input.editorial)) throw new ApiError(409, 'submission_not_approved', '投稿尚未通过审核');
    }
    const priorityFields = (data: JsonObject) => ({ ...data,
      ...(('primaryCharacterId' in data || 'characterId' in data || 'character' in data || 'characterIds' in data) && {
        primaryCharacterId: data.primaryCharacterId ?? data.characterId ?? data.character ?? uniqueStrings(data.characterIds)[0],
      }), ...(('categoryId' in data || 'categoryIds' in data) && { categoryId: data.categoryId ?? uniqueStrings(data.categoryIds)[0], categoryIds: data.categoryIds }) });
    const editorial = 'editorial' in input ? input.editorial : undefined;
    const fields = checkedFields(item ? { ...priorityFields(item.fields), ...priorityFields(object(item.review.content)), ...priorityFields(item.editorial), ...priorityFields(editorial ?? {}) } :
      'fields' in input ? input.fields : {}, item?.origin ?? ('origin' in input ? input.origin : undefined));
    await resolveTaxonomy(tx, fields.primaryCharacterId, fields.characterIds, fields.categoryId);
    const bytes = item ? await r2.getObjectBuffer(config.R2_STAGING_BUCKET, item.r2StagingKey, MAX_IMAGE_BYTES).catch((error: unknown) => {
      if (isNotFound(error)) throw new ApiError(410, 'staging_image_unavailable', '暂存原图已过期或不存在');
      throw error;
    }) : 'bytes' in input ? input.bytes : Buffer.alloc(0);
    if (item && item.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new ApiError(422, 'sha256_mismatch', '暂存原图摘要不符');
    const image = directImage ?? await prepareImage(bytes);
    if (!item) await lockHash(tx, image.sha256);
    const id = `sticker_${image.sha256.slice(0, 24)}`;
    const [existing] = await tx.select({ id: works.id }).from(works).where(or(eq(works.sha256, image.sha256), eq(works.id, id))).limit(1);
    if (existing) throw new ApiError(409, 'duplicate_work', '此图片或作品标识已存在');
    if (!item) {
      const [queued] = await tx.select({ id: submissions.id }).from(submissions).where(eq(submissions.sha256, image.sha256)).limit(1);
      if (queued) throw new ApiError(409, 'duplicate_submission', '此图片已有投稿记录');
    }
    const keys = buildR2Keys(image.sha256, image.extension);
    const now = new Date();
    const { characterIds, ...metadata } = fields;
    const values = { ...metadata, id, submissionId: item?.id, kind: 'kind' in input ? input.kind : 'submission' as const,
      channel: item?.source ?? ('channel' in input ? input.channel : 'manual'), sha256: image.sha256, r2OriginalKey: keys.originalKey, r2ThumbKey: keys.thumbKey, r2DisplayKey: keys.displayKey,
      width: image.width, height: image.height, thumbWidth: image.thumbWidth, thumbHeight: image.thumbHeight, displayWidth: image.displayWidth, displayHeight: image.displayHeight,
      fileSize: image.fileSize, format: image.format, mimeType: image.mimeType, isAnimated: image.isAnimated, status: 'published' as const,
      revision: '', publishedAt: now, createdAt: now, updatedAt: now };
    let work: WorkRow | undefined;
    for (let suffix = 0; !work; suffix++) {
      [work] = await tx.insert(works).values({ ...values, slug: slugCandidate(fields.name, id, suffix) }).onConflictDoNothing({ target: works.slug }).returning();
    }
    await tx.insert(workCharacters).values(characterIds.map(characterId => ({ workId: id, characterId })));
    work = await refreshWorkRevision(tx, config, work);
    if (item) await tx.update(submissions).set({ ...submissionChange(item, 'published', actor.actorType, now), workId: id,
      ...(editorial && { editorial: { ...item.editorial, ...editorial }, agentProgress: { ...item.agentProgress, token: null, expiresAt: 0 } }) }).where(eq(submissions.id, item.id));
    await writeAudit(tx, { ...actor, entityType: 'work', entityId: id, action: 'publish', diff: { submissionId: item?.id } });
    const notificationId = await feishu.enqueue({ eventType: 'work.published', dedupeKey: id,
      text: `作品已上线：${work.name}\n${config.SITE_PUBLIC_URL}/works/${work.slug}.html\n原图：${r2.publicUrl(keys.originalKey)}\n管理：${config.SITE_PUBLIC_URL}/admin/works?workId=${id}&action=hide` }, tx);
    uploaded = { sha256: image.sha256, keys: [keys.originalKey, keys.thumbKey, keys.displayKey] };
    const uploads = await Promise.allSettled([
      r2.putObject(config.R2_MEDIA_BUCKET, keys.originalKey, bytes, image.mimeType, immutableMedia),
      r2.putObject(config.R2_MEDIA_BUCKET, keys.thumbKey, image.thumbnail, 'image/webp', immutableMedia),
      r2.putObject(config.R2_MEDIA_BUCKET, keys.displayKey, image.display, 'image/webp', immutableMedia),
    ]);
    const failure = uploads.find(upload => upload.status === 'rejected');
    if (failure) throw failure.reason;
    return { work, notificationId, stagingKey: item?.r2StagingKey };
  });
  const outcome = await run().catch(async (error: unknown) => {
    const attempt = uploaded;
    if (attempt) await db.transaction(async tx => {
      // Every publisher shares this lock. Check the database before compensating for an uncertain commit.
      await lockHash(tx, attempt.sha256);
      const [committed] = await tx.select({ id: works.id }).from(works).where(eq(works.sha256, attempt.sha256));
      if (!committed) await Promise.all(attempt.keys.map(key => r2.deleteObject(config.R2_MEDIA_BUCKET, key)));
    }).catch(cleanupError => console.error('Publication rollback cleanup failed', cleanupError));
    throw error;
  });
  if (outcome.stagingKey) await deps.r2.deleteObject(config.R2_STAGING_BUCKET, outcome.stagingKey).catch(error => console.error('Staging cleanup failed', error));
  if (outcome.notificationId) {
    background(purgeWorkCaches(deps, outcome.work));
    background(feishu.sendPending(outcome.notificationId));
  }
  return outcome.work;
}

export const autoPublishSubmission = (deps: PublishDeps, submissionId: string, actor: Actor = { actorType: 'hermes' }, editorial?: JsonObject) => publish(deps, { submissionId, editorial }, actor);
export const publishWorkDirect = (deps: PublishDeps, input: DirectWorkInput, actor = systemActor) => publish(deps, input, actor);

async function changeVisibility(deps: PublishDeps, id: string, status: WorkRow['status'], actor: Actor): Promise<WorkRow> {
  const { db, config, r2 } = deps;
  const result = await db.transaction(async tx => {
    const [previous] = await tx.select().from(works).where(eq(works.id, id)).for('update');
    if (!previous) throw new ApiError(404, 'work_not_found', '作品不存在');
    if (previous.status === status) return { work: previous, previous };
    const transitions: Partial<Record<WorkRow['status'], WorkRow['status'][]>> = {
      pending: ['deleted'], published: ['hidden', 'removed', 'deleted'], hidden: ['published', 'removed', 'deleted'], removed: ['published', 'deleted'],
    };
    if (!transitions[previous.status]?.includes(status)) throw new ApiError(409, 'invalid_visibility_transition', '作品当前状态不支持此操作');
    if (status === 'published' && previous.status === 'removed') {
      if (!previous.r2OriginalKey) throw new ApiError(409, 'removed_media_unavailable', '隔离存储缺少可恢复的原图');
      for (const key of mediaKeys(previous)) {
        const isolated = `quarantine/${key}`;
        if (key.startsWith('og/') && !await r2.headObject(config.R2_BACKUPS_BUCKET, isolated)) continue;
        await r2.copyObject(config.R2_BACKUPS_BUCKET, isolated, config.R2_MEDIA_BUCKET, key);
      }
    }
    if (status === 'removed') {
      for (const key of mediaKeys(previous)) {
        if (key.startsWith('og/') && !await r2.headObject(config.R2_MEDIA_BUCKET, key)) continue;
        await r2.copyObject(config.R2_MEDIA_BUCKET, key, config.R2_BACKUPS_BUCKET, `quarantine/${key}`);
      }
    }
    const work = { ...previous, status, updatedAt: new Date() };
    await tx.update(works).set({ status, updatedAt: work.updatedAt }).where(eq(works.id, id));
    await writeAudit(tx, { ...actor, entityType: 'work', entityId: id, action: status, diff: { from: previous.status, to: status } });
    return { work: await refreshWorkRevision(tx, config, work), previous };
  });
  // Reacquire the row lock so cleanup and restoration cannot overwrite each other's media.
  if (status === 'removed' || status === 'deleted') {
    try {
      await db.transaction(async tx => {
        const [current] = await tx.select({ status: works.status }).from(works).where(eq(works.id, id)).for('update');
        if (current?.status !== status) return;
        for (const key of mediaKeys(result.work)) {
          await r2.deleteObject(config.R2_MEDIA_BUCKET, key);
          if (status === 'deleted') await r2.deleteObject(config.R2_BACKUPS_BUCKET, `quarantine/${key}`);
        }
      });
    } finally { await purgeWorkCaches(deps, result.work, result.previous, [], true); }
  } else if (status === 'hidden') await purgeWorkCaches(deps, result.work, result.previous);
  else background(purgeWorkCaches(deps, result.work, result.previous));
  return result.work;
}

export const hideWork = (deps: PublishDeps, id: string, actor = systemActor) => changeVisibility(deps, id, 'hidden', actor);
export const restoreWork = (deps: PublishDeps, id: string, actor = systemActor) => changeVisibility(deps, id, 'published', actor);
export const removeWork = (deps: PublishDeps, id: string, actor = systemActor) => changeVisibility(deps, id, 'removed', actor);
export const deleteWork = (deps: PublishDeps, id: string, actor = systemActor) => changeVisibility(deps, id, 'deleted', actor);

export function createPublisher(deps: PublishDeps) {
  return {
    autoPublishSubmission: (submissionId: string, actor?: Actor, editorial?: JsonObject) => autoPublishSubmission(deps, submissionId, actor, editorial),
    publishWorkDirect: (input: DirectWorkInput, actor?: Actor) => publishWorkDirect(deps, input, actor),
    hideWork: (id: string, actor?: Actor) => hideWork(deps, id, actor), restoreWork: (id: string, actor?: Actor) => restoreWork(deps, id, actor),
    removeWork: (id: string, actor?: Actor) => removeWork(deps, id, actor), deleteWork: (id: string, actor?: Actor) => deleteWork(deps, id, actor),
    purgeWorkCaches: (work: WorkRow, previous?: WorkRow, previousCharacters?: string[]) => purgeWorkCaches(deps, work, previous, previousCharacters),
  };
}
