import type { Endpoint, PayloadRequest } from 'payload'
import { consoleRows } from '../lib/console-list'
import { json } from '../lib/endpoint-auth'
import type { ConsoleTask, TaskKind } from '../components/admin/task-types'

// A read model over the existing queues. Workers remain the only executors.
const TASKS = `
SELECT 'bulk' AS kind,b.job_id AS sourceId,b.operation,b.operation || ' · ' || json_array_length(b.ids) || ' 项' AS title,
 CASE WHEN status IN ('queued','running') AND json_extract(options,'$.agent.stage')='blocked' THEN 'attention'
 WHEN status='running' THEN 'running' WHEN status IN ('partial','failed') THEN 'failed'
 WHEN status='succeeded' AND EXISTS(SELECT 1 FROM works w WHERE w.needs_publish=1 AND (w.work_id IN (SELECT value FROM json_each(b.ids)) OR w.submission_id IN (SELECT value FROM json_each(b.ids)))) THEN 'ready'
 WHEN status='succeeded' THEN 'completed' ELSE status END AS status,
 json_extract(options,'$.agent.stage') AS stage,json_extract(options,'$.agent.lastError') AS error,
 cursor AS current,json_array_length(ids) AS total,created_at AS createdAt,updated_at AS updatedAt,
 CASE WHEN status IN ('partial','failed') OR (status IN ('queued','running') AND json_extract(options,'$.agent.stage')='blocked') THEN 1 ELSE 0 END AS canRetry,
 CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END AS canCancel,
 coalesce((SELECT display_name FROM users WHERE id=b.requested_by_id),'站长') AS actor,b.target AS target
FROM bulk_jobs b WHERE NOT EXISTS(SELECT 1 FROM bulk_jobs child WHERE json_extract(child.options,'$.retryOf')=b.job_id)
UNION ALL
SELECT 'publish',run_id,'publish','发布网站',
 CASE WHEN status='in_progress' THEN 'running' WHEN status='succeeded' THEN 'completed' ELSE status END,
 step,error,CASE WHEN status='succeeded' THEN 1 ELSE 0 END,1,coalesce(requested_at,created_at),updated_at,0,0,coalesce((SELECT display_name FROM users WHERE id=requested_by_id),'发布执行器'),'publish' FROM publish_runs
UNION ALL
SELECT 'submission',cast(id AS TEXT),'submission',title,
 CASE WHEN state='publish_failed' THEN 'failed'
 WHEN work_id IS NOT NULL OR state IN ('published','rejected') THEN 'completed'
 WHEN state IN ('auto_rejected','needs_manual') OR json_extract(agent_progress,'$.stage')='blocked' THEN 'attention'
 WHEN state IN ('reviewing','publishing') THEN 'running' ELSE 'queued' END,
 CASE WHEN work_id IS NOT NULL THEN 'included' WHEN state IN ('auto_rejected','needs_manual') THEN state ELSE coalesce(json_extract(agent_progress,'$.stage'),state) END,
 json_extract(agent_progress,'$.lastError'),0,0,created_at,updated_at,0,0,source,'submissions' FROM submissions s
 WHERE NOT EXISTS(SELECT 1 FROM bulk_jobs j,json_each(j.ids) item WHERE j.target='submissions' AND j.operation='manual-include' AND j.status<>'cancelled' AND item.value=s.submission_id)
UNION ALL
SELECT 'rights',cast(id AS TEXT),request_type,request_id,
 CASE WHEN status IN ('completed','rejected') THEN 'completed'
 WHEN json_extract(agent_progress,'$.stage')='blocked' THEN 'attention'
 WHEN json_extract(agent_progress,'$.stage') IN ('awaiting_publish','reply_queued') THEN 'ready'
 WHEN status='investigating' THEN 'running' ELSE 'attention' END,
 coalesce(json_extract(agent_progress,'$.stage'),status),json_extract(agent_progress,'$.lastError'),0,0,created_at,updated_at,0,0,'申请人','rights' FROM takedown_requests
UNION ALL
SELECT 'changes','pending','changes','全部待发布内容','ready','pending',NULL,0,count(*),min(createdAt),max(updatedAt),0,0,'站长 / 机器人','publish'
FROM (SELECT created_at AS createdAt,updated_at AS updatedAt FROM works WHERE needs_publish=1
 UNION ALL SELECT created_at,updated_at FROM topics WHERE needs_publish=1) HAVING count(*)>0
`

export async function listTasks(req: PayloadRequest): Promise<Response> {
  if (req.user?.role !== 'owner') return json({ error: '任务中心仅限站长' }, req.user ? 403 : 401)
  const params = new URL(req.url || 'http://localhost').searchParams
  const where: string[] = []
  const args: string[] = []
  const kind = params.get('kind') || ''
  const task = params.get('task') || ''
  const keyword = (params.get('keyword') || '').trim().slice(0, 200)
  if (kind) {
    where.push('kind=?')
    args.push(kind)
  }
  if (task) {
    where.push('sourceId=?')
    args.push(task)
  }
  if (keyword) {
    where.push("(title LIKE ? ESCAPE '\\' OR sourceId LIKE ? ESCAPE '\\')")
    const pattern = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`
    args.push(pattern, pattern)
  }
  const scope = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const countsRows = await consoleRows(
    req.payload,
    `WITH tasks AS (${TASKS}) SELECT status,count(*) AS total FROM tasks ${scope} GROUP BY status`,
    args,
  )
  const counts: Record<string, number> = Object.fromEntries(
    countsRows.map((row) => [row.status, Number(row.total)]),
  )
  counts.all = Object.values(counts).reduce((a, b) => a + b, 0)
  counts.attention = (counts.attention || 0) + (counts.failed || 0)
  counts.running = (counts.running || 0) + (counts.queued || 0)
  counts.completed = (counts.completed || 0) + (counts.cancelled || 0)
  if (params.get('summary') === 'true') return json({ counts })
  const status = params.get('status') || 'all'
  const totalDocs = status === 'all' ? counts.all : counts[status] || 0
  if (status !== 'all') {
    const groups: Record<string, string[]> = {
      attention: ['attention', 'failed'],
      running: ['running', 'queued'],
      completed: ['completed', 'cancelled'],
    }
    const states = groups[status] || [status]
    where.push(`status IN (${states.map(() => '?').join(',')})`)
    args.push(...states)
  }
  const totalPages = Math.max(1, Math.ceil(totalDocs / 30))
  const requestedPage = Number(params.get('page'))
  const page = Math.min(
    totalPages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  )
  const rows = await consoleRows(
    req.payload,
    `WITH tasks AS (${TASKS}) SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE status WHEN 'attention' THEN 0 WHEN 'failed' THEN 1 WHEN 'running' THEN 2 WHEN 'queued' THEN 3 ELSE 4 END,updatedAt DESC,kind,sourceId LIMIT 30 OFFSET ?`,
    [...args, (page - 1) * 30],
  )
  const docs: ConsoleTask[] = rows.map((row) => {
    const type = row.kind as TaskKind
    const href =
      type === 'submission'
        ? `/admin/review?mode=${row.status === 'attention' && ['auto_rejected', 'needs_manual'].includes(row.stage) ? 'rejected' : row.status === 'completed' ? 'reviewed' : 'processing'}&item=${encodeURIComponent(row.sourceId)}`
        : type === 'rights'
          ? `/admin/collections/takedown-requests/${encodeURIComponent(row.sourceId)}`
          : type === 'changes' || type === 'publish'
            ? '/admin/publish'
            : row.target === 'submissions'
              ? '/admin/review?mode=rejected'
              : '/admin/library'
    return {
      ...row,
      key: `${type}:${row.sourceId}`,
      kind: type,
      href,
      canRetry: Boolean(row.canRetry),
      canCancel: Boolean(row.canCancel),
    } as ConsoleTask
  })
  return json({ docs, counts, page, totalPages, totalDocs })
}

export const TaskEndpoints: Endpoint[] = [
  { path: '/console/tasks', method: 'get', handler: listTasks },
]
