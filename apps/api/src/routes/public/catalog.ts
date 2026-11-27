import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, not, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../../app.js';
import { categories, characters, creators, events, friendLinks, topicWorks, topics, videos, works } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { object, safeUrl, text } from '../../services/work-data.js';
import { likePattern, pageResult, pagination } from '../query.js';
import { createCreatorRoutes } from './creators.js';
import { activeCategory, activeCharacter, activeTopic, approvedVideo, hasCharacter, loadRoles, publicCharacter, publicCounts, publicCreator, publicVideo, publicWork, published, serialWork } from './data.js';

export async function listPublicTopics(ctx: AppContext, serial?: boolean, ids?: string[]) {
  if (ids?.length === 0) return [];
  const { db } = ctx;
  const groups = await db.select().from(topics).where(and(activeTopic, serial === undefined ? undefined : eq(topics.isSerial, serial),
    ids ? inArray(topics.id, ids) : undefined)).orderBy(asc(topics.sortOrder), asc(topics.id));
  if (!groups.length) return [];
  const covers = [...new Set(groups.flatMap(topic => topic.coverWorkId ? [topic.coverWorkId] : []))];
  const [links, coverWorks] = await Promise.all([
    db.select({ link: topicWorks, work: works }).from(topicWorks).innerJoin(works, eq(topicWorks.workId, works.id))
      .where(and(inArray(topicWorks.topicId, groups.map(topic => topic.id)), published)).orderBy(asc(topicWorks.position), asc(topicWorks.workId)),
    covers.length ? db.select().from(works).where(and(inArray(works.id, covers), published)) : [],
  ]);
  const roles = await loadRoles(db, [...new Map([...links.map(link => link.work), ...coverWorks].map(work => [work.id, work])).values()]);
  const coverById = new Map(coverWorks.map(work => [work.id, publicWork(ctx, work, roles.get(work.id))]));
  return groups.flatMap(topic => {
    const entries = links.filter(entry => entry.link.topicId === topic.id).map(({ work, link }) => ({ ...link, work: publicWork(ctx, work, roles.get(work.id)) }));
    const cover = (topic.coverWorkId ? coverById.get(topic.coverWorkId) : undefined) ?? entries[0]?.work;
    if (!cover || (!topic.isSerial && !entries.length)) return [];
    const pages = topic.isSerial ? entries.flatMap(entry => entry.pageNumber ? [{ pageNumber: entry.pageNumber, workId: entry.workId, work: entry.work }] : [])
      .sort((a, b) => a.pageNumber - b.pageNumber) : [];
    const configured = topic.readerConfig.totalPages;
    const totalPages = Math.max(Number.isSafeInteger(configured) && typeof configured === 'number' ? configured : 0, pages.at(-1)?.pageNumber ?? 0);
    const readerConfig = { totalPages, credits: topic.readerConfig.credits, creditsI18n: topic.readerConfig.creditsI18n };
    const author = topic.author && { name: text(topic.author.name), url: safeUrl(topic.author.url), bio: text(topic.author.bio),
      channels: Array.isArray(topic.author.channels) ? topic.author.channels.map(value => object(value)).map(channel => ({ platform: text(channel.platform), label: text(channel.label), url: safeUrl(channel.url) })).filter(channel => channel.url) : [] };
    return [{ ...topic, author, cover, coverWorkId: cover.id, coverUrl: cover.thumbnailUrl, works: entries, pages, workCount: entries.length,
      readerConfig, ...(topic.isSerial && { reader: { ...readerConfig, pages } }) }];
  });
}

export function topicSummary({ pages, reader, works, ...summary }: Awaited<ReturnType<typeof listPublicTopics>>[number]) {
  return summary;
}

export function createCatalogRoutes(ctx: AppContext) {
  const { db, services } = ctx;
  const routes = new Hono();
  routes.get('/characters', async c => {
    const rows = await db.select({ row: characters, workCount: sql<number>`(SELECT count(*)::int FROM works
      WHERE ${published} AND NOT ${serialWork} AND (works.primary_character_id=characters.id OR EXISTS
        (SELECT 1 FROM work_characters wc WHERE wc.work_id=works.id AND wc.character_id=characters.id)))` })
      .from(characters).where(activeCharacter).orderBy(asc(characters.sortOrder), asc(characters.id));
    return c.json({ items: rows.map(({ row, workCount }) => publicCharacter(ctx, row, workCount)), total: rows.length });
  });
  routes.get('/characters/:id', async c => {
    const id = c.req.param('id');
    const [[row], [totals]] = await Promise.all([
      db.select().from(characters).where(and(eq(characters.id, id), activeCharacter)),
      db.select({ total: count() }).from(works).where(and(published, not(serialWork), hasCharacter(id))),
    ]);
    if (!row) throw new ApiError(404, 'character_not_found', '角色不存在');
    return c.json({ character: publicCharacter(ctx, row, totals?.total) });
  });
  routes.get('/categories', async c => {
    const rows = await db.select().from(categories).where(activeCategory).orderBy(asc(categories.sortOrder), asc(categories.id));
    return c.json({ items: rows, total: rows.length });
  });
  for (const base of ['/topics', '/serials'] as const) {
    routes.get(base, async c => {
      const { page, pageSize, offset } = pagination(c.req.query());
      const serial = base === '/serials' ? true : c.req.query('serial') === 'true' ? true : c.req.query('serial') === 'all' ? undefined : false;
      const rows = await listPublicTopics(ctx, serial);
      return c.json(pageResult(rows.slice(offset, offset + pageSize).map(topicSummary), rows.length, page, pageSize));
    });
    routes.get(`${base}/:id`, async c => {
      const [topic] = await listPublicTopics(ctx, base === '/serials' ? true : undefined, [c.req.param('id')]);
      if (!topic) throw new ApiError(404, 'topic_not_found', '专题不存在');
      return c.json({ topic });
    });
  }
  const serialPage = async (c: Context) => {
    const rawPage = c.req.param('pageNumber');
    if (!rawPage || !/^[1-9]\d*$/.test(rawPage)) throw new ApiError(404, 'page_not_found', '连载页不存在');
    const pageNumber = Number(rawPage);
    const [topic] = await listPublicTopics(ctx, true, [c.req.param('id') ?? '']);
    const totalPages = topic?.readerConfig.totalPages ?? 0;
    if (!topic || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) throw new ApiError(404, 'page_not_found', '连载页不存在');
    const page = topic.pages.find(entry => entry.pageNumber === pageNumber);
    return c.json({ topic, totalPages, pageNumber, work: page?.work ?? null, previous: pageNumber > 1 ? pageNumber - 1 : null, next: pageNumber < totalPages ? pageNumber + 1 : null });
  };
  routes.get('/serials/:id/pages/:pageNumber', serialPage);
  routes.get('/topics/:id/page/:pageNumber', serialPage);
  routes.route('/', createCreatorRoutes(ctx));
  routes.get('/videos', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query);
    const pattern = query.q ? likePattern(query.q.slice(0, 100)) : undefined;
    const where = and(approvedVideo, query.creator ? eq(videos.creatorId, query.creator) : undefined,
      query.character ? sql`(${videos.review}->'characterIds') ? ${query.character}` : undefined,
      pattern ? or(sql`${videos.title} ILIKE ${pattern}`, sql`(${videos.review}->'i18n')::text ILIKE ${pattern}`) : undefined);
    const order = query.sort === 'oldest' ? asc(videos.publishedAt) : sql`${videos.publishedAt} DESC NULLS LAST`;
    const [rows, [totals]] = await Promise.all([
      db.select({ row: videos, creator: creators }).from(videos).innerJoin(creators, eq(creators.id, videos.creatorId)).where(where)
        .orderBy(order, asc(videos.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(videos).where(where),
    ]);
    return c.json(pageResult(rows.map(({ row, creator }) => publicVideo(row, publicCreator(ctx, creator))), totals?.total ?? 0, page, pageSize));
  });
  const getEvents = async (status: 'active' | 'archived' | 'all' = 'active') => {
    const now = new Date();
    const active = and(eq(events.status, 'active'), or(isNull(events.startsAt), lte(events.startsAt, now)), or(isNull(events.endsAt), gte(events.endsAt, now)));
    const archived = or(eq(events.status, 'archived'), and(eq(events.status, 'active'), lt(events.endsAt, now)));
    const where = status === 'all' ? or(active, archived) : status === 'archived' ? archived : active;
    const rows = await db.select().from(events).where(where)
      .orderBy(desc(events.startsAt), asc(events.id));
    return rows.map(row => ({ ...row, status: row.status === 'archived' || (row.endsAt && row.endsAt < now) ? 'archived' as const : 'active' as const }));
  };
  const getLinks = async () => (await db.select().from(friendLinks).where(eq(friendLinks.status, 'active')).orderBy(asc(friendLinks.sortOrder), asc(friendLinks.id)))
    .map(row => ({ ...row, url: safeUrl(row.url), avatarUrl: row.avatarKey ? services.r2.publicUrl(row.avatarKey) : null }));
  routes.get('/site-meta', async c => {
    const [events, friendLinks, counts] = await Promise.all([getEvents(), getLinks(), publicCounts(ctx)]);
    return c.json({ events, friendLinks, counts });
  });
  routes.get('/events', async c => {
    const status = c.req.query('status') ?? 'active';
    if (status !== 'active' && status !== 'archived' && status !== 'all') throw new ApiError(400, 'invalid_event_status', '活动状态筛选无效');
    const items = await getEvents(status);
    return c.json({ items, total: items.length });
  });
  routes.get('/friend-links', async c => { const items = await getLinks(); return c.json({ items, total: items.length }); });
  return routes;
}
