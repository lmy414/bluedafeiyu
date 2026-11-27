import { createHash } from 'node:crypto';
import { categoryIdSchema, topicAuthorSchema } from '@dafeiyu/shared';
import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import sharp from 'sharp';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import { categories, characters, topicStatus, topicWorks, topics, works } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { writeAudit } from '../../services/audit.js';
import { inspectImage, MAX_IMAGE_BYTES } from '../../services/image.js';
import { refreshWorkRevision } from '../../services/publish.js';
import { immutableMedia } from '../../services/r2.js';
import { uniqueStrings } from '../../services/work-data.js';
import { boundedForm, boundedJson } from '../body.js';
import { likePattern, pageResult, pagination } from '../query.js';
import type { AdminEnv } from './auth.js';

const id = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const jsonObject = z.record(z.string(), z.unknown());
const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(4000);
const sortOrder = z.number().int().min(-1_000_000).max(1_000_000);
const taxonFields = { name, description: description.optional(), status: z.enum(['active', 'hidden']).optional(), sortOrder: sortOrder.optional(), i18n: jsonObject.optional() };
const characterCreate = z.strictObject({ ...taxonFields, id, aliases: z.array(z.string().trim().min(1).max(120)).max(100).optional(), brandTokens: jsonObject.optional() });
const categoryCreate = z.strictObject({ ...taxonFields, id: categoryIdSchema });
const topicMember = z.strictObject({ workId: z.string().min(1).max(120), position: z.number().int().min(0).max(20_000).optional(), pageNumber: z.number().int().min(1).max(20_000).nullable().optional() });
const topicCreate = z.strictObject({
  id, name, summary: description.optional(), status: z.enum(topicStatus.enumValues).optional(), sortOrder: sortOrder.optional(), isSerial: z.boolean().optional(),
  coverWorkId: z.string().min(1).max(120).nullable().optional(), readerConfig: jsonObject.nullable().optional(), author: topicAuthorSchema.optional(),
  i18n: jsonObject.optional(), works: z.array(topicMember).max(3000).optional(),
});

export function purgeTaxonomy(ctx: AppContext, kind: string, id?: string) {
  const languages = ['', '/zh-hant', '/en', '/ja'];
  const paths = languages.flatMap(prefix => [`${prefix}/`, `${prefix}/${kind}`, `${prefix}/${kind}.html`, `${prefix}/gallery`, `${prefix}/gallery.html`,
    ...(kind === 'topics' ? [`${prefix}/serials`, `${prefix}/serials.html`] : [])]);
  const prefixPaths = languages.flatMap(prefix => [...(id ? [`${prefix}/${kind}/${id}`] : []), ...(kind === 'topics' ? [`${prefix}/creators/`] : [])]);
  void Promise.all([ctx.services.cloudflare.purgePaths(paths), ctx.services.cloudflare.purgePrefixes([...prefixPaths, '/open-api/v1/'])]);
}

export function createAdminCatalogRoutes(ctx: AppContext) {
  const { db, config, services } = ctx;
  const routes = new Hono<AdminEnv>();
  routes.get('/characters', async c => {
    const rows = await db.select().from(characters).orderBy(asc(characters.sortOrder), asc(characters.id));
    return c.json({ items: rows.map(row => ({ ...row, portraitUrl: row.portraitKey ? services.r2.publicUrl(row.portraitKey) : null })), total: rows.length });
  });
  routes.get('/categories', async c => {
    const rows = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id));
    return c.json({ items: rows, total: rows.length });
  });
  routes.get('/characters/:id', async c => {
    const [row] = await db.select().from(characters).where(eq(characters.id, c.req.param('id')));
    if (!row) throw new ApiError(404, 'character_not_found', '角色不存在');
    return c.json({ ...row, portraitUrl: row.portraitKey ? services.r2.publicUrl(row.portraitKey) : null });
  });
  routes.get('/categories/:id', async c => {
    const [row] = await db.select().from(categories).where(eq(categories.id, c.req.param('id')));
    if (!row) throw new ApiError(404, 'category_not_found', '分类不存在');
    return c.json(row);
  });
  for (const kind of ['characters', 'categories'] as const) {
    const table = kind === 'characters' ? characters : categories;
    const schema = kind === 'characters' ? characterCreate : categoryCreate;
    const patch = kind === 'characters' ? characterCreate.omit({ id: true }).partial() : categoryCreate.omit({ id: true }).partial();
    routes.post(`/${kind}`, async c => {
      const input = schema.parse(await boundedJson(c.req.raw));
      const row = await db.transaction(async tx => {
        const [created] = await tx.insert(table).values(input).onConflictDoNothing().returning();
        if (!created) throw new ApiError(409, 'taxonomy_exists', '标识已存在');
        await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: kind, entityId: input.id, action: 'create' });
        return created;
      });
      purgeTaxonomy(ctx, kind, row.id);
      return c.json(row, 201);
    });
    routes.patch(`/${kind}/:id`, async c => {
      const input = patch.parse(await boundedJson(c.req.raw));
      if (!Object.keys(input).length) throw new ApiError(422, 'no_changes', '请选择要修改的字段');
      const row = await db.transaction(async tx => {
        const [updated] = await tx.update(table).set(input).where(eq(table.id, c.req.param('id'))).returning();
        if (!updated) throw new ApiError(404, 'taxonomy_not_found', '记录不存在');
        await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: kind, entityId: updated.id, action: 'update', diff: { fields: Object.keys(input) } });
        return updated;
      });
      purgeTaxonomy(ctx, kind, row.id);
      return c.json(row);
    });
  }
  routes.delete('/characters/:id', async c => {
    const id = c.req.param('id');
    await db.transaction(async tx => {
      const [row] = await tx.delete(characters).where(eq(characters.id, id)).returning();
      if (!row) throw new ApiError(404, 'character_not_found', '角色不存在');
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'character', entityId: id, action: 'delete' });
    });
    purgeTaxonomy(ctx, 'characters', id);
    return c.body(null, 204);
  });
  routes.post('/characters/:id/portrait', async c => {
    const id = c.req.param('id');
    const form = await boundedForm(c.req.raw, MAX_IMAGE_BYTES + 128 * 1024);
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError(422, 'missing_portrait', '请选择角色立绘');
    const bytes = Buffer.from(await file.arrayBuffer());
    const image = await inspectImage(bytes);
    if (image.isAnimated || !['png', 'webp'].includes(image.format)) throw new ApiError(422, 'invalid_portrait_format', '立绘请选择静态 PNG 或 WebP');
    const { data, info } = await sharp(bytes).resize({ width: 1600, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    const version = createHash('sha256').update(data).digest('hex').slice(0, 24);
    const portraitKey = `assets/portraits/${id}/${version}.webp`;
    await db.transaction(async tx => {
      const [row] = await tx.select().from(characters).where(eq(characters.id, id)).for('update');
      if (!row) throw new ApiError(404, 'character_not_found', '角色不存在');
      await tx.update(characters).set({ portraitKey, portraitWidth: info.width, portraitHeight: info.height }).where(eq(characters.id, id));
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'character', entityId: id, action: 'portrait', diff: { portraitKey } });
      await services.r2.putObject(config.R2_MEDIA_BUCKET, portraitKey, data, 'image/webp', immutableMedia);
    });
    purgeTaxonomy(ctx, 'characters', id);
    return c.json({ portraitKey, portraitUrl: services.r2.publicUrl(portraitKey), portraitWidth: info.width, portraitHeight: info.height });
  });

  routes.get('/topics', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query, 50);
    const q = query.q && likePattern(query.q.slice(0, 100));
    const where = and(q ? or(ilike(topics.name, q), ilike(topics.id, q), ilike(topics.summary, q)) : undefined,
      query.serial === undefined ? undefined : eq(topics.isSerial, query.serial === 'true'));
    const [rows, [total]] = await Promise.all([db.select().from(topics).where(where).orderBy(asc(topics.sortOrder), asc(topics.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(topics).where(where)]);
    return c.json(pageResult(rows, total?.total ?? 0, page, pageSize));
  });
  routes.get('/topics/:id', async c => {
    const id = c.req.param('id');
    const [row] = await db.select().from(topics).where(eq(topics.id, id));
    if (!row) throw new ApiError(404, 'topic_not_found', '专题不存在');
    const entries = await db.select({ workId: works.id, name: works.name, position: topicWorks.position, pageNumber: topicWorks.pageNumber }).from(topicWorks)
      .innerJoin(works, eq(topicWorks.workId, works.id)).where(eq(topicWorks.topicId, id)).orderBy(asc(topicWorks.position), asc(works.id));
    if (row.coverWorkId && !entries.some(item => item.workId === row.coverWorkId)) {
      const [cover] = await db.select({ workId: works.id, name: works.name }).from(works).where(eq(works.id, row.coverWorkId));
      if (cover) entries.unshift({ ...cover, position: 0, pageNumber: null });
    }
    return c.json({ ...row, works: entries });
  });

  async function updateTopic(topicId: string, actorId: string, input: Omit<Partial<z.output<typeof topicCreate>>, 'id'>, creating = false) {
    const { works: members, readerConfig, ...metadata } = input;
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`topic:${topicId}`}, 0))`);
      const [previous] = await tx.select().from(topics).where(eq(topics.id, topicId)).for('update');
      if (creating && previous) throw new ApiError(409, 'topic_exists', '专题标识已存在');
      if (!creating && !previous) throw new ApiError(404, 'topic_not_found', '专题不存在');
      const cover = metadata.coverWorkId === undefined ? previous?.coverWorkId : metadata.coverWorkId;
      const serial = metadata.isSerial ?? previous?.isSerial ?? false;
      const reader = readerConfig === undefined ? previous?.readerConfig ?? {} : readerConfig ?? {};
      const old = previous ? await tx.select().from(topicWorks).where(eq(topicWorks.topicId, topicId)).orderBy(asc(topicWorks.position), asc(topicWorks.workId)) : [];
      const current = members ?? old;
      const linkedIds = uniqueStrings([...current.map(entry => entry.workId), cover]);
      if (current.length !== new Set(current.map(entry => entry.workId)).size) throw new ApiError(422, 'duplicate_topic_work', '专题作品不能重复');
      const ids = uniqueStrings([...linkedIds, ...old.map(entry => entry.workId), previous?.coverWorkId]);
      const rows = ids.length ? await tx.select().from(works).where(inArray(works.id, ids)).orderBy(asc(works.id)).for('update') : [];
      const pendingIds = new Set(rows.map(work => work.id));
      if (linkedIds.some(workId => !pendingIds.has(workId))) throw new ApiError(422, 'invalid_topic_work', '专题含不存在的作品');
      const totalPages = reader.totalPages;
      if (serial && (typeof totalPages !== 'number' || !Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 20_000)) throw new ApiError(422, 'invalid_total_pages', '连载需填写有效原稿总页数');
      const positions = current.map((entry, index) => ({ topicId, workId: entry.workId, position: entry.position ?? index,
        pageNumber: serial && entry.workId !== cover ? entry.pageNumber ?? null : null }));
      const pages = positions.filter(entry => entry.workId !== cover).map(entry => entry.pageNumber);
      if (serial && (pages.some(page => page === null || page > Number(totalPages)) || pages.length !== new Set(pages).size)) throw new ApiError(422, 'invalid_page_numbers', '正文原稿页码必填、不能重复且不得超过总页数');
      const values = { ...metadata, readerConfig: serial ? reader : {}, updatedAt: new Date() };
      const [row] = previous ? await tx.update(topics).set(values).where(eq(topics.id, topicId)).returning() :
        await tx.insert(topics).values({ ...values, id: topicId, name: metadata.name ?? '' }).onConflictDoNothing().returning();
      if (!row) throw new ApiError(409, 'topic_exists', '专题标识已存在');
      if (members || metadata.isSerial !== undefined || metadata.coverWorkId !== undefined) {
        await tx.delete(topicWorks).where(eq(topicWorks.topicId, topicId));
        if (positions.length) await tx.insert(topicWorks).values(positions);
      }
      if (previous?.status === 'active' || row.status === 'active') {
        for (const work of rows) await refreshWorkRevision(tx, config, work);
      }
      await writeAudit(tx, { actorType: 'owner', actorId, entityType: 'topic', entityId: topicId, action: previous ? 'update' : 'create', diff: { workCount: positions.length } });
      return { topic: { ...row, works: positions }, affected: rows.map(work => work.slug) };
    });
  }
  function purgeTopic(id: string, affected: string[]) {
    purgeTaxonomy(ctx, 'topics', id);
    void services.cloudflare.purgePaths(['', '/zh-hant', '/en', '/ja'].flatMap(prefix => affected.map(slug => `${prefix}/works/${encodeURIComponent(slug)}.html`)));
  }
  routes.post('/topics', async c => {
    const { id, ...input } = topicCreate.parse(await boundedJson(c.req.raw, 1024 * 1024));
    const result = await updateTopic(id, c.get('owner').id, input, true);
    purgeTopic(id, result.affected);
    return c.json(result.topic, 201);
  });
  routes.patch('/topics/:id', async c => {
    const id = c.req.param('id');
    const input = topicCreate.omit({ id: true }).partial().parse(await boundedJson(c.req.raw, 1024 * 1024));
    const result = await updateTopic(id, c.get('owner').id, input);
    purgeTopic(id, result.affected);
    return c.json(result.topic);
  });
  routes.delete('/topics/:id', async c => {
    const id = c.req.param('id');
    const affected = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`topic:${id}`}, 0))`);
      const [row] = await tx.select().from(topics).where(eq(topics.id, id)).for('update');
      if (!row) throw new ApiError(404, 'topic_not_found', '专题不存在');
      const members = await tx.select({ workId: topicWorks.workId }).from(topicWorks).where(eq(topicWorks.topicId, id));
      const ids = uniqueStrings([row.coverWorkId, ...members.map(member => member.workId)]);
      const workRows = ids.length ? await tx.select().from(works).where(inArray(works.id, ids)).orderBy(asc(works.id)).for('update') : [];
      await tx.delete(topics).where(eq(topics.id, id));
      if (row.status === 'active') for (const work of workRows) await refreshWorkRevision(tx, config, work);
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'topic', entityId: id, action: 'delete' });
      return workRows.map(work => work.slug);
    });
    purgeTopic(id, affected);
    return c.body(null, 204);
  });
  return routes;
}
