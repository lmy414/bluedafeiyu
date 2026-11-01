export const TASK_GROUPS = [
  { value: 'all', label: '全部任务' },
  { value: 'decide', label: '需要判断' },
  { value: 'intervene', label: '需要介入' },
  { value: 'publish', label: '待发布' },
  { value: 'processing', label: '系统处理中' },
  { value: 'history', label: '历史' },
] as const

export const TASK_STATUSES = [
  { value: 'all', label: '全部任务' },
  { value: 'attention', label: '待处理' },
  { value: 'ready', label: '待发布' },
  { value: 'running', label: '进行中' },
  { value: 'queued', label: '排队中' },
  { value: 'failed', label: '失败' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
] as const

export const TASK_KINDS = [
  { value: '', label: '所有类型' },
  { value: 'submission', label: '投稿处理' },
  { value: 'creator', label: '作者登记' },
  { value: 'video', label: '视频审核' },
  { value: 'bulk', label: '内容加工' },
  { value: 'publish', label: '站点发布' },
  { value: 'rights', label: '下架与更正' },
  { value: 'content', label: '待发布内容' },
] as const

export const OPERATIONS: Record<string, string> = {
  'write-fields': '批量修改内容',
  'ai-fill': '内容编辑与多语言准备',
  translate: '生成多语言',
  'manual-include': '人工收录',
  submission: '投稿处理',
  creator: 'Bilibili 作者登记',
  video: 'AI 娘二创视频审核',
  publish: '站点发布',
  content: '确认并发布内容',
  takedown: '下架申请',
  attribution: '署名更正',
  'source-correction': '来源更正',
  'license-correction': '授权更正',
}

export type TaskStatus = Exclude<(typeof TASK_STATUSES)[number]['value'], 'all'>
export type TaskGroup = Exclude<(typeof TASK_GROUPS)[number]['value'], 'all'>
export type TaskKind = Exclude<(typeof TASK_KINDS)[number]['value'], ''>
export type TaskUnit = 'task' | 'content'
export type TaskOwner = 'owner' | 'system' | 'none'
export type ContentState = 'pending_publish' | 'published' | 'hidden' | 'removed' | 'deleted' | 'unknown'
export type ContentType = 'work' | 'topic' | 'video' | 'creator'

export type JobRef = {
  jobId: string
  operation: string
  status: 'queued' | 'running'
  cursor: number
  total: number
}

export type JobRefFull = Omit<JobRef, 'status'> & {
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled'
  succeeded: number
  skipped: number
  failed: number
  agentStage?: string
  agentError?: string
  finishedAt?: string
  href: string
}

export type ContentRef = {
  state: ContentState
  needsPublish: boolean
  liveVersion: boolean
  status?: string | null
  workId?: string | null
  lastPublishRun?: number | null
  changeAction?: string | null
}

export type ConsoleTask = {
  key: string
  unit: TaskUnit
  kind: TaskKind
  contentType?: ContentType | null
  sourceId: string
  title: string
  operation: string
  group: TaskGroup
  owner: TaskOwner
  status: TaskStatus
  stage: string
  stageLabel: string
  nextAction: string
  reason?: string | null
  error?: string | null
  current: number
  total: number
  createdAt: string
  updatedAt: string
  href: string
  canRetry: boolean
  canCancel: boolean
  retryOf?: string | null
  retriedBy?: { jobId: string; status?: string | null; href: string } | null
  retriedByStatus?: string | null
  job?: JobRefFull | null
  content?: ContentRef | null
  liveVersion?: boolean
  autoRetryAt?: number | null
  blocked?: boolean
  source?: string | null
  author?: string | null
  actor?: string | null
  batchId?: string | null
  batchLabel?: string | null
  batchItemCount?: number | null
  sourceKind?: string | null
  sourceLabel?: string | null
}

export type TaskCounts = {
  tasks: Record<TaskGroup | 'all', number>
  content: { publish: number }
  all: number
  decide: number
  intervene: number
  publish: number
  processing: number
  history: number
}

export type TaskList = {
  docs: ConsoleTask[]
  counts: TaskCounts
  totalDocs: number
  totalPages: number
  page: number
}
