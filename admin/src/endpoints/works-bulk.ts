/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Endpoint, PayloadRequest } from 'payload'

import { json, readJsonBody, requireOwnerOrBot } from '../lib/endpoint-auth'
import { writeAudit } from '../lib/audit'
import { validateContent } from '../lib/sync-submissions'
import { submissionAttribution } from '../lib/attribution.mjs'
import { sourceHash } from '../lib/localization.mjs'

const ALLOWED_ACTIONS = ['hide', 'restore', 'remove', 'delete', 'set-categories', 'add-to-topic', 'include', 'manual-include'] as const
type BulkAction = (typeof ALLOWED_ACTIONS)[number]

type BulkBody = {
  action?: BulkAction
  categoryIds?: string[]
  confirm?: string
  content?: unknown
  ids?: string[]
  submissionId?: string
  topicId?: string
}

/**
 * 把专题的作品关系值归一成 Payload 关系字段需要的数字 ID。
 * SQLite/Payload 的 works.id 是 number，关系字段只接受数字；depth>0 时也可能拿到
 * 已填充的关系对象（取它的 id）。旧的字符串形式「11」也兼容；其余（NaN、小数、0、
 * 布尔、缺 id 的对象、超长到溢出/失去精度的数字串等）一律返回 null，交由调用方
 * 明确处理，绝不静默写坏数据。
 */
function workRelationId(value: unknown): number | null {
  const raw = value && typeof value === 'object' ? (value as { id?: unknown }).id : value
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim())
    // isSafeInteger 同时挡掉超长数字串解析出的 Infinity 与超过 2^53-1 的失真值。
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

async function findWorks(req: PayloadRequest, ids: string[]): Promise<any[]> {
  const payload = req.payload as any
  const numericIds = ids.filter((id) => /^\d+$/.test(id)).map(Number)
  const result = await payload.find({
    collection: 'works',
    where: {
      or: [
        ...(numericIds.length ? [{ id: { in: numericIds } }] : []),
        { workId: { in: ids } },
      ],
    },
    depth: 0,
    limit: Math.max(ids.length, 1),
    overrideAccess: true,
    pagination: false,
  })
  return result.docs
}

async function vocabulary(req: PayloadRequest) {
  const payload = req.payload as any
  const [characters, categories] = await Promise.all([
    payload.find({ collection: 'characters', limit: 1000, depth: 0, overrideAccess: true }),
    payload.find({ collection: 'categories', limit: 1000, depth: 0, overrideAccess: true }),
  ])
  return {
    characterIds: new Set(characters.docs.map((doc: any) => String(doc.characterId)) as string[]),
    categoryIds: new Set(categories.docs.map((doc: any) => String(doc.categoryId)) as string[]),
    characterDocs: characters.docs,
    categoryDocs: categories.docs,
  }
}

async function includeSubmissions(req: PayloadRequest, ids: string[]): Promise<{ workIds: string[]; skipped: string[] }> {
  const payload = req.payload as any
  const vocab = await vocabulary(req)
  const workIds: string[] = []
  const skipped: string[] = []
  for (const id of ids) {
    const existingWork = await payload.find({ collection: 'works', where: { workId: { equals: id } }, limit: 1, depth: 0, overrideAccess: true })
    if (existingWork.docs[0]) {
      const work = existingWork.docs[0]
      if (work.status !== 'published' && work.status !== 'deleted') {
        await payload.update({
          collection: 'works',
          id: work.id,
          data: { status: 'pending', needsPublish: true, changeAction: 'add' },
          context: { audit: false, skipFieldAccess: true },
          overrideAccess: true,
          req,
        })
        workIds.push(work.workId)
      } else skipped.push(id)
      continue
    }
    const submission = await payload.find({
      collection: 'submissions',
      where: { or: [{ submissionId: { equals: id } }, ...(/^\d+$/.test(id) ? [{ id: { equals: Number(id) } }] : [])] },
      limit: 1,
      depth: 1,
      overrideAccess: true,
    })
    const doc = submission.docs[0]
    if (!doc) throw new Error(`找不到投稿 ${id}`)
    const check = validateContent(doc.review?.content, vocab)
    if (!check.ok) throw new Error(`投稿 ${id} 内容不合法：${check.errors.join('；')}`)
    if (!doc.sha256) throw new Error(`投稿 ${id} 缺 sha256`)
    const duplicate = await payload.find({ collection: 'works', where: { sha256: { equals: doc.sha256 } }, limit: 1, depth: 0, overrideAccess: true })
    if (duplicate.docs[0]) {
      await payload.update({ collection: 'submissions', id: doc.id, data: { work: duplicate.docs[0].id }, context: { audit: false }, overrideAccess: true, req })
      skipped.push(id)
      continue
    }
    const character = vocab.characterDocs.find((item: any) => item.characterId === check.value.characterId)
    const categories = vocab.categoryDocs.filter((item: any) => check.value.categoryIds.includes(item.categoryId))
    const workId = `sticker_${String(doc.sha256).slice(0, 24)}`
    const created = await payload.create({
      collection: 'works',
      data: {
        workId,
        name: check.value.name,
        description: check.value.description,
        commentary: check.value.commentary,
        kind: 'submission',
        channel: doc.source || 'manual',
        submissionId: doc.submissionId,
        sha256: doc.sha256,
        character: character?.id,
        categories: categories.map((item: any) => item.id),
        tags: check.value.tags.map((value: string) => ({ value })),
        preview: doc.media?.id || doc.media,
        status: 'pending',
        needsPublish: true,
        changeAction: 'add',
        review: doc.review || null,
        origin: doc.origin || {},
        submitter: submissionAttribution(doc.fields || {}) || undefined,
        legacySource: 'submission-sync',
      },
      context: { audit: false, skipNeedsPublish: true, skipFieldAccess: true },
      overrideAccess: true,
      req,
    })
    await payload.update({ collection: 'submissions', id: doc.id, data: { work: created.id }, context: { audit: false }, overrideAccess: true, req })
    workIds.push(created.workId)
  }
  return { workIds, skipped }
}

async function manualInclude(req: PayloadRequest, body: BulkBody): Promise<Response> {
  const role = (req.user as any)?.role
  if (role !== 'owner') return json({ ok: false, error: '人工收录仅限站长' }, 403)
  const submissionId = String(body.submissionId || '').trim()
  if (!submissionId) return json({ ok: false, error: 'submissionId 不能为空' }, 400)
  if (body.confirm !== 'MANUAL_INCLUDE') return json({ ok: false, error: '人工收录需要明确确认' }, 400)

  const payload = req.payload as any
  const submission = await payload.find({
    collection: 'submissions',
    where: { or: [{ submissionId: { equals: submissionId } }, ...(/^\d+$/.test(submissionId) ? [{ id: { equals: Number(submissionId) } }] : [])] },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  })
  const doc = submission.docs[0]
  if (!doc) return json({ ok: false, error: `找不到投稿 ${submissionId}` }, 404)
  if (!['auto_rejected', 'needs_manual'].includes(String(doc.state))) {
    return json({ ok: false, error: `投稿 ${submissionId} 不是拒绝或转人工状态` }, 400)
  }
  if (doc.work) return json({ ok: false, error: `投稿 ${submissionId} 已关联作品` }, 400)

  const vocab = await vocabulary(req)
  const check = validateContent(body.content, vocab)
  if (!check.ok) return json({ ok: false, error: `投稿 ${submissionId} 内容不合法：${check.errors.join('；')}` }, 400)
  if (!doc.sha256) return json({ ok: false, error: `投稿 ${submissionId} 缺 sha256` }, 400)
  const duplicate = await payload.find({ collection: 'works', where: { sha256: { equals: doc.sha256 } }, limit: 1, depth: 0, overrideAccess: true })
  if (duplicate.docs[0]) return json({ ok: false, error: `投稿 ${submissionId} 已存在同图作品`, workId: duplicate.docs[0].workId }, 409)

  const i18n = (body.content as any)?.i18n
  if (!i18n) return json({ ok: false, error: '请先生成完整的英文和日文版本，再人工收录' }, 400)
  const currentHash = sourceHash({ ...check.value, origin: doc.origin || {}, license: {} })
  if (i18n.sourceHash !== currentHash) return json({ ok: false, error: '内容已修改，请重新生成英文和日文版本，再人工收录' }, 409)

  const character = vocab.characterDocs.find((item: any) => item.characterId === check.value.characterId)
  const categories = vocab.categoryDocs.filter((item: any) => check.value.categoryIds.includes(item.categoryId))
  const workId = `sticker_${String(doc.sha256).slice(0, 24)}`
  const created = await payload.create({
    collection: 'works',
    data: {
      workId,
      name: check.value.name,
      description: check.value.description,
      commentary: check.value.commentary,
      kind: 'submission',
      channel: doc.source || 'manual',
      submissionId: doc.submissionId,
      sha256: doc.sha256,
      character: character?.id,
      categories: categories.map((item: any) => item.id),
      tags: check.value.tags.map((value: string) => ({ value })),
      preview: doc.media?.id || doc.media,
      status: 'pending',
      needsPublish: true,
      changeAction: 'add',
      review: doc.review || null,
      origin: doc.origin || {},
      submitter: submissionAttribution(doc.fields || {}) || undefined,
      legacySource: 'submission-sync',
      legacyData: { i18n: { sourceHash: currentHash, ...check.value.i18n } },
    },
    context: { audit: false, skipNeedsPublish: true, skipFieldAccess: true },
    overrideAccess: true,
    req,
  })
  await payload.update({ collection: 'submissions', id: doc.id, data: { work: created.id }, context: { audit: false }, overrideAccess: true, req })
  await writeAudit(req, {
    action: 'submissions.manual-include',
    after: {
      content: check.value,
      manual: true,
      review: doc.review || null,
      submissionId: doc.submissionId,
      workId: created.workId,
      workStatus: created.status,
    },
    before: { review: doc.review || null, state: doc.state, submissionId: doc.submissionId },
    targetId: doc.submissionId,
    targetType: 'submissions',
  })
  return json({ ok: true, action: 'manual-include', workId: created.workId })
}

export const bulkHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  const role = (req.user as any)?.role
  const body = await readJsonBody<BulkBody>(req)
  const action = body.action
  if (!action || !ALLOWED_ACTIONS.includes(action)) return json({ ok: false, error: 'action 非法' }, 400)
  if (role === 'bot' && action !== 'set-categories') return json({ ok: false, error: '机器人无此操作权限' }, 403)
  if (action === 'manual-include') return manualInclude(req, body)

  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : []
  if (!ids.length) return json({ ok: false, error: 'ids 不能为空' }, 400)
  if (action === 'delete' && body.confirm !== 'DELETE') return json({ ok: false, error: '删除需要 confirm=DELETE' }, 400)

  const payload = req.payload as any
  const affected: any[] = []
  if (action === 'include') {
    const result = await includeSubmissions(req, ids)
    await writeAudit(req, { action: 'works.bulk.include', after: result, targetId: ids.join(','), targetType: 'works' })
    return json({ ok: true, action, ...result })
  }

  const works = await findWorks(req, ids)
  if (!works.length) return json({ ok: false, error: '没有找到作品' }, 404)
  if ((action === 'hide' || action === 'restore' || action === 'remove' || action === 'delete') && works.length !== ids.length) {
    return json({ ok: false, error: '存在无法匹配的作品' }, 400)
  }

  if (action === 'set-categories') {
    const categoryIds = Array.isArray(body.categoryIds) ? body.categoryIds.map(String) : []
    if (categoryIds.length !== 1) return json({ ok: false, error: '每张图必须且只能选择一个作品类型' }, 400)
    const categories = await payload.find({ collection: 'categories', where: { categoryId: { in: categoryIds } }, limit: 1000, depth: 0, overrideAccess: true })
    if (categories.docs.length !== categoryIds.length) return json({ ok: false, error: '分类不存在' }, 400)
    for (const work of works) {
      await payload.update({ collection: 'works', id: work.id, data: { categories: categories.docs.map((item: any) => item.id) }, context: { audit: false, skipFieldAccess: true }, overrideAccess: true, req })
      affected.push(work.workId)
    }
  } else if (action === 'add-to-topic') {
    if (!body.topicId) return json({ ok: false, error: 'topicId 必填' }, 400)
    const topicResult = await payload.find({ collection: 'topics', where: { topicId: { equals: body.topicId } }, limit: 1, depth: 0, overrideAccess: true })
    const topic = topicResult.docs[0]
    if (!topic) return json({ ok: false, error: '专题不存在' }, 404)
    const next: number[] = []
    if (Array.isArray(topic.works)) {
      for (const item of topic.works) {
        const id = workRelationId(item)
        if (id === null) return json({ ok: false, error: '专题已有作品关系数据异常' }, 400)
        if (!next.includes(id)) next.push(id)
      }
    }
    for (const work of works) {
      const id = workRelationId(work.id)
      if (id === null) return json({ ok: false, error: `作品 ${work.workId} 缺少有效的数字 ID` }, 400)
      if (!next.includes(id)) next.push(id)
      affected.push(work.workId)
    }
    await payload.update({ collection: 'topics', id: topic.id, data: { works: next }, context: { audit: false }, overrideAccess: true, req })
  } else {
    const nextStatus = action === 'hide' ? 'hidden' : action === 'restore' ? 'published' : action === 'remove' ? 'removed' : 'deleted'
    for (const work of works) {
      if (action === 'hide' && work.status !== 'published') return json({ ok: false, error: `作品 ${work.workId} 不是已发布状态` }, 400)
      if (action === 'restore' && work.status !== 'hidden') return json({ ok: false, error: `作品 ${work.workId} 不是隐藏状态` }, 400)
      if (action === 'remove' && work.status !== 'pending') return json({ ok: false, error: `作品 ${work.workId} 不是待发布状态` }, 400)
      await payload.update({
        collection: 'works',
        id: work.id,
        data: { status: nextStatus, needsPublish: true, changeAction: action },
        context: { audit: false, skipFieldAccess: true },
        overrideAccess: true,
        req,
      })
      affected.push(work.workId)
    }
  }

  await writeAudit(req, { action: `works.bulk.${action}`, after: { affected, action, topicId: body.topicId }, before: works.map((work) => ({ status: work.status, workId: work.workId })), targetId: ids.join(','), targetType: 'works' })
  return json({ ok: true, action, affected })
}

export const WorksBulkEndpoint: Endpoint = {
  handler: bulkHandler,
  method: 'post',
  path: '/bulk',
}
