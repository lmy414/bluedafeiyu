/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'

import { json, readJsonBody } from '../lib/endpoint-auth'
import { writeAudit } from '../lib/audit'
import {
  addTopicMemberships,
  createQuickTopic,
  findTopic,
  removeTopicMemberships,
  undoMemberships,
} from '../lib/topics-membership'

const ownerOnly = (req: PayloadRequest) =>
  req.user?.role === 'owner'
    ? null
    : json({ ok: false, error: '专题成员仅限站长手动操作' }, req.user ? 403 : 401)

const workIdsOf = (body: any): string[] =>
  Array.isArray(body?.workIds)
    ? [...new Set<string>(body.workIds.map((id: unknown) => String(id || '').trim()).filter(Boolean))]
    : []

async function add(req: PayloadRequest) {
  const denied = ownerOnly(req)
  if (denied) return denied
  const route = (req.routeParams || {}) as Record<string, string>
  const topic = await findTopic(req.payload, route.topicId || '')
  if (!topic) return json({ ok: false, error: '专题不存在' }, 404)
  const body = await readJsonBody<any>(req)
  const workIds = workIdsOf(body)
  if (!workIds.length) return json({ ok: false, error: 'workIds 不能为空' }, 400)
  try {
    const result = await addTopicMemberships(req.payload, topic, workIds, req)
    await writeAudit(req, {
      action: 'topics.membership.add',
      targetId: topic.topicId,
      targetType: 'topics',
      after: { added: result.added, already: result.already, failed: result.failed },
    })
    return json({ ok: result.failed.length === 0, ...result })
  } catch (error) {
    return json({ ok: false, error: (error as Error).message }, 400)
  }
}

async function remove(req: PayloadRequest) {
  const denied = ownerOnly(req)
  if (denied) return denied
  const route = (req.routeParams || {}) as Record<string, string>
  const topic = await findTopic(req.payload, route.topicId || '')
  if (!topic) return json({ ok: false, error: '专题不存在' }, 404)
  const body = await readJsonBody<any>(req)
  const workIds = workIdsOf(body)
  if (!workIds.length) return json({ ok: false, error: 'workIds 不能为空' }, 400)
  const result = await removeTopicMemberships(req.payload, topic, workIds, req)
  await writeAudit(req, {
    action: 'topics.membership.remove',
    targetId: topic.topicId,
    targetType: 'topics',
    after: result,
  })
  return json({ ok: result.kept.length === 0, ...result })
}

async function undo(req: PayloadRequest) {
  const denied = ownerOnly(req)
  if (denied) return denied
  const body = await readJsonBody<any>(req)
  try {
    const result = await undoMemberships(req.payload, String(body.undoToken || ''), req)
    await writeAudit(req, {
      action: 'topics.membership.undo',
      targetId: result.topicId,
      targetType: 'topics',
      after: result,
    })
    return json({ ok: true, ...result })
  } catch (error) {
    return json({ ok: false, error: (error as Error).message }, 400)
  }
}

async function quickCreate(req: PayloadRequest) {
  const denied = ownerOnly(req)
  if (denied) return denied
  const body = await readJsonBody<any>(req)
  const name = String(body.name || '').trim().slice(0, 200)
  const summary = String(body.summary || '').trim().slice(0, 2000)
  if (!name) return json({ ok: false, error: '专题名称不能为空' }, 400)
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
  const generated = `topic-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const topicId = requestId && /^[a-z0-9-]{8,80}$/.test(requestId) ? `topic-${requestId}` : generated
  const workIds = workIdsOf(body)
  try {
    const result = await createQuickTopic(
      req.payload,
      { topicId, name, summary, workIds },
      req,
    )
    await writeAudit(req, {
      action: 'topics.quick-create',
      targetId: topicId,
      targetType: 'topics',
      after: { created: result.created, added: result.membership.added, already: result.membership.already },
    })
    return json(
      {
        ok: result.membership.failed.length === 0,
        created: result.created,
        doc: { ...result.topic, works: (result.topic.works || []).map((item: any) => item?.workId || item) },
        ...result.membership,
      },
      result.created ? 201 : 200,
    )
  } catch (error) {
    return json({ ok: false, error: (error as Error).message }, 400)
  }
}

async function recent(req: PayloadRequest) {
  const denied = ownerOnly(req)
  if (denied) return denied
  const params = new URL(req.url || 'http://localhost').searchParams
  const limit = Math.min(20, Math.max(1, Number(params.get('limit')) || 8))
  const found = await (req.payload as any).find({
    collection: 'topics',
    sort: '-updatedAt',
    limit,
    depth: 0,
    overrideAccess: true,
  })
  const ids = found.docs.map((doc: any) => Number(doc.id))
  const counts = new Map<number, number>()
  if (ids.length) {
    const database = (req.payload.db as any).client
    const rows = await database.execute({
      sql: `SELECT parent_id,count(*) AS total FROM topics_rels WHERE path='works' AND parent_id IN (${ids.map(() => '?').join(',')}) GROUP BY parent_id`,
      args: ids,
    })
    for (const row of rows.rows) counts.set(Number(row.parent_id), Number(row.total))
  }
  return json({
    topics: found.docs.map((doc: any) => ({
      id: doc.id,
      topicId: doc.topicId,
      name: doc.name,
      status: doc.status,
      updatedAt: doc.updatedAt,
      workCount: counts.get(Number(doc.id)) || 0,
      translationState: doc.translationState || 'none',
    })),
  })
}

export const TopicMembershipEndpoints: Endpoint[] = [
  { path: '/quick', method: 'post', handler: quickCreate },
  { path: '/recent', method: 'get', handler: recent },
  { path: '/membership/undo', method: 'post', handler: undo },
  { path: '/:topicId/works', method: 'post', handler: add },
  { path: '/:topicId/works/remove', method: 'post', handler: remove },
]
