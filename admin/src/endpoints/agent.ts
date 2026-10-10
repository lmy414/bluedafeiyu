/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import sharp from 'sharp'
import type { Endpoint, PayloadRequest } from 'payload'
import { json, readJsonBody, requireWorker } from '../lib/endpoint-auth'
import {
  contentOnly,
  draftOf,
  fingerprint,
  loadVocabulary,
  RUNNABLE,
  stepJob,
  targetDoc,
} from '../lib/bulk-jobs'
import { validateContent } from '../lib/sync-submissions'
import { sourceHash, validateLocale, validateI18n } from '../lib/localization.mjs'
import { readMedia, readOriginal } from '../lib/content-images'
import { WORK_TYPE_RULES } from '../lib/work-types.mjs'
import { isPlaceholderDescription } from '../lib/ai-fill'
import { writeAudit } from '../lib/audit'

const LEASE_MS = 10 * 60 * 1000
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status })
const checkLease = (job: any, token: string, now: number) => {
  if (
    !RUNNABLE.includes(job.status) ||
    !token ||
    job.options?.agent?.token !== token ||
    job.options.agent.expiresAt <= now
  )
    throw fail('任务领取已过期、取消或由其他处理者接手')
}
async function findJob(payload: any, id: string, req?: any) {
  return (
    await payload.find({
      collection: 'bulk-jobs',
      where: { jobId: { equals: id } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
  ).docs[0]
}
function view(job: any, draft: any) {
  return {
    jobId: job.jobId,
    operation: job.operation,
    target: job.target,
    id: job.ids[job.cursor],
    cursor: job.cursor,
    stage: job.options.agent?.stage || 'queued',
    draft,
    suggestOnly: job.options.suggestOnly === true,
  }
}

/** Every tool save is a short transaction; generation never happens in the backend. */
export async function agentHandler(req: PayloadRequest) {
  const denied = requireWorker(req)
  if (denied) return denied
  const payload = req.payload as any
  let transactionID: any
  try {
    const body = await readJsonBody<any>(req)
    const now = Date.now()
    if (body.action === 'list') {
      const jobs = await payload.find({
        collection: 'bulk-jobs',
        where: {
          and: [{ status: { in: RUNNABLE } }, { operation: { in: ['ai-fill', 'translate'] } }],
        },
        sort: 'createdAt',
        depth: 0,
        limit: 20,
        overrideAccess: true,
      })
      return json({
        jobs: jobs.docs
          .filter((j: any) => !j.options.agent?.token || j.options.agent.expiresAt <= now)
          .filter((j: any) => !j.options.agent?.retryAt || j.options.agent.retryAt <= now)
          .map((j: any) => ({
            jobId: j.jobId,
            operation: j.operation,
            id: j.ids[j.cursor],
            stage: j.options.agent?.stage || 'queued',
          })),
      })
    }
    const vocab = await loadVocabulary(payload)
    if (body.action === 'rules')
      return json({
        characters: vocab.characters.map((c: any) => ({ id: c.characterId, name: c.name })),
        categories: vocab.categories.map((c: any) => ({ id: c.categoryId, name: c.name })),
        rules: WORK_TYPE_RULES,
      })
    if (!/^[a-f0-9-]{36}$/.test(body.jobId || '')) return json({ error: '任务编号非法' }, 400)
    transactionID = await payload.db.beginTransaction()
    if (transactionID == null) throw fail('工具保存需要数据库事务', 500)
    const tx = { ...req, transactionID } as PayloadRequest
    let job = await findJob(payload, body.jobId, tx)
    if (!job || !['ai-fill', 'translate'].includes(job.operation))
      throw fail('Agent 任务不存在', 404)
    if (!RUNNABLE.includes(job.status) || job.cursor >= job.ids.length)
      throw fail('任务已结束或取消')
    const user = await payload.findByID({
      collection: 'users',
      id: job.requestedBy,
      depth: 0,
      overrideAccess: true,
      req: tx,
    })
    if (user.role !== 'owner') throw fail('任务提交者不再具有站长权限', 403)
    const id = job.ids[job.cursor]
    const doc = await targetDoc(payload, job.target, id, tx)
    if (!doc || fingerprint(doc, job.target) !== job.options.versions[id])
      throw fail('内容已修改，请取消旧任务后重新提交')
    let draft = job.options.agent?.draft || {
      ...draftOf(doc, job.target, vocab),
      ...job.options.drafts?.[id],
    }
    if (body.action === 'claim') {
      if (
        !RUNNABLE.includes(job.status) ||
        job.options.agent?.expiresAt > now ||
        job.options.agent?.retryAt > now ||
        (job.options.agent?.attempt || 0) >= 3
      )
        throw fail('任务暂不可领取')
      job = await payload.update({
        collection: 'bulk-jobs',
        id: job.id,
        data: {
          status: 'running',
          options: {
            ...job.options,
            agent: {
              ...job.options.agent,
              token: crypto.randomUUID(),
              expiresAt: now + LEASE_MS,
              draft,
              attempt: (job.options.agent?.attempt || 0) + 1,
              stage: 'editing',
            },
          },
        },
        overrideAccess: true,
        req: tx,
      })
    } else {
      checkLease(job, body.token, now)
      if (body.id !== id) throw fail('任务游标已推进，请重新领取')
      if (
        ['draft', 'locale', 'validate', 'complete'].includes(body.action) &&
        job.options.agent.imageToken !== body.token
      )
        throw fail('请先读取本次任务图片', 422)
      if (body.action === 'draft') {
        const checked = validateContent(body.content, vocab)
        if (!checked.ok || 'i18n' in body.content)
          throw fail(!checked.ok ? checked.errors.join('；') : '请分语言提交译文', 422)
        const base = { ...draftOf(doc, job.target, vocab), ...job.options.drafts?.[id] }
        if (
          job.operation === 'translate' &&
          Object.keys(contentOnly(base)).some(
            (k) => JSON.stringify(base[k]) !== JSON.stringify(checked.value[k]),
          )
        )
          throw fail('翻译任务不能修改中文字段', 422)
        if (job.operation === 'ai-fill') {
          for (const key of [
            'name',
            'description',
            'commentary',
            'characterId',
            'tags',
            'categoryIds',
          ]) {
            const value = base[key]
            const filled =
              key === 'description'
                ? !isPlaceholderDescription(value)
                : Array.isArray(value)
                  ? value.length > 0
                  : Boolean(value)
            if (filled && JSON.stringify(value) !== JSON.stringify(checked.value[key]))
              throw fail(`已有 ${key} 不允许自动覆盖`, 422)
          }
        }
        const hash = sourceHash({ ...checked.value, origin: draft.origin, license: draft.license })
        draft = {
          ...draft,
          ...checked.value,
          i18n: { sourceHash: hash, ...(draft.i18n?.sourceHash === hash ? draft.i18n : {}) },
        }
      } else if (body.action === 'locale') {
        const hash = sourceHash(draft)
        if (body.sourceHash !== hash) throw fail('中文版本已变化')
        if (!['en', 'ja'].includes(body.language)) throw fail('语言只接受 en 或 ja', 400)
        draft = {
          ...draft,
          i18n: {
            ...draft.i18n,
            sourceHash: hash,
            [body.language]: validateLocale(body.content, body.language, draft),
          },
        }
      } else if (body.action === 'release') {
        const attempt = job.options.agent.attempt || 0
        job.options.agent = {
          ...job.options.agent,
          token: null,
          expiresAt: 0,
          retryAt: attempt >= 3 ? Number.MAX_SAFE_INTEGER : now + 5 * 60 * 1000,
          stage: attempt >= 3 ? 'blocked' : 'retry',
          lastError: String(body.reason || '本轮未完成').slice(0, 1000),
        }
      } else if (body.action === 'complete' || body.action === 'validate') {
        const check = validateContent(contentOnly(draft), vocab)
        if (!check.ok) throw fail(check.errors.join('；'), 422)
        validateI18n(draft.i18n, draft)
        if (draft.i18n.sourceHash !== sourceHash(draft)) throw fail('译文已过期')
      } else if (!['get', 'image'].includes(body.action)) throw fail('未知工具操作', 400)
      if (!['get', 'validate'].includes(body.action)) {
        const agent =
          body.action === 'release'
            ? job.options.agent
            : {
                ...job.options.agent,
                draft,
                ...(body.action === 'image' ? { imageToken: body.token } : {}),
                expiresAt: now + LEASE_MS,
                stage: draft.i18n?.en && draft.i18n?.ja ? 'ready' : 'translating',
              }
        job = await payload.update({
          collection: 'bulk-jobs',
          id: job.id,
          data: { options: { ...job.options, agent } },
          overrideAccess: true,
          req: tx,
        })
      }
    }
    if (['claim', 'draft', 'locale', 'release'].includes(body.action))
      await writeAudit(
        { ...tx, user, context: { audit: true } },
        {
          action: `agent.${body.action}`,
          targetType: job.target,
          targetId: id,
          after: { jobId: job.jobId, stage: job.options.agent?.stage, language: body.language },
        },
      )
    await payload.db.commitTransaction(transactionID)
    transactionID = null
    if (body.action === 'image') {
      const image =
        (await readMedia(payload, job.target === 'works' ? doc.preview : doc.media)) ||
        (await readOriginal(doc.legacyPaths?.path))
      if (!image) return json({ error: '图片不可用，不能凭空生成' }, 422)
      const bytes = await sharp(image, { animated: false })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
      return new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
      })
    }
    if (body.action === 'complete') {
      const done = await stepJob({ ...req, user } as PayloadRequest, job, {
        ...contentOnly(draft),
        i18n: draft.i18n,
      })
      const result = done.results.at(-1)
      return json({
        ok: result?.status !== 'failed',
        status: done.status,
        result,
        ...(result?.status === 'failed' ? { error: result.message } : {}),
      })
    }
    return json({
      ok: true,
      ...view(job, draft),
      ...(body.action === 'claim' ? { token: job.options.agent.token } : {}),
    })
  } catch (error) {
    if (transactionID != null) await payload.db.rollbackTransaction(transactionID)
    const e = error as any
    return json(
      { ok: false, error: e.message, path: e.path || null },
      e.status || (e.code === 'LOCALIZATION_INVALID' ? 422 : 500),
    )
  }
}
export const AgentEndpoints: Endpoint[] = [
  { path: '/agent', method: 'post', handler: agentHandler },
]
