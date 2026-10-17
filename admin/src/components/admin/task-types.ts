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
  { value: 'bulk', label: '内容加工' },
  { value: 'publish', label: '站点发布' },
  { value: 'changes', label: '待发布内容' },
  { value: 'rights', label: '下架与更正' },
] as const

export const OPERATIONS: Record<string, string> = {
  'write-fields': '批量修改内容',
  'ai-fill': '内容编辑与多语言准备',
  translate: '生成多语言',
  'manual-include': '人工收录',
  submission: '投稿处理',
  publish: '站点发布',
  changes: '确认并发布内容',
  takedown: '下架申请',
  attribution: '署名更正',
  'source-correction': '来源更正',
  'license-correction': '授权更正',
}

export type TaskStatus = Exclude<(typeof TASK_STATUSES)[number]['value'], 'all'>
export type TaskKind = Exclude<(typeof TASK_KINDS)[number]['value'], ''>
export type ConsoleTask = {
  key: string
  sourceId: string
  kind: TaskKind
  operation: string
  title: string
  status: TaskStatus
  stage?: string
  error?: string
  current: number
  total: number
  createdAt: string
  updatedAt: string
  href: string
  canRetry: boolean
  canCancel: boolean
  actor?: string
  target?: string
}
export type TaskList = {
  docs: ConsoleTask[]
  counts: Record<string, number>
  totalDocs: number
  totalPages: number
  page: number
}
