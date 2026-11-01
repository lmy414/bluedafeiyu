import fs from 'node:fs/promises'
import path from 'node:path'
import type { Endpoint, PayloadRequest } from 'payload'
import { json } from '../lib/endpoint-auth'

const snapshotPath = () =>
  process.env.ADMIN_SERVER_BATCH_SNAPSHOT ||
  path.resolve(process.cwd(), '../.build/admin-workflow-refinement/server-batches-snapshot.json')

async function history(req: PayloadRequest) {
  if (req.user?.role !== 'owner') return json({ error: '批次历史仅限站长' }, req.user ? 403 : 401)
  try {
    const value = JSON.parse(await fs.readFile(snapshotPath(), 'utf8'))
    return json({
      configured: true,
      capturedAt: value.capturedAt ?? null,
      capturedAtNote: value.capturedAtNote || '原始只读采集未记录精确时间',
      generatedAt: value.generatedAt || null,
      source: value.source,
      note: value.note,
      batches: Array.isArray(value.batches) ? value.batches : [],
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return json({ configured: false, capturedAt: null, source: null, note: '未配置服务器只读快照', batches: [] })
    return json({ configured: false, error: (error as Error).message }, 500)
  }
}

export const ServerBatchEndpoints: Endpoint[] = [
  { path: '/console/server-batches', method: 'get', handler: history },
]
