export type ID = number | string

export type MediaDoc = {
  alt?: string
  filename?: string
  id: ID
  mimeType?: string
  sizes?: Record<string, { filename?: string; url?: string }>
  thumbnailURL?: string
  url?: string
}

export type CharacterDoc = {
  characterId?: string
  id: ID
  name?: string
}

export type CategoryDoc = {
  categoryId?: string
  id: ID
  name?: string
}

/** 作者型专题的联系方式（与导出 / 快照形态一致，字段名冻结）。 */
export type TopicAuthorChannel = {
  id?: ID
  label?: string
  platform?: string
  url?: string
}

/** 作者分组：整组可空；有值时 name 与 channels[0] 必在，channels 顺序即首选顺序。 */
export type TopicAuthor = {
  bio?: string
  channels?: TopicAuthorChannel[]
  name?: string
  url?: string
}

export type TopicDoc = {
  author?: TopicAuthor | null
  cover?: ID | WorkDoc
  id: ID
  lastPublishedAt?: string
  name: string
  needsPublish?: boolean
  order?: number
  status: 'active' | 'draft'
  summary?: string
  topicId: string
  works?: Array<ID | WorkDoc>
}

export type ReviewInfo = {
  confidence?: number
  model?: string
  reason?: string
  verdict?: string
  [key: string]: unknown
}

export type WorkDoc = {
  categories?: Array<CategoryDoc | ID>
  changeAction?: null | string
  channel: string
  character?: CharacterDoc | ID
  commentary?: string
  description?: string
  id: ID
  lastPublishedAt?: string
  legacyData?: Record<string, unknown>
  legacyPaths?: { externalOriginalUrl?: null | string; fullPath?: null | string; path?: null | string; thumbnailPath?: null | string }
  name: string
  needsPublish?: boolean
  origin?: Record<string, unknown> | null
  fields?: Record<string, unknown>
  path?: string
  preview?: MediaDoc | ID
  publishedAt?: string
  review?: ReviewInfo
  sha256?: string
  status: 'deleted' | 'hidden' | 'pending' | 'published' | 'removed'
  submissionId?: string
  submitter?: { github?: string | null; name?: string | null } | null
  tags?: Array<{ id?: string; value: string }>
  updatedAt?: string
  workId: string
}

export type SubmissionDoc = {
  fields?: Record<string, unknown>
  id: ID
  media?: MediaDoc | ID
  origin?: Record<string, unknown>
  review?: ReviewInfo
  sha256?: string
  source: string
  state: string
  stateHistory?: Array<Record<string, unknown>>
  submissionId: string
  syncedAt?: string
  title: string
  work?: ID | WorkDoc
}

export type PublishRun = {
  commits?: Record<string, string>
  error?: string
  finishedAt?: string
  id: ID
  log?: string
  requestedAt?: string
  runId: string
  startedAt?: string
  status: string
  step?: string
  summary?: Record<string, number>
}

export type PublishPlanItem = {
  changeAction?: null | string
  id: ID
  kind?: string
  name: string
  status: string
  topicId?: string
  workId?: string
}

export type PublishPlan = {
  added: PublishPlanItem[]
  deleted: PublishPlanItem[]
  hidden: PublishPlanItem[]
  restored: PublishPlanItem[]
  summary: Record<string, number>
  topics: PublishPlanItem[]
  updated: PublishPlanItem[]
}

export type ListResponse<T> = {
  docs: T[]
  hasNextPage?: boolean
  hasPrevPage?: boolean
  page?: number
  totalDocs?: number
  totalPages?: number
}

export function relationID(value: ID | { id: ID } | null | undefined): ID | undefined {
  if (value === null || value === undefined) return undefined
  return typeof value === 'object' ? value.id : value
}

export function asObject<T extends object>(value: T | ID | null | undefined): T | undefined {
  return value && typeof value === 'object' ? value : undefined
}

export function workImageURL(work: WorkDoc): string | undefined {
  const media = asObject<MediaDoc>(work.preview)
  return media?.sizes?.thumbnail?.url || media?.thumbnailURL || media?.url
}

export function workOriginalURL(work: WorkDoc): string | undefined {
  if (work.status !== 'published' && work.status !== 'hidden') return undefined
  const raw = work.legacyPaths?.path || work.path || (typeof work.legacyData?.path === 'string' ? work.legacyData.path : '')
  const value = String(raw || '').trim()
  if (!value) return undefined
  if (/^https?:\/\//i.test(value)) return value
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
  const repoPath = normalized.startsWith('dist/') ? normalized : `dist/${normalized}`
  return `https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/${repoPath}`
}

export function submissionImageURL(submission: SubmissionDoc): string | undefined {
  const media = asObject<MediaDoc>(submission.media)
  return media?.sizes?.thumbnail?.url || media?.thumbnailURL || media?.url
}

const SELF_AUTHOR = /^(本人|自己|我|原创|self)$/i

function cleanAuthor(value: unknown): string {
  return String(value ?? '').trim().replace(/^@+/, '').trim()
}

/** 作品作者：来源作者优先；填「本人」或空时用投稿者。都没有返回空串。 */
export function authorOf(item: { origin?: Record<string, unknown> | null; submitter?: { github?: string | null; name?: string | null } | null; fields?: Record<string, unknown> }): string {
  const origin = item.origin || {}
  const submitter = cleanAuthor(item.submitter?.name) || cleanAuthor(item.submitter?.github)
    || cleanAuthor(origin.submitter) || cleanAuthor(item.fields?.submitter)
  const author = cleanAuthor(origin.author)
  if (author && !SELF_AUTHOR.test(author)) return author
  return submitter
}

/** 作者下拉选项，按作品数倒序。 */
export function authorOptions<T>(items: T[], pick: (item: T) => string): Array<{ count: number; value: string }> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const value = pick(item)
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
}

export const NO_AUTHOR = '__none__'