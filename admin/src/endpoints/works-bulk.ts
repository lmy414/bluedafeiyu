/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Endpoint, PayloadRequest } from 'payload'

import { json, readJsonBody, requireOwnerOrBot } from '../lib/endpoint-auth'
import { writeAudit } from '../lib/audit'
import { validateContent } from '../lib/sync-submissions'

const ALLOWED_ACTIONS = ['hide', 'restore', 'remove', 'delete', 'set-categories', 'add-to-topic', 'include'] as const
type BulkAction = (typeof ALLOWED_ACTIONS)[number]

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

const bulkHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  const role = (req.user as any)?.role
  const body = await readJsonBody<{ action?: BulkAction; confirm?: string; ids?: string[]; categoryIds?: string[]; topicId?: string }>(req)
  const action = body.action
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : []
  if (!action || !ALLOWED_ACTIONS.includes(action)) return json({ ok: false, error: 'action 非法' }, 400)
  if (!ids.length) return json({ ok: false, error: 'ids 不能为空' }, 400)
  if (role === 'bot' && action !== 'set-categories') return json({ ok: false, error: '机器人无此操作权限' }, 403)
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
    const existing = Array.isArray(topic.works) ? topic.works.map((item: any) => String(item?.id ?? item)) : []
    const next = [...existing]
    for (const work of works) {
      const id = String(work.id)
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
