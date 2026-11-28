import { safeHttpUrlSchema } from '@dafeiyu/shared';
import { asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import { events } from '../../db/schema.js';
import type { JsonObject } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { writeAudit } from '../../services/audit.js';
import { object } from '../../services/work-data.js';
import { boundedJson } from '../body.js';
import type { AdminEnv } from './auth.js';

const slug = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const title = z.string().trim().min(1).max(200);
const summary = z.string().max(2000);
const timestamp = z.iso.datetime({ offset: true }).transform(value => new Date(value)).nullable().optional();
const link = z.union([z.string().trim().regex(/^\/(?!\/)[^\s\\\p{Cc}]*$/u), safeHttpUrlSchema]);
const optionalLink = z.string().trim().pipe(z.union([z.literal(''), link])).optional();
const popupCopy = z.looseObject({
  badge: z.string().optional(),
  headline: z.string().optional(),
  description: z.string().optional(),
  highlights: z.array(z.string()).max(4).optional(),
  ctaLabel: z.string().optional(),
  ctaUrl: optionalLink,
  secondaryLabel: z.string().optional(),
  secondaryUrl: optionalLink,
});
const localeCopy = z.looseObject({ title: title.optional(), summary: summary.optional(), popup: popupCopy.optional() });
const i18n = z.looseObject({ en: localeCopy.optional(), ja: localeCopy.optional() });
const popupI18n = z.record(z.string(), z.unknown()).superRefine((translations, ctx) => {
  for (const [locale, translation] of Object.entries(translations)) {
    const copy = object(translation);
    for (const field of ['ctaUrl', 'secondaryUrl'] as const) {
      if (!optionalLink.safeParse(copy[field]).success) ctx.addIssue({ code: 'custom', path: [locale, field], message: '弹窗链接无效' });
    }
  }
});
const popup = popupCopy.extend({ enabled: z.boolean().optional(), version: z.string().optional(), i18n: popupI18n.optional() });
const payload = z.looseObject({
  body: z.string().optional(), url: optionalLink, repository: optionalLink, exhibition: optionalLink,
  cover: z.looseObject({ src: link, width: z.number().int().positive().optional(), height: z.number().int().positive().optional() }).optional(),
  popup: popup.optional(),
});
const status = z.enum(['active', 'archived', 'hidden']);
const eventFields = z.strictObject({ slug, title, summary, status, startsAt: timestamp, endsAt: timestamp, i18n: i18n.optional(), payload: payload.optional() });
const eventCreate = eventFields.extend({ id: slug.optional(), status: status.default('active'), summary: summary.default('') });
const eventPatch = eventFields.partial();

function checkWindow(startsAt?: Date | null, endsAt?: Date | null) {
  if (startsAt && endsAt && endsAt < startsAt) throw new ApiError(422, 'invalid_event_window', '活动结束时间不能早于开始时间');
}

const eventNotFound = () => new ApiError(404, 'event_not_found', '活动不存在');
const eventExists = () => new ApiError(409, 'event_exists', '活动标识或链接已存在');

function mergePayload(previous: JsonObject, input?: z.infer<typeof payload>): JsonObject {
  return { ...previous, ...input, popup: { enabled: true, ...object(previous.popup), ...input?.popup } };
}

function purgeEvents(ctx: AppContext, slugs: string[]) {
  const pages = ['/', '/events', '/events/current', '/events/archive', ...slugs.map(value => `/events/${encodeURIComponent(value)}`)];
  return ctx.services.cloudflare.purgePaths(['', '/zh-hant', '/en', '/ja'].flatMap(prefix => pages.map(page => `${prefix}${page}`)));
}

export function createAdminEventRoutes(ctx: AppContext) {
  const { db } = ctx;
  const routes = new Hono<AdminEnv>();
  routes.get('/events', async c => {
    const items = await db.select().from(events).orderBy(desc(events.startsAt), asc(events.id));
    return c.json({ items, total: items.length });
  });

  routes.get('/events/:id', async c => {
    const [row] = await db.select().from(events).where(eq(events.id, c.req.param('id')));
    if (!row) throw eventNotFound();
    return c.json(row);
  });

  routes.post('/events', async c => {
    const input = eventCreate.parse(await boundedJson(c.req.raw));
    checkWindow(input.startsAt, input.endsAt);
    const row = await db.transaction(async tx => {
      const [created] = await tx.insert(events).values({ ...input, id: input.id ?? input.slug,
        payload: mergePayload({}, input.payload) }).onConflictDoNothing().returning();
      if (!created) throw eventExists();
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'event', entityId: created.id, action: 'create' });
      return created;
    });
    await purgeEvents(ctx, [row.slug]);
    return c.json(row, 201);
  });

  routes.patch('/events/:id', async c => {
    const id = c.req.param('id');
    const input = eventPatch.parse(await boundedJson(c.req.raw));
    if (!Object.keys(input).length) throw new ApiError(422, 'no_changes', '请选择要修改的字段');
    const { row, previousSlug } = await db.transaction(async tx => {
      const [previous] = await tx.select().from(events).where(eq(events.id, id)).for('update');
      if (!previous) throw eventNotFound();
      checkWindow(input.startsAt === undefined ? previous.startsAt : input.startsAt, input.endsAt === undefined ? previous.endsAt : input.endsAt);
      const [updated] = await tx.update(events).set({ ...input,
        ...(input.i18n && { i18n: { ...previous.i18n, ...input.i18n } }),
        ...(input.payload && { payload: mergePayload(previous.payload, input.payload) }),
      }).where(eq(events.id, id)).returning().catch((error: unknown) => {
        const cause = error instanceof Error && error.cause ? error.cause : error;
        if (object(cause).code === '23505') throw eventExists();
        throw error;
      });
      if (!updated) throw eventNotFound();
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'event', entityId: id, action: 'update',
        diff: { fields: Object.keys(input), ...(input.status && { status: { from: previous.status, to: updated.status } }) } });
      return { row: updated, previousSlug: previous.slug };
    });
    await purgeEvents(ctx, [...new Set([previousSlug, row.slug])]);
    return c.json(row);
  });

  routes.delete('/events/:id', async c => {
    const id = c.req.param('id');
    const slug = await db.transaction(async tx => {
      const [row] = await tx.delete(events).where(eq(events.id, id)).returning({ slug: events.slug });
      if (!row) throw eventNotFound();
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'event', entityId: id, action: 'delete' });
      return row.slug;
    });
    await purgeEvents(ctx, [slug]);
    return c.body(null, 204);
  });

  return routes;
}
