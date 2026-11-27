import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppContext } from '../../app.js';
import { creators, topics, topicWorks, videos, works } from '../../db/schema.js';
import type { TopicRow } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { topicCreatorId } from '../../services/publish.js';
import { safeUrl, text, uniqueStrings } from '../../services/work-data.js';
import { pageResult, pagination } from '../query.js';
import { activeSerialWork, activeTopic, approvedVideo, chronological, loadRoles, publicCreator, publicVideo, publicWork, published, topicAuthorChannels, videoHref, visibleCreator } from './data.js';

const imageFields = {
  id: works.id, slug: works.slug, name: works.name, r2ThumbKey: works.r2ThumbKey, thumbWidth: works.thumbWidth, thumbHeight: works.thumbHeight,
  createdAt: works.createdAt, publishedAt: works.publishedAt,
};
type Image = Pick<typeof works.$inferSelect, keyof typeof imageFields>;
type TopicMember = Image & { topicId: string; inSerial: boolean };
type Video = Pick<typeof videos.$inferSelect, 'id' | 'creatorId' | 'bvid' | 'title' | 'publishedAt'> & { cover: string | null };
type Preview = { kind: 'image' | 'video' | 'serial'; title: string; href: string; thumbUrl: string | null };
type CreatorProfile = ReturnType<typeof publicCreator> & {
  status: typeof creators.$inferSelect.status;
  lastSyncedAt: Date | null;
  channels: ReturnType<typeof topicAuthorChannels>;
};
type CreatorArchive = {
  profile: CreatorProfile;
  topics: TopicRow[];
  works: Map<string, Image>;
  videos: Video[];
};

const byDate = (a: Date | null, b: Date | null) => (b?.getTime() ?? Number.MIN_SAFE_INTEGER) - (a?.getTime() ?? Number.MIN_SAFE_INTEGER);
const byVideoDate = [sql`${videos.publishedAt} DESC NULLS LAST`, asc(videos.id)];
const thumbnail = (ctx: AppContext, work?: Image) => work?.r2ThumbKey ? ctx.services.r2.publicUrl(work.r2ThumbKey) : null;

function summarizeTopic(ctx: AppContext, row: TopicRow, members: TopicMember[], coversById: Map<string, Image>) {
  const cover = (row.coverWorkId ? coversById.get(row.coverWorkId) : undefined) ?? members[0];
  const coverUrl = thumbnail(ctx, cover);
  const author = row.author;
  const avatarKey = text(author?.avatarKey) || null;
  return {
    id: row.id, name: row.name, summary: row.summary, isSerial: row.isSerial, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    author: author && { name: text(author.name), url: safeUrl(author.url), bio: text(author.bio), channels: topicAuthorChannels(author),
      avatarKey, avatarUrl: avatarKey ? ctx.services.r2.publicUrl(avatarKey) : null },
    i18n: row.i18n, coverWorkId: cover?.id ?? null, coverUrl,
    cover: cover ? { id: cover.id, slug: cover.slug, name: cover.name, thumbnailUrl: coverUrl, thumbWidth: cover.thumbWidth, thumbHeight: cover.thumbHeight } : null,
    workCount: members.length, readerConfig: { totalPages: row.readerConfig.totalPages, credits: row.readerConfig.credits, creditsI18n: row.readerConfig.creditsI18n },
  };
}

function assembleCreatorArchive(ctx: AppContext, creatorRows: typeof creators.$inferSelect[], topicRows: TopicRow[], members: TopicMember[], covers: Image[], videoRows: Video[]) {
  const archives = new Map<string, CreatorArchive>();
  for (const row of creatorRows) archives.set(row.id, {
    profile: { ...publicCreator(ctx, row), status: row.status, lastSyncedAt: row.lastSyncedAt, channels: [] }, topics: [], works: new Map(), videos: [],
  });
  const membersByTopic = new Map<string, TopicMember[]>();
  for (const member of members) {
    const topicMembers = membersByTopic.get(member.topicId) ?? [];
    topicMembers.push(member);
    membersByTopic.set(member.topicId, topicMembers);
  }
  const coversById = new Map(covers.map(cover => [cover.id, cover]));
  for (const topic of topicRows) {
    const author = topic.author;
    if (!author) continue;
    const id = topicCreatorId(topic.id, author);
    const channels = topicAuthorChannels(author);
    const homepage = safeUrl(author.url) ?? channels[0]?.url ?? null;
    const avatarKey = text(author.avatarKey) || null;
    const archive: CreatorArchive = archives.get(id) ?? {
      profile: { id, uid: /^bilibili-(\d+)$/.exec(id)?.[1] ?? '', name: '', homepage: null, intro: '', avatarKey: null, avatarUrl: null,
        status: 'active', lastSyncedAt: null, channels: [] }, topics: [], works: new Map(), videos: [],
    };
    const { profile } = archive;
    profile.name = profile.name.trim() ? profile.name : text(author.name).trim() || topic.name;
    profile.homepage ??= homepage;
    if (!profile.intro.trim()) profile.intro = text(author.bio).trim();
    if (!profile.avatarUrl && avatarKey) {
      profile.avatarKey = avatarKey;
      profile.avatarUrl = ctx.services.r2.publicUrl(avatarKey);
    }
    profile.channels = [...new Map([...profile.channels, ...channels].map(channel => [channel.url, channel])).values()];
    archive.topics.push(topic);
    if (!topic.isSerial) {
      for (const member of membersByTopic.get(topic.id) ?? []) if (!member.inSerial) archive.works.set(member.id, member);
    }
    archives.set(id, archive);
  }
  for (const video of videoRows) archives.get(video.creatorId)?.videos.push(video);

  return [...archives.values()].map(({ profile, topics: authored, works: images, videos: clips }) => {
    const summaries = authored.map(topic => summarizeTopic(ctx, topic, membersByTopic.get(topic.id) ?? [], coversById));
    const serials = summaries.filter(topic => topic.isSerial);
    const previews: Array<Preview & { date: Date | null }> = [
      ...[...images.values()].map(work => ({ kind: 'image' as const, title: work.name, href: `/works/${encodeURIComponent(work.slug)}.html`,
        thumbUrl: thumbnail(ctx, work), date: work.publishedAt ?? work.createdAt })),
      ...clips.map(video => ({ kind: 'video' as const, title: video.title, href: videoHref(video.bvid), thumbUrl: safeUrl(video.cover), date: video.publishedAt })),
      ...serials.map(serial => ({ kind: 'serial' as const, title: serial.name, href: `/topics/${encodeURIComponent(serial.id)}`,
        thumbUrl: serial.coverUrl, date: serial.updatedAt })),
    ];
    previews.sort((a, b) => byDate(a.date, b.date) || a.href.localeCompare(b.href));
    return {
      profile, creator: { ...profile, workCount: images.size, videoCount: clips.length, serialCount: serials.length,
        totalCount: images.size + clips.length + serials.length, latestAt: previews[0]?.date?.toISOString() ?? null,
        previews: previews.slice(0, 3).map(({ date, ...preview }) => preview) },
      topics: summaries.filter(topic => !topic.isSerial), serials, workIds: [...images.keys()],
    };
  });
}

async function loadCreatorArchive(ctx: AppContext, id?: string) {
  const { db } = ctx;
  const [creatorRows, allTopics] = await Promise.all([
    db.select().from(creators).where(and(visibleCreator, id ? eq(creators.id, id) : undefined)),
    db.select().from(topics).where(and(activeTopic, isNotNull(topics.author))).orderBy(asc(topics.sortOrder), asc(topics.id)),
  ]);
  const topicRows = id ? allTopics.filter(topic => topicCreatorId(topic.id, topic.author) === id) : allTopics;
  const topicIds = topicRows.map(topic => topic.id);
  const coverIds = uniqueStrings(topicRows.map(topic => topic.coverWorkId));
  const creatorIds = uniqueStrings([...creatorRows.map(row => row.id), ...topicRows.map(row => topicCreatorId(row.id, row.author))]);
  if (!creatorIds.length) return [];
  const [members, covers, clips] = await Promise.all([
    topicIds.length ? db.select({ ...imageFields, topicId: topicWorks.topicId, inSerial: activeSerialWork }).from(topicWorks)
      .innerJoin(works, eq(topicWorks.workId, works.id)).where(and(published, inArray(topicWorks.topicId, topicIds)))
      .orderBy(asc(topicWorks.position), asc(works.id)) : [],
    coverIds.length ? db.select(imageFields).from(works).where(and(published, inArray(works.id, coverIds))) : [],
    db.select({ id: videos.id, creatorId: videos.creatorId, bvid: videos.bvid, title: videos.title, publishedAt: videos.publishedAt,
      cover: sql<string | null>`coalesce(${videos.source}->>'coverUrl', ${videos.source}->>'cover', ${videos.source}->>'pic')` })
      .from(videos).where(and(approvedVideo, inArray(videos.creatorId, creatorIds))),
  ]);
  return assembleCreatorArchive(ctx, creatorRows, topicRows, members, covers, clips);
}

export function createCreatorRoutes(ctx: AppContext) {
  const routes = new Hono();
  const { db } = ctx;
  routes.get('/creators', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query, 50);
    const q = query.q?.trim().slice(0, 100).toLowerCase();
    const archive = await loadCreatorArchive(ctx);
    const items = archive.map(entry => entry.creator).filter(creator => !q ||
      creator.name.toLowerCase().includes(q) || creator.intro.toLowerCase().includes(q));
    items.sort((a, b) => (b.latestAt ?? '').localeCompare(a.latestAt ?? '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return c.json(pageResult(items.slice(offset, offset + pageSize), items.length, page, pageSize));
  });
  routes.get('/creators/:id', async c => {
    const id = c.req.param('id');
    const [entry] = await loadCreatorArchive(ctx, id);
    if (!entry) throw new ApiError(404, 'creator_not_found', '作者不存在');
    const [images, clips] = await Promise.all([
      entry.workIds.length ? db.select().from(works).where(and(published, inArray(works.id, entry.workIds))).orderBy(...chronological).limit(100) : [],
      entry.creator.videoCount ? db.select().from(videos).where(and(approvedVideo, eq(videos.creatorId, id))).orderBy(...byVideoDate).limit(24) : [],
    ]);
    const imageIds = images.map(work => work.id);
    const [roles, memberships] = await Promise.all([
      loadRoles(db, images),
      imageIds.length ? db.select({ workId: topicWorks.workId, topicId: topics.id, author: topics.author }).from(topicWorks)
        .innerJoin(topics, eq(topicWorks.topicId, topics.id)).where(and(activeTopic, inArray(topicWorks.workId, imageIds)))
        .orderBy(asc(topics.sortOrder), asc(topics.id)) : [],
    ]);
    const groupsByWork = new Map<string, typeof memberships>();
    for (const group of memberships) {
      const groups = groupsByWork.get(group.workId) ?? [];
      groups.push(group);
      groupsByWork.set(group.workId, groups);
    }
    const workItems = images.map(work => {
      const groups = groupsByWork.get(work.id) ?? [];
      return publicWork(ctx, work, roles.get(work.id), groups.map(group => group.topicId),
        uniqueStrings(groups.flatMap(group => group.author ? [topicCreatorId(group.topicId, group.author)] : [])).sort());
    });
    return c.json({ creator: entry.creator, topics: entry.topics, serials: entry.serials, works: workItems,
      videos: clips.map(video => publicVideo(video, entry.profile)) });
  });
  return routes;
}
