export const CHANNELS = [
  { label: '网页', value: 'web' },
  { label: 'GitHub', value: 'github-issue' },
  { label: 'QQ', value: 'qq' },
  { label: '人工', value: 'manual' },
  { label: '站长自用', value: 'owner' },
  { label: '蓝色大肥鱼档案', value: 'blue-fish' },
] as const

export const WORK_STATUSES = [
  { label: '待发布', value: 'pending' },
  { label: '已上线', value: 'published' },
  { label: '已隐藏', value: 'hidden' },
  { label: '已移除', value: 'removed' },
  { label: '已删除', value: 'deleted' },
] as const

export const SUBMISSION_STATES: Record<string, string> = {
  approved: '人工通过',
  auto_passed: 'AI 通过',
  auto_rejected: 'AI 拒绝',
  needs_manual: '转人工',
  publish_failed: '发布失败',
  published: '已发布',
  publishing: '发布中',
  ready_to_publish: '待发布',
  received: '已收到',
  rejected: '人工拒绝',
  reviewing: '审核中',
}

export const STATUS_LABELS: Record<string, string> = {
  active: '已上线',
  deleted: '已删除',
  draft: '草稿',
  failed: '失败',
  hidden: '已隐藏',
  in_progress: '执行中',
  pending: '待发布',
  published: '已上线',
  queued: '排队中',
  removed: '已移除',
  succeeded: '成功',
}

export function labelOf(items: readonly { label: string; value: string }[], value?: string): string {
  return items.find((item) => item.value === value)?.label || value || '未设置'
}

export function formatDate(value?: string): string {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
