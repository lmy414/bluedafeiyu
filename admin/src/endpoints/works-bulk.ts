/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Endpoint, PayloadRequest } from 'payload'

import { json, readJsonBody, requireOwnerOrBot } from '../lib/endpoint-auth'
import { writeAudit } from '../lib/audit'
import { lookupSubmissionImageMetadata, validateContent } from '../lib/sync-submissions'
import { addTopicMemberships } from '../lib/topics-membership'
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

export type BulkItemResult = {
  id: string
  status: 'succeeded' | 'skipped' | 'failed'
  workId?: string
  reason?: string
}

type IncludePlan =
  | { action: 'restore'; id: string; work: any }
  | { action: 'link'; id: string; doc: any; target: any }
  | {
      action: 'create'
      id: string
      doc: any
      check: any
      image: any
      character: any
      categories: any[]
      workId: string
    }
  | { action: 'skip'; id: string; reason: string; workId?: string }
  | { action: 'fail'; id: string; reason: string }

async function includeSubmissions(req: PayloadRequest, ids: string[]): Promise<{
  workIds: string[]
  skipped: string[]
  failed: string[]
  errors: string[]
  results: BulkItemResult[]
}> {
  const payload = req.payload as any
  const vocab = await vocabulary(req)
  const plans: IncludePlan[] = []
  // 先只读校验全部条目，避免后面的校验失败让前面的写入变成“看不见的部分成功”。
  for (const id of ids) {
    try {
      const existingWork = await payload.find({ collection: 'works', where: { workId: { equals: id } }, limit: 1, depth: 0, overrideAccess: true })
      const work = existingWork.docs[0]
      if (work) {
        if (work.status !== 'published' && work.status !== 'deleted')
          plans.push({ action: 'restore', id, work })
        else
          plans.push({ action: 'skip', id, workId: work.workId, reason: `作品已${work.status === 'published' ? '上线' : '删除'}` })
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
      if (!doc) {
        plans.push({ action: 'fail', id, reason: `找不到投稿 ${id}` })
        continue
      }
      const check = validateContent(doc.review?.content, vocab, { origin: doc.origin, submitter: submissionAttribution(doc.fields) })
      if (!check.ok) {
        plans.push({ action: 'fail', id, reason: `投稿 ${id} 内容不合法：${check.errors.join('；')}` })
        continue
      }
      if (!doc.sha256) {
        plans.push({ action: 'fail', id, reason: `投稿 ${id} 缺 sha256` })
        continue
      }
      const duplicate = await payload.find({ collection: 'works', where: { sha256: { equals: doc.sha256 } }, limit: 1, depth: 0, overrideAccess: true })
      if (duplicate.docs[0]) {
        plans.push({ action: 'link', id, doc, target: duplicate.docs[0] })
        continue
      }
      const character = vocab.characterDocs.find((item: any) => item.characterId === check.value.characterId)
      const categories = vocab.categoryDocs.filter((item: any) => check.value.categoryIds.includes(item.categoryId))
      let image
      try {
        image = await lookupSubmissionImageMetadata(String(doc.submissionId), String(doc.sha256))
      } catch (error) {
        plans.push({ action: 'fail', id, reason: (error as Error).message })
        continue
      }
      plans.push({
        action: 'create',
        id,
        doc,
        check,
        image,
        character,
        categories,
        workId: `sticker_${String(doc.sha256).slice(0, 24)}`,
      })
    } catch (error) {
      plans.push({ action: 'fail', id, reason: (error as Error).message })
    }
  }

  const workIds: string[] = []
  const skipped: string[] = []
  const failed: string[] = []
  const errors: string[] = []
  const results: BulkItemResult[] = []
  const succeed = (id: string, workId: string) => {
    workIds.push(workId)
    results.push({ id, status: 'succeeded', workId })
  }
  const skip = (id: string, reason: string, workId?: string) => {
    skipped.push(id)
    results.push({ id, status: 'skipped', ...(workId ? { workId } : {}), reason })
  }
  const fail = (id: string, reason: string) => {
    failed.push(id)
    errors.push(`${id}: ${reason}`)
    results.push({ id, status: 'failed', reason })
  }
  for (const plan of plans) {
    if (plan.action === 'fail') {
      fail(plan.id, plan.reason)
      continue
    }
    if (plan.action === 'skip') {
      skip(plan.id, plan.reason, plan.workId)
      continue
    }
    try {
      if (plan.action === 'restore') {
        await payload.update({
          collection: 'works',
          id: plan.work.id,
          data: { status: 'pending', needsPublish: true, changeAction: 'add' },
          context: { audit: false, skipFieldAccess: true },
          overrideAccess: true,
          req,
        })
        succeed(plan.id, plan.work.workId)
        continue
      }
      if (plan.action === 'link') {
        await payload.update({
          collection: 'submissions',
          id: plan.doc.id,
          data: { work: plan.target.id },
          context: { audit: false },
          overrideAccess: true,
          req,
        })
        skip(plan.id, '已存在同图作品，已关联', plan.target.workId)
        continue
      }
      const created = await payload.create({
        collection: 'works',
        data: {
          workId: plan.workId,
          name: plan.check.value.name,
          description: plan.check.value.description,
          commentary: plan.check.value.commentary,
          kind: 'submission',
          channel: plan.doc.source || 'manual',
          submissionId: plan.doc.submissionId,
          sha256: plan.doc.sha256,
          format: plan.image?.format,
          mimeType: plan.image?.mimeType,
          isAnimated: plan.image?.isAnimated,
          width: plan.image?.width,
          height: plan.image?.height,
          fileSize: plan.image?.fileSize,
          character: plan.character?.id,
          characters: plan.check.value.characterIds.map((id: string) => vocab.characterDocs.find((item: any) => item.characterId === id)?.id),
          categories: plan.categories.map((item: any) => item.id),
          tags: plan.check.value.tags.map((value: string) => ({ value })),
          preview: plan.doc.media?.id || plan.doc.media,
          status: 'pending',
          needsPublish: true,
          changeAction: 'add',
          review: plan.doc.review || null,
          origin: plan.doc.origin || {},
          submitter: submissionAttribution(plan.doc.fields || {}) || undefined,
          legacySource: 'submission-sync',
        },
        context: { audit: false, skipNeedsPublish: true, skipFieldAccess: true },
        overrideAccess: true,
        req,
      })
      await payload.update({
        collection: 'submissions',
        id: plan.doc.id,
        data: { work: created.id },
        context: { audit: false },
        overrideAccess: true,
        req,
      })
      succeed(plan.id, created.workId)
    } catch (error) {
      fail(plan.id, (error as Error).message)
    }
  }
  return { workIds, skipped, failed, errors, results }
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
  const check = validateContent(body.content, vocab, { origin: doc.origin, submitter: submissionAttribution(doc.fields) })
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
  let image
  try {
    image = await lookupSubmissionImageMetadata(String(doc.submissionId), String(doc.sha256))
  } catch (error) {
    return json({ ok: false, error: `无法读取原图元数据：${(error as Error).message}` }, 502)
  }
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
      format: image?.format,
      mimeType: image?.mimeType,
      isAnimated: image?.isAnimated,
      width: image?.width,
      height: image?.height,
      fileSize: image?.fileSize,
      character: character?.id,
      characters: check.value.characterIds.map((id: string) => vocab.characterDocs.find((item: any) => item.characterId === id)?.id),
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
  if (action === 'include') {
    const result = await includeSubmissions(req, ids)
    await writeAudit(req, { action: 'works.bulk.include', after: result, targetId: ids.join(','), targetType: 'works' })
    return json({ ok: result.failed.length === 0, action, ...result })
  }

  const works = await findWorks(req, ids)
  if (!works.length) return json({ ok: false, error: '没有找到作品' }, 404)
  if ((action === 'hide' || action === 'restore' || action === 'remove' || action === 'delete') && works.length !== ids.length) {
    return json({ ok: false, error: '存在无法匹配的作品' }, 400)
  }

  const affected: string[] = []
  const skipped: string[] = []
  const failed: string[] = []
  const errors: string[] = []
  const results: BulkItemResult[] = []
  const succeed = (workId: string) => {
    affected.push(workId)
    results.push({ id: workId, status: 'succeeded', workId })
  }
  const fail = (id: string, reason: string) => {
    failed.push(id)
    errors.push(`${id}: ${reason}`)
    results.push({ id, status: 'failed', reason })
  }

  if (action === 'set-categories') {
    const categoryIds = Array.isArray(body.categoryIds) ? body.categoryIds.map(String) : []
    if (categoryIds.length !== 1) return json({ ok: false, error: '每张图必须且只能选择一个作品类型' }, 400)
    const categories = await payload.find({ collection: 'categories', where: { categoryId: { in: categoryIds } }, limit: 1000, depth: 0, overrideAccess: true })
    if (categories.docs.length !== categoryIds.length) return json({ ok: false, error: '分类不存在' }, 400)
    for (const work of works) {
      try {
        await payload.update({ collection: 'works', id: work.id, data: { categories: categories.docs.map((item: any) => item.id) }, context: { audit: false, skipFieldAccess: true }, overrideAccess: true, req })
        succeed(work.workId)
      } catch (error) {
        fail(work.workId, (error as Error).message)
      }
    }
  } else if (action === 'add-to-topic') {
    if (!body.topicId) return json({ ok: false, error: 'topicId 必填' }, 400)
    const topicResult = await payload.find({ collection: 'topics', where: { topicId: { equals: body.topicId } }, limit: 1, depth: 0, overrideAccess: true })
    const topic = topicResult.docs[0]
    if (!topic) return json({ ok: false, error: '专题不存在' }, 404)
    try {
      const membership = await addTopicMemberships(payload, topic, ids, req)
      for (const id of membership.added) succeed(id)
      for (const id of membership.already) {
        skipped.push(id)
        affected.push(id)
        results.push({ id, status: 'skipped', reason: '已在专题' })
      }
      for (const failure of membership.failed) fail(failure.id, failure.error)
    } catch (error) {
      for (const work of works) fail(work.workId, (error as Error).message)
    }
  } else {
    const nextStatus = action === 'hide' ? 'hidden' : action === 'restore' ? 'published' : action === 'remove' ? 'removed' : 'deleted'
    // 先校验所有作品状态，再开始写，避免后面的校验失败让前面的写入变成假失败。
    for (const work of works) {
      const valid =
        (action === 'hide' && work.status === 'published') ||
        (action === 'restore' && work.status === 'hidden') ||
        (action === 'remove' && work.status === 'pending') ||
        (action !== 'hide' && action !== 'restore' && action !== 'remove')
      if (!valid) {
        const expected = action === 'hide' ? '已发布' : action === 'restore' ? '隐藏' : '待发布'
        return json({ ok: false, error: `作品 ${work.workId} 不是${expected}状态` }, 400)
      }
    }
    for (const work of works) {
      try {
        await payload.update({
          collection: 'works',
          id: work.id,
          data: { status: nextStatus, needsPublish: true, changeAction: action },
          context: { audit: false, skipFieldAccess: true },
          overrideAccess: true,
          req,
        })
        succeed(work.workId)
      } catch (error) {
        fail(work.workId, (error as Error).message)
      }
    }
  }

  await writeAudit(req, { action: `works.bulk.${action}`, after: { affected, action, topicId: body.topicId }, before: works.map((work) => ({ status: work.status, workId: work.workId })), targetId: ids.join(','), targetType: 'works' })
  return json({ ok: failed.length === 0, action, affected, skipped, failed, errors, results })
}

export const WorksBulkEndpoint: Endpoint = {
  handler: bulkHandler,
  method: 'post',
  path: '/bulk',
}
