/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

import type { Endpoint, PayloadRequest } from 'payload'

import { json, readJsonBody, requireOwnerOrBot, requireWorker } from '../lib/endpoint-auth'
import { writeAudit } from '../lib/audit'
import { applyPublishStatus, buildPublishPlan, buildPublishSnapshot } from '../lib/publish'
import { queueRightsReplies } from '../lib/rights-requests'

function requestDir(): string {
  return path.resolve(process.env.ADMIN_PUBLISH_REQUEST_DIR || path.resolve(process.cwd(), 'run'))
}

async function findRun(req: PayloadRequest, runId: string): Promise<any | null> {
  const result = await (req.payload as any).find({ collection: 'publish-runs', where: { runId: { equals: runId } }, limit: 1, depth: 0, overrideAccess: true })
  return result.docs[0] ?? null
}

const planHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  return json(await buildPublishPlan(req.payload))
}

const requestHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  const payload = req.payload as any
  const role = (req.user as any)?.role
  const active = await payload.find({
    collection: 'publish-runs',
    where: { status: { in: ['queued', 'in_progress'] } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (active.docs[0]) return json({ ok: false, error: '已有排队或执行中的发布批次', run: active.docs[0] }, 409)

  const plan = await buildPublishPlan(req.payload)
  const requestedAt = new Date().toISOString()
  const runId = `run_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
  const run = await payload.create({
    collection: 'publish-runs',
    data: {
      runId,
      trigger: role === 'bot' ? 'bot' : 'manual',
      mode: 'publish',
      status: 'queued',
      requestedAt,
      requestedBy: (req.user as any)?.id,
      plannedChanges: plan,
      summary: plan.summary,
    },
    context: { audit: false },
    overrideAccess: true,
    req,
  })

  const targetDir = requestDir()
  const target = path.join(targetDir, 'publish.request')
  const temp = path.join(targetDir, `.publish.request.${runId}.tmp`)
  const actor = (req.user as any)?.displayName || (req.user as any)?.email || 'system'
  try {
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(temp, `${JSON.stringify({ runId, requestedAt, actor })}\n`, 'utf8')
    await fs.rename(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    await payload.update({ collection: 'publish-runs', id: run.id, data: { status: 'failed', error: (error as Error).message, finishedAt: new Date().toISOString() }, context: { audit: false }, overrideAccess: true, req })
    return json({ ok: false, error: `写发布请求失败：${(error as Error).message}` }, 500)
  }
  await writeAudit(req, { action: 'publish.request', after: { runId, requestedAt, actor }, targetId: run.id, targetType: 'publish-runs' })
  return json({ ok: true, runId, requestedAt, plan })
}

const snapshotHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireWorker(req)
  if (denied) return denied
  const url = new URL(req.url || 'http://localhost')
  const runId = String(url.searchParams.get('runId') || '')
  if (!runId) return json({ ok: false, error: 'runId 必填' }, 400)
  const run = await findRun(req, runId)
  if (!run) return json({ ok: false, error: '批次不存在' }, 404)
  if (run.status !== 'queued' && run.status !== 'in_progress') return json({ ok: false, error: '批次状态不允许取快照' }, 409)
  const snapshot = await buildPublishSnapshot(req.payload, run)
  await (req.payload as any).update({ collection: 'publish-runs', id: run.id,
    data: { plannedChanges: { ...run.plannedChanges, snapshotVersions: snapshot.versions } },
    context: { audit: false }, overrideAccess: true, req })
  return json(snapshot)
}

const runStatusHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireWorker(req)
  if (denied) return denied
  const route = (req.routeParams || {}) as Record<string, string>
  const body = await readJsonBody<any>(req)
  const status = body.status
  if (!['in_progress', 'succeeded', 'failed'].includes(status)) return json({ ok: false, error: 'status 非法' }, 400)
  const run = await findRun(req, route.runId)
  if (!run) return json({ ok: false, error: '批次不存在' }, 404)
  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') return json({ ok: false, error: '批次已经结束' }, 409)
  if (run.status === 'queued' && status === 'succeeded') {
    // 允许执行器因极短发布直接上报成功，但仍走一次状态落盘。
  }

  const payload = req.payload as any
  const data: Record<string, any> = {
    status,
    step: body.step || undefined,
    log: body.log || undefined,
    error: body.error || undefined,
    commits: body.commits || undefined,
    releasePath: body.releasePath || undefined,
    healthCheck: body.healthCheck || undefined,
  }
  if (status === 'in_progress') data.startedAt = new Date().toISOString()
  if (status === 'failed') data.finishedAt = new Date().toISOString()
  if (status === 'succeeded') data.finishedAt = new Date().toISOString()

  if (status === 'succeeded') {
    await applyPublishStatus(req, run, body)
    data.results = body.results || undefined
  }

  await payload.update({ collection: 'publish-runs', id: run.id, data, context: { audit: false }, overrideAccess: true, req })
  // Reply failures never turn a successfully deployed release into a failed batch.
  // The next Hermes sync resumes the durable request records.
  if (status === 'succeeded') await queueRightsReplies(payload).catch(() => undefined)
  if (status !== 'succeeded') {
    await writeAudit(req, { action: `publish.${status}`, after: { body, runId: run.runId }, targetId: run.id, targetType: 'publish-runs' })
  }
  return json({ ok: true, runId: run.runId, status })
}

const runHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  const route = (req.routeParams || {}) as Record<string, string>
  const run = await findRun(req, route.runId)
  if (!run) return json({ ok: false, error: '批次不存在' }, 404)
  return json({ ok: true, run })
}

export const PublishEndpoints: Endpoint[] = [
  { handler: planHandler, method: 'get', path: '/publish/plan' },
  { handler: requestHandler, method: 'post', path: '/publish/request' },
  { handler: snapshotHandler, method: 'get', path: '/publish/snapshot' },
  { handler: runStatusHandler, method: 'post', path: '/publish/runs/:runId/status' },
  { handler: runHandler, method: 'get', path: '/publish/runs/:runId' },
]
