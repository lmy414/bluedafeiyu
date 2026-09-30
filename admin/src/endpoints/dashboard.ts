/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Endpoint, PayloadRequest } from 'payload'

import { json, readJsonBody, requireOwnerOrBot } from '../lib/endpoint-auth'
import { writeAudit } from '../lib/audit'
import { syncSubmissions } from '../lib/sync-submissions'

async function dashboardStats(req: PayloadRequest) {
  const payload = req.payload as any
  const [works, submissions, topics, runs] = await Promise.all([
    payload.find({ collection: 'works', limit: 3000, depth: 0, overrideAccess: true, pagination: false }),
    payload.find({ collection: 'submissions', limit: 3000, depth: 0, overrideAccess: true, pagination: false }),
    payload.find({ collection: 'topics', limit: 1000, depth: 0, overrideAccess: true, pagination: false }),
    payload.find({ collection: 'publish-runs', limit: 1, sort: '-requestedAt', depth: 0, overrideAccess: true }),
  ])
  const pendingByChannel: Record<string, number> = {}
  const needsPublishByChannel: Record<string, number> = {}
  for (const work of works.docs) {
    if (work.status === 'pending') pendingByChannel[work.channel] = (pendingByChannel[work.channel] || 0) + 1
    if (work.needsPublish) needsPublishByChannel[work.channel] = (needsPublishByChannel[work.channel] || 0) + 1
  }
  const reviewPending = submissions.docs.filter((doc: any) => ['received', 'reviewing', 'needs_manual'].includes(doc.state)).length
  const autoRejected = submissions.docs.filter((doc: any) => doc.state === 'auto_rejected').length
  const aiReviewing = submissions.docs.filter((doc: any) => ['received', 'reviewing'].includes(doc.state)).length
  const needsAttention = submissions.docs.filter((doc: any) => ['auto_rejected', 'needs_manual'].includes(doc.state) && !doc.work).length
  return {
    pendingByChannel,
    needsPublishByChannel,
    pendingReview: reviewPending,
    autoRejected,
    aiReviewing,
    needsAttention,
    needsPublish: works.docs.filter((doc: any) => doc.needsPublish).length,
    topicsNeedsPublish: topics.docs.filter((doc: any) => doc.needsPublish).length,
    latestRun: runs.docs[0] || null,
  }
}

const statsHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  return json(await dashboardStats(req))
}

const syncHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  let body: any = {}
  try {
    body = await readJsonBody(req)
  } catch {
    body = {}
  }
  const url = new URL(req.url || 'http://localhost')
  const stats = await syncSubmissions(req.payload, {
    dryRun: Boolean(body.dryRun),
    limit: Number(body.limit || url.searchParams.get('limit') || 500),
    source: body.source || url.searchParams.get('source') || undefined,
    state: body.state || url.searchParams.get('state') || undefined,
  })
  await writeAudit(req, { action: 'submissions.sync', after: stats, targetId: req.user ? String((req.user as any).id) : 'worker', targetType: 'submissions' })
  return json({ ok: true, stats })
}

export const SubmissionsSyncEndpoint: Endpoint = { handler: syncHandler, method: 'post', path: '/sync' }

export const DashboardEndpoints: Endpoint[] = [
  { handler: statsHandler, method: 'get', path: '/dashboard/stats' },
  SubmissionsSyncEndpoint,
]
