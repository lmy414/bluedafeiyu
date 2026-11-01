/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'

export type MembershipFailure = { id: string; error: string }
export type MembershipResult = {
  added: string[]
  already: string[]
  failed: MembershipFailure[]
  skipped: string[]
  undoToken?: string
}

const ALLOWED_WORK_STATES: Record<string, true> = { pending: true, published: true }
const MAX_MEMBERS = 200

function signUndoToken(
  topicId: string,
  workIds: string[],
  topicUpdatedAt: string,
) {
  const payload = Buffer.from(
    JSON.stringify({ v: 2, topicId, workIds, topicUpdatedAt, exp: Date.now() + 24 * 60 * 60 * 1000 }),
  ).toString('base64url')
  const signature = crypto
    .createHmac('sha256', process.env.PAYLOAD_SECRET || '')
    .update(payload)
    .digest('base64url')
  return `${payload}.${signature}`
}

export function verifyUndoToken(token: string):
  | { topicId: string; workIds: string[]; topicUpdatedAt: string }
  | null {
  const [payload, signature] = String(token || '').split('.')
  if (!payload || !signature) return null
  const expected = crypto
    .createHmac('sha256', process.env.PAYLOAD_SECRET || '')
    .update(payload)
    .digest('base64url')
  if (signature.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (parsed?.v !== 2 || typeof parsed.topicId !== 'string' || !Array.isArray(parsed.workIds)) return null
    if (!Number.isFinite(parsed.exp) || parsed.exp < Date.now()) return null
    return {
      topicId: parsed.topicId,
      workIds: parsed.workIds.map(String),
      topicUpdatedAt: String(parsed.topicUpdatedAt || ''),
    }
  } catch {
    return null
  }
}

export async function findTopic(payload: Payload, topicId: string, req?: PayloadRequest) {
  const result = await payload.find({
    collection: 'topics',
    where: { topicId: { equals: topicId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return result.docs[0] || null
}

const relationIds = (topic: any): number[] =>
  (Array.isArray(topic?.works) ? topic.works : [])
    .map((value: any) => Number(value && typeof value === 'object' ? value.id : value))
    .filter((id: number) => Number.isSafeInteger(id) && id > 0)

async function validateWorks(payload: Payload, workIds: string[], req?: PayloadRequest) {
  const found = await payload.find({
    collection: 'works',
    where: { workId: { in: workIds } },
    limit: MAX_MEMBERS,
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return new Map<string, any>(found.docs.map((doc: any) => [String(doc.workId), doc]))
}

async function addMembershipsInTx(
  payload: Payload,
  topic: any,
  workIds: string[],
  txReq: PayloadRequest,
): Promise<MembershipResult> {
  const ids = [...new Set(workIds.map((id) => String(id || '').trim()).filter(Boolean))]
  const result: MembershipResult = { added: [], already: [], failed: [], skipped: [] }
  if (!ids.length) return result
  if (ids.length > MAX_MEMBERS) throw new Error('每批最多 200 个作品')
  const byKey = await validateWorks(payload, ids, txReq)
  const existing = relationIds(topic)
  const existingSet = new Set(existing)
  const next = [...existing]
  for (const id of ids) {
    const work = byKey.get(id)
    if (!work) {
      result.failed.push({ id, error: '作品不存在' })
      continue
    }
    if (!ALLOWED_WORK_STATES[String(work.status)]) {
      result.failed.push({ id, error: `作品状态 ${work.status || '未知'} 不可加入专题` })
      continue
    }
    if (existingSet.has(Number(work.id))) {
      result.already.push(id)
      continue
    }
    existingSet.add(Number(work.id))
    next.push(Number(work.id))
    result.added.push(id)
  }
  if (result.added.length) {
    const saved = await payload.update({
      collection: 'topics',
      id: topic.id,
      data: { works: next, needsPublish: true },
      overrideAccess: true,
      req: txReq,
    })
    result.undoToken = signUndoToken(String(saved.topicId), result.added, String(saved.updatedAt || ''))
  }
  return result
}

let writeQueue: Promise<unknown> = Promise.resolve()

function withWriteLock<T>(run: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(run, run)
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

async function transaction<T>(
  payload: Payload,
  req: PayloadRequest,
  run: (txReq: PayloadRequest) => Promise<T>,
): Promise<T> {
  return withWriteLock(async () => {
    const transactionID = await (payload.db as any).beginTransaction()
    if (transactionID == null) {
      // Legacy in-memory adapters without transaction support (tests): keep the
      // read-modify-write under the process write lock. Production configured
      // with immediate transactions uses the atomic path above.
      const plainReq = { ...req, context: { ...req.context } } as PayloadRequest
      return run(plainReq)
    }
    const txReq = { ...req, transactionID, context: { ...req.context } } as PayloadRequest
    try {
      const value = await run(txReq)
      await (payload.db as any).commitTransaction(transactionID)
      return value
    } catch (error) {
      await (payload.db as any).rollbackTransaction(transactionID)
      throw error
    }
  })
}

export async function addTopicMemberships(
  payload: Payload,
  topic: any,
  workIds: string[],
  req: PayloadRequest,
): Promise<MembershipResult> {
  return transaction(payload, req, async (txReq) => {
    const fresh = await (payload as any).findByID({
      collection: 'topics',
      id: topic.id,
      depth: 0,
      overrideAccess: true,
      req: txReq,
    })
    if (!fresh) throw new Error('专题不存在')
    return addMembershipsInTx(payload, fresh, workIds, txReq)
  })
}

async function removeInTx(
  payload: Payload,
  topic: any,
  workIds: string[],
  txReq: PayloadRequest,
) {
  const ids = [...new Set(workIds.map((id) => String(id || '').trim()).filter(Boolean))]
  const removed: string[] = []
  const alreadyAbsent: string[] = []
  const kept: MembershipFailure[] = []
  const works = await validateWorks(payload, ids, txReq)
  const existing = relationIds(topic)
  const next = [...existing]
  for (const id of ids) {
    const work = works.get(id)
    if (!work || !existing.includes(Number(work.id))) {
      alreadyAbsent.push(id)
      continue
    }
    if (String(topic.cover) === String(work.id)) {
      kept.push({ id, error: '是专题封面，请先更换封面再移除' })
      continue
    }
    next.splice(next.indexOf(Number(work.id)), 1)
    removed.push(id)
  }
  if (removed.length)
    await payload.update({
      collection: 'topics',
      id: topic.id,
      data: { works: next, needsPublish: true },
      overrideAccess: true,
      req: txReq,
    })
  return { removed, alreadyAbsent, kept }
}

export async function removeTopicMemberships(
  payload: Payload,
  topic: any,
  workIds: string[],
  req: PayloadRequest,
) {
  return transaction(payload, req, async (txReq) => {
    const fresh = await (payload as any).findByID({
      collection: 'topics',
      id: topic.id,
      depth: 0,
      overrideAccess: true,
      req: txReq,
    })
    if (!fresh) throw new Error('专题不存在')
    return removeInTx(payload, fresh, workIds, txReq)
  })
}

export async function undoMemberships(payload: Payload, token: string, req: PayloadRequest) {
  const decoded = verifyUndoToken(token)
  if (!decoded) throw new Error('撤销凭证无效或已过期')
  return transaction(payload, req, async (txReq) => {
    const topic = await findTopic(payload, decoded.topicId, txReq)
    if (!topic) throw new Error('专题不存在')
    if (String(topic.updatedAt || '') !== decoded.topicUpdatedAt)
      throw new Error('专题成员已变化，撤销凭证已失效；请按当前成员重新核对')
    const result = await removeInTx(payload, topic, decoded.workIds, txReq)
    return { topicId: topic.topicId, removed: result.removed, alreadyAbsent: result.alreadyAbsent, kept: result.kept }
  })
}

export async function createQuickTopic(
  payload: Payload,
  input: { topicId: string; name: string; summary: string; workIds: string[] },
  req: PayloadRequest,
) {
  return transaction(payload, req, async (txReq) => {
    let topic = await findTopic(payload, input.topicId, txReq)
    let created = false
    if (!topic) {
      const last = await (payload as any).find({
        collection: 'topics',
        sort: '-order',
        limit: 1,
        depth: 0,
        overrideAccess: true,
        req: txReq,
      })
      topic = await (payload as any).create({
        collection: 'topics',
        data: {
          topicId: input.topicId,
          name: input.name,
          summary: input.summary,
          status: 'draft',
          order: Number(last.docs[0]?.order || 0) + 1,
          works: [],
        },
        overrideAccess: true,
        context: { quickTopic: true },
        req: txReq,
      })
      created = true
    }
    const membership = await addMembershipsInTx(payload, topic, input.workIds, txReq)
    const fresh = await (payload as any).findByID({
      collection: 'topics',
      id: topic.id,
      depth: 1,
      overrideAccess: true,
      req: txReq,
    })
    return { created, topic: fresh, membership }
  })
}
