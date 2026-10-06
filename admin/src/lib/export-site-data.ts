/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs'
import path from 'node:path'
import { sourceHash, validateI18n } from './localization.mjs'

import type { Payload } from 'payload'

import { isPlaceholderDescription } from './placeholder'
import { safeHomepage } from './attribution.mjs'

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

function legacyOrder(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const order = Number(value)
  return Number.isFinite(order) ? order : null
}

function orderedDocs(docs: any[]): any[] {
  return [...docs].sort((left, right) => {
    const leftOrder = legacyOrder(left.legacyOrder)
    const rightOrder = legacyOrder(right.legacyOrder)
    if (leftOrder !== null && rightOrder === null) return -1
    if (leftOrder === null && rightOrder !== null) return 1
    if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder
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
  const who = doc.submitter ?? base.submitter ?? {}
  const submitter = who.credit === 'anonymous' ? { credit: 'anonymous', name: '', url: '', github: '' }
    : who.credit === 'named' ? { ...who, url: safeHomepage(who.url), github: '' } : who
  setPreservingKeyOrder(base, 'submitter', submitter)
  const origin = { ...(doc.origin ?? base.origin ?? {}) }
  if (who.credit === 'anonymous') delete origin.submitter
  setPreservingKeyOrder(base, 'origin', origin)
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
  if(base.i18n?.sourceHash!==sourceHash(base))delete base.i18n
  const saved=doc.legacyData?.i18n
  if(saved?.sourceHash===sourceHash(base)) base.i18n={sourceHash:saved.sourceHash,...validateI18n(saved,base)}
  const authored = doc.review?.content
  if (!base.i18n && authored?.i18n && sourceHash(authored) === sourceHash({...base, origin:{}, license:{}})) {
    base.i18n = {sourceHash:sourceHash(base), ...validateI18n(authored.i18n, base)}
  } else if (base.i18n && base.i18n.sourceHash !== sourceHash(base)) delete base.i18n
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

type ExportedAuthorChannel = {
  label?: string
  platform: string
  url: string
}

type ExportedAuthor = {
  bio?: string
  channels: ExportedAuthorChannel[]
  name: string
  url?: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 只接受 http/https 外链：先要求字面量 `http://` / `https://` 且 authority 以非空、
 * 非 `/?#\`、非空白字符开头（挡掉 `https://`、`https:///x`、反斜杠这些 new URL 会
 * 偷偷规范化的写法），再解析核对协议与主机名。
 */
function isHttpUrl(value: string): boolean {
  if (!value || /\s/.test(value) || value.includes('\\')) return false
  if (!/^https?:\/\/[^\s/?#\\]/.test(value)) return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * 作者分组显式透传：整组全空返回 null（普通专题）；只要出现任意作者字段就按作者型校验，
 * 缺作者名、渠道不完整或链接非法一律抛错（含 topicId），不静默降级为普通版式。
 * 输出形态固定为 { name, url?, bio?, channels: [{ platform, label?, url }] }，字段名冻结。
 */
function authorRecord(value: unknown, topicId: string): ExportedAuthor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const author = value as { bio?: unknown; channels?: unknown; name?: unknown; url?: unknown }
  const name = text(author.name)
  const homepage = text(author.url)
  const bio = text(author.bio)
  const rawChannels = Array.isArray(author.channels) ? author.channels : []
  if (!name && !homepage && !bio && rawChannels.length === 0) return null
  const fail = (why: string): never => {
    throw new Error(`专题 ${topicId} 的作者信息不完整：${why}`)
  }
  if (!name) fail('缺少作者名（name）')
  if (homepage && !isHttpUrl(homepage)) fail(`作者主页不是有效的 http/https 地址：${homepage}`)
  const channels: ExportedAuthorChannel[] = []
  rawChannels.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`渠道 ${index + 1} 不是对象`)
    const channel = raw as { label?: unknown; platform?: unknown; url?: unknown }
    const platform = text(channel.platform)
    const url = text(channel.url)
    if (!platform) fail(`渠道 ${index + 1} 缺 platform`)
    if (!url) fail(`渠道 ${index + 1} 缺 url`)
    if (!isHttpUrl(url)) fail(`渠道 ${index + 1} 的链接不是有效的 http/https 地址：${url}`)
    const label = text(channel.label)
    channels.push({ platform, ...(label ? { label } : {}), url })
  })
  if (!channels.length) fail('缺少首选渠道 channels[0]（只有作者名不足以成为作者型专题）')
  return {
    name,
    ...(homepage ? { url: homepage } : {}),
    ...(bio ? { bio } : {}),
    channels,
  }
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
  // 无作者时不加键，record 的键顺序与输出保持原样。
  const author = authorRecord(doc.author, String(doc.topicId || ''))
  if (author) record.author = author
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
    // 后台补写的说明与点评写进叠加层；占位说明、空值不写，避免无意义改动。
    const description = String(work.description ?? '').trim()
    if (description && !isPlaceholderDescription(description) && current.description !== description) current.description = description
    const commentary = String(work.commentary ?? '').trim()
    if (commentary && current.commentary !== commentary) current.commentary = commentary
    if (work.status === 'hidden' || work.status === 'deleted') current.status = work.status
    else if (Object.prototype.hasOwnProperty.call(current, 'status')) delete current.status
    const exported=workRecord(work,{})
    if(exported.i18n)current.i18n=exported.i18n
    else if(current.i18n)delete current.i18n
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
  // 已分配的网址永久占用；隐藏或删除后仍保留记录，前台按 status 过滤。
  const allowedStatus = (doc: any) => doc.status === 'published'
    || (input.treatPendingAsPublished && doc.status === 'pending')
    || (['hidden', 'removed', 'deleted'].includes(doc.status) && Boolean(doc.slug))
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
