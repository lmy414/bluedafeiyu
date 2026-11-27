import { validateTrilingualCompleteness } from '@dafeiyu/shared';
import { asc, eq } from 'drizzle-orm';
import { submissions } from '../../db/schema.js';
import type { SubmissionRow } from '../../db/schema.js';
import { getImage, vocabulary } from './context.js';
import type { HermesContext } from './context.js';
import { contentOnly, sourceHash, validateContent, validateI18n, validateLocale, validateReview, workTypeRules } from './editorial.js';
import { available, claimLease, fail, finishBatch, imageResponse, json, leaseMs, ownLease, releaseLease } from './protocol.js';
import type { Wire } from './protocol.js';

function view(item: SubmissionRow, progress: Wire = item.agentProgress) {
  const history = Array.isArray(progress.batchHistory) ? progress.batchHistory.slice(-20) : [];
  const latest = history.at(-1);
  return {
    id: item.id, source: item.source, fields: item.fields, origin: item.origin, state: item.state,
    stage: progress.stage || 'queued', attempt: progress.attempt || 0,
    draft: progress.draft || null, review: progress.review || null, lastError: progress.lastError || null,
    batchId: latest?.batchId || progress.batchId || null, batchLabel: latest?.batchLabel || progress.batchLabel || null,
    sourceKind: latest?.sourceKind || progress.sourceKind || null, batchHistory: history,
  };
}

export async function submissionAgent(ctx: HermesContext, body: Wire) {
  const { db, services } = ctx;
  const now = Date.now();
  if (body.action === 'list') {
    const items = await db.select().from(submissions).where(eq(submissions.state, 'received')).orderBy(asc(submissions.createdAt)).limit(200);
    return json({ ok: true, items: items.filter(item => available(item.agentProgress, now)).slice(0, 20).map(item => view(item)) });
  }
  if (body.action === 'rules') {
    const vocab = await vocabulary(db);
    return json({ ok: true, characterIds: [...vocab.characterIds], categoryIds: [...vocab.categoryIds], rules: workTypeRules + '\ncharacterIds 必须是非空、无重复的合法角色数组，标明画面中同时出现的所有已确认角色，不得猜测不存在的角色。characterId 必须在集合中（默认第一项），仅用于新图目录，不改变已发布图片路径。' });
  }
  if (!/^sub_[A-Za-z0-9_-]{1,64}$/.test(body.id || '')) fail('投稿 ID 非法', 400);
  const result = await db.transaction(async tx => {
    const [item] = await tx.select().from(submissions).where(eq(submissions.id, body.id)).for('update');
    if (!item) fail('条目不存在', 404);
    let progress: Wire = item.agentProgress;
    const persisted: Wire = item.review;
    if (body.action === 'complete' && item.state !== 'received' && body.token && progress.completedToken === body.token && persisted.decidedBy === 'hermes') {
      return { completed: true, item, review: persisted, duplicate: true } as const;
    }
    if (item.state !== 'received') fail(body.action === 'claim' ? '条目不允许 Agent 处理' : '任务已过期或已由其他处理者领取');
    const save = (agentProgress: Wire) => tx.update(submissions).set({ agentProgress, updatedAt: new Date() }).where(eq(submissions.id, item.id));
    if (body.action === 'claim') {
      if (!available(progress, now)) fail(progress.expiresAt > now ? '任务正在处理' : '条目暂挂，需站长检查后重试');
      progress = claimLease(progress, body, now, progress.draft ? 'translating' : 'reviewing');
      await save(progress);
      return json({ ok: true, ...view(item, progress), token: progress.token, expiresAt: progress.expiresAt });
    }
    ownLease(progress, body.token, now, '任务已过期或已由其他处理者领取');
    if (body.action === 'get') return json({ ok: true, ...view(item) });
    if (body.action === 'image') {
      const image = await getImage(ctx, ctx.config.R2_STAGING_BUCKET, item.r2StagingKey);
      if (!image) fail('原图不可用', 410);
      ownLease(progress, body.token, Date.now(), '任务已过期或已由其他处理者领取');
      await save({ ...progress, imageToken: body.token, expiresAt: Date.now() + leaseMs });
      return imageResponse(image.bytes, image.mime);
    }
    if (body.action === 'release') {
      progress = releaseLease(progress, body.reason, now, 'Agent 本轮未完成');
      await save(progress);
      return json({ ok: true, ...view(item, progress) });
    }
    if (['draft', 'validate', 'complete'].includes(body.action) && progress.imageToken !== body.token) fail('请先读取本次领取任务的图片', 422);
    const draft = progress.draft;
    if (body.action === 'draft') {
      const checked = validateContent(body.content, await vocabulary(tx));
      const review = validateReview(body.review, '审核结论、置信度或理由非法');
      const hash = sourceHash({ ...checked, origin: item.origin });
      const i18n = draft?.i18n?.sourceHash === hash ? draft.i18n : { sourceHash: hash };
      progress = { ...progress, review, draft: { ...checked, i18n }, stage: 'translating', expiresAt: now + leaseMs };
    } else if (body.action === 'locale') {
      if (!draft || !['en', 'ja'].includes(body.language)) fail('请先保存中文草稿，再提交 en 或 ja', 422);
      const source = { ...draft, origin: item.origin };
      const hash = sourceHash(source);
      if (hash !== body.sourceHash) fail('中文版本已变化，请重新读取后翻译');
      const i18n = { ...draft.i18n, sourceHash: hash, [body.language]: validateLocale(body.content, body.language, source) };
      progress = { ...progress, draft: { ...draft, i18n }, stage: i18n.en && i18n.ja ? 'ready' : 'translating', expiresAt: now + leaseMs };
    } else if (['validate', 'complete'].includes(body.action)) {
      const result = validateReview(body.review || progress.review);
      const pass = result.verdict === 'pass';
      if (pass) {
        validateContent(draft && contentOnly(draft), await vocabulary(tx), true);
        validateI18n(draft.i18n, { ...draft, origin: item.origin });
        const complete = validateTrilingualCompleteness({ ...draft, i18n: { en: draft.i18n.en, ja: draft.i18n.ja } });
        if (!complete.success) {
          const issue = complete.error.issues[0];
          fail(issue?.message || '作品三语内容不完整', 422, issue?.path.join('.') || null);
        }
        if (body.action === 'complete' && result.confidence < Number(process.env.SUBMISSION_AI_MIN_CONFIDENCE || 0.6))
          fail('初审置信度不足，请判断是否需要人工复核', 422);
      }
      if (body.action === 'validate') return json({ ok: true, ready: true, result: { ...result, content: pass ? draft : null }, item: view(item) });
      const state = pass ? 'auto_passed' : result.verdict === 'reject' ? 'auto_rejected' : 'needs_manual';
      const review = { ...result, content: pass ? draft : null, schema: pass ? 'submission-ai-content/2' : null, model: 'hermes-agent', decidedBy: 'hermes', reason: result.reason.trim() };
      const at = new Date(now).toISOString();
      progress = {
        ...finishBatch(progress, now, { status: 'completed', verdict: result.verdict }),
        token: null, expiresAt: 0, completedToken: body.token, stage: 'completed',
      };
      const [updated] = await tx.update(submissions).set({
        state, review, agentProgress: progress,
        editorial: pass ? { ...item.editorial, ...draft } : item.editorial,
        stateHistory: [...item.stateHistory, { event: 'review.start', from: item.state, to: 'reviewing', actor: 'hermes', at, reason: '' },
          { event: `review.${result.verdict}`, from: 'reviewing', to: state, actor: 'hermes', at, reason: review.reason }],
        updatedAt: new Date(now),
      }).where(eq(submissions.id, item.id)).returning();
      return { completed: true, item: updated!, review: review as Wire, duplicate: false } as const;
    } else fail('未知 Agent 操作', 400);
    await save(progress);
    return json({ ok: true, ...view(item, progress) });
  });
  if (result instanceof Response) return result;
  const { item, review, duplicate } = result;
  if (review.verdict === 'pass' && item.state === 'auto_passed') await services.publish.autoPublishSubmission(item.id);
  const [stored] = await db.select({ state: submissions.state }).from(submissions).where(eq(submissions.id, item.id));
  return json({ ok: true, id: item.id, state: stored?.state ?? item.state, duplicate, verdict: review.verdict, confidence: review.confidence, bridge: null,
    ...(duplicate && { reason: review.reason, model: review.model }),
  });
}
