/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { PayloadRequest } from 'payload'
import { authorDescription, httpVisionCaller, missingFields, suggestFill, visionConfig } from './ai-fill'
import { readMedia, readOriginal } from './content-images'
import { sourceHash, validateI18n } from './localization.mjs'
import { prepareSubmissionPreview, validateContent } from './sync-submissions'
import { writeAudit } from './audit'
import { submissionAttribution } from './attribution.mjs'

export const JOB_OPERATIONS = ['write-fields', 'ai-fill', 'translate', 'manual-include'] as const
export const EDIT_KEYS = ['name', 'description', 'commentary', 'characterId', 'categoryIds', 'tags'] as const
export const RUNNABLE = ['queued', 'running']
export type JobResult = { id: string; status: 'succeeded' | 'skipped' | 'failed'; message: string }

export async function loadVocabulary(payload: any) {
  const [characters, categories] = await Promise.all([
    payload.find({
      collection: 'characters',
      where: { status: { equals: 'active' } },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'categories',
      where: { status: { equals: 'active' } },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    }),
  ])
  return {
    characters: characters.docs,
    categories: categories.docs,
    characterIds: new Set<string>(characters.docs.map((c: any) => c.characterId)),
    categoryIds: new Set<string>(categories.docs.map((c: any) => c.categoryId)),
  }
}

export function draftOf(doc: any, target: string, vocab: any) {
  if (target === 'submissions') {
    const fields = doc.fields || {}
    const review = doc.review?.content || {}
    const editorial = doc.editorial || {}
    return {
      name: fields.name || doc.title || '',
      description: fields.description || '',
      commentary: '',
      tags: fields.tags || [],
      characterId: fields.characterId || fields.character || '',
      categoryIds: fields.categoryIds || (fields.categoryId ? [fields.categoryId] : []),
      ...review,
      ...editorial,
      origin: doc.origin || {},
      license: {},
    }
  }
  const relation = (value: any) => (value && typeof value === 'object' ? value.id : value)
  return {
    name: doc.name || '',
    description: doc.description || '',
    commentary: doc.commentary || '',
    tags: (doc.tags || []).map((t: any) => t.value),
    characterId: vocab.characters.find((c: any) => String(c.id) === String(relation(doc.character)))?.characterId || '',
    categoryIds: (doc.categories || []).map(
      (c: any) => vocab.categories.find((v: any) => String(v.id) === String(relation(c)))?.categoryId || '',
    ),
    origin: doc.origin || {},
    license: doc.license || {},
  }
}

export function contentOnly(draft: any) {
  return Object.fromEntries(EDIT_KEYS.map((key) => [key, draft[key]])) as any
}

export function fingerprint(doc: any, target: string) {
  const value =
    target === 'works'
      ? {
          name: doc.name,
          description: doc.description,
          commentary: doc.commentary,
          tags: doc.tags,
          character: doc.character,
          categories: doc.categories,
          origin: doc.origin,
          license: doc.license,
          legacyData: doc.legacyData,
          status: doc.status,
          preview: doc.preview,
        }
      : {
          fields: doc.fields,
          review: doc.review,
          editorial: doc.editorial,
          work: doc.work,
          state: doc.state,
          origin: doc.origin,
          media: doc.media,
        }
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function targetDoc(payload: any, target: string, id: string, req?: PayloadRequest) {
  const result = await payload.find({
    collection: target,
    where: { [target === 'works' ? 'workId' : 'submissionId']: { equals: id } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  return result.docs[0] || null
}

export function validatePatch(patch: any, vocab: any) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length)
    throw new Error('至少选择一个字段')
  for (const key of Object.keys(patch))
    if (!(EDIT_KEYS as readonly string[]).includes(key)) throw new Error(`不允许批量修改字段 ${key}`)
  const full = {
    name: '校验',
    description: '',
    commentary: '',
    characterId: [...vocab.characterIds][0],
    categoryIds: [[...vocab.categoryIds][0]],
    tags: [],
    ...patch,
  }
  const checked = validateContent(full, vocab)
  if (!checked.ok) throw new Error(checked.errors.join('；'))
  return Object.fromEntries(Object.keys(patch).map((key) => [key, checked.value[key]]))
}

function workPatch(content: any, vocab: any) {
  const data: any = {}
  for (const key of ['name', 'description', 'commentary']) if (key in content) data[key] = content[key]
  if ('tags' in content) data.tags = content.tags.map((value: string) => ({ value }))
  if ('characterId' in content) data.character = vocab.characters.find((c: any) => c.characterId === content.characterId)?.id
  if ('categoryIds' in content)
    data.categories = content.categoryIds.map((id: string) => vocab.categories.find((c: any) => c.categoryId === id)?.id)
  return data
}

export async function prepareJobItem(req: PayloadRequest, job: any, id: string, vocab: any, callOverride?: any) {
  const doc = await targetDoc(req.payload, job.target, id)
  if (!doc) throw new Error('条目不存在')
  if (job.options?.versions?.[id] !== fingerprint(doc, job.target)) throw new Error('条目自提交后已修改，请重新选择后提交')
  if (job.target === 'works' && ['deleted', 'removed'].includes(doc.status)) throw new Error('已删除或移除的作品不能批量编辑')
  if (job.target === 'submissions' && doc.work) return { doc, skipped: '已关联作品，不重复处理', data: null }
  const draft = draftOf(doc, job.target, vocab)
  if (job.operation === 'write-fields') {
    const patch = validatePatch(job.options.patch, vocab)
    const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => !isDeepStrictEqual(draft[k], v)))
    if (!Object.keys(changed).length) return { doc, skipped: '字段已一致', data: null }
    return {
      doc,
      data:
        job.target === 'works'
          ? { ...workPatch(changed, vocab), needsPublish: true }
          : { editorial: { ...(doc.editorial || {}), ...changed, i18n: null } },
    }
  }
  if (job.operation === 'manual-include') {
    if (!['needs_manual', 'auto_rejected'].includes(doc.state)) throw new Error('条目不是人工审核状态')
    const check = validateContent(contentOnly(draft), vocab)
    if (!check.ok) throw new Error('请先补写字段：' + check.errors.join('；'))
    if (!doc.sha256 || !doc.media) throw new Error('缺少原图摘要或预览，不能收录')
    const i18n = doc.editorial?.i18n || doc.review?.content?.i18n
    if (!i18n || i18n.sourceHash !== sourceHash(draft)) throw new Error('请先批量翻译当前内容，再收录')
    validateI18n(i18n, draft)
    const token = process.env.SUBMISSION_ADMIN_TOKEN
    if (!token || !/^sub_[A-Za-z0-9_-]{1,64}$/.test(doc.submissionId)) throw new Error('投稿服务原图校验未配置或投稿 ID 非法')
    const base = String(process.env.SUBMISSION_ADMIN_API_URL || 'http://127.0.0.1:8788').replace(/\/$/, '')
    const response = await fetch(`${base}/api/v1/items/${encodeURIComponent(doc.submissionId)}/raw`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`原图不可用（HTTP ${response.status}），无法收录待发布作品`)
    const raw = Buffer.from(await response.arrayBuffer())
    if (raw.length > 30 * 1024 * 1024) throw new Error('原图超过校验上限')
    const original = await prepareSubmissionPreview(raw, { id: doc.submissionId, sha256: doc.sha256 })
    return { doc, draft, i18n, original, data: null }
  }
  const cfg = visionConfig()
  if (!cfg && !callOverride) throw new Error('AI 模型未配置')
  const base = { ...draft, tags: draft.tags.map((value: string) => ({ value })), categories: draft.categoryIds }
  const fields = job.operation === 'translate' ? ['i18n'] : missingFields(base).filter((key) => key !== 'dimensions')
  if (job.operation === 'translate') {
    const check = validateContent(contentOnly(draft), vocab)
    if (!check.ok) throw new Error('中文字段不完整，请先批量补写：' + check.errors.join('；'))
    const existing = doc.editorial?.i18n || doc.legacyData?.i18n || doc.review?.content?.i18n
    if (!job.options.force && existing?.sourceHash === sourceHash(draft)) {
      try {
        validateI18n(existing, draft)
        return { doc, skipped: '已有有效英日译文', data: null }
      } catch {
        /* regenerate invalid */
      }
    }
  }
  const image =
    (await readMedia(req.payload, job.target === 'works' ? doc.preview : doc.media)) ||
    (await readOriginal(doc.legacyPaths?.path))
  if (!image) throw new Error('无法读取图片，不能生成内容')
  const { suggestion, errors } = await suggestFill(
    {
      current: draft,
      name: draft.name,
      fields: fields as any,
      image,
      authorText: authorDescription(job.target === 'works' ? doc : null, job.target === 'submissions' ? doc : null),
      characterName: vocab.characters.find((c: any) => c.characterId === draft.characterId)?.name || draft.characterId,
      vocabulary: { categories: vocab.categories },
    },
    callOverride || httpVisionCaller(cfg!),
  )
  if (errors.length) throw new Error(errors.join('；'))
  const merged = { ...draft, ...suggestion }
  const check = validateContent(contentOnly(merged), vocab)
  if (!check.ok) throw new Error(check.errors.join('；'))
  if (suggestion.i18n?.sourceHash !== sourceHash(merged)) throw new Error('译文与当前内容不匹配')
  const data =
    job.target === 'works'
      ? {
          ...workPatch(
            Object.fromEntries(EDIT_KEYS.filter((k) => k in suggestion).map((k) => [k, (suggestion as any)[k]])),
            vocab,
          ),
          legacyData: { ...(doc.legacyData || {}), i18n: suggestion.i18n },
          needsPublish: true,
        }
      : { editorial: { ...contentOnly(merged), i18n: suggestion.i18n } }
  return { doc, data }
}

/** 内容写入和游标推进共用事务；进程重启不会重复执行已提交条目。模型调用在事务外。 */
export async function stepJob(req: PayloadRequest, job: any, callOverride?: any) {
  const payload = req.payload as any
  const ids: string[] = job.ids
  if (!RUNNABLE.includes(job.status) || job.cursor >= ids.length) return job
  const id = ids[job.cursor]
  const vocab = await loadVocabulary(payload)
  let prepared: any
  let failure: string | undefined
  try {
    prepared = await prepareJobItem(req, job, id, vocab, callOverride)
  } catch (error) {
    failure = (error as Error).message
  }
  const transactionID = await payload.db.beginTransaction()
  if (transactionID == null) throw new Error('批量任务需要数据库事务')
  const txReq = { ...req, transactionID, context: { ...req.context, audit: true } } as PayloadRequest
  try {
    const freshJob = await payload.findByID({ collection: 'bulk-jobs', id: job.id, depth: 0, overrideAccess: true, req: txReq })
    if (!RUNNABLE.includes(freshJob.status) || freshJob.cursor !== job.cursor) {
      await payload.db.rollbackTransaction(transactionID)
      return freshJob
    }
    let result: JobResult = { id, status: 'failed', message: failure || '' }
    if (!failure) {
      const fresh = await targetDoc(payload, job.target, id, txReq)
      if (!fresh || fingerprint(fresh, job.target) !== fingerprint(prepared.doc, job.target)) {
        result.message = '生成期间内容已修改，请重新提交'
      } else if (prepared.skipped) {
        result = { id, status: 'skipped', message: prepared.skipped }
      } else if (job.operation === 'manual-include') {
        const duplicate = await payload.find({
          collection: 'works',
          where: { sha256: { equals: fresh.sha256 } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
          req: txReq,
        })
        if (duplicate.docs.length) result = { id, status: 'failed', message: '同图作品已存在，请人工确认关联' }
        else {
          const created = await payload.create({
            collection: 'works',
            data: {
              ...workPatch(contentOnly(prepared.draft), vocab),
              workId: `sticker_${fresh.sha256.slice(0, 24)}`,
              kind: 'submission',
              channel: fresh.source,
              submissionId: fresh.submissionId,
              sha256: fresh.sha256,
              preview: fresh.media,
              format: prepared.original.format,
              mimeType: prepared.original.mimeType,
              width: prepared.original.width,
              height: prepared.original.height,
              fileSize: prepared.original.fileSize,
              isAnimated: prepared.original.isAnimated,
              status: 'pending',
              needsPublish: true,
              changeAction: 'add',
              review: fresh.review,
              origin: fresh.origin,
              submitter: submissionAttribution(fresh.fields || {}) || undefined,
              legacySource: 'submission-sync',
              legacyData: { i18n: prepared.i18n },
            },
            context: { audit: false, skipFieldAccess: true, skipNeedsPublish: true },
            overrideAccess: true,
            req: { ...txReq, context: { ...txReq.context, audit: false } },
          })
          await payload.update({
            collection: 'submissions',
            id: fresh.id,
            data: { work: created.id },
            overrideAccess: true,
            req: { ...txReq, context: { ...txReq.context, audit: false } },
          })
          result = { id, status: 'succeeded', message: `人工收录为 ${created.workId}，待发布` }
        }
      } else {
        await payload.update({
          collection: job.target,
          id: fresh.id,
          data: prepared.data,
          context: { audit: false, skipFieldAccess: true },
          overrideAccess: true,
          req: { ...txReq, context: { ...txReq.context, audit: false, skipFieldAccess: true } },
        })
        result = {
          id,
          status: 'succeeded',
          message: job.target === 'works' ? '已保存，待发布' : '草稿已保存，原投稿和 AI 结论未修改',
        }
      }
    }
    // 显式审计保持在同一事务内。
    await writeAudit({ ...txReq, context: { audit: true } } as PayloadRequest, {
      action: `bulk.${job.operation}`,
      targetType: job.target,
      targetId: id,
      before: prepared?.doc,
      after: { jobId: job.jobId, result, data: prepared?.data, model: visionConfig()?.model },
    })
    const results = [...(freshJob.results || []), result]
    const cursor = job.cursor + 1
    const status =
      cursor < ids.length
        ? 'running'
        : results.every((r) => r.status !== 'failed')
          ? 'succeeded'
          : results.every((r) => r.status === 'failed')
            ? 'failed'
            : 'partial'
    const updated = await payload.update({
      collection: 'bulk-jobs',
      id: job.id,
      data: { results, cursor, status, ...(cursor === ids.length ? { finishedAt: new Date().toISOString() } : {}) },
      overrideAccess: true,
      req: txReq,
    })
    await payload.db.commitTransaction(transactionID)
    return updated
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID)
    if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test((error as Error).message)) throw error
    // 单条写入失败回滚后记录失败并推进；不能让一个坏条目永久阻塞整批。
    const failureTransaction = await payload.db.beginTransaction()
    if (failureTransaction == null) throw error
    const failureReq = { ...req, transactionID: failureTransaction, context: { audit: true } } as PayloadRequest
    try {
      const current = await payload.findByID({
        collection: 'bulk-jobs',
        id: job.id,
        depth: 0,
        overrideAccess: true,
        req: failureReq,
      })
      if (!RUNNABLE.includes(current.status) || current.cursor !== job.cursor) {
        await payload.db.rollbackTransaction(failureTransaction)
        return current
      }
      const result: JobResult = { id, status: 'failed', message: `写入失败，已回滚本条：${(error as Error).message}` }
      const results = [...(current.results || []), result]
      const cursor = job.cursor + 1
      const status = cursor < ids.length ? 'running' : results.every((r) => r.status === 'failed') ? 'failed' : 'partial'
      await writeAudit(failureReq, {
        action: `bulk.${job.operation}`,
        targetType: job.target,
        targetId: id,
        after: { jobId: job.jobId, result },
      })
      const updated = await payload.update({
        collection: 'bulk-jobs',
        id: job.id,
        data: { results, cursor, status, ...(cursor === ids.length ? { finishedAt: new Date().toISOString() } : {}) },
        overrideAccess: true,
        req: failureReq,
      })
      await payload.db.commitTransaction(failureTransaction)
      return updated
    } catch (failureError) {
      await payload.db.rollbackTransaction(failureTransaction)
      throw failureError
    }
  }
}
