/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs'
import path from 'node:path'

import type { Payload } from 'payload'

export const SITE_DATA_FILES = [
  'data/works.json',
  'data/owner-picks.json',
  'data/characters.json',
  'data/categories.json',
  'data/topics.json',
  'data/blue-fish-editorial.json',
] as const

export type SiteDataFile = (typeof SITE_DATA_FILES)[number]
export type SiteDataTexts = Record<SiteDataFile, string>

/** 与 git 工作树现有文件一致：topics 是 LF，其余五个是 CRLF。 */
const FILE_EOL: Record<SiteDataFile, string> = {
  'data/works.json': '\r\n',
  'data/owner-picks.json': '\r\n',
  'data/characters.json': '\r\n',
  'data/categories.json': '\r\n',
  'data/topics.json': '\n',
  'data/blue-fish-editorial.json': '\r\n',
}

const WORK_FIELD_ORDER = [
  'id',
  'name',
  'description',
  'commentary',
  'path',
  'thumbnailPath',
  'fullPath',
  'format',
  'mimeType',
  'isAnimated',
  'width',
  'height',
  'fileSize',
  'sha256',
  'characterId',
  'tags',
  'submitter',
  'origin',
  'license',
  'status',
  'createdAt',
  'updatedAt',
  'tone',
  'symbol',
  'sourceIssue',
  'slug',
  'categoryIds',
]

function cloneJson<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function relationId(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return String((value as any).id ?? (value as any).workId ?? (value as any).categoryId ?? (value as any).characterId ?? '')
  return String(value)
}

function relationCode(value: unknown, codeField: string): string {
  if (isObject(value)) return String(value[codeField] ?? relationId(value))
  return String(value ?? '')
}

function orderedDocs(docs: any[]): any[] {
  return [...docs].sort((left, right) => {
    const leftOrder = Number.isFinite(Number(left.legacyOrder)) ? Number(left.legacyOrder) : Number.MAX_SAFE_INTEGER
    const rightOrder = Number.isFinite(Number(right.legacyOrder)) ? Number(right.legacyOrder) : Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    const leftDate = String(left.createdAt || '')
    const rightDate = String(right.createdAt || '')
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate)
    return String(left.workId || left.categoryId || left.characterId || left.id).localeCompare(String(right.workId || right.categoryId || right.characterId || right.id))
  })
}

function setPreservingKeyOrder(target: Record<string, any>, key: string, value: unknown): void {
  if (value === undefined) return
  target[key] = value
}

function workBase(doc: any): Record<string, any> {
  const base = isObject(doc.legacyData) && doc.legacySource !== 'submission-sync' ? cloneJson(doc.legacyData) : {}
  if (Object.keys(base).length === 0) {
    for (const key of WORK_FIELD_ORDER) {
      if (key === 'sourceIssue' && doc.kind !== 'owner-picks') continue
      setPreservingKeyOrder(base, key, null)
    }
  }
  return base
}

function workRecord(doc: any, options: { originalUrlByWorkId?: Record<string, string>; treatPendingAsPublished?: boolean }): Record<string, any> {
  const base = workBase(doc)
  const paths = isObject(doc.legacyPaths) ? doc.legacyPaths : {}
  const characterId = relationCode(doc.character, 'characterId')
  const categoryIds = (Array.isArray(doc.categories) ? doc.categories : []).map((item: unknown) => relationCode(item, 'categoryId')).filter(Boolean)
  const tags = (Array.isArray(doc.tags) ? doc.tags : []).map((item: any) => String(item?.value ?? item ?? '')).filter(Boolean)
  const status = options.treatPendingAsPublished && doc.status === 'pending' ? 'published' : doc.status
  const createdAt = isObject(doc.legacyData) && doc.legacyData.createdAt ? doc.legacyData.createdAt : doc.createdAt
  const updatedAt = isObject(doc.legacyData) && doc.legacyData.updatedAt ? doc.legacyData.updatedAt : doc.updatedAt
  const originalUrl = options.originalUrlByWorkId?.[doc.workId]

  setPreservingKeyOrder(base, 'id', doc.workId)
  setPreservingKeyOrder(base, 'name', doc.name)
  setPreservingKeyOrder(base, 'description', doc.description ?? '')
  setPreservingKeyOrder(base, 'commentary', doc.commentary ?? '')
  setPreservingKeyOrder(base, 'path', originalUrl ?? paths.path ?? base.path ?? '')
  setPreservingKeyOrder(base, 'thumbnailPath', paths.thumbnailPath ?? base.thumbnailPath ?? '')
  setPreservingKeyOrder(base, 'fullPath', paths.fullPath ?? base.fullPath ?? '')
  setPreservingKeyOrder(base, 'format', doc.format ?? base.format ?? '')
  setPreservingKeyOrder(base, 'mimeType', doc.mimeType ?? base.mimeType ?? '')
  setPreservingKeyOrder(base, 'isAnimated', Boolean(doc.isAnimated ?? base.isAnimated))
  setPreservingKeyOrder(base, 'width', doc.width ?? base.width ?? 0)
  setPreservingKeyOrder(base, 'height', doc.height ?? base.height ?? 0)
  setPreservingKeyOrder(base, 'fileSize', doc.fileSize ?? base.fileSize ?? 0)
  setPreservingKeyOrder(base, 'sha256', doc.sha256 ?? base.sha256 ?? '')
  setPreservingKeyOrder(base, 'characterId', characterId)
  setPreservingKeyOrder(base, 'tags', tags)
  setPreservingKeyOrder(base, 'submitter', doc.submitter ?? base.submitter ?? {})
  setPreservingKeyOrder(base, 'origin', doc.origin ?? base.origin ?? {})
  setPreservingKeyOrder(base, 'license', doc.license ?? base.license ?? {})
  setPreservingKeyOrder(base, 'status', status)
  setPreservingKeyOrder(base, 'createdAt', createdAt)
  setPreservingKeyOrder(base, 'updatedAt', updatedAt)
  setPreservingKeyOrder(base, 'tone', base.tone ?? characterId)
  setPreservingKeyOrder(base, 'symbol', base.symbol ?? '')
  if (doc.kind === 'owner-picks' || Object.prototype.hasOwnProperty.call(base, 'sourceIssue')) {
    setPreservingKeyOrder(base, 'sourceIssue', base.sourceIssue ?? null)
  }
  setPreservingKeyOrder(base, 'slug', doc.slug ?? '')
  setPreservingKeyOrder(base, 'categoryIds', categoryIds)
  return base
}

function characterRecord(doc: any): Record<string, any> {
  const base = isObject(doc.legacyData) ? cloneJson(doc.legacyData) : { id: '', name: '', aliases: [], status: 'active', inSubmissionForm: true }
  setPreservingKeyOrder(base, 'id', doc.characterId)
  setPreservingKeyOrder(base, 'name', doc.name)
  setPreservingKeyOrder(base, 'aliases', (Array.isArray(doc.aliases) ? doc.aliases : []).map((item: any) => String(item?.value ?? item ?? '')).filter(Boolean))
  setPreservingKeyOrder(base, 'status', doc.status)
  setPreservingKeyOrder(base, 'inSubmissionForm', Boolean(doc.inSubmissionForm))
  return base
}

function categoryRecord(doc: any): Record<string, any> {
  const base = isObject(doc.legacyData) ? cloneJson(doc.legacyData) : { id: '', name: '', description: '', status: 'active' }
  setPreservingKeyOrder(base, 'id', doc.categoryId)
  setPreservingKeyOrder(base, 'name', doc.name)
  setPreservingKeyOrder(base, 'description', doc.description ?? '')
  setPreservingKeyOrder(base, 'status', doc.status)
  return base
}

function topicRecord(doc: any): Record<string, any> {
  const workIds = (Array.isArray(doc.works) ? doc.works : []).map((item: unknown) => relationCode(item, 'workId')).filter(Boolean)
  const coverWorkId = relationCode(doc.cover, 'workId')
  const i18n: Record<string, any> = {}
  if (doc.nameEn || doc.summaryEn) i18n.en = { name: doc.nameEn || doc.name || '', summary: doc.summaryEn || doc.summary || '' }
  if (doc.nameJa || doc.summaryJa) i18n.ja = { name: doc.nameJa || doc.name || '', summary: doc.summaryJa || doc.summary || '' }
  const record: Record<string, any> = {
    id: doc.topicId,
    name: doc.name,
    summary: doc.summary,
    coverWorkId: workIds.includes(coverWorkId) ? coverWorkId : (workIds[0] || ''),
    status: doc.status,
    order: Number(doc.order) || 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    workIds,
  }
  if (Object.keys(i18n).length > 0) record.i18n = i18n
  return record
}

function serializeJson(value: unknown, eol: string): string {
  return JSON.stringify(value, null, 2).replace(/\n/g, eol) + eol
}

function editorialText(works: any[], snapshot: any): string {
  let base: Record<string, any> = {}
  if (snapshot?.text) {
    try {
      const parsed = JSON.parse(String(snapshot.text))
      if (isObject(parsed)) base = parsed
    } catch {
      throw new Error('legacy-snapshots 里的 blue-fish-editorial 快照不是合法 JSON')
    }
  } else {
    for (const work of works.filter((doc) => doc.kind === 'blue-fish')) {
      const sourcePath = work.legacyData?.sourcePath
      if (!sourcePath) continue
      base[sourcePath] = cloneJson(work.legacyData?.editorial || {})
    }
  }

  for (const work of works.filter((doc) => doc.kind === 'blue-fish')) {
    const sourcePath = String(work.legacyData?.sourcePath || '')
    if (!sourcePath) continue
    const current = isObject(base[sourcePath]) ? base[sourcePath] : {}
    if (work.status === 'hidden' || work.status === 'deleted') current.status = work.status
    else if (Object.prototype.hasOwnProperty.call(current, 'status')) delete current.status
    base[sourcePath] = current
  }
  return serializeJson(base, FILE_EOL['data/blue-fish-editorial.json'])
}

export function buildSiteDataTexts(input: {
  works: any[]
  characters: any[]
  categories: any[]
  topics: any[]
  editorialSnapshot?: any
  originalUrlByWorkId?: Record<string, string>
  treatPendingAsPublished?: boolean
}): SiteDataTexts {
  const options = {
    originalUrlByWorkId: input.originalUrlByWorkId,
    treatPendingAsPublished: input.treatPendingAsPublished,
  }
  const allowedStatus = (doc: any) => doc.status === 'published' || (input.treatPendingAsPublished && doc.status === 'pending')
  const works = orderedDocs(input.works.filter((doc) => doc.kind === 'submission' && allowedStatus(doc))).map((doc) => workRecord(doc, options))
  const ownerPicks = orderedDocs(input.works.filter((doc) => doc.kind === 'owner-picks' && allowedStatus(doc))).map((doc) => workRecord(doc, options))
  const characters = orderedDocs(input.characters).map(characterRecord)
  const categories = orderedDocs(input.categories).map(categoryRecord)
  const topics = orderedDocs(input.topics.filter((doc) => doc.status === 'active')).map(topicRecord)

  return {
    'data/works.json': serializeJson(works, FILE_EOL['data/works.json']),
    'data/owner-picks.json': serializeJson(ownerPicks, FILE_EOL['data/owner-picks.json']),
    'data/characters.json': serializeJson(characters, FILE_EOL['data/characters.json']),
    'data/categories.json': serializeJson(categories, FILE_EOL['data/categories.json']),
    'data/topics.json': serializeJson(topics, FILE_EOL['data/topics.json']),
    'data/blue-fish-editorial.json': editorialText(input.works, input.editorialSnapshot),
  }
}

export async function exportSiteData(
  payload: Payload,
  options: { originalUrlByWorkId?: Record<string, string>; treatPendingAsPublished?: boolean } = {},
): Promise<SiteDataTexts> {
  const api = payload as any
  const [works, characters, categories, topics, snapshots] = await Promise.all([
    api.find({ collection: 'works', depth: 2, limit: 2000, overrideAccess: true, pagination: false }),
    api.find({ collection: 'characters', depth: 0, limit: 1000, overrideAccess: true, pagination: false }),
    api.find({ collection: 'categories', depth: 0, limit: 1000, overrideAccess: true, pagination: false }),
    api.find({ collection: 'topics', depth: 2, limit: 1000, overrideAccess: true, pagination: false }),
    api.find({ collection: 'legacy-snapshots', where: { key: { equals: 'blue-fish-editorial' } }, limit: 1, overrideAccess: true }),
  ])
  return buildSiteDataTexts({
    works: works.docs,
    characters: characters.docs,
    categories: categories.docs,
    topics: topics.docs,
    editorialSnapshot: snapshots.docs[0],
    originalUrlByWorkId: options.originalUrlByWorkId,
    treatPendingAsPublished: options.treatPendingAsPublished,
  })
}

export function writeSiteDataTexts(siteRoot: string, texts: SiteDataTexts): { changed: string[]; unchanged: string[] } {
  const changed: string[] = []
  const unchanged: string[] = []
  for (const relativePath of SITE_DATA_FILES) {
    const absolutePath = path.join(siteRoot, relativePath)
    const next = texts[relativePath]
    const current = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : null
    if (current === next) {
      unchanged.push(relativePath)
      continue
    }
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, next, 'utf8')
    changed.push(relativePath)
  }
  return { changed, unchanged }
}

export function compareSiteDataTexts(siteRoot: string, texts: SiteDataTexts): { mismatched: string[]; matched: string[] } {
  const mismatched: string[] = []
  const matched: string[] = []
  for (const relativePath of SITE_DATA_FILES) {
    const absolutePath = path.join(siteRoot, relativePath)
    const current = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : null
    if (current === texts[relativePath]) matched.push(relativePath)
    else mismatched.push(relativePath)
  }
  return { matched, mismatched }
}
