/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'
import { json, readJsonBody, requireWorker } from '../lib/endpoint-auth'
import { writeAudit } from '../lib/audit'
import { fingerprint, JOB_OPERATIONS, loadVocabulary, RUNNABLE, stepJob, validatePatch } from '../lib/bulk-jobs'

const ownerOnly = (req: PayloadRequest) =>
  req.user?.role === 'owner' ? null : json({ ok: false, error: '批量任务仅限站长' }, req.user ? 403 : 401)
const findJob = async (req: PayloadRequest, id: string) => {
  const found = await (req.payload as any).find({
    collection: 'bulk-jobs',
    where: { jobId: { equals: id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return found.docs[0]
}
const summary = (job: any) => ({
  jobId: job.jobId,
  operation: job.operation,
  target: job.target,
  status: job.status,
  cursor: job.cursor,
  total: job.ids.length,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  finishedAt: job.finishedAt,
  succeeded: (job.results || []).filter((r: any) => r.status === 'succeeded').length,
  skipped: (job.results || []).filter((r: any) => r.status === 'skipped').length,
  failed: (job.results || []).filter((r: any) => r.status === 'failed').length,
})

export async function createBulkJob(req: PayloadRequest): Promise<Response> {
  const denied = ownerOnly(req)
  if (denied) return denied
  const body = await readJsonBody<any>(req)
  if (!JOB_OPERATIONS.includes(body.operation) || !['works', 'submissions'].includes(body.target))
    return json({ error: '批量操作或目标非法' }, 400)
  if (body.operation === 'manual-include' && (body.target !== 'submissions' || body.confirm !== 'MANUAL_INCLUDE'))
    return json({ error: '批量人工收录需要明确确认已逐张复核' }, 400)
  const ids = Array.isArray(body.ids) ? [...new Set<string>(body.ids)] : []
  if (!ids.length || ids.length > 200 || ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)))
    return json({ error: '每批选择 1～200 个有效条目' }, 400)
  if (body.force && body.confirm !== 'OVERWRITE') return json({ error: '覆盖已有译文需要明确确认' }, 400)
  const jobId =
    typeof body.requestId === 'string' && /^[a-f0-9-]{36}$/.test(body.requestId) ? body.requestId : crypto.randomUUID()
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({ operation: body.operation, target: body.target, ids, patch: body.patch || {}, force: body.force === true, confirm: body.confirm || null })).digest('hex')
  const existing = await findJob(req, jobId)
  if (existing) {
    if (
      String(existing.requestedBy) !== String(req.user!.id) ||
      existing.operation !== body.operation ||
      existing.target !== body.target ||
      JSON.stringify(existing.ids) !== JSON.stringify(ids) ||
      existing.options?.requestHash !== requestHash
    )
      return json({ error: '请求编号已被其他批量任务使用' }, 409)
    return json({ ok: true, job: summary(existing) })
  }
  const active = await (req.payload as any).count({
    collection: 'bulk-jobs',
    where: { status: { in: RUNNABLE } },
    overrideAccess: true,
  })
  if (active.totalDocs >= 5) return json({ error: '已有 5 个批量任务等待处理，请稍后提交' }, 429)
  let patch: any
  try {
    if (body.operation === 'write-fields') patch = validatePatch(body.patch, await loadVocabulary(req.payload))
  } catch (error) {
    return json({ error: (error as Error).message }, 400)
  }
  const versions: Record<string, string> = {}
  const selected = await (req.payload as any).find({ collection: body.target, where: { [body.target === 'works' ? 'workId' : 'submissionId']: { in: ids } }, depth: 0, limit: ids.length, pagination: false, overrideAccess: true })
  const byId = new Map<string, any>(selected.docs.map((doc: any) => [body.target === 'works' ? doc.workId : doc.submissionId, doc]))
  for (const id of ids) {
    const doc = byId.get(id)
    if (!doc) return json({ error: `条目不存在：${id}` }, 404)
    versions[id] = fingerprint(doc, body.target)
  }
  const transactionID = await (req.payload.db as any).beginTransaction()
  if (transactionID == null) throw new Error('创建批量任务需要数据库事务')
  const transactionReq = { ...req, transactionID, context: { ...req.context } } as PayloadRequest
  let job: any
  try {
  job = await (req.payload as any).create({
    collection: 'bulk-jobs',
    data: {
      jobId,
      operation: body.operation,
      target: body.target,
      status: 'queued',
      ids,
      cursor: 0,
      results: [],
      options: { versions, patch, requestHash, force: body.force === true, confirmed: body.confirm || null },
      requestedBy: req.user!.id,
    },
    overrideAccess: true,
    req: transactionReq,
  })
  await writeAudit(transactionReq, {
    action: 'bulk.request',
    targetId: jobId,
    targetType: 'bulk-jobs',
    after: { operation: body.operation, target: body.target, ids, patch, confirmed: body.confirm },
  })
  await (req.payload.db as any).commitTransaction(transactionID)
  } catch (error) {
    await (req.payload.db as any).rollbackTransaction(transactionID)
    throw error
  }
  return json({ ok: true, job: summary(job) }, 202)
}

export async function listBulkJobs(req: PayloadRequest) {
  const denied = ownerOnly(req)
  if (denied) return denied
  const id = new URL(req.url || 'http://localhost').searchParams.get('jobId')
  if (id) {
    const job = await findJob(req, id)
    return job ? json({ job: { ...summary(job), results: job.results || [] } }) : json({ error: '任务不存在' }, 404)
  }
  const jobs = await (req.payload as any).find({
    collection: 'bulk-jobs',
    limit: 10,
    sort: '-createdAt',
    depth: 0,
    overrideAccess: true,
  })
  return json({ jobs: jobs.docs.map(summary) })
}

export async function cancelBulkJob(req: PayloadRequest) {
  const denied = ownerOnly(req)
  if (denied) return denied
  const body = await readJsonBody<any>(req)
  const job = await findJob(req, String(body.jobId || ''))
  if (!job) return json({ error: '任务不存在' }, 404)
  if (!RUNNABLE.includes(job.status)) return json({ ok: true })
  await (req.payload as any).update({
    collection: 'bulk-jobs',
    where: { and: [{ id: { equals: job.id } }, { status: { in: RUNNABLE } }] },
    data: { status: 'cancelled', finishedAt: new Date().toISOString() },
    overrideAccess: true,
  })
  await writeAudit(req, { action: 'bulk.cancel', targetId: job.jobId, targetType: 'bulk-jobs' })
  return json({ ok: true })
}

export async function retryBulkJob(req: PayloadRequest) {
  const denied = ownerOnly(req)
  if (denied) return denied
  const body = await readJsonBody<any>(req)
  const job = await findJob(req, String(body.jobId || ''))
  if (!job || RUNNABLE.includes(job.status)) return json({ error: '只能重试已结束任务' }, 400)
  const ids = (job.results || []).filter((r: any) => r.status === 'failed').map((r: any) => r.id)
  if (!ids.length) return json({ error: '没有失败项可重试' }, 400)
  return createBulkJob({
    ...req,
    json: async () => ({
      ids,
      target: job.target,
      operation: job.operation,
      patch: job.options.patch,
      force: job.options.force,
      confirm: job.options.confirmed,
      requestId: crypto.randomUUID(),
    }),
  } as PayloadRequest)
}

let processing = false
export async function processNextBulkItem(req: PayloadRequest) {
  const denied = requireWorker(req)
  if (denied) return denied
  if (processing) return json({ busy: true }, 409)
  processing = true
  try {
    const found = await (req.payload as any).find({
      collection: 'bulk-jobs',
      where: { status: { in: RUNNABLE } },
      limit: 1,
      sort: 'createdAt',
      depth: 0,
      overrideAccess: true,
    })
    const job = found.docs[0]
    if (!job) return json({ idle: true })
    const user = await (req.payload as any)
      .findByID({ collection: 'users', id: job.requestedBy, depth: 0, overrideAccess: true })
      .catch(() => null)
    if (user?.role !== 'owner') {
      await (req.payload as any).update({
        collection: 'bulk-jobs',
        id: job.id,
        data: {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          cursor: job.ids.length,
          results: [...(job.results || []), ...job.ids.slice(job.cursor).map((id: string) => ({ id, status: 'failed', message: '提交者不再具有站长权限' }))],
        },
        overrideAccess: true,
      })
      return json({ jobId: job.jobId, status: 'failed' })
    }
    if (job.status === 'queued') {
      const claimed = await (req.payload as any).update({ collection: 'bulk-jobs', where: { and: [{ id: { equals: job.id } }, { status: { equals: 'queued' } }] }, data: { status: 'running' }, overrideAccess: true })
      if (!claimed.docs?.length) return json({ idle: false, skipped: true })
    }
    const next = await stepJob({ ...req, user, context: { audit: true } } as PayloadRequest, job)
    return json({ idle: false, job: summary(next), result: next.results?.at(-1) })
  } finally {
    processing = false
  }
}

export const BulkJobEndpoints: Endpoint[] = [
  { path: '/bulk/request', method: 'post', handler: createBulkJob },
  { path: '/bulk/jobs', method: 'get', handler: listBulkJobs },
  { path: '/bulk/cancel', method: 'post', handler: cancelBulkJob },
  { path: '/bulk/retry', method: 'post', handler: retryBulkJob },
  { path: '/bulk/process-next', method: 'post', handler: processNextBulkItem },
]
