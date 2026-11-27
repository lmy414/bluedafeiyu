import { and, asc, count, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { AppContext } from '../../app.js';
import { categories, characters, creators, topics, videos, workCharacters, works } from '../../db/schema.js';
import type { JsonObject, WorkRow } from '../../db/schema.js';
import { object, projectOpenWork, safeUrl, text, translations, uniqueStrings } from '../../services/work-data.js';

export const published = eq(works.status, 'published');
export const chronological = [sql`${works.publishedAt} DESC NULLS LAST`, asc(works.slug)];
export const activeCharacter = eq(characters.status, 'active');
export const activeCategory = eq(categories.status, 'active');
export const activeTopic = eq(topics.status, 'active');
export const approvedVideo = eq(videos.status, 'approved');
export const visibleCreator = or(eq(creators.status, 'active'), and(eq(creators.status, 'paused'), or(isNotNull(creators.lastSyncedAt),
  sql`EXISTS (SELECT 1 FROM videos cv WHERE cv.creator_id = ${creators.id} AND cv.status = 'approved')`)));
const belongsToSerial = (activeOnly = false) => sql<boolean>`EXISTS (SELECT 1 FROM topics st WHERE st.is_serial
  ${activeOnly ? sql`AND st.status = 'active'` : sql.empty()} AND
  (st.cover_work_id = ${works.id} OR EXISTS (SELECT 1 FROM topic_works sw WHERE sw.topic_id = st.id AND sw.work_id = ${works.id})))`;
export const serialWork = belongsToSerial();
export const activeSerialWork = belongsToSerial(true);
export const hasCharacter = (id: string) => or(eq(works.primaryCharacterId, id), sql`EXISTS (SELECT 1 FROM work_characters wc WHERE wc.work_id = ${works.id} AND wc.character_id = ${id})`);

export async function loadRoles(db: AppContext['db'], rows: WorkRow[]) {
  const result = new Map(rows.map(work => [work.id, [work.primaryCharacterId]]));
  if (!rows.length) return result;
  const links = await db.select().from(workCharacters).where(inArray(workCharacters.workId, rows.map(work => work.id))).orderBy(asc(workCharacters.characterId));
  for (const link of links) {
    const ids = result.get(link.workId);
    if (ids && !ids.includes(link.characterId)) ids.push(link.characterId);
  }
  return result;
}

export function publicWork(ctx: AppContext, row: WorkRow, roles: string[] = [], topicIds: string[] = [], creatorIds: string[] = []) {
  const data = projectOpenWork(row, roles, ctx.config.SITE_PUBLIC_URL, ctx.config.R2_PUBLIC_BASE_URL, topicIds, creatorIds);
  return {
    ...data, author: data.author.name, i18n: translations(row.i18n, ['name', 'description', 'commentary', 'tags', 'licenseNote', 'originNote', 'seoTitle', 'seoDescription', 'faq']),
    source: { ...data.source, note: text(row.origin.note) }, viewCount: row.viewCount, downloadCount: row.downloadCount,
    fileSize: row.fileSize, mimeType: row.mimeType,
    categoryId: row.categoryId, primaryCharacterId: row.primaryCharacterId, kind: row.kind, channel: row.channel,
    originalUrl: data.image.originalUrl, thumbnailUrl: data.image.thumbnailUrl, displayUrl: data.image.displayUrl,
    width: data.image.width, height: data.image.height, thumbWidth: row.thumbWidth, thumbHeight: row.thumbHeight, format: data.image.format,
    displayWidth: row.displayWidth, displayHeight: row.displayHeight, isAnimated: row.isAnimated, publishedAt: row.publishedAt, revision: row.revision,
  };
}

export async function publicWorks(ctx: AppContext, rows: WorkRow[]) {
  const roles = await loadRoles(ctx.db, rows);
  return rows.map(row => publicWork(ctx, row, roles.get(row.id)));
}

export function publicCharacter(ctx: AppContext, row: typeof characters.$inferSelect, workCount = 0) {
  return { ...row, workCount, portraitUrl: row.portraitKey ? ctx.services.r2.publicUrl(row.portraitKey) : null };
}

export function publicCreator(ctx: AppContext, row: typeof creators.$inferSelect) {
  return { id: row.id, uid: row.uid, name: row.name, homepage: safeUrl(row.homepage), intro: row.intro,
    avatarKey: row.avatarKey, avatarUrl: row.avatarKey ? ctx.services.r2.publicUrl(row.avatarKey) : null };
}

export function topicAuthorChannels(author: JsonObject) {
  return Array.isArray(author.channels) ? author.channels.flatMap(value => {
    const channel = object(value);
    const url = safeUrl(channel.url);
    return url ? [{ platform: text(channel.platform), label: text(channel.label), url }] : [];
  }) : [];
}

export const videoHref = (bvid: string) => `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`;

export function publicVideo(row: typeof videos.$inferSelect, creator: ReturnType<typeof publicCreator>) {
  const i18n = row.review.i18n;
  return { id: row.id, bvid: row.bvid, creatorId: row.creatorId, creator, title: row.title,
    url: videoHref(row.bvid), publishedAt: row.publishedAt,
    coverUrl: safeUrl(row.source.coverUrl ?? row.source.cover ?? row.source.pic), description: text(row.source.description), i18n,
    characterIds: uniqueStrings(row.review.characterIds), };
}

export async function publishedWorkCounts(db: AppContext['db']) {
  const [result] = await db.select({ total: count(),
    totalViews: sql`coalesce(sum(${works.viewCount}), 0)`.mapWith(Number),
    totalDownloads: sql`coalesce(sum(${works.downloadCount}), 0)`.mapWith(Number),
  }).from(works).where(published);
  return result ?? { total: 0, totalViews: 0, totalDownloads: 0 };
}

export async function publicCounts({ db }: AppContext) {
  const [work, role, category, topic, serial, video, creator] = await Promise.all([
    publishedWorkCounts(db),
    db.select({ total: count() }).from(characters).where(activeCharacter),
    db.select({ total: count() }).from(categories).where(activeCategory),
    db.select({ total: count() }).from(topics).where(and(activeTopic, eq(topics.isSerial, false))),
    db.select({ total: count() }).from(topics).where(and(activeTopic, eq(topics.isSerial, true))),
    db.select({ total: count() }).from(videos).where(approvedVideo),
    db.select({ total: count() }).from(creators).where(visibleCreator),
  ]);
  return { works: work.total, totalViews: work.totalViews, totalDownloads: work.totalDownloads, characters: role[0]?.total ?? 0, categories: category[0]?.total ?? 0,
    topics: topic[0]?.total ?? 0, serials: serial[0]?.total ?? 0, videos: video[0]?.total ?? 0, creators: creator[0]?.total ?? 0 };
}
