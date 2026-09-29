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

export type TopicDoc = {
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
  large?: MediaDoc | ID
  lastPublishedAt?: string
  legacyData?: Record<string, unknown>
  name: string
  needsPublish?: boolean
  original?: MediaDoc | ID
  preview?: MediaDoc | ID
  publishedAt?: string
  review?: ReviewInfo
  sha256?: string
  status: 'deleted' | 'hidden' | 'pending' | 'published' | 'removed'
  submissionId?: string
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
  const media = asObject<MediaDoc>(work.preview) || asObject<MediaDoc>(work.original) || asObject<MediaDoc>(work.large)
  return media?.sizes?.thumbnail?.url || media?.thumbnailURL || media?.url
}

export function submissionImageURL(submission: SubmissionDoc): string | undefined {
  const media = asObject<MediaDoc>(submission.media)
  return media?.sizes?.thumbnail?.url || media?.thumbnailURL || media?.url
}
