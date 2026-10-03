import type { Endpoint, PayloadRequest } from 'payload'

import { analyticsConfig, publishedMetrics, readAnalytics, syncAnalytics } from '../lib/analytics'
import { json, requireOwnerOrBot, requireWorker } from '../lib/endpoint-auth'

async function snapshotResponse(req: PayloadRequest, admin: boolean) {
  const snapshot = await readAnalytics()
  const result = await req.payload.find({
    collection: 'works', depth: 0, pagination: false, limit: 10000, overrideAccess: true,
    where: { status: { equals: 'published' } }, select: { workId: true },
  })
  const data = publishedMetrics(snapshot, result.docs.map(work => work.workId))
  return Response.json(admin ? { ...data, configured: analyticsConfig().configured, unassigned: snapshot?.unassigned || 0 } : data, {
    headers: { 'Cache-Control': admin ? 'no-store' : 'public, max-age=300' },
  })
}

export const AnalyticsEndpoints: Endpoint[] = [
  {
    path: '/analytics/public', method: 'get',
    handler: async req => {
      try { return await snapshotResponse(req, false) }
      catch { return json({ available: false, works: {}, error: '统计暂不可用' }, 503) }
    },
  },
  {
    path: '/analytics', method: 'get',
    handler: async req => {
      const denied = requireOwnerOrBot(req)
      if (denied) return denied
      try { return await snapshotResponse(req, true) }
      catch (error) { return json({ error: (error as Error).message }, 503) }
    },
  },
  {
    path: '/analytics/sync', method: 'post',
    handler: async req => {
      if (req.user?.role !== 'owner') {
        const denied = requireWorker(req)
        if (denied) return denied
      }
      try { await syncAnalytics(); return await snapshotResponse(req, true) }
      catch (error) { return json({ error: (error as Error).message }, 503) }
    },
  },
]
