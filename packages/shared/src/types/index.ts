export const LOCALES = ['zh', 'zh-hant', 'en', 'ja'] as const
export const CATEGORY_IDS = ['meme', 'illustration', 'setting', 'comic', 'standing', 'other'] as const
export const WORK_KINDS = ['submission', 'owner-picks', 'blue-fish'] as const
export const SUBMISSION_SOURCES = ['web', 'github-issue', 'qq', 'manual'] as const
export const WORK_CHANNELS = [...SUBMISSION_SOURCES, 'owner', 'blue-fish'] as const
export const WORK_STATUSES = ['pending', 'published', 'hidden', 'removed', 'deleted'] as const
export const SUBMISSION_STATES = [
  'received', 'reviewing', 'auto_passed', 'auto_rejected', 'needs_manual', 'approved', 'rejected', 'published',
] as const
export const VIDEO_STATUSES = ['queued', 'reviewing', 'approved', 'rejected', 'manual', 'hidden'] as const
export const CREATOR_STATUSES = ['queued', 'active', 'paused'] as const
export const TAKEDOWN_REQUEST_TYPES = ['takedown', 'attribution', 'source-correction', 'license-correction'] as const
export const TAKEDOWN_REQUEST_STATUSES = ['received', 'investigating', 'approved', 'rejected', 'completed'] as const
export const TOPIC_STATUSES = ['draft', 'active'] as const
export const WORK_LICENSE_TYPES = ['unknown', 'cc0', 'cc-by', 'cc-by-nc', 'author-permission', 'submitter-permission'] as const

export type Locale = typeof LOCALES[number]
export type CategoryId = typeof CATEGORY_IDS[number]
export type WorkKind = typeof WORK_KINDS[number]
export type WorkChannel = typeof WORK_CHANNELS[number]
export type WorkStatus = typeof WORK_STATUSES[number]
export type SubmissionSource = typeof SUBMISSION_SOURCES[number]
export type SubmissionState = typeof SUBMISSION_STATES[number]
export type VideoStatus = typeof VIDEO_STATUSES[number]
export type CreatorStatus = typeof CREATOR_STATUSES[number]
export type TakedownRequestType = typeof TAKEDOWN_REQUEST_TYPES[number]
export type TakedownRequestStatus = typeof TAKEDOWN_REQUEST_STATUSES[number]
export type TopicStatus = typeof TOPIC_STATUSES[number]
export type WorkLicenseType = typeof WORK_LICENSE_TYPES[number]
export type TranslationLocale = Extract<Locale, 'en' | 'ja'>
export type Translations<T> = Partial<Record<TranslationLocale, T>>

export interface WorkTranslation {
  name?: string
  description?: string
  commentary?: string
  tags?: string[]
  licenseNote?: string
  originNote?: string
  seoTitle?: string
  seoDescription?: string
  faq?: { question: string; answer: string }[]
}

export type WorkI18n = Translations<WorkTranslation>

export interface WorkSubmitter {
  credit?: 'named' | 'anonymous'
  name?: string
  url?: string
  github?: string
}

export interface WorkOrigin {
  type: string
  author?: string
  sourceUrl?: string
  issueUrl?: string
  note?: string
}

export interface WorkLicense {
  type: WorkLicenseType
  note?: string
  url?: string
}

export interface WorkRecord {
  id: string
  slug: string
  name: string
  description: string
  commentary: string
  kind: WorkKind
  channel: WorkChannel
  submissionId: string | null
  sha256: string
  primaryCharacterId: string
  characterIds: string[]
  categoryId: CategoryId
  tags: string[]
  r2OriginalKey: string | null
  r2ThumbKey: string | null
  r2DisplayKey: string | null
  format: string
  mimeType: string
  isAnimated: boolean
  width: number
  height: number
  fileSize: number
  thumbWidth: number
  thumbHeight: number
  displayWidth: number
  displayHeight: number
  submitter: WorkSubmitter | null
  origin: WorkOrigin | null
  license: WorkLicense | null
  i18n: WorkI18n
  status: WorkStatus
  revision: string
  viewCount: number
  downloadCount: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkSummary extends Omit<OpenApiWork, 'author' | 'i18n'> {
  author: string | null
  i18n: WorkI18n
  kind: WorkKind
  channel: WorkChannel | null
  primaryCharacterId: string
  categoryId: CategoryId
  originalUrl: string
  thumbnailUrl: string | null
  displayUrl: string | null
  width: number | null
  height: number | null
  thumbWidth: number
  thumbHeight: number
  displayWidth: number
  displayHeight: number
  format: string | null
  isAnimated: boolean
  publishedAt: string | null
}

export interface WorkDetail extends WorkSummary {
  character: Pick<CharacterRecord, 'id' | 'name' | 'i18n'> | null
  category: Pick<CategoryRecord, 'id' | 'name' | 'i18n'> | null
}

interface TaxonomyRecord<Id extends string> {
  id: Id
  name: string
  description: string
  i18n: Translations<{ name?: string; description?: string }>
  sortOrder: number
  status: 'active' | 'inactive'
}

export interface CharacterRecord extends TaxonomyRecord<string> {
  aliases: string[]
  portraitKey: string | null
  portraitWidth: number | null
  portraitHeight: number | null
  brandTokens: Record<string, string>
}

export type CategoryRecord = TaxonomyRecord<CategoryId>

export interface TopicAuthorChannel {
  platform: string
  label?: string
  url: string
}

export interface TopicAuthor {
  name: string
  url?: string
  bio?: string
  channels: TopicAuthorChannel[]
}

export interface SerialReaderConfig {
  totalPages: number
  credits: string
  creditsI18n: Translations<string>
}

export interface TopicWorkRecord {
  topicId: string
  workId: string
  position: number
  pageNumber: number | null
}

export interface TopicRecord {
  id: string
  name: string
  summary: string
  coverWorkId: string | null
  isSerial: boolean
  readerConfig: SerialReaderConfig | null
  author: TopicAuthor | null
  i18n: Translations<{ name?: string; summary?: string }>
  status: TopicStatus
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreatorRecord {
  id: string
  uid: string
  homepage: string
  name: string
  avatarKey: string | null
  intro: string
  status: CreatorStatus
  syncPage: number
  syncLease: Record<string, unknown> | null
  lastSyncedAt: string | null
  retryAt: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface VideoRecord {
  id: string
  bvid: string
  creatorId: string
  title: string
  source: Record<string, unknown>
  status: VideoStatus
  review: Record<string, unknown> | null
  lease: Record<string, unknown> | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SubmissionRecord {
  id: string
  source: SubmissionSource
  sourceIds: string[]
  sha256: string
  r2StagingKey: string | null
  fields: Record<string, unknown>
  editorial: Record<string, unknown> | null
  review: Record<string, unknown> | null
  agentProgress: Record<string, unknown> | null
  state: SubmissionState
  stateHistory: {
    from: SubmissionState | null
    to: SubmissionState
    at: string
    event?: string
    actor?: string
    reason?: string
  }[]
  origin: WorkOrigin | null
  workId: string | null
  createdAt: string
  updatedAt: string
}

export interface TakedownRequestRecord {
  id: string
  requestType: TakedownRequestType
  workId: string | null
  requester: { name?: string; contact?: string; proof?: string } | null
  status: TakedownRequestStatus
  decisionNote: string | null
  issueData: Record<string, unknown> | null
  agentProgress: Record<string, unknown> | null
  processedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface EventRecord {
  id: string
  slug: string
  title: string
  summary: string
  i18n: Translations<{ title?: string; summary?: string }>
  payload: Record<string, unknown>
  status: 'draft' | 'active' | 'archived'
  startsAt: string | null
  endsAt: string | null
}

export interface FriendLinkRecord {
  id: string
  kind: 'friend' | 'project'
  name: string
  url: string
  description: string
  avatarKey: string | null
  i18n: Translations<{ name?: string; description?: string }>
  sortOrder: number
  status: 'active' | 'inactive'
}

export interface OpenApiWorkSummary {
  id: string
  name: string
  revision: string
  detailUrl: string
  originalUrl: string
}

export interface OpenApiWork {
  id: string
  slug: string
  name: string
  description: string
  commentary: string
  url: string
  detailUrl: string
  characterId: string
  characterIds: string[]
  categoryIds: [CategoryId]
  topicIds: string[]
  creatorIds: string[]
  tags: string[]
  createdAt: string | null
  updatedAt: string | null
  author: { name: string | null }
  attribution: { name: string | null; url: string | null; explicit: boolean }
  source: { type: string; url: string | null }
  license: { type: WorkLicenseType; note: string; url: string; copyrightNotice: string }
  image: {
    originalUrl: string
    thumbnailUrl: string | null
    displayUrl: string | null
    format: string | null
    mimeType: string | null
    animated: boolean
    width: number | null
    height: number | null
    bytes: number | null
    sha256: string | null
  }
  i18n: Translations<Pick<WorkTranslation, 'name' | 'description' | 'commentary' | 'tags' | 'licenseNote'>>
  revision: string
}

export interface OpenApiTaxonomyEntry {
  id: string
  name: string
  count: number
  worksUrl: string
}

export interface OpenApiCharacter extends OpenApiTaxonomyEntry {
  aliases: string[]
}

export interface OpenApiCategory extends OpenApiTaxonomyEntry {
  id: CategoryId
  description: string
}

export interface OpenApiTopic extends OpenApiTaxonomyEntry {
  summary: string
  coverWorkId: string
  workIds: string[]
  creatorId: string | null
  updatedAt: string | null
  url: string
  i18n: Translations<{ name?: string; summary?: string }>
}

export interface OpenApiCreator extends OpenApiTaxonomyEntry {
  bio: string
  homepage: string | null
  channels: (TopicAuthorChannel & { label: string })[]
  topicIds: string[]
  url: string
}

interface OpenApiResponse {
  apiVersion: 1
}

export interface OpenApiTaxonomy extends OpenApiResponse {
  characters: OpenApiCharacter[]
  categories: OpenApiCategory[]
  tags: OpenApiTaxonomyEntry[]
  topics: OpenApiTopic[]
  creators: OpenApiCreator[]
}

type OpenApiTaxonomyKey = Exclude<keyof OpenApiTaxonomy, 'apiVersion'>

export interface OpenApiIndex extends OpenApiResponse {
  revision: string
  counts: Record<OpenApiTaxonomyKey | 'works', number>
  pageSize: number
  totalPages: number
  endpoints: Record<OpenApiTaxonomyKey | 'manifest' | 'taxonomy' | 'works' | 'firstPage', string>
  documentation: string
}

export interface OpenApiList<T> extends OpenApiResponse {
  total: number
  items: T[]
}

export interface OpenApiManifest extends OpenApiList<OpenApiWorkSummary> {
  revision: string
}

export interface OpenApiPage extends OpenApiList<OpenApiWork> {
  page: number
  pageSize: number
  totalPages: number
  previous: string | null
  next: string | null
}

export interface OpenApiWorkResponse extends OpenApiResponse {
  work: OpenApiWork
}

export type OpenApiWorks = OpenApiList<OpenApiWork>
export type OpenApiDirectory<Key extends OpenApiTaxonomyKey> = OpenApiList<OpenApiTaxonomy[Key][number]>
export type OpenApiGroup = OpenApiList<OpenApiWorkSummary> & (
  | { character: OpenApiCharacter }
  | { category: OpenApiCategory }
  | { tag: OpenApiTaxonomyEntry }
  | { topic: OpenApiTopic }
  | { creator: OpenApiCreator }
  | { characterId: string; categoryId: CategoryId }
)

export interface WorksQueryParams {
  lang?: Locale
  character?: string
  category?: CategoryId
  tag?: string
  topic?: string
  kind?: WorkKind
  animated?: boolean
  q?: string
  sort?: 'newest' | 'oldest' | 'name' | 'popular' | 'downloads'
  cursor?: string
  page?: number
  pageSize?: number
}

export interface AdminWorksQueryParams extends WorksQueryParams {
  status?: WorkStatus
  channel?: WorkChannel
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  hasMore: boolean
  nextPage: number | null
  nextCursor?: string | null
}
