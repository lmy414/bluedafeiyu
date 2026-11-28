import { randomBytes, randomUUID } from 'node:crypto';
import { safeHttpUrlSchema } from '@dafeiyu/shared';
import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import { adminUsers, auditEvents, bulkJobs, creators, creatorStatus, notifyOutbox, requestType, submissions, takedownRequests, videos, videoStatus, works } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { writeAudit } from '../../services/audit.js';
import { object } from '../../services/work-data.js';
import { boundedJson } from '../body.js';
import { loadRoles, publishedWorkCounts } from '../public/data.js';
import { likePattern, pageResult, pagination } from '../query.js';
import { apiTokenHash, createAdminAuthRoutes, ownerEmail } from './auth.js';
import type { AdminEnv } from './auth.js';
import { createAdminCatalogRoutes, purgeTaxonomy } from './catalog.js';
import { createAdminEventRoutes } from './events.js';
import { createAdminSubmissionRoutes } from './submissions.js';
import { adminWork, createAdminWorkRoutes, editWork, purgeAfterEdit } from './works.js';

const filters = z.object({ status: z.string().max(50).optional(), q: z.string().trim().max(100).optional() });
const decisionBody = z.strictObject({ decisionNote: z.string().trim().min(1).max(2000), correction: z.record(z.string(), z.unknown()).optional() });

export function createAdminRoutes(ctx: AppContext) {
  const { db, services, config } = ctx;
  const routes = new Hono<AdminEnv>();
  routes.route('/', createAdminAuthRoutes(ctx));
  routes.route('/', createAdminWorkRoutes(ctx));
  routes.route('/', createAdminSubmissionRoutes(ctx));
  routes.route('/', createAdminCatalogRoutes(ctx));
  routes.route('/', createAdminEventRoutes(ctx));

  routes.get('/dashboard', async c => {
    const now = new Date();
    const offset = 8 * 3_600_000;
    const local = new Date(now.valueOf() + offset);
    local.setUTCHours(0, 0, 0, 0);
    const today = new Date(local.valueOf() - offset);
    const weekStart = new Date(+today - ((local.getUTCDay() + 6) % 7) * 86_400_000);
    const auto = and(eq(auditEvents.entityType, 'work'), eq(auditEvents.action, 'publish'), eq(auditEvents.actorType, 'hermes'));
    const health = services.r2.checkBucket(config.R2_MEDIA_BUCKET).then(() => 'ok', () => 'unavailable');
    const [[todayStats], [weekStats], [pending], [manual], recentRows, recentNotifications, r2, totals] = await Promise.all([
      db.select({ total: count() }).from(auditEvents).where(and(auto, gte(auditEvents.createdAt, today))),
      db.select({ total: count() }).from(auditEvents).where(and(auto, gte(auditEvents.createdAt, weekStart))),
      db.select({ total: count() }).from(submissions).where(inArray(submissions.state, ['received', 'reviewing'])),
      db.select({ total: count() }).from(submissions).where(eq(submissions.state, 'needs_manual')),
      db.select({ work: works }).from(auditEvents).innerJoin(works, eq(auditEvents.entityId, works.id)).where(and(auto, eq(works.status, 'published')))
        .orderBy(desc(auditEvents.createdAt)).limit(10),
      db.select().from(notifyOutbox).orderBy(desc(notifyOutbox.createdAt)).limit(15), health, publishedWorkCounts(db),
    ]);
    const recent = recentRows.map(result => result.work);
    const roles = await loadRoles(db, recent);
    return c.json({ autoPublishedToday: todayStats?.total ?? 0, autoPublishedThisWeek: weekStats?.total ?? 0, pendingReview: pending?.total ?? 0, needsManual: manual?.total ?? 0,
      totalViews: totals.totalViews, totalDownloads: totals.totalDownloads,
      recentAutoPublished: recent.map(row => adminWork(ctx, row, roles.get(row.id))), recentNotifications, health: { db: 'ok', r2 } });
  });

  routes.get('/creators', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query);
    const { status, q } = filters.extend({ status: z.enum(creatorStatus.enumValues).optional() }).parse(query);
    const pattern = q && likePattern(q);
    const where = and(status ? eq(creators.status, status) : undefined, pattern ? or(ilike(creators.name, pattern), ilike(creators.uid, pattern)) : undefined);
    const [rows, [total]] = await Promise.all([db.select().from(creators).where(where).orderBy(desc(creators.createdAt), asc(creators.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(creators).where(where)]);
    return c.json(pageResult(rows, total?.total ?? 0, page, pageSize));
  });
  routes.get('/creators/:id', async c => {
    const [row] = await db.select().from(creators).where(eq(creators.id, c.req.param('id')));
    if (!row) throw new ApiError(404, 'creator_not_found', '作者不存在');
    return c.json(row);
  });
  for (const action of ['pause', 'resume', 'sync'] as const) routes.post(`/creators/:id/${action}`, async c => {
    const id = c.req.param('id');
    const row = await db.transaction(async tx => {
      const [previous] = await tx.select().from(creators).where(eq(creators.id, id)).for('update');
      if (!previous) throw new ApiError(404, 'creator_not_found', '作者不存在');
      if (action === 'sync' && previous.status === 'paused') throw new ApiError(409, 'creator_paused', '已暂停的作者须先恢复同步');
      const patch = action === 'pause' ? { status: 'paused' as const, syncLease: null } : { ...(action === 'resume' ? { status: previous.lastSyncedAt ? 'active' as const : 'queued' as const } : {}), retryAt: new Date(), error: null };
      const [updated] = await tx.update(creators).set({ ...patch, updatedAt: new Date() }).where(eq(creators.id, id)).returning();
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'creator', entityId: id, action });
      return updated;
    });
    purgeTaxonomy(ctx, 'creators', id);
    return c.json(row);
  });

  routes.get('/videos', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query);
    const { status, q } = filters.extend({ status: z.enum(videoStatus.enumValues).optional() }).parse(query);
    const pattern = q && likePattern(q);
    const where = and(status ? eq(videos.status, status) : undefined, query.creatorId ? eq(videos.creatorId, query.creatorId) : undefined,
      pattern ? or(ilike(videos.title, pattern), ilike(videos.bvid, pattern)) : undefined);
    const [rows, [total]] = await Promise.all([db.select().from(videos).where(where).orderBy(desc(videos.createdAt), asc(videos.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(videos).where(where)]);
    return c.json(pageResult(rows, total?.total ?? 0, page, pageSize));
  });
  routes.get('/videos/:id', async c => {
    const [row] = await db.select().from(videos).where(eq(videos.id, c.req.param('id')));
    if (!row) throw new ApiError(404, 'video_not_found', '视频不存在');
    return c.json(row);
  });
  for (const action of ['hide', 'restore'] as const) routes.post(`/videos/:id/${action}`, async c => {
    const id = c.req.param('id');
    const status = action === 'hide' ? 'hidden' : 'approved';
    const row = await db.transaction(async tx => {
      const [previous] = await tx.select().from(videos).where(eq(videos.id, id)).for('update');
      if (!previous) throw new ApiError(404, 'video_not_found', '视频不存在');
      if (previous.status === status) return previous;
      if (previous.status !== (action === 'hide' ? 'approved' : 'hidden')) throw new ApiError(409, 'invalid_video_state', '视频当前状态不支持此操作');
      const [updated] = await tx.update(videos).set({ status, lease: null, updatedAt: new Date() }).where(eq(videos.id, id)).returning();
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'video', entityId: id, action });
      return updated ?? previous;
    });
    await services.cloudflare.purgePaths(['', '/zh-hant', '/en', '/ja'].flatMap(prefix => [`${prefix}/videos.html`, `${prefix}/creators/${row.creatorId}.html`]));
    return c.json(row);
  });

  routes.get('/requests', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query);
    const { status, requestType: type } = filters.extend({ requestType: z.enum(requestType.enumValues).optional() }).parse(query);
    const where = and(status ? eq(takedownRequests.status, status) : undefined, type ? eq(takedownRequests.requestType, type) : undefined);
    const [rows, [total]] = await Promise.all([db.select().from(takedownRequests).where(where).orderBy(desc(takedownRequests.createdAt), asc(takedownRequests.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(takedownRequests).where(where)]);
    return c.json(pageResult(rows, total?.total ?? 0, page, pageSize));
  });
  routes.get('/requests/:id', async c => {
    const [row] = await db.select().from(takedownRequests).where(eq(takedownRequests.id, c.req.param('id')));
    if (!row) throw new ApiError(404, 'request_not_found', '申请不存在');
    return c.json(row);
  });
  for (const action of ['approve', 'reject'] as const) routes.post(`/requests/:id/${action}`, async c => {
    const id = c.req.param('id');
    const body = decisionBody.parse(await boundedJson(c.req.raw));
    const actor = { actorType: 'owner' as const, actorId: c.get('owner').id };
    const result = await db.transaction(async tx => {
      const [previous] = await tx.select().from(takedownRequests).where(eq(takedownRequests.id, id)).for('update');
      if (!previous) throw new ApiError(404, 'request_not_found', '申请不存在');
      if (['approved', 'rejected', 'completed'].includes(previous.status)) throw new ApiError(409, 'request_processed', '申请已作出决定');
      const status = action === 'approve' ? 'approved' : 'rejected';
      let progress = { ...previous.agentProgress, stage: 'reply_queued', token: null, expiresAt: 0, decidedBy: 'owner', decision: status };
      let change: Awaited<ReturnType<typeof editWork>> | undefined;
      if (action === 'approve') {
        const [work] = previous.workId ? await tx.select().from(works).where(eq(works.id, previous.workId)).for('update') : [];
        if (!work || work.status === 'deleted') throw new ApiError(422, 'request_work_unavailable', '关联作品不存在或已删除');
        if (previous.requestType === 'takedown') {
          progress = { ...progress, stage: 'awaiting_removal', ...{ expected: { workId: work.id, slug: work.slug, status: 'removed', origin: work.origin, license: work.license } } };
        } else {
          const raw = body.correction;
          const draftOrigin = object(raw?.origin);
          const draftLicense = object(raw?.license);
          const patch = previous.requestType === 'attribution' ? { origin: { ...work.origin, author: z.string().trim().min(1).max(120).parse(raw?.author ?? draftOrigin.author) } } :
            previous.requestType === 'source-correction' ? { origin: { ...work.origin, sourceUrl: safeHttpUrlSchema.parse(raw?.sourceUrl ?? raw?.url ?? draftOrigin.sourceUrl) } } :
              { license: { ...work.license, note: z.string().trim().min(1).max(2000).parse(raw?.licenseNote ?? raw?.note ?? draftLicense.note) } };
          if (work.status !== 'published') throw new ApiError(409, 'request_work_not_published', '更正申请关联作品必须处于上线状态');
          change = await editWork(tx, ctx, work.id, patch, actor);
          progress = { ...progress, ...{ expected: { workId: change.row.id, slug: change.row.slug, status: change.row.status, origin: change.row.origin, license: change.row.license } } };
        }
      }
      const [row] = await tx.update(takedownRequests).set({ status, decisionNote: body.decisionNote,
        agentProgress: progress, updatedAt: new Date() }).where(eq(takedownRequests.id, id)).returning();
      await writeAudit(tx, { ...actor, entityType: 'takedown_request', entityId: id, action, diff: { requestType: previous.requestType, workId: previous.workId } });
      return { row, change, removeId: progress.stage === 'awaiting_removal' ? previous.workId : null };
    });
    if (result.change) await purgeAfterEdit(ctx, result.change);
    if (!result.removeId) return c.json(result.row);
    await services.publish.removeWork(result.removeId, actor);
    const [row] = await db.update(takedownRequests).set({ agentProgress: sql`${takedownRequests.agentProgress} || '{"stage":"reply_queued"}'::jsonb`, updatedAt: new Date() })
      .where(and(eq(takedownRequests.id, id), sql`${takedownRequests.agentProgress}->>'stage'='awaiting_removal'`)).returning();
    return c.json(row ?? result.row);
  });

  routes.get('/bots', async c => {
    const rows = await db.select({ id: adminUsers.id, email: adminUsers.email, lastLoginAt: adminUsers.lastLoginAt, hasKey: sql<boolean>`${adminUsers.apiTokenHash} is not null` })
      .from(adminUsers).where(eq(adminUsers.role, 'bot')).orderBy(asc(adminUsers.email));
    return c.json({ items: rows, total: rows.length });
  });
  routes.post('/bots', async c => {
    const { email } = z.strictObject({ email: ownerEmail }).parse(await boundedJson(c.req.raw));
    const apiKey = randomBytes(32).toString('base64url');
    const id = `bot_${randomUUID()}`;
    await db.transaction(async tx => {
      const [row] = await tx.insert(adminUsers).values({ id, email, role: 'bot', apiTokenHash: apiTokenHash(apiKey) }).onConflictDoNothing().returning({ id: adminUsers.id });
      if (!row) throw new ApiError(409, 'bot_exists', '邮箱已登记');
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'bot', entityId: id, action: 'create' });
    });
    return c.json({ id, email, apiKey }, 201);
  });
  for (const action of ['rotate', 'revoke'] as const) routes.post(`/bots/:id/${action}`, async c => {
    const id = c.req.param('id');
    const apiKey = action === 'rotate' ? randomBytes(32).toString('base64url') : null;
    await db.transaction(async tx => {
      const [row] = await tx.update(adminUsers).set({ apiTokenHash: apiKey ? apiTokenHash(apiKey) : null }).where(and(eq(adminUsers.id, id), eq(adminUsers.role, 'bot'))).returning({ id: adminUsers.id });
      if (!row) throw new ApiError(404, 'bot_not_found', '机器人不存在');
      await writeAudit(tx, { actorType: 'owner', actorId: c.get('owner').id, entityType: 'bot', entityId: id, action });
    });
    return c.json({ id, apiKey });
  });
  routes.get('/bulk-jobs', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query);
    const where = query.status ? eq(bulkJobs.status, query.status) : undefined;
    const [rows, [total]] = await Promise.all([db.select().from(bulkJobs).where(where).orderBy(desc(bulkJobs.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(bulkJobs).where(where)]);
    return c.json(pageResult(rows, total?.total ?? 0, page, pageSize));
  });
  routes.get('/audit-events', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query);
    const kind = z.enum(['owner', 'hermes', 'system']).optional().parse(query.actorType);
    const pattern = query.q && likePattern(query.q.slice(0, 100));
    const where = and(kind ? eq(auditEvents.actorType, kind) : undefined, pattern ? or(ilike(auditEvents.entityId, pattern), ilike(auditEvents.action, pattern), ilike(auditEvents.entityType, pattern)) : undefined);
    const [rows, [total]] = await Promise.all([db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.createdAt), asc(auditEvents.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(auditEvents).where(where)]);
    return c.json(pageResult(rows, total?.total ?? 0, page, pageSize));
  });
  return routes;
}
