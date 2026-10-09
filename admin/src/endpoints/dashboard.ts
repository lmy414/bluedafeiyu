/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Endpoint, PayloadRequest } from 'payload'

import { json, readJsonBody, requireOwnerOrBot, requireWorker } from '../lib/endpoint-auth'
import { writeAudit } from '../lib/audit'
import { syncSubmissions } from '../lib/sync-submissions'
import { consoleRows } from '../lib/console-list'

async function dashboardStats(req: PayloadRequest) {
  const payload = req.payload as any
  const [works, submissions, topics, runs] = await Promise.all([
    consoleRows(payload, "SELECT channel,sum(status='pending') AS pending,sum(needs_publish=1) AS needs FROM works GROUP BY channel"),
    consoleRows(payload, "SELECT sum(state IN ('received','reviewing','needs_manual')) AS pending,sum(state='auto_rejected') AS rejected,sum(state IN ('received','reviewing')) AS reviewing,sum(state IN ('auto_rejected','needs_manual') AND work_id IS NULL) AS attention FROM submissions"),
    consoleRows(payload, 'SELECT count(*) AS total FROM topics WHERE needs_publish=1'),
    payload.find({ collection: 'publish-runs', limit: 1, sort: '-requestedAt', depth: 0, overrideAccess: true }),
  ])
  const pendingByChannel: Record<string, number> = {}
  const needsPublishByChannel: Record<string, number> = {}
  for (const row of works) { pendingByChannel[row.channel] = Number(row.pending); needsPublishByChannel[row.channel] = Number(row.needs) }
  const counts = submissions[0] || {}
  return {
    pendingByChannel,
    needsPublishByChannel,
    pendingReview: Number(counts.pending || 0),
    autoRejected: Number(counts.rejected || 0),
    aiReviewing: Number(counts.reviewing || 0),
    needsAttention: Number(counts.attention || 0),
    needsPublish: Object.values(needsPublishByChannel).reduce((a, b) => a + b, 0),
    topicsNeedsPublish: Number(topics[0].total),
    latestRun: runs.docs[0] || null,
  }
}

const statsHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  return json(await dashboardStats(req))
}

const syncHandler = async (req: PayloadRequest): Promise<Response> => {
  const role = (req.user as any)?.role
  if (role !== 'owner' && role !== 'bot') {
    const denied = requireWorker(req)
    if (denied) return denied
  }
  let body: any = {}
  try {
    body = await readJsonBody(req)
  } catch {
    body = {}
  }
  const url = new URL(req.url || 'http://localhost')
  const stats = await syncSubmissions(req.payload, {
    dryRun: Boolean(body.dryRun),
    incremental: body.full !== true,
    limit: Number(body.limit || url.searchParams.get('limit') || 200),
    source: body.source || url.searchParams.get('source') || undefined,
    state: body.state || url.searchParams.get('state') || undefined,
  })
  await writeAudit(req, { action: 'submissions.sync', after: stats, targetId: req.user ? String((req.user as any).id) : 'worker', targetType: 'submissions' })
  return json({ ok: stats.errors.length === 0, stats })
}

export const SubmissionsSyncEndpoint: Endpoint = { handler: syncHandler, method: 'post', path: '/sync' }

export const DashboardEndpoints: Endpoint[] = [
  { handler: statsHandler, method: 'get', path: '/dashboard/stats' },
  SubmissionsSyncEndpoint,
]
