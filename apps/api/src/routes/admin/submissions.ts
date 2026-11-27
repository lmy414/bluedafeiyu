import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import { submissions, submissionSource, submissionState, works } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { writeAudit } from '../../services/audit.js';
import { submissionChange } from '../../services/publish.js';
import { boundedJson } from '../body.js';
import { likePattern, pageResult, pagination } from '../query.js';
import type { AdminEnv } from './auth.js';
import { manualWorkFields } from './works.js';

export function createAdminSubmissionRoutes(ctx: AppContext) {
  const { db, config, services } = ctx;
  const routes = new Hono<AdminEnv>();
  routes.get('/submissions', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query);
    const parsed = z.object({ state: z.enum(submissionState.enumValues).optional(), source: z.enum(submissionSource.enumValues).optional() }).safeParse(query);
    if (!parsed.success) throw new ApiError(400, 'invalid_submission_filters', '投稿状态或渠道无效');
    const { state, source } = parsed.data;
    const q = query.q && likePattern(query.q.slice(0, 100));
    const where = and(state ? eq(submissions.state, state) : undefined, source ? eq(submissions.source, source) : undefined,
      q ? or(ilike(submissions.id, q), sql`${submissions.fields}->>'name' ILIKE ${q}`, sql`${submissions.editorial}->>'name' ILIKE ${q}`) : undefined);
    const [rows, [total]] = await Promise.all([db.select().from(submissions).where(where).orderBy(desc(submissions.createdAt), asc(submissions.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(submissions).where(where)]);
    return c.json(pageResult(rows, total?.total ?? 0, page, pageSize));
  });
  routes.get('/submissions/:id', async c => {
    const [row] = await db.select().from(submissions).where(eq(submissions.id, c.req.param('id')));
    if (!row) throw new ApiError(404, 'submission_not_found', '投稿不存在');
    let originalUrl = row.r2StagingKey && row.state !== 'published' ? await services.r2.signReadUrl(config.R2_STAGING_BUCKET, row.r2StagingKey) : null;
    if (row.workId) {
      const [work] = await db.select({ status: works.status, key: works.r2OriginalKey }).from(works).where(eq(works.id, row.workId));
      if (work && !['removed', 'deleted'].includes(work.status)) originalUrl = services.r2.publicUrl(work.key);
    }
    return c.json({ ...row, originalUrl });
  });
  routes.post('/submissions/:id/publish', async c => {
    const id = c.req.param('id');
    const actorId = c.get('owner').id;
    const editorial = manualWorkFields(await boundedJson(c.req.raw));
    const work = await services.publish.autoPublishSubmission(id, { actorType: 'owner', actorId }, editorial);
    return c.json({ id, state: 'published', workId: work.id, work });
  });
  for (const action of ['reject', 'retry'] as const) routes.post(`/submissions/:id/${action}`, async c => {
    const id = c.req.param('id');
    const actorId = c.get('owner').id;
    const body = z.strictObject({ reason: z.string().trim().max(2000).optional() }).parse(await boundedJson(c.req.raw));
    const row = await db.transaction(async tx => {
      const [previous] = await tx.select().from(submissions).where(eq(submissions.id, id)).for('update');
      if (!previous) throw new ApiError(404, 'submission_not_found', '投稿不存在');
      if (previous.state === 'published') throw new ApiError(409, 'submission_published', '已上线投稿须在作品库处理');
      const state = action === 'retry' ? 'received' : 'rejected';
      const [updated] = await tx.update(submissions).set({ ...submissionChange(previous, state, 'owner', new Date(), body.reason),
        agentProgress: action === 'retry' ? {} : { ...previous.agentProgress, token: null, expiresAt: 0 } }).where(eq(submissions.id, id)).returning();
      await writeAudit(tx, { actorType: 'owner', actorId, entityType: 'submission', entityId: id, action, diff: { reason: body.reason } });
      return updated;
    });
    return c.json({ submission: row });
  });
  return routes;
}
