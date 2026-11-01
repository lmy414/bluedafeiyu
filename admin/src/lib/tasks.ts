/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payload } from 'payload'
import { consoleRows, SUB_AUTHOR_SQL, WORK_AUTHOR_SQL, workProcessingStateSQL } from './console-list'

export type TaskRow = {
  kind: string
  contentType: string | null
  sourceId: string
  operation: string
  title: string
  bucket: 'decide' | 'intervene' | 'publish' | 'processing' | 'history'
  owner: 'owner' | 'system' | 'none'
  stage: string | null
  reason: string | null
  error: string | null
  current: number
  total: number
  createdAt: string
  updatedAt: string
  canRetry: number
  canCancel: number
  actor: string | null
  target: string | null
  source: string | null
  author: string | null
  retryOf: string | null
  retriedBy: string | null
  retriedByStatus?: string | null
  jobId: string | null
  jobStatus: string | null
  jobCursor: number | null
  jobTotal: number | null
  jobSucceeded: number | null
  jobSkipped: number | null
  jobFailed: number | null
  jobStage: string | null
  jobError: string | null
  jobFinishedAt: string | null
  autoRetryAt: number | null
  blocked: number
  batchId?: string | null
  batchLabel?: string | null
  batchItemCount?: number | null
  sourceKind?: string | null
  sourceLabel?: string | null
  contentState: string | null
  needsPublish: number | null
  contentStatus: string | null
  workId: string | null
  lastPublishRun: number | null
  changeAction: string | null
  unit: 'task' | 'content'
}

const NO_JOB = 'NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0'

const ACTIVE_SUBMISSION_JOBS = `active_jobs AS (
  SELECT * FROM (
    SELECT j.job_id,j.operation,j.status,j.cursor,json_array_length(j.ids) AS total,
      json_extract(j.options,'$.agent.stage') AS stage,
      json_extract(j.options,'$.agent.retryAt') AS retryAt,
      json_extract(j.options,'$.agent.lastError') AS error,
      (SELECT count(*) FROM json_each(CASE WHEN json_valid(j.results) THEN j.results ELSE '[]' END) r WHERE json_extract(r.value,'$.status')='succeeded') AS succeeded,
      (SELECT count(*) FROM json_each(CASE WHEN json_valid(j.results) THEN j.results ELSE '[]' END) r WHERE json_extract(r.value,'$.status')='skipped') AS skipped,
      (SELECT count(*) FROM json_each(CASE WHEN json_valid(j.results) THEN j.results ELSE '[]' END) r WHERE json_extract(r.value,'$.status')='failed') AS failed,
      cast(item.value AS TEXT) AS sid,
      row_number() OVER (PARTITION BY cast(item.value AS TEXT) ORDER BY j.created_at DESC) AS rn
    FROM bulk_jobs j,json_each(j.ids) item
    WHERE j.target='submissions' AND j.status IN ('queued','running')
  ) WHERE rn=1
)`

const ACTIVE_WORK_JOBS = `active_work_jobs AS (
  SELECT * FROM (
    SELECT j.job_id,j.operation,j.status,j.cursor,json_array_length(j.ids) AS total,
      json_extract(j.options,'$.agent.stage') AS stage,
      json_extract(j.options,'$.agent.retryAt') AS retryAt,
      cast(item.value AS TEXT) AS wid,
      row_number() OVER (PARTITION BY cast(item.value AS TEXT) ORDER BY j.created_at DESC) AS rn
    FROM bulk_jobs j,json_each(j.ids) item
    WHERE j.target='works'
  ) WHERE rn=1
)`

const RAW_TASKS = `
SELECT 'bulk' AS kind,NULL AS contentType,b.job_id AS sourceId,b.operation AS operation,
  b.operation || ' · ' || json_array_length(b.ids) || ' 项' AS title,
  CASE
    WHEN EXISTS(SELECT 1 FROM bulk_jobs child WHERE json_extract(child.options,'$.retryOf')=b.job_id AND child.status<>'cancelled') THEN 'history'
    WHEN b.status IN ('queued','running') AND json_extract(b.options,'$.agent.stage')='blocked' THEN 'intervene'
    WHEN b.status IN ('queued','running') AND json_extract(b.options,'$.agent.stage')='retry' AND coalesce(json_extract(b.options,'$.agent.retryAt'),0)>0 THEN 'processing'
    WHEN b.status IN ('queued','running') AND json_extract(b.options,'$.agent.stage')='retry' THEN 'intervene'
    WHEN b.status IN ('queued','running') THEN 'processing'
    WHEN b.status IN ('partial','failed') THEN 'intervene'
    ELSE 'history' END AS bucket,
  coalesce(nullif(json_extract(b.options,'$.agent.stage'),''),b.status) AS stage,NULL AS reason,
  json_extract(b.options,'$.agent.lastError') AS error,
  b.cursor AS current,json_array_length(b.ids) AS total,b.created_at AS createdAt,b.updated_at AS updatedAt,
  CASE WHEN EXISTS(SELECT 1 FROM bulk_jobs child WHERE json_extract(child.options,'$.retryOf')=b.job_id AND child.status<>'cancelled') THEN 0
    WHEN b.status IN ('partial','failed') OR (b.status IN ('queued','running') AND json_extract(b.options,'$.agent.stage')='blocked') THEN 1 ELSE 0 END AS canRetry,
  CASE WHEN b.status IN ('queued','running') THEN 1 ELSE 0 END AS canCancel,
  coalesce((SELECT display_name FROM users WHERE id=b.requested_by_id),'站长') AS actor,
  b.target AS target,b.target AS source,NULL AS author,
  json_extract(b.options,'$.retryOf') AS retryOf,
  (SELECT child.job_id FROM bulk_jobs child WHERE json_extract(child.options,'$.retryOf')=b.job_id AND child.status<>'cancelled' ORDER BY child.created_at DESC LIMIT 1) AS retriedBy,
  b.job_id AS jobId,b.status AS jobStatus,b.cursor AS jobCursor,json_array_length(b.ids) AS jobTotal,
  (SELECT count(*) FROM json_each(CASE WHEN json_valid(b.results) THEN b.results ELSE '[]' END) r WHERE json_extract(r.value,'$.status')='succeeded') AS jobSucceeded,
  (SELECT count(*) FROM json_each(CASE WHEN json_valid(b.results) THEN b.results ELSE '[]' END) r WHERE json_extract(r.value,'$.status')='skipped') AS jobSkipped,
  (SELECT count(*) FROM json_each(CASE WHEN json_valid(b.results) THEN b.results ELSE '[]' END) r WHERE json_extract(r.value,'$.status')='failed') AS jobFailed,
  nullif(json_extract(b.options,'$.agent.stage'),'') AS jobStage,json_extract(b.options,'$.agent.lastError') AS jobError,b.finished_at AS jobFinishedAt,
  CASE WHEN b.status IN ('queued','running') AND json_extract(b.options,'$.agent.stage')='retry' AND coalesce(json_extract(b.options,'$.agent.retryAt'),0)>0 THEN json_extract(b.options,'$.agent.retryAt') ELSE NULL END AS autoRetryAt,
  CASE WHEN json_extract(b.options,'$.agent.stage')='blocked' THEN 1 ELSE 0 END AS blocked,
  NULL AS contentState,NULL AS needsPublish,NULL AS contentStatus,NULL AS workId,NULL AS lastPublishRun,NULL AS changeAction,
  'task' AS unit
FROM bulk_jobs b
UNION ALL
SELECT 'publish',NULL,pr.run_id,'publish','发布网站',
  CASE
    WHEN pr.status IN ('queued','in_progress','running') THEN 'processing'
    WHEN pr.status='failed' AND EXISTS(SELECT 1 FROM publish_runs newer WHERE newer.status='succeeded' AND newer.created_at>pr.created_at) THEN 'history'
    WHEN pr.status='failed' THEN 'intervene'
    ELSE 'history' END,
  CASE WHEN pr.status='failed' AND EXISTS(SELECT 1 FROM publish_runs newer WHERE newer.status='succeeded' AND newer.created_at>pr.created_at) THEN 'superseded' ELSE coalesce(nullif(pr.step,''),pr.status) END,NULL,pr.error,
  CASE WHEN pr.status='succeeded' THEN 1 ELSE 0 END,1,coalesce(pr.requested_at,pr.created_at),pr.updated_at,
  0,0,coalesce((SELECT display_name FROM users WHERE id=pr.requested_by_id),'发布执行器'),'publish','site',NULL,
  NULL,NULL,${NO_JOB},NULL,NULL,NULL,NULL,NULL,NULL,
  'task'
FROM publish_runs pr
UNION ALL
SELECT 'submission',NULL,s.submission_id,'submission',s.title,
  CASE
    WHEN s.work_id IS NOT NULL THEN 'history'
    WHEN aj.job_id IS NOT NULL AND aj.stage='blocked' THEN 'intervene'
    WHEN aj.job_id IS NOT NULL THEN 'processing'
    WHEN coalesce(json_extract(s.agent_progress,'$.stage'),'')='blocked' THEN 'intervene'
    WHEN coalesce(json_extract(s.agent_progress,'$.stage'),'')='retry' AND coalesce(json_extract(s.agent_progress,'$.retryAt'),0)<=0 THEN 'intervene'
    WHEN s.state='publish_failed' THEN 'intervene'
    WHEN s.state IN ('auto_rejected','needs_manual') THEN 'decide'
    WHEN s.state='rejected' THEN 'history'
    WHEN coalesce(json_extract(s.agent_progress,'$.stage'),'')='retry' THEN 'processing'
    WHEN s.state IN ('received','reviewing','auto_passed','approved','ready_to_publish','publishing') THEN 'processing'
    ELSE 'history' END,
  coalesce(nullif(json_extract(s.agent_progress,'$.stage'),''),s.state),
  json_extract(CASE WHEN json_valid(s.review) THEN s.review ELSE '{}' END,'$.reason'),
  json_extract(s.agent_progress,'$.lastError'),
  0,0,s.created_at,s.updated_at,
  CASE WHEN aj.job_id IS NOT NULL AND aj.stage='blocked' THEN 1 ELSE 0 END,0,
  s.source,'submissions',s.source,(${SUB_AUTHOR_SQL}),
  NULL,NULL,
  aj.job_id,aj.status,aj.cursor,aj.total,aj.succeeded,aj.skipped,aj.failed,aj.stage,aj.error,NULL,
  CASE
    WHEN aj.job_id IS NOT NULL AND aj.stage='retry' AND coalesce(aj.retryAt,0)>0 THEN aj.retryAt
    WHEN coalesce(json_extract(s.agent_progress,'$.stage'),'')='retry' AND coalesce(json_extract(s.agent_progress,'$.retryAt'),0)>0 THEN json_extract(s.agent_progress,'$.retryAt')
    ELSE NULL END,
  CASE WHEN coalesce(json_extract(s.agent_progress,'$.stage'),'')='blocked' OR aj.stage='blocked' THEN 1 ELSE 0 END,
  CASE
    WHEN s.work_id IS NULL OR w.id IS NULL THEN NULL
    WHEN coalesce(w.needs_publish,0)=1 OR w.status='pending' THEN 'pending_publish'
    WHEN w.status IN ('published','hidden','removed','deleted') THEN w.status
    ELSE 'unknown' END,
  w.needs_publish,w.status,w.work_id,w.last_publish_run_id,w.change_action,
  'task'
FROM submissions s
LEFT JOIN works w ON w.id=s.work_id
LEFT JOIN active_jobs aj ON aj.sid=s.submission_id
WHERE NOT (s.work_id IS NOT NULL AND (coalesce(w.needs_publish,0)=1 OR w.status='pending'))
  AND aj.job_id IS NULL
UNION ALL
SELECT 'rights',NULL,cast(r.id AS TEXT),r.request_type,r.request_id,
  CASE
    WHEN r.status IN ('completed','rejected') THEN 'history'
    WHEN coalesce(json_extract(r.agent_progress,'$.stage'),'')='blocked' THEN 'intervene'
    WHEN coalesce(json_extract(r.agent_progress,'$.stage'),'')='awaiting_publish' THEN 'publish'
    WHEN coalesce(json_extract(r.agent_progress,'$.stage'),'')='reply_queued' THEN 'processing'
    WHEN r.status='investigating' THEN 'processing'
    ELSE 'decide' END,
  coalesce(nullif(json_extract(r.agent_progress,'$.stage'),''),r.status),NULL,
  json_extract(r.agent_progress,'$.lastError'),
  0,0,r.created_at,r.updated_at,0,0,'申请人','rights','github',NULL,
  NULL,NULL,${NO_JOB},
  NULL,NULL,NULL,NULL,NULL,NULL,
  'task'
FROM takedown_requests r
UNION ALL
SELECT 'creator',NULL,cast(c.id AS TEXT),'creator',c.name,
  CASE
    WHEN c.status='paused' THEN 'history'
    WHEN c.error IS NOT NULL AND c.error<>'' AND c.retry_at IS NOT NULL AND datetime(c.retry_at)>datetime('now') THEN 'processing'
    WHEN c.error IS NOT NULL AND c.error<>'' THEN 'intervene'
    WHEN c.status='queued' THEN 'processing'
    ELSE 'history' END,
  CASE
    WHEN c.error IS NOT NULL AND c.error<>'' AND c.retry_at IS NOT NULL AND datetime(c.retry_at)>datetime('now') THEN 'retry'
    WHEN c.error IS NOT NULL AND c.error<>'' THEN 'error'
    ELSE c.status END,
  c.error,NULL,
  0,0,c.created_at,c.updated_at,0,0,'Bilibili 作者','creators','bilibili',c.name,
  NULL,NULL,
  NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
  CASE WHEN c.retry_at IS NOT NULL AND datetime(c.retry_at)>datetime('now') THEN cast(strftime('%s',c.retry_at) AS INTEGER)*1000 ELSE NULL END,
  CASE WHEN c.error IS NOT NULL AND c.error<>'' AND NOT (c.retry_at IS NOT NULL AND datetime(c.retry_at)>datetime('now')) THEN 1 ELSE 0 END,
  NULL,NULL,NULL,NULL,NULL,NULL,
  'task'
FROM creators c
UNION ALL
SELECT 'video',NULL,cast(v.id AS TEXT),'video',v.title,
  CASE WHEN v.status='manual' THEN 'decide' WHEN v.status IN ('queued','reviewing') THEN 'processing' ELSE 'history' END,
  v.status,json_extract(CASE WHEN json_valid(v.review) THEN v.review ELSE '{}' END,'$.reason'),NULL,
  0,0,v.created_at,v.updated_at,0,0,'Bilibili','videos','bilibili',NULL,
  NULL,NULL,${NO_JOB},
  NULL,NULL,NULL,NULL,NULL,NULL,
  'task'
FROM videos v
WHERE NOT (v.needs_publish=1 AND v.status IN ('approved','hidden'))
UNION ALL
SELECT 'content','work',cast(w.id AS TEXT),'publish',w.name,
  'publish','pending_publish',NULL,NULL,
  0,1,w.created_at,w.updated_at,0,0,'站长','publish',w.channel,(${WORK_AUTHOR_SQL}),
  NULL,NULL,${NO_JOB},
  'pending_publish',w.needs_publish,w.status,w.work_id,w.last_publish_run_id,w.change_action,
  'content'
FROM works w
LEFT JOIN active_work_jobs aw ON aw.wid=w.work_id
WHERE (${workProcessingStateSQL('w')})='needs_publish'
UNION ALL
SELECT 'content','topic',cast(t.id AS TEXT),'publish',t.name,
  'publish','pending_publish',NULL,NULL,
  0,1,t.created_at,t.updated_at,0,0,'站长','publish','site',NULL,
  NULL,NULL,${NO_JOB},
  'pending_publish',t.needs_publish,t.status,NULL,t.last_publish_run_id,NULL,
  'content'
FROM topics t
WHERE t.needs_publish=1
UNION ALL
SELECT 'content','video',cast(v.id AS TEXT),'publish',v.title,
  'publish','pending_publish',NULL,NULL,
  0,1,v.created_at,v.updated_at,0,0,'站长','publish','bilibili',NULL,
  NULL,NULL,${NO_JOB},
  'pending_publish',v.needs_publish,v.status,NULL,NULL,NULL,
  'content'
FROM videos v
WHERE v.needs_publish=1
UNION ALL
SELECT 'content','creator',cast(c.id AS TEXT),'publish',c.name,
  'publish','pending_publish',NULL,NULL,
  0,1,c.created_at,c.updated_at,0,0,'站长','publish','bilibili',c.name,
  NULL,NULL,${NO_JOB},
  'pending_publish',c.needs_publish,c.status,NULL,NULL,NULL,
  'content'
FROM creators c
WHERE c.needs_publish=1`

const TASKS_CTE = `WITH ${ACTIVE_WORK_JOBS}, ${ACTIVE_SUBMISSION_JOBS}, raw AS (${RAW_TASKS}),
tasks AS (SELECT raw.*,
  CASE WHEN raw.bucket='processing' THEN 'system' WHEN raw.bucket='history' THEN 'none' ELSE 'owner' END AS owner
FROM raw)`

export type TaskQuery = {
  group: string
  kind: string
  contentType: string
  owner: string
  source: string
  author: string
  task: string
  batch: string
  sourceKind: string
  keyword: string
  page: number
}

function taskFilters(q: TaskQuery, includeGroup: boolean) {
  const where: string[] = []
  const args: any[] = []
  if (includeGroup) {
    if (q.group === 'all') where.push("unit='task'")
    else if (q.group === 'publish') where.push("bucket='publish'")
    else {
      where.push("bucket=? AND unit='task'")
      args.push(q.group)
    }
  }
  if (q.kind === 'content') where.push("unit='content'")
  else if (q.kind) {
    where.push('(kind=? OR (unit=\'content\' AND contentType=?))')
    args.push(q.kind, q.kind)
  }
  if (q.contentType) {
    where.push("unit='content' AND contentType=?")
    args.push(q.contentType)
  }
  if (q.owner) {
    where.push('owner=?')
    args.push(q.owner)
  }
  if (q.source) {
    where.push('source=?')
    args.push(q.source)
  }
  if (q.author) {
    where.push('author=?')
    args.push(q.author)
  }
  if (q.task) {
    where.push('sourceId=?')
    args.push(q.task)
  }
  if (q.batch) {
    where.push(
      `(
        (kind='bulk' AND sourceId IN (SELECT job_id FROM bulk_jobs WHERE coalesce(json_extract(options,'$.agent.batchId'),json_extract(options,'$.batchId'))=?)) OR
        (kind='bulk' AND sourceId=?) OR
        (kind='publish' AND sourceId=?) OR
        (kind='submission' AND sourceId IN (SELECT submission_id FROM submissions s2 WHERE json_extract(s2.agent_progress,'$.batchId')=? OR EXISTS(SELECT 1 FROM json_each(s2.agent_progress,'$.batchHistory') h WHERE json_extract(h.value,'$.batchId')=?))) OR
        (kind='rights' AND sourceId IN (SELECT request_id FROM takedown_requests r2 WHERE json_extract(r2.agent_progress,'$.batchId')=? OR EXISTS(SELECT 1 FROM json_each(r2.agent_progress,'$.batchHistory') h WHERE json_extract(h.value,'$.batchId')=?))) OR
        (kind='video' AND sourceId IN (SELECT cast(id AS TEXT) FROM videos v2 WHERE EXISTS(SELECT 1 FROM json_each(v2.lease,'$.batchHistory') h WHERE json_extract(h.value,'$.batchId')=?)))
      )`,
    )
    args.push(q.batch, q.batch, q.batch, q.batch, q.batch, q.batch, q.batch, q.batch)
  }
  if (q.sourceKind) {
    const hermes = "(kind='bulk' AND operation IN ('ai-fill','translate','manual-include','translate-topic')) OR kind='rights' OR (kind='submission' AND stage IN ('editing','translating','ready','retry','blocked'))"
    const map: Record<string, string> = {
      hermes: `(${hermes})`,
      'bulk-worker': "(kind='bulk' AND operation='write-fields')",
      'publish-executor': "kind='publish'",
      'video-sync': "kind='video'",
      'creator-sync': "kind='creator'",
      'submission-sync': "(kind='submission' AND stage NOT IN ('editing','translating','ready','retry','blocked'))",
      'rights-agent': "kind='rights'",
      'local-editor': "(kind='bulk' AND sourceId IN (SELECT job_id FROM bulk_jobs WHERE json_extract(options,'$.agent.sourceKind')='local-editor' OR json_extract(options,'$.sourceKind')='local-editor'))",
    }
    if (map[q.sourceKind]) where.push(map[q.sourceKind])
  }
  if (q.keyword) {
    where.push("(title LIKE ? ESCAPE '\\' OR sourceId LIKE ? ESCAPE '\\')")
    const pattern = `%${q.keyword.replace(/[\\%_]/g, '\\$&')}%`
    args.push(pattern, pattern)
  }
  return { where, args }
}

export type TaskCountsResult = {
  tasks: Record<'all' | 'decide' | 'intervene' | 'publish' | 'processing' | 'history', number>
  content: { publish: number }
  all: number
  decide: number
  intervene: number
  publish: number
  processing: number
  history: number
}

export async function taskCounts(payload: Payload, q: TaskQuery): Promise<TaskCountsResult> {
  const f = taskFilters(q, false)
  const rows = await consoleRows(
    payload,
    `${TASKS_CTE} SELECT unit,bucket,count(*) AS total FROM tasks ${f.where.length ? `WHERE ${f.where.join(' AND ')}` : ''} GROUP BY unit,bucket`,
    f.args,
  )
  const tasks = { all: 0, decide: 0, intervene: 0, publish: 0, processing: 0, history: 0 }
  let contentPublish = 0
  for (const row of rows) {
    const total = Number(row.total || 0)
    if (row.unit === 'content' && row.bucket === 'publish') contentPublish += total
    else if (row.unit === 'task' && row.bucket in tasks) tasks[row.bucket as keyof typeof tasks] += total
  }
  tasks.all = tasks.decide + tasks.intervene + tasks.publish + tasks.processing + tasks.history
  return {
    tasks,
    content: { publish: contentPublish },
    all: tasks.all,
    decide: tasks.decide,
    intervene: tasks.intervene,
    publish: contentPublish,
    processing: tasks.processing,
    history: tasks.history,
  }
}

export async function taskRows(payload: Payload, q: TaskQuery, page: number, perPage = 30) {
  const f = taskFilters(q, true)
  const rows = await consoleRows(
    payload,
    `${TASKS_CTE} SELECT * FROM tasks ${f.where.length ? `WHERE ${f.where.join(' AND ')}` : ''}
    ORDER BY CASE bucket WHEN 'decide' THEN 0 WHEN 'intervene' THEN 1 WHEN 'publish' THEN 2 WHEN 'processing' THEN 3 ELSE 4 END,
      updatedAt DESC,kind,sourceId LIMIT ? OFFSET ?`,
    [...f.args, perPage, (page - 1) * perPage],
  )
  return rows as TaskRow[]
}
