import { categoryIdSchema, validateTrilingualCompleteness, workEditSchema } from '@dafeiyu/shared';
import { and, arrayContains, asc, count, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import type { DbTransaction } from '../../db/client.js';
import { workCharacters, workKind, workSearchText, workStatus, works } from '../../db/schema.js';
import type { JsonObject, WorkRow } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { writeAudit } from '../../services/audit.js';
import { MAX_IMAGE_BYTES } from '../../services/image.js';
import { refreshWorkRevision, resolveTaxonomy } from '../../services/publish.js';
import type { Actor } from '../../services/publish.js';
import { object, uniqueStrings } from '../../services/work-data.js';
import { boundedForm, boundedJson } from '../body.js';
import { formFields } from '../public/submissions.js';
import { hasCharacter, loadRoles } from '../public/data.js';
import { likePattern, pageResult, pagination } from '../query.js';
import type { AdminEnv } from './auth.js';

const objectField = z.record(z.string(), z.unknown());
export const workPatchSchema = z.strictObject({ ...workEditSchema.shape,
  description: z.string().trim().max(2000).nullable().optional(), commentary: z.string().trim().max(2000).nullable().optional(),
  kind: z.enum(workKind.enumValues).optional(), channel: z.string().trim().max(50).optional(),
  origin: objectField.nullable().optional(), license: objectField.nullable().optional(), submitter: objectField.nullable().optional(),
}).refine(value => !value.primaryCharacterId || !value.characterIds || value.characterIds.includes(value.primaryCharacterId), { path: ['characterIds'], message: '角色列表必须包含主角色' });
type WorkPatch = z.output<typeof workPatchSchema>;
const bulkSchema = z.strictObject({ ids: z.array(z.string().min(1).max(100)).min(1).max(100), categoryId: categoryIdSchema.optional(),
  primaryCharacterId: z.string().min(1).max(64).optional(), characterIds: z.array(z.string().min(1).max(64)).min(1).max(24).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(), });

export function adminWork(ctx: AppContext, row: WorkRow, characterIds = [row.primaryCharacterId]) {
  const media = row.status !== 'deleted' && row.status !== 'removed';
  return { ...row, characterIds, image: media ? {
    originalUrl: ctx.services.r2.publicUrl(row.r2OriginalKey), thumbnailUrl: ctx.services.r2.publicUrl(row.r2ThumbKey), displayUrl: ctx.services.r2.publicUrl(row.r2DisplayKey),
  } : null };
}

export function purgeAfterEdit(ctx: AppContext, change: { row: WorkRow; previous: WorkRow; previousCharacters: string[] }) {
  return ctx.services.publish.purgeWorkCaches(change.row, change.previous, change.previousCharacters).catch(error => console.error('Work cache purge failed', error));
}

export async function editWork(tx: DbTransaction, ctx: AppContext, id: string, patch: WorkPatch, actor: Actor) {
  const [previous] = await tx.select().from(works).where(eq(works.id, id)).for('update');
  if (!previous) throw new ApiError(404, 'work_not_found', '作品不存在');
  if (previous.status === 'deleted') throw new ApiError(409, 'work_deleted', '已删除作品不可编辑');
  const roles = await tx.select({ id: workCharacters.characterId }).from(workCharacters).where(eq(workCharacters.workId, id)).orderBy(asc(workCharacters.characterId));
  const previousCharacters = uniqueStrings([previous.primaryCharacterId, ...roles.map(role => role.id)]);
  const primary = patch.primaryCharacterId ?? patch.characterIds?.[0] ?? previous.primaryCharacterId;
  const characterIds = uniqueStrings(patch.characterIds ?? [primary, ...previousCharacters]);
  const category = patch.categoryId ?? previous.categoryId;
  if (patch.primaryCharacterId || patch.characterIds || patch.categoryId) await resolveTaxonomy(tx, primary, characterIds, category, false);
  const next = { ...previous, ...patch, kind: patch.kind ?? previous.kind, channel: patch.channel ?? previous.channel, i18n: patch.i18n ?? previous.i18n, name: patch.name ?? previous.name,
    primaryCharacterId: primary, categoryId: category, tags: uniqueStrings(patch.tags ?? previous.tags),
    description: patch.description === undefined ? previous.description : patch.description ?? '', commentary: patch.commentary === undefined ? previous.commentary : patch.commentary ?? '',
    submitter: patch.submitter === undefined ? previous.submitter : patch.submitter ?? {}, origin: patch.origin === undefined ? previous.origin : patch.origin ?? {},
    license: patch.license === undefined ? previous.license : patch.license ?? {}, updatedAt: new Date() };
  if (previous.status === 'published' && (patch.name !== undefined || patch.description !== undefined || patch.commentary !== undefined || patch.i18n !== undefined)) {
    const { en, ja } = object(next.i18n);
    const result = validateTrilingualCompleteness({ ...next, i18n: { en, ja } });
    if (!result.success) throw new ApiError(422, 'invalid_translations', '作品三语内容不完整', result.error.issues);
  }
  const { characterIds: _, ...rowValues } = next;
  await tx.update(works).set(rowValues).where(eq(works.id, id));
  if (patch.primaryCharacterId || patch.characterIds) {
    await tx.delete(workCharacters).where(eq(workCharacters.workId, id));
    await tx.insert(workCharacters).values(characterIds.map(characterId => ({ workId: id, characterId })));
  }
  const row = await refreshWorkRevision(tx, ctx.config, next);
  await writeAudit(tx, { ...actor, entityType: 'work', entityId: id, action: 'edit', diff: { fields: Object.keys(patch) } });
  return { row, characterIds, previous, previousCharacters };
}

export function createAdminWorkRoutes(ctx: AppContext) {
  const routes = new Hono<AdminEnv>();
  const { db, services } = ctx;
  routes.get('/works', async c => {
    const query = c.req.query();
    const { page, pageSize, offset } = pagination(query);
    const parsed = z.object({ status: z.enum(workStatus.enumValues).optional(), kind: z.enum(workKind.enumValues).optional() }).safeParse(query);
    if (!parsed.success) throw new ApiError(400, 'invalid_work_filters', '作品状态或类型无效');
    const { status, kind } = parsed.data;
    const q = query.q && likePattern(query.q.slice(0, 100));
    const where = and(status ? eq(works.status, status) : undefined, kind ? eq(works.kind, kind) : undefined,
      query.character ? hasCharacter(query.character) : undefined, query.category ? eq(works.categoryId, query.category) : undefined,
      query.channel ? eq(works.channel, query.channel) : undefined, query.tag ? arrayContains(works.tags, [query.tag]) : undefined,
      q ? or(ilike(workSearchText(works), q), ilike(works.id, q), ilike(works.slug, q)) : undefined);
    const [rows, [total]] = await Promise.all([db.select().from(works).where(where).orderBy(desc(works.createdAt), asc(works.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(works).where(where)]);
    const roles = await loadRoles(db, rows);
    return c.json(pageResult(rows.map(work => adminWork(ctx, work, roles.get(work.id))), total?.total ?? 0, page, pageSize));
  });
  routes.post('/works', async c => {
    const form = await boundedForm(c.req.raw, MAX_IMAGE_BYTES + 256 * 1024);
    const file = form.get('file') ?? form.get('image');
    if (!(file instanceof File)) throw new ApiError(422, 'image_required', '请选择要收录的原图');
    const input = formFields(form);
    const fields = object(input);
    const kind = z.enum(workKind.enumValues).optional().parse(input.kind);
    const row = await services.publish.publishWorkDirect({ bytes: Buffer.from(await file.arrayBuffer()), fields, kind, channel: 'manual' }, { actorType: 'owner', actorId: c.get('owner').id });
    return c.json(adminWork(ctx, row, (await loadRoles(db, [row])).get(row.id)), 201);
  });
  routes.patch('/works/bulk', async c => {
    const parsed = bulkSchema.safeParse(await boundedJson(c.req.raw));
    if (!parsed.success) throw new ApiError(422, 'invalid_work_patch', '批量修改字段无效', parsed.error.issues);
    const { ids, ...patch } = parsed.data;
    if (!Object.keys(patch).length) throw new ApiError(422, 'no_changes', '请选择要修改的字段');
    const changes = await db.transaction(async tx => {
      const applied = [];
      for (const id of uniqueStrings(ids).sort()) applied.push(await editWork(tx, ctx, id, patch, { actorType: 'owner', actorId: c.get('owner').id }));
      return applied;
    });
    void Promise.all(changes.map(change => purgeAfterEdit(ctx, change)));
    return c.json({ updated: changes.length });
  });
  routes.get('/works/:id', async c => {
    const [row] = await db.select().from(works).where(eq(works.id, c.req.param('id')));
    if (!row) throw new ApiError(404, 'work_not_found', '作品不存在');
    return c.json(adminWork(ctx, row, (await loadRoles(db, [row])).get(row.id)));
  });
  routes.patch('/works/:id', async c => {
    const result = workPatchSchema.safeParse(await boundedJson(c.req.raw));
    if (!result.success) throw new ApiError(422, 'invalid_work_patch', '作品修改字段无效', result.error.issues);
    const change = await db.transaction(tx => editWork(tx, ctx, c.req.param('id'), result.data, { actorType: 'owner', actorId: c.get('owner').id }));
    void purgeAfterEdit(ctx, change);
    return c.json(adminWork(ctx, change.row, change.characterIds));
  });
  for (const [action, operation] of Object.entries({ hide: services.publish.hideWork, restore: services.publish.restoreWork, remove: services.publish.removeWork })) {
    routes.post(`/works/:id/${action}`, async c => c.json(adminWork(ctx, await operation(c.req.param('id'), { actorType: 'owner', actorId: c.get('owner').id }))));
  }
  routes.delete('/works/:id', async c => {
    await services.publish.deleteWork(c.req.param('id'), { actorType: 'owner', actorId: c.get('owner').id });
    return c.body(null, 204);
  });
  return routes;
}

export function manualWorkFields(input: unknown): JsonObject {
  const draft = workPatchSchema.safeParse(input);
  if (!draft.success) throw new ApiError(422, 'invalid_work_fields', '人工收录字段无效', draft.error.issues);
  return draft.data;
}
