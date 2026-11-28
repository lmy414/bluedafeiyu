import { and, arrayContains, asc, count, desc, eq, ilike, inArray, ne, not, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import { categories, characters, workSearchText, works } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { workRelations } from '../../services/publish.js';
import { clientIp, createRateLimiter } from '../../services/ratelimit.js';
import { likePattern, pageResult, pagination } from '../query.js';
import { listPublicTopics, topicSummary } from './catalog.js';
import { chronological, hasCharacter, publicCounts, publicWork, publicWorks, published, serialWork } from './data.js';
import { peerIp } from './submissions.js';

const filters = z.object({
  character: z.array(z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).max(12),
  category: z.string().max(64).optional(), tag: z.string().max(120).optional(),
  creation: z.enum(['non-ai']).optional(),
  topic: z.string().max(64).optional(), q: z.string().trim().max(100).optional(), animated: z.enum(['true', 'false', '1', '0']).optional(),
  kind: z.enum(['submission', 'owner-picks', 'blue-fish']).optional(), sort: z.string().max(20).optional(),
});
const workKey = (key: string) => and(published, or(eq(works.id, key), eq(works.slug, key)));
const counterFields = { id: works.id, slug: works.slug, viewCount: works.viewCount, downloadCount: works.downloadCount };
const crawlerAgent = /bot|spider|crawler|slurp|bingpreview|headlesschrome|lighthouse/i;

export function createPublicWorkRoutes(ctx: AppContext) {
  const routes = new Hono();
  const { db } = ctx;
  const cooldown = createRateLimiter({ limit: 1, windowMs: 60_000, autoCleanup: true });
  routes.get('/works', async c => {
    const query = c.req.query();
    const characterIds = (c.req.queries('character') ?? []).flatMap(value => value.split(',').map(id => id.trim()));
    const parsed = filters.safeParse({ ...query, character: [...new Set(characterIds)] });
    if (!parsed.success) throw new ApiError(400, 'invalid_filters', '筛选参数无效', parsed.error.issues);
    const f = parsed.data;
    let { page, pageSize, offset } = pagination(query);
    if (query.cursor !== undefined) {
      const cursor = Buffer.from(query.cursor, 'base64url').toString('utf8');
      const next = /^page:(\d{1,6})$/.exec(cursor)?.[1];
      if (!next) throw new ApiError(400, 'invalid_cursor', '分页游标无效');
      ({ page, pageSize, offset } = pagination({ ...query, page: next }));
    }
    const pattern = f.q ? likePattern(f.q) : undefined;
    const where = and(published, (!f.q && !f.topic) ? not(serialWork) : undefined,
      ...f.character.map(hasCharacter), f.category ? eq(works.categoryId, f.category) : undefined,
      f.creation === 'non-ai' ? arrayContains(works.tags, ['非AI']) : undefined,
      f.tag ? arrayContains(works.tags, [f.tag]) : undefined, f.kind ? eq(works.kind, f.kind) : undefined,
      f.animated ? eq(works.isAnimated, ['true', '1'].includes(f.animated)) : undefined,
      f.topic ? sql`EXISTS (SELECT 1 FROM topics t LEFT JOIN topic_works tw ON tw.topic_id=t.id AND tw.work_id=${works.id}
        WHERE t.id=${f.topic} AND t.status='active' AND (tw.work_id IS NOT NULL OR t.cover_work_id=${works.id}))` : undefined,
      pattern ? or(ilike(workSearchText(works), pattern), sql`EXISTS (SELECT 1 FROM characters ch WHERE
        (ch.id=${works.primaryCharacterId} OR EXISTS (SELECT 1 FROM work_characters wc WHERE wc.work_id=${works.id} AND wc.character_id=ch.id))
        AND dafeiyu_search_text(ch.name, ch.description, '', ch.aliases, ch.i18n) ILIKE ${pattern})`) : undefined);
    const order = f.sort === 'oldest' ? [sql`${works.publishedAt} ASC NULLS LAST`, asc(works.slug)] :
      f.sort === 'name' ? [asc(works.name), asc(works.slug)] : f.sort === 'popular' ? [desc(works.viewCount), ...chronological] :
      f.sort === 'downloads' ? [desc(works.downloadCount), ...chronological] : chronological;
    const [rows, [totals]] = await Promise.all([
      db.select().from(works).where(where).orderBy(...order).limit(pageSize).offset(offset), db.select({ total: count() }).from(works).where(where),
    ]);
    const result = pageResult(await publicWorks(ctx, rows), totals?.total ?? 0, page, pageSize);
    return c.json({ ...result, nextCursor: result.nextPage ? Buffer.from(`page:${result.nextPage}`).toString('base64url') : null });
  });

  routes.get('/works/:slugOrId', async c => {
    const key = c.req.param('slugOrId').replace(/\.html$/, '');
    const [row] = await db.select().from(works).where(workKey(key))
      .orderBy(sql`${works.id} = ${key} DESC`).limit(1);
    if (!row) throw new ApiError(404, 'work_not_found', '作品不存在');
    const relations = await workRelations(db, row);
    const [grouped, recommendations, previous, next, roles, category] = await Promise.all([
      listPublicTopics(ctx, undefined, relations.topicIds),
      db.select().from(works).where(and(published, not(serialWork), ne(works.id, row.id), or(...relations.roles.map(hasCharacter))))
        .orderBy(...chronological).limit(8),
      db.select({ id: works.id, slug: works.slug, name: works.name }).from(works).where(and(published, not(serialWork),
        sql`(coalesce(${works.publishedAt}, '-infinity'::timestamptz) > coalesce(${row.publishedAt?.toISOString() ?? null}::timestamptz, '-infinity') OR
         (${works.publishedAt} IS NOT DISTINCT FROM ${row.publishedAt?.toISOString() ?? null}::timestamptz AND ${works.slug} < ${row.slug}))`))
        .orderBy(sql`${works.publishedAt} ASC NULLS FIRST`, desc(works.slug)).limit(1),
      db.select({ id: works.id, slug: works.slug, name: works.name }).from(works).where(and(published, not(serialWork),
        sql`(coalesce(${works.publishedAt}, '-infinity'::timestamptz) < coalesce(${row.publishedAt?.toISOString() ?? null}::timestamptz, '-infinity') OR
         (${works.publishedAt} IS NOT DISTINCT FROM ${row.publishedAt?.toISOString() ?? null}::timestamptz AND ${works.slug} > ${row.slug}))`)).orderBy(...chronological).limit(1),
      db.select({ id: characters.id, name: characters.name, aliases: characters.aliases, i18n: characters.i18n })
        .from(characters).where(inArray(characters.id, relations.roles)),
      db.select({ id: categories.id, name: categories.name, i18n: categories.i18n }).from(categories).where(eq(categories.id, row.categoryId)),
    ]);
    const serials = grouped.filter(topic => topic.isSerial).map(topic => ({ ...topic, pageNumber: topic.pages.find(page => page.workId === row.id)?.pageNumber ?? null }));
    const rolesById = new Map(roles.map(role => [role.id, role]));
    const orderedRoles = relations.roles.flatMap(id => {
      const role = rolesById.get(id);
      return role ? [role] : [];
    });
    return c.json({ work: { ...publicWork(ctx, row, relations.roles, relations.topicIds, relations.creatorIds),
      character: rolesById.get(row.primaryCharacterId) ?? null, characters: orderedRoles, category: category[0] ?? null },
      topics: grouped, serials, recommendations: await publicWorks(ctx, recommendations), previous: previous[0] ?? null, next: next[0] ?? null });
  });

  for (const action of ['view', 'download'] as const) {
    routes.post(`/works/:slugOrId/${action}`, async c => {
      c.header('Cache-Control', 'no-store');
      const key = c.req.param('slugOrId').replace(/\.html$/, '');
      const [work] = await db.select(counterFields).from(works).where(workKey(key)).orderBy(sql`${works.id} = ${key} DESC`).limit(1);
      if (!work) throw new ApiError(404, 'work_not_found', '作品不存在');
      if (crawlerAgent.test(c.req.header('User-Agent') ?? '')) return c.json({ ...work, counted: false });
      const ip = clientIp(peerIp(c), c.req.header('X-Forwarded-For'), ctx.config.TRUST_PROXY_HOPS);
      const release = cooldown.reserve(`${ip ?? 'unknown'}|${work.id}|${action}`);
      if (!release) return c.json({ ...work, counted: false });

      const increment = action === 'view' ? { viewCount: sql`${works.viewCount} + 1` } : { downloadCount: sql`${works.downloadCount} + 1` };
      try {
        const [updated] = await db.update(works).set(increment).where(and(published, eq(works.id, work.id))).returning(counterFields);
        if (!updated) throw new ApiError(404, 'work_not_found', '作品不存在');
        return c.json({ ...updated, counted: true });
      } catch (error) {
        release();
        throw error;
      }
    });
  }

  routes.get('/home', async c => {
    const [latest, featured, counts] = await Promise.all([
      db.select().from(works).where(and(published, not(serialWork))).orderBy(...chronological).limit(24),
      listPublicTopics(ctx), publicCounts(ctx),
    ]);
    return c.json({ latestWorks: await publicWorks(ctx, latest), featuredTopics: featured.filter(topic => !topic.isSerial).slice(0, 6).map(topicSummary),
      featuredSerials: featured.filter(topic => topic.isSerial).slice(0, 6).map(topicSummary), counts });
  });
  return routes;
}
