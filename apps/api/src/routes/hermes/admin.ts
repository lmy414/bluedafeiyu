import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { adminUsers, auditEvents, bulkJobs, submissions, topics, workCharacters, works } from '../../db/schema.js';
import { refreshWorkRevision } from '../../services/publish.js';
import { getImage, purgeTopic, vocabulary, workDraft } from './context.js';
import type { HermesContext } from './context.js';
import { contentOnly, sourceHash, topicLocale, validateContent, validateI18n, validateLocale, workTypeRules } from './editorial.js';
import { available, claimLease, fail, imageResponse, json, leaseMs, ownLease, releaseLease, topicHash } from './protocol.js';
import type { Wire } from './protocol.js';

const operations = ['ai-fill', 'translate', 'manual-include', 'translate-topic'];
const runnable = ['queued', 'running'];
type Job = typeof bulkJobs.$inferSelect;

function details(row: Job) {
  const payload: Wire = row.payload;
  const progress: Wire = row.progress;
  const options: Wire = payload.options || payload;
  const agent: Wire = progress.agent || options.agent || {};
  const operation = payload.operation || row.kind;
  const target = payload.target || (operation === 'translate-topic' ? 'topics' : operation === 'manual-include' ? 'submissions' : 'works');
  const ids: string[] = payload.ids || [];
  const cursor: number = progress.cursor ?? payload.cursor ?? 0;
  return { operation, target, ids, cursor, id: ids[cursor], options, agent, progress };
}

export async function adminAgent(ctx: HermesContext, body: Wire) {
  const { db, config, services } = ctx;
  const now = Date.now();
  if (body.action === 'rules') {
    const vocab = await vocabulary(db);
    return json({ characters: vocab.characters, categories: vocab.categories, rules: workTypeRules });
  }
  if (body.action === 'list') {
    const rows = await db.select().from(bulkJobs).where(inArray(bulkJobs.status, runnable)).orderBy(asc(bulkJobs.createdAt));
    return json({ jobs: rows.flatMap(row => {
      const job = details(row);
      if (!operations.includes(job.operation) || !job.id || (job.target === 'topics') !== (body.target === 'topics') || !available(job.agent, now)) return [];
      return [{ jobId: row.id, operation: job.operation, target: job.target, id: job.id, stage: job.agent.stage || 'queued', batchId: job.agent.batchId || job.options.batchId || null }];
    }).slice(0, 20) });
  }
  if (!/^[a-f0-9-]{36}$/.test(body.jobId || '')) fail('任务编号非法', 400);
  let edit: { work: typeof works.$inferSelect; previous: typeof works.$inferSelect; roles: string[] } | undefined;
  let topicId: string | undefined;
  let publication: { submissionId: string; jobId: string; token: string; cursor: number; result: Wire; status: string } | undefined;
  const response = await db.transaction(async tx => {
    const [row] = await tx.select().from(bulkJobs).where(eq(bulkJobs.id, body.jobId)).for('update');
    if (!row) fail('Agent 任务不存在', 404);
    const job = details(row);
    const { operation, target, id, cursor, options } = job;
    if (!operations.includes(operation)) fail('Agent 任务不存在', 404);
    if (!runnable.includes(row.status) || !id) fail('任务已结束或取消');
    const requestedBy = String(row.payload.requestedBy || options.requestedBy || '');
    const [user] = await tx.select({ role: adminUsers.role }).from(adminUsers).where(eq(adminUsers.id, requestedBy));
    if (user?.role !== 'owner') fail('任务提交者不再具有站长权限', 403);
    const pending = job.progress.pendingPublication;
    if (pending && body.action === 'complete' && body.id === id && body.token && pending.token === body.token) {
      publication = pending;
      return json({ ok: true, status: pending.status, result: pending.result });
    }
    const [work] = target === 'works' ? await tx.select().from(works).where(eq(works.id, id)).for('update') : [];
    const [submission] = target === 'submissions' ? await tx.select().from(submissions).where(eq(submissions.id, id)).for('update') : [];
    const [topic] = target === 'topics' ? await tx.select().from(topics).where(eq(topics.id, id)).for('update') : [];
    const doc = work || submission || topic;
    if (!doc) fail('内容已修改，请取消旧任务后重新提交');
    const revision = work?.revision || (topic ? topicHash(topic.name, topic.summary) : doc.updatedAt.toISOString());
    const expected = options.versions?.[id] ?? job.agent.version;
    if (expected && expected !== revision) fail('内容已修改，请取消旧任务后重新提交');
    const raw: Wire = submission?.fields || {};
    const base: Wire = work ? await workDraft(tx, work) : topic ? { name: topic.name, summary: topic.summary, i18n: topic.i18n }
      : { name: raw.name || '', description: raw.description || '', commentary: '', characterId: raw.characterId || raw.character || raw.characterIds?.[0] || '',
          characterIds: raw.characterIds || [raw.characterId || raw.character].filter(Boolean), categoryIds: raw.categoryIds || (raw.categoryId ? [raw.categoryId] : []), tags: raw.tags || [],
          ...(submission?.review.content as Wire), ...submission?.editorial, origin: submission?.origin || {}, license: {} };
    if (!topic) Object.assign(base, options.patch || {}, options.drafts?.[id] || {}, options.checkpoints?.[id] || {});
    const hashOf = (value: Wire) => topic ? topicHash(value.name, value.summary) : sourceHash(value);
    base.i18n = base.i18n?.sourceHash === hashOf(base) ? base.i18n : { sourceHash: hashOf(base) };
    let agent = job.agent;
    let draft: Wire = agent.draft || base;
    const save = (patch: Partial<typeof bulkJobs.$inferInsert>) => tx.update(bulkJobs).set({ ...patch, updatedAt: new Date() }).where(eq(bulkJobs.id, row.id));
    const audit = () => tx.insert(auditEvents).values({ actorType: 'hermes', actorId: requestedBy, entityType: target, entityId: id,
      action: `agent.${body.action}`, diff: { jobId: row.id, stage: agent.stage, language: body.language },
    });
    if (body.action === 'claim') {
      if (!available(agent, now)) fail('任务暂不可领取');
      agent = { ...claimLease(agent, body, now, topic ? 'translating' : 'editing'), draft, version: revision };
      await save({ status: 'running', progress: { ...job.progress, agent } });
    } else {
      ownLease(agent, body.token, now, '任务领取已过期、取消或由其他处理者接手');
      if (body.id !== id) fail('任务游标已推进，请重新领取');
      if (!topic && ['draft', 'locale', 'validate', 'complete'].includes(body.action) && agent.imageToken !== body.token) fail('请先读取本次任务图片', 422);
      if (body.action === 'image') {
        const image = work ? await getImage(ctx, config.R2_MEDIA_BUCKET, work.r2DisplayKey) || await getImage(ctx, config.R2_MEDIA_BUCKET, work.r2OriginalKey)
          : submission && await getImage(ctx, config.R2_STAGING_BUCKET, submission.r2StagingKey);
        if (!image) fail('图片不可用，不能凭空生成', 422);
        const png = await sharp(image.bytes).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        ownLease(agent, body.token, Date.now(), '任务领取已过期、取消或由其他处理者接手');
        await save({ progress: { ...job.progress, agent: { ...agent, draft, imageToken: body.token, expiresAt: Date.now() + leaseMs } } });
        return imageResponse(png, 'image/png');
      }
      if (body.action === 'draft') {
        if (topic) {
          if (body.content?.i18n) fail('请分语言提交译文', 422);
          const { name, summary } = topicLocale(body.content, 'zh');
          if (name !== base.name || summary !== base.summary) fail('翻译任务不能修改中文名称或简介', 422);
        } else {
          const checked = validateContent(body.content, await vocabulary(tx));
          for (const [key, value] of Object.entries(contentOnly(base))) {
            const filled = key === 'description' ? Boolean(String(value || '').trim()) && !/^首批收录自蓝色大肥鱼档案馆|原投稿未逐张命名|^GitHub Issue #\d+ 多图投稿/.test(String(value))
              : Array.isArray(value) ? value.length > 0 : Boolean(value);
            if ((operation === 'translate' || filled) && !isDeepStrictEqual(value, (checked as Wire)[key]))
              fail(operation === 'translate' ? '翻译任务不能修改中文字段' : `已有 ${key} 不允许自动覆盖`, 422);
          }
          draft = { ...draft, ...checked };
        }
        if (draft.i18n?.sourceHash !== hashOf(draft)) draft = { ...draft, i18n: { sourceHash: hashOf(draft) } };
      } else if (body.action === 'locale') {
        if (body.sourceHash !== hashOf(draft)) fail('中文版本已变化');
        if (!['en', 'ja'].includes(body.language)) fail('语言只接受 en 或 ja', 400);
        const locale = topic ? topicLocale(body.content, body.language) : validateLocale(body.content, body.language, draft);
        draft = { ...draft, i18n: { ...draft.i18n, sourceHash: body.sourceHash, [body.language]: locale } };
      } else if (body.action === 'release') {
        agent = releaseLease(agent, body.reason, now);
      } else if (['complete', 'validate'].includes(body.action)) {
        if (topic) {
          if (draft.i18n?.sourceHash !== hashOf(draft)) fail('译文与当前中文不一致，请重新生成');
          topicLocale(draft.i18n?.en, 'en');
          topicLocale(draft.i18n?.ja, 'ja');
        } else {
          validateContent(contentOnly(draft), await vocabulary(tx), operation === 'manual-include');
          validateI18n(draft.i18n, draft);
        }
        if (body.action === 'complete') {
          const suggestion = topic ? { name: draft.name, summary: draft.summary, i18n: draft.i18n } : { ...contentOnly(draft), i18n: draft.i18n };
          const result = { id, status: 'succeeded', message: options.suggestOnly ? 'Hermes 建议已生成，请核对后保存' : topic ? '英日译文已保存' : work ? '已保存' : '草稿已保存，原投稿和 AI 结论未修改', ...(options.suggestOnly && { suggestion }) };
          const results = Array.isArray(row.result.results) ? row.result.results : [];
          const status = cursor + 1 < job.ids.length ? 'running' : results.some((entry: Wire) => entry.status === 'failed') ? 'partial' : 'succeeded';
          if (!options.suggestOnly) {
            if (work) {
              const [updated] = await tx.update(works).set({ name: draft.name, description: draft.description, commentary: draft.commentary,
                primaryCharacterId: draft.characterId, categoryId: draft.categoryIds[0], tags: draft.tags, i18n: draft.i18n, updatedAt: new Date(),
              }).where(eq(works.id, id)).returning();
              await tx.delete(workCharacters).where(eq(workCharacters.workId, id));
              await tx.insert(workCharacters).values(draft.characterIds.map((characterId: string) => ({ workId: id, characterId })));
              edit = { work: await refreshWorkRevision(tx, config, updated!), previous: work, roles: base.characterIds };
            } else if (topic) {
              await tx.update(topics).set({ i18n: draft.i18n, updatedAt: new Date() }).where(eq(topics.id, id));
              topicId = id;
            } else if (submission) {
              const include = operation === 'manual-include';
              if (include) {
                if (submission.review.legacyPreview) fail('发布前请补齐可核验的投稿原图');
                const [existing] = submission.sha256 ? await tx.select({ id: works.id }).from(works).where(eq(works.sha256, submission.sha256)) : [];
                if (existing && (submission.state !== 'published' || submission.workId !== existing.id)) fail('同图作品已存在，请人工确认关联');
                publication = { submissionId: id, jobId: row.id, token: body.token, cursor, result, status };
              }
              await tx.update(submissions).set({ editorial: { ...submission.editorial, ...suggestion }, updatedAt: new Date(),
                ...(include && !['approved', 'published'].includes(submission.state) && { state: 'approved' as const, stateHistory: [...submission.stateHistory, { from: submission.state, to: 'approved', event: 'manual-include', actor: requestedBy, at: new Date(now).toISOString() }] }),
              }).where(eq(submissions.id, id));
            }
          }
          const checkpoints = { ...job.progress.checkpoints, [id]: suggestion };
          if (publication) await save({ progress: { ...job.progress, checkpoints, pendingPublication: publication } });
          else await save({ status, progress: { ...job.progress, checkpoints, cursor: cursor + 1, agent: {}, pendingPublication: null }, result: { ...row.result, results: [...results, result] } });
          await audit();
          return json({ ok: true, status, result });
        }
      } else if (body.action !== 'get') fail('未知工具操作', 400);
      if (!['get', 'validate'].includes(body.action)) {
        if (body.action !== 'release') agent = { ...agent, draft, expiresAt: now + leaseMs, stage: draft.i18n?.en && draft.i18n?.ja ? 'ready' : 'translating' };
        await save({ progress: { ...job.progress, agent } });
      }
    }
    if (['claim', 'draft', 'locale', 'release'].includes(body.action)) await audit();
    return json({ ok: true, jobId: row.id, operation, target, id, cursor, stage: agent.stage || 'queued', draft, suggestOnly: options.suggestOnly === true,
      ...(body.action === 'claim' && { token: agent.token }),
    });
  });
  if (edit) await services.publish.purgeWorkCaches(edit.work, edit.previous, edit.roles);
  if (topicId) await purgeTopic(ctx, topicId);
  if (publication) {
    const { submissionId, jobId, token, cursor, result, status } = publication;
    await services.publish.autoPublishSubmission(submissionId);
    await db.transaction(async tx => {
      const [current] = await tx.select().from(bulkJobs).where(eq(bulkJobs.id, jobId)).for('update');
      const pending = (current?.progress as Wire)?.pendingPublication;
      if (!current || pending?.token !== token || pending.cursor !== cursor) return;
      const results = Array.isArray(current.result.results) ? current.result.results : [];
      await tx.update(bulkJobs).set({ status, updatedAt: new Date(), progress: { ...current.progress, cursor: cursor + 1, agent: {}, pendingPublication: null }, result: { ...current.result, results: [...results, result] } }).where(eq(bulkJobs.id, jobId));
    });
  }
  return response;
}
