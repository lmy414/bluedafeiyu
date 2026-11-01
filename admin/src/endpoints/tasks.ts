import type { Endpoint, PayloadRequest } from 'payload'
import { json } from '../lib/endpoint-auth'
import { taskCounts, taskRows, type TaskRow } from '../lib/tasks'
import { consoleRows, SUB_AUTHOR_SQL } from '../lib/console-list'
import { OPERATIONS } from '../components/admin/task-types'
import type {
  ConsoleTask,
  ContentRef,
  ContentState,
  ContentType,
  JobRefFull,
  TaskKind,
  TaskStatus,
} from '../components/admin/task-types'

// A read model over the existing queues. Workers remain the only executors.
const STAGE_LABELS: Record<string, string> = {
  received: '已收到',
  reviewing: '审核中',
  auto_passed: 'AI 已通过',
  auto_rejected: 'AI 已拒绝',
  needs_manual: '待人工审核',
  approved: '人工已通过',
  rejected: '人工已拒绝',
  ready_to_publish: '待发布',
  publishing: '发布中',
  published: '已上线',
  publish_failed: '发布失败',
  queued: '排队中',
  running: '执行中',
  succeeded: '已完成',
  partial: '部分失败',
  failed: '失败',
  cancelled: '已取消',
  editing: '编辑中',
  translating: '翻译中',
  ready: '待提交',
  retry: '等待自动重试',
  blocked: '处理暂挂',
  error: '同步异常',
  manual: '待人工复核',
  active: '持续同步',
  paused: '已暂停',
  investigating: '调查中',
  awaiting_publish: '待发布',
  reply_queued: '等待系统回写',
  pending_publish: '待发布',
  superseded: '已被新批次取代',
  included: '已收录',
}

const GROUPS = ['all', 'decide', 'intervene', 'publish', 'processing', 'history'] as const
const KINDS = ['submission', 'creator', 'video', 'bulk', 'publish', 'rights', 'content'] as const
const CONTENT_TYPES = ['work', 'topic', 'video', 'creator'] as const
const OWNERS = ['owner', 'system', 'none'] as const
const SOURCE_KINDS = ['hermes', 'bulk-worker', 'publish-executor', 'video-sync', 'creator-sync', 'submission-sync', 'rights-agent', 'local-editor'] as const
const SOURCE_LABELS: Record<string, string> = {
  hermes: 'Hermes Agent',
  'bulk-worker': '后台执行器',
  'publish-executor': '发布执行器',
  'video-sync': '视频同步',
  'creator-sync': '作者同步',
  'submission-sync': '投稿同步',
  'rights-agent': '申请处理 Agent',
  'local-editor': '本地编辑 Agent',
}

function sourceKindOf(row: TaskRow) {
  if (row.kind === 'bulk')
    return ['ai-fill', 'translate', 'manual-include', 'translate-topic'].includes(row.operation)
      ? 'hermes'
      : 'bulk-worker'
  if (row.kind === 'publish') return 'publish-executor'
  if (row.kind === 'video') return 'video-sync'
  if (row.kind === 'creator') return 'creator-sync'
  if (row.kind === 'rights') return 'rights-agent'
  if (row.kind === 'submission')
    return ['editing', 'translating', 'ready', 'retry', 'blocked'].includes(String(row.stage || ''))
      ? 'hermes'
      : 'submission-sync'
  return null
}

const parseOptions = (value: unknown) => {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, any>
  try {
    return JSON.parse(String(value)) as Record<string, any>
  } catch {
    return {}
  }
}

async function hydrateBatchMeta(payload: PayloadRequest['payload'], rows: TaskRow[]) {
  const jobIds = [...new Set(rows.map((row) => row.jobId).filter((id): id is string => Boolean(id)))]
  const optionsByJob = new Map<string, Record<string, any>>()
  if (jobIds.length) {
    const jobs = await consoleRows(
      payload,
      `SELECT job_id AS jobId,options FROM bulk_jobs WHERE job_id IN (${jobIds.map(() => '?').join(',')})`,
      jobIds,
    )
    for (const job of jobs) optionsByJob.set(String(job.jobId), parseOptions(job.options))
  }
  for (const row of rows) {
    const options = row.jobId ? optionsByJob.get(row.jobId) || {} : {}
    const sourceKind = String(options.agent?.sourceKind || options.sourceKind || sourceKindOf(row) || '')
    row.sourceKind = sourceKind || null
    row.sourceLabel = sourceKind ? SOURCE_LABELS[sourceKind] || sourceKind : null
    const agentBatch = options.agent?.batchId || options.batchId || null
    row.batchId =
      row.kind === 'bulk' ? String(agentBatch || row.jobId || '') || null : row.kind === 'publish' ? row.sourceId : null
    row.batchItemCount = row.kind === 'bulk' ? Number(row.jobTotal || 0) : row.kind === 'publish' ? 1 : null
    row.batchLabel = row.batchId
      ? `${options.agent?.batchLabel || options.batchLabel || row.sourceLabel || '系统'} · ${OPERATIONS[row.operation] || row.operation}`
      : null
  }
}

async function hydrateSubmissionBatchMeta(payload: PayloadRequest['payload'], rows: TaskRow[], batchFilter = '') {
  const ids = [...new Set(rows.filter((row) => row.kind === 'submission').map((row) => row.sourceId))]
  if (!ids.length) return
  const submissions = await consoleRows(
    payload,
    `SELECT submission_id AS submissionId,agent_progress AS progress FROM submissions WHERE submission_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  )
  const selected = new Map<string, any>()
  for (const item of submissions) {
    let progress: any = {}
    try { progress = JSON.parse(item.progress || '{}') } catch {}
    const history = Array.isArray(progress.batchHistory) ? progress.batchHistory : []
    const match = batchFilter
      ? history.find((entry: any) => String(entry.batchId) === batchFilter)
      : history.at(-1) || (progress.batchId ? progress : null)
    if (match) selected.set(String(item.submissionId), match)
  }
  const batches = [...new Set([...selected.values()].map((item) => String(item.batchId || '')).filter(Boolean))]
  const counts = new Map<string, number>()
  if (batches.length) {
    const grouped = await consoleRows(
      payload,
      `SELECT json_extract(h.value,'$.batchId') AS batchId,count(*) AS total
       FROM submissions s,json_each(s.agent_progress,'$.batchHistory') h
       WHERE json_extract(h.value,'$.batchId') IN (${batches.map(() => '?').join(',')})
       GROUP BY json_extract(h.value,'$.batchId')`,
      batches,
    )
    for (const item of grouped) counts.set(String(item.batchId), Number(item.total))
  }
  for (const row of rows) {
    if (row.kind !== 'submission') continue
    const item = selected.get(row.sourceId)
    if (!item?.batchId) continue
    row.batchId = String(item.batchId)
    row.batchLabel = item.batchLabel || `${SOURCE_LABELS[item.sourceKind] || '服务器批次'} · 投稿审核`
    row.sourceKind = String(item.sourceKind || 'hermes')
    row.sourceLabel = SOURCE_LABELS[row.sourceKind] || row.sourceKind
    row.batchItemCount = counts.get(String(item.batchId)) || 1
  }
}

async function hydrateRightsBatchMeta(payload: PayloadRequest['payload'], rows: TaskRow[], batchFilter = '') {
  const ids = [...new Set(rows.filter((row) => row.kind === 'rights').map((row) => row.sourceId))]
  if (!ids.length) return
  const records = await consoleRows(
    payload,
    `SELECT request_id AS requestId,agent_progress AS progress FROM takedown_requests WHERE request_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  )
  const selected = new Map<string, any>()
  for (const item of records) {
    let progress: any = {}
    try { progress = JSON.parse(item.progress || '{}') } catch {}
    const history = Array.isArray(progress.batchHistory) ? progress.batchHistory : []
    const match = batchFilter ? history.find((entry: any) => String(entry.batchId) === batchFilter) : history.at(-1) || (progress.batchId ? progress : null)
    if (match) selected.set(String(item.requestId), match)
  }
  for (const row of rows) {
    if (row.kind !== 'rights') continue
    const item = selected.get(row.sourceId)
    if (!item?.batchId) continue
    row.batchId = String(item.batchId)
    row.batchLabel = item.batchLabel || 'Hermes Agent · 申请处理'
    row.sourceKind = String(item.sourceKind || 'hermes')
    row.sourceLabel = SOURCE_LABELS[row.sourceKind] || row.sourceKind
    row.batchItemCount = 1
  }
}

async function hydrateVideoBatchMeta(payload: PayloadRequest['payload'], rows: TaskRow[], batchFilter = '') {
  const ids = [...new Set(rows.filter((row) => row.kind === 'video').map((row) => row.sourceId))].filter((id) => /^\d+$/.test(id))
  if (!ids.length) return
  const videos = await consoleRows(
    payload,
    `SELECT id,lease FROM videos WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids.map(Number),
  )
  const meta = new Map<string, any>()
  for (const video of videos) {
    let lease: any = {}
    try { lease = JSON.parse(video.lease || '{}') } catch {}
    const history = Array.isArray(lease.batchHistory) ? lease.batchHistory : []
    const last = batchFilter ? history.find((entry: any) => String(entry.batchId) === batchFilter) : history.at(-1)
    if (last?.batchId) meta.set(String(video.id), last)
  }
  for (const row of rows) {
    if (row.kind !== 'video') continue
    const item = meta.get(row.sourceId)
    if (!item) continue
    row.batchId = String(item.batchId)
    row.batchLabel = item.batchLabel || 'Hermes Agent · 视频审核'
    row.sourceKind = String(item.sourceKind || 'hermes')
    row.sourceLabel = SOURCE_LABELS[row.sourceKind] || row.sourceKind
    row.batchItemCount = 1
  }
}

async function batchSummaries(
  payload: PayloadRequest['payload'],
  filters: { sourceKind?: string; kind?: string; source?: string; author?: string; owner?: string; page?: number; pageSize?: number; history?: boolean } = {},
) {
  const sourceKind = filters.sourceKind || ''
  const kind = filters.kind || ''
  const source = filters.source || ''
  const author = filters.author || ''
  const owner = filters.owner || ''
  const page = Math.max(1, Number(filters.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(filters.pageSize) || 20))
  const batches = new Map<string, {
    batchId: string
    batchLabel: string
    sourceKind: string
    sourceLabel: string
    count: number
    itemCount: number
    updatedAt: string
    status: 'active' | 'finished'
  }>()
  const allowed = (rowKind: string, rowSource: string, rowSourceKind: string) => {
    if (kind && kind !== rowKind) return false
    if (sourceKind && sourceKind !== rowSourceKind) return false
    if (source && source !== rowSource) return false
    if (author && rowKind !== 'submission') return false
    if (owner === 'owner') return false
    return true
  }
  const add = (input: { batchId: string; batchLabel?: string; sourceKind: string; sourceLabel?: string; kind: string; source: string; count: number; itemCount: number; updatedAt: string; status: 'active' | 'finished' }) => {
    if (!allowed(input.kind, input.source, input.sourceKind)) return
    const key = `${input.sourceKind}:${input.batchId}`
    const current = batches.get(key)
    if (current) {
      current.count += input.count
      current.itemCount += input.itemCount
      if (input.updatedAt > current.updatedAt) current.updatedAt = input.updatedAt
    } else {
      batches.set(key, {
        batchId: input.batchId,
        batchLabel: input.batchLabel || `${input.sourceLabel || SOURCE_LABELS[input.sourceKind] || input.sourceKind} · ${OPERATIONS[input.kind] || input.kind}`,
        sourceKind: input.sourceKind,
        sourceLabel: input.sourceLabel || SOURCE_LABELS[input.sourceKind] || input.sourceKind,
        count: input.count,
        itemCount: input.itemCount,
        updatedAt: input.updatedAt,
        status: input.status,
      })
    }
  }
  if (!filters.history) {
    const jobs = await consoleRows(
      payload,
      `SELECT job_id AS jobId,operation,target,json_array_length(ids) AS total,options,updated_at AS updatedAt
       FROM bulk_jobs WHERE status IN ('queued','running') ORDER BY updated_at DESC`,
    )
    for (const job of jobs) {
      const options = parseOptions(job.options)
      const source = String(options.agent?.sourceKind || options.sourceKind || (['ai-fill', 'translate', 'manual-include', 'translate-topic'].includes(String(job.operation)) ? 'hermes' : 'bulk-worker'))
      add({
        batchId: String(options.agent?.batchId || options.batchId || job.jobId),
        batchLabel: options.agent?.batchLabel || options.batchLabel,
        sourceKind: source,
        kind: 'bulk',
        source: String(job.target || ''),
        count: 1,
        itemCount: Number(job.total || 0),
        updatedAt: String(job.updatedAt || ''),
        status: 'active',
      })
    }
    const runs = await consoleRows(
      payload,
      `SELECT run_id AS runId,updated_at AS updatedAt FROM publish_runs WHERE status IN ('queued','in_progress') ORDER BY updated_at DESC`,
    )
    for (const run of runs)
      add({
        batchId: String(run.runId),
        sourceKind: 'publish-executor',
        kind: 'publish',
        source: 'site',
        count: 1,
        itemCount: 1,
        updatedAt: String(run.updatedAt || ''),
        status: 'active',
      })
  } else {
    const submissions = await consoleRows(
      payload,
      `SELECT json_extract(h.value,'$.batchId') AS batchId,
        json_extract(h.value,'$.batchLabel') AS batchLabel,
        coalesce(json_extract(h.value,'$.sourceKind'),'hermes') AS sourceKind,
        max(coalesce(json_extract(h.value,'$.finishedAt'),s.updated_at)) AS updatedAt,
        count(*) AS total
       FROM submissions s LEFT JOIN works w ON w.id=s.work_id,
         json_each(CASE WHEN json_valid(s.agent_progress) THEN s.agent_progress ELSE '{}' END,'$.batchHistory') h
       WHERE json_extract(h.value,'$.batchId') IS NOT NULL
         ${source ? 'AND s.source=?' : ''}
         ${author ? `AND (${SUB_AUTHOR_SQL})=?` : ''}
       GROUP BY batchId,batchLabel,sourceKind`,
      [...(source ? [source] : []), ...(author ? [author] : [])],
    )
    for (const item of submissions)
      add({
        batchId: String(item.batchId),
        batchLabel: item.batchLabel || undefined,
        sourceKind: String(item.sourceKind || 'hermes'),
        kind: 'submission',
        source: source || 'submission',
        count: Number(item.total || 0),
        itemCount: Number(item.total || 0),
        updatedAt: String(item.updatedAt || ''),
        status: 'finished',
      })
    const rights = await consoleRows(
      payload,
      `SELECT json_extract(h.value,'$.batchId') AS batchId,
        json_extract(h.value,'$.batchLabel') AS batchLabel,
        coalesce(json_extract(h.value,'$.sourceKind'),'hermes') AS sourceKind,
        max(coalesce(json_extract(h.value,'$.finishedAt'),r.updated_at)) AS updatedAt,
        count(*) AS total
       FROM takedown_requests r,json_each(CASE WHEN json_valid(r.agent_progress) THEN r.agent_progress ELSE '{}' END,'$.batchHistory') h
       WHERE json_extract(h.value,'$.batchId') IS NOT NULL
       GROUP BY batchId,batchLabel,sourceKind`,
    )
    for (const item of rights)
      add({
        batchId: String(item.batchId),
        batchLabel: item.batchLabel || undefined,
        sourceKind: String(item.sourceKind || 'hermes'),
        kind: 'rights',
        source: 'github',
        count: Number(item.total || 0),
        itemCount: Number(item.total || 0),
        updatedAt: String(item.updatedAt || ''),
        status: 'finished',
      })
    const videos = await consoleRows(
      payload,
      `SELECT json_extract(h.value,'$.batchId') AS batchId,
        json_extract(h.value,'$.batchLabel') AS batchLabel,
        coalesce(json_extract(h.value,'$.sourceKind'),'hermes') AS sourceKind,
        max(coalesce(json_extract(h.value,'$.finishedAt'),v.updated_at)) AS updatedAt,
        count(*) AS total
       FROM videos v,json_each(CASE WHEN json_valid(v.lease) THEN v.lease ELSE '{}' END,'$.batchHistory') h
       WHERE json_extract(h.value,'$.batchId') IS NOT NULL
       GROUP BY batchId,batchLabel,sourceKind`,
    )
    for (const item of videos)
      add({
        batchId: String(item.batchId),
        batchLabel: item.batchLabel || undefined,
        sourceKind: String(item.sourceKind || 'hermes'),
        kind: 'video',
        source: 'bilibili',
        count: Number(item.total || 0),
        itemCount: Number(item.total || 0),
        updatedAt: String(item.updatedAt || ''),
        status: 'finished',
      })
  }
  const all = [...batches.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const start = (page - 1) * pageSize
  return {
    batches: all.slice(start, start + pageSize),
    batchTotal: all.length,
    batchPage: page,
    batchPageSize: pageSize,
    hasMore: start + pageSize < all.length,
  }
}

const oneOf = <T extends readonly string[]>(value: string, values: T): T[number] | '' =>
  (values as readonly string[]).includes(value) ? (value as T[number]) : ''

function stageLabel(row: TaskRow) {
  const stage = String(row.stage || '')
  if (row.unit === 'content') return '待发布'
  if (stage === 'retry' && !row.autoRetryAt) return '自动重试待确认'
  return STAGE_LABELS[stage] || '未知状态'
}

function statusOf(row: TaskRow): TaskStatus {
  if (row.unit === 'content' || row.bucket === 'publish') return 'ready'
  if (row.bucket === 'decide') return 'attention'
  if (row.bucket === 'processing') return row.stage === 'queued' ? 'queued' : 'running'
  if (row.bucket === 'history')
    return row.kind === 'bulk' && row.stage === 'cancelled' ? 'cancelled' : 'completed'
  return row.blocked ? 'attention' : 'failed'
}

function nextActionOf(row: TaskRow): string {
  if (row.unit === 'content' || row.bucket === 'publish') return '检查并发布'
  if (row.bucket === 'decide')
    return row.kind === 'submission' ? '看图审核' : row.kind === 'video' ? '复核视频' : '处理申请'
  if (row.bucket === 'intervene') {
    if (row.kind === 'bulk') return row.canRetry ? '查看失败项并重试' : '检查原因'
    if (row.kind === 'submission')
      return row.stage === 'publish_failed'
        ? '检查发布失败'
        : row.canRetry
          ? '检查原因后重试'
          : '检查原因'
    if (row.kind === 'creator') return '检查同步问题'
    if (row.kind === 'rights') return '检查处理暂挂'
    return '检查失败原因'
  }
  if (row.bucket === 'processing') return row.autoRetryAt ? '等待自动重试' : '等待系统处理'
  if (row.retriedBy) return '查看子任务'
  return '查看结果'
}

function hrefOf(row: TaskRow): string {
  if (row.unit === 'content') return '/admin/publish'
  if (row.retriedBy)
    return `/admin?task=${encodeURIComponent(row.retriedBy)}&kind=bulk`
  if (row.jobId || row.kind === 'bulk')
    return `/admin?task=${encodeURIComponent(row.jobId || row.sourceId)}&kind=bulk`
  if (row.kind === 'submission')
    return `/admin/review?mode=${encodeURIComponent(row.bucket)}&submission=${encodeURIComponent(row.sourceId)}`
  if (row.kind === 'video') return `/admin/collections/videos/${encodeURIComponent(row.sourceId)}`
  if (row.kind === 'creator') return `/admin/collections/creators/${encodeURIComponent(row.sourceId)}`
  if (row.kind === 'rights')
    return `/admin/collections/takedown-requests/${encodeURIComponent(row.sourceId)}`
  return '/admin/publish'
}

function jobOf(row: TaskRow): JobRefFull | null {
  if (!row.jobId) return null
  return {
    jobId: String(row.jobId),
    operation: String(row.operation || ''),
    status: String(row.jobStatus || 'queued') as JobRefFull['status'],
    cursor: Number(row.jobCursor || 0),
    total: Number(row.jobTotal || 0),
    succeeded: Number(row.jobSucceeded || 0),
    skipped: Number(row.jobSkipped || 0),
    failed: Number(row.jobFailed || 0),
    agentStage: row.jobStage || undefined,
    agentError: row.jobError || undefined,
    finishedAt: row.jobFinishedAt || undefined,
    href: `/admin?task=${encodeURIComponent(String(row.jobId))}&kind=bulk`,
  }
}

function contentOf(row: TaskRow): ContentRef | null {
  if (row.unit === 'content')
    return {
      state: 'pending_publish',
      needsPublish: Boolean(row.needsPublish),
      liveVersion: row.contentStatus === 'published',
      status: row.contentStatus || null,
      workId: row.workId || null,
      lastPublishRun: row.lastPublishRun ?? null,
      changeAction: row.changeAction || null,
    }
  if (row.kind === 'submission' && row.contentState)
    return {
      state: String(row.contentState) as ContentState,
      needsPublish: Boolean(row.needsPublish),
      liveVersion: row.contentStatus === 'published',
      status: row.contentStatus || null,
      workId: row.workId || null,
      lastPublishRun: row.lastPublishRun ?? null,
      changeAction: row.changeAction || null,
    }
  return null
}

function toConsoleTask(row: TaskRow): ConsoleTask {
  const contentType = row.contentType ? (String(row.contentType) as ContentType) : null
  return {
    key: row.unit === 'content' ? `content:${contentType}:${row.sourceId}` : `${row.kind}:${row.sourceId}`,
    unit: row.unit,
    kind: String(row.kind) as TaskKind,
    contentType,
    sourceId: String(row.sourceId),
    title: String(row.title || ''),
    operation: String(row.operation || ''),
    group: row.bucket,
    owner: row.owner,
    status: statusOf(row),
    stage: String(row.stage || ''),
    stageLabel: stageLabel(row),
    nextAction: nextActionOf(row),
    reason: row.reason || null,
    error: row.error || null,
    current: Number(row.current || 0),
    total: Number(row.total || 0),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
    href: hrefOf(row),
    canRetry: Boolean(row.canRetry),
    canCancel: Boolean(row.canCancel),
    retryOf: row.retryOf || null,
    retriedBy: row.retriedBy
      ? {
          jobId: row.retriedBy,
          status: row.retriedByStatus || null,
          href: `/admin?task=${encodeURIComponent(row.retriedBy)}&kind=bulk`,
        }
      : null,
    retriedByStatus: row.retriedByStatus || null,
    job: jobOf(row),
    content: contentOf(row),
    liveVersion: row.contentStatus === 'published',
    autoRetryAt: row.autoRetryAt == null ? null : Number(row.autoRetryAt),
    blocked: Boolean(row.blocked),
    source: row.source || null,
    author: row.author || null,
    actor: row.actor || null,
    batchId: row.batchId || null,
    batchLabel: row.batchLabel || null,
    batchItemCount: row.batchItemCount == null ? null : Number(row.batchItemCount),
    sourceKind: row.sourceKind || null,
    sourceLabel: row.sourceLabel || null,
  }
}

export async function listTasks(req: PayloadRequest): Promise<Response> {
  if (req.user?.role !== 'owner') return json({ error: '任务中心仅限站长' }, req.user ? 403 : 401)
  const params = new URL(req.url || 'http://localhost').searchParams
  const query = {
    group: oneOf(params.get('group') || 'all', GROUPS) || 'all',
    kind: oneOf(params.get('kind') || '', KINDS),
    contentType: oneOf(params.get('contentType') || '', CONTENT_TYPES),
    owner: oneOf(params.get('owner') || '', OWNERS),
    source: (params.get('source') || '').trim().slice(0, 100),
    sourceKind: oneOf(params.get('sourceKind') || '', SOURCE_KINDS),
    batch: (params.get('batch') || '').trim().slice(0, 200),
    author: (params.get('author') || '').trim().slice(0, 200),
    task: (params.get('task') || '').trim().slice(0, 200),
    keyword: (params.get('keyword') || '').trim().slice(0, 200),
    page: 1,
  }
  const counts = await taskCounts(req.payload, query)
  if (params.get('summary') === 'true') return json({ counts })
  const totalDocs =
    query.group === 'all'
      ? counts.tasks.all
      : query.group === 'publish'
        ? counts.tasks.publish + counts.content.publish
        : counts.tasks[query.group]
  const totalPages = Math.max(1, Math.ceil(totalDocs / 30))
  const requestedPage = Number(params.get('page'))
  const page = Math.min(
    totalPages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  )
  const rows = totalDocs ? await taskRows(req.payload, query, page) : []
  const retried = [...new Set(rows.map((row) => row.retriedBy).filter((value): value is string => Boolean(value)))]
  if (retried.length) {
    const statusRows = await consoleRows(
      req.payload,
      `SELECT job_id AS jobId,status FROM bulk_jobs WHERE job_id IN (${retried.map(() => '?').join(',')})`,
      retried,
    )
    const statuses = new Map(statusRows.map((row) => [String(row.jobId), String(row.status)]))
    for (const row of rows) if (row.retriedBy) row.retriedByStatus = statuses.get(row.retriedBy) || null
  }
  await hydrateBatchMeta(req.payload, rows)
  await hydrateSubmissionBatchMeta(req.payload, rows, query.batch)
  await hydrateRightsBatchMeta(req.payload, rows, query.batch)
  await hydrateVideoBatchMeta(req.payload, rows, query.batch)
  const batchPage = Math.max(1, Number(params.get('batchPage')) || 1)
  const batchPageSize = Math.min(50, Math.max(1, Number(params.get('batchPageSize')) || 20))
  const batchInfo =
    (query.group === 'processing' || query.group === 'history') && !query.keyword && !query.batch
      ? await batchSummaries(req.payload, {
          sourceKind: query.sourceKind,
          kind: query.kind,
          source: query.source,
          author: query.author,
          owner: query.owner,
          page: batchPage,
          pageSize: batchPageSize,
          history: query.group === 'history',
        })
      : undefined
  return json({ docs: rows.map(toConsoleTask), counts, page, totalPages, totalDocs, ...(batchInfo || {}) })
}

export const TaskEndpoints: Endpoint[] = [
  { path: '/console/tasks', method: 'get', handler: listTasks },
]
