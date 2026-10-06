/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPayload } from 'payload'

import config from '../src/payload.config'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = path.resolve(HERE, '..')
const SITE_DIR = path.resolve(ADMIN_DIR, '..')
const DEFAULT_CONTENT_DIR = path.resolve(SITE_DIR, '..', 'AI娘表情包')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const noMedia = args.includes('--no-media')
const previewsOnly = args.includes('--previews-only')
const skipBlueFish = args.includes('--skip-blue-fish')
const skipSubmissions = args.includes('--skip-submissions')
const noUpdate = args.includes('--no-update')
const contentArg = args.find((arg) => arg.startsWith('--content-dir='))
const limitArg = args.find((arg) => arg.startsWith('--limit='))
const contentDir = path.resolve(contentArg ? contentArg.slice('--content-dir='.length) : DEFAULT_CONTENT_DIR)
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 0
const dataDir = path.join(SITE_DIR, 'data')

const MIME_BY_EXT: Record<string, string> = {
  '.apng': 'image/apng',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

const payload = await getPayload({ config })
const mediaBySha = new Map<string, number | string>()
const hashCache = new Map<string, string>()
type UpsertCollection = 'categories' | 'characters' | 'legacy-snapshots' | 'submissions' | 'topics' | 'works'
const stats = {
  categories: { created: 0, updated: 0, skipped: 0 },
  characters: { created: 0, updated: 0, skipped: 0 },
  media: { created: 0, reused: 0, missing: 0, skipped: 0 },
  works: { created: 0, updated: 0, skipped: 0 },
  topics: { created: 0, updated: 0, skipped: 0 },
  submissions: { created: 0, updated: 0, skipped: 0 },
  snapshots: { created: 0, updated: 0, skipped: 0 },
  errors: [] as string[],
}

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf8')) as T
}

function readText(filename: string): string {
  return fs.readFileSync(path.join(dataDir, filename), 'utf8')
}

function basenameFromUrl(value: string): string {
  try {
    const url = new URL(value)
    return decodeURIComponent(path.posix.basename(url.pathname))
  } catch {
    return decodeURIComponent(path.basename(value))
  }
}

function fileHash(filename: string): string {
  const cached = hashCache.get(filename)
  if (cached) return cached
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
  hashCache.set(filename, hash)
  return hash
}

function relativeSource(filename: string): string {
  return path.relative(contentDir, filename).split(path.sep).join('/')
}

function tagsToArray(value: unknown): Array<{ value: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index)
    .map((item) => ({ value: item }))
}

function safeDate(value: unknown): string | undefined {
  if (!value) return undefined
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function mediaMime(filename: string | null): string | undefined {
  if (!filename) return undefined
  return MIME_BY_EXT[path.extname(filename).toLowerCase()]
}

async function findOne(collection: any, field: string, value: unknown): Promise<any | null> {
  const result = await payload.find({
    collection,
    where: { [field]: { equals: value } } as any,
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs[0] ?? null
}

async function upsert(collection: UpsertCollection, field: string, value: unknown, data: Record<string, any>): Promise<any> {
  const existing = await findOne(collection, field, value)
  const stat = stats[collection === 'legacy-snapshots' ? 'snapshots' : collection] as { created: number; updated: number; skipped: number }
  if (existing && noUpdate) {
    stat.skipped += 1
    return existing
  }
  if (dryRun) {
    if (existing) stat.updated += 1
    else stat.created += 1
    return existing ?? { id: `dry-${collection}-${String(value)}`, ...data }
  }
  if (existing) {
    const updated = await payload.update({
      collection,
      id: existing.id,
      data,
      context: { audit: false, importLegacy: true, skipNeedsPublish: true },
      overrideAccess: true,
    } as any)
    stat.updated += 1
    return updated
  }
  const created = await payload.create({
    collection,
    data,
    context: { audit: false, importLegacy: true, skipNeedsPublish: true },
    overrideAccess: true,
  } as any)
  stat.created += 1
  return created
}

async function ensureMedia(
  filename: string | null,
  meta: {
    alt: string
    externalUrl?: null | string
    isAnimated?: boolean
    role: 'attachment' | 'preview'
    sourcePath?: null | string
  },
): Promise<number | string | null> {
  if (!filename) return null
  if (!fs.existsSync(filename)) {
    stats.media.missing += 1
    return null
  }
  const sha256 = fileHash(filename)
  const existing = mediaBySha.get(sha256)
  if (existing) {
    stats.media.reused += 1
    return existing
  }
  const existingDoc = await findOne('media', 'sha256', sha256)
  if (existingDoc) {
    mediaBySha.set(sha256, existingDoc.id)
    stats.media.reused += 1
    return existingDoc.id
  }
  if (dryRun || noMedia) {
    const fakeId = `dry-media-${sha256.slice(0, 12)}`
    mediaBySha.set(sha256, fakeId)
    stats.media.skipped += 1
    return fakeId
  }
  const ext = path.extname(filename).toLowerCase()
  const created = await payload.create({
    collection: 'media',
    filePath: filename,
    context: { audit: false, importLegacy: true },
    overrideAccess: true,
    data: {
      alt: String(meta.alt || path.basename(filename)).slice(0, 200),
      sha256,
      mediaRole: meta.role,
      storageKind: 'content-repository',
      sourcePath: meta.sourcePath || relativeSource(filename),
      externalUrl: meta.externalUrl || null,
      isAnimated: Boolean(meta.isAnimated || ext === '.gif' || ext === '.apng'),
    },
  } as any)
  const createdID = created.id
  mediaBySha.set(sha256, createdID)
  stats.media.created += 1
  return createdID
}

function submissionSource(raw: any): 'github-issue' | 'manual' {
  if (raw.sourceIssue !== null && raw.sourceIssue !== undefined) return 'github-issue'
  if (raw.submitter?.github) return 'github-issue'
  return 'manual'
}

function blueFishRows(): any[] {
  const classification = readJson<any[]>('blue-fish-classification.json')
  const editorial = readJson<Record<string, any>>('blue-fish-editorial.json')
  const ids = readJson<Record<string, any>>('blue-fish-ids.json')
  return classification
    .map((item, index) => {
      const edit = editorial[item.sourcePath] || {}
      const identity = ids[item.sourcePath] || {}
      const tags = Array.isArray(edit.tags) && edit.tags.length ? edit.tags : item.tags || []
      const characterId = String(edit.characterId || item.characterId || '').trim()
      const name = String(edit.name || item.name || '').trim()
      const passes = Boolean(name && tags.length && characterId)
      return {
        ...item,
        ...edit,
        index,
        id: identity.id,
        slug: identity.slug,
        sourcePath: item.sourcePath,
        previewPath: item.previewPath,
        name,
        tags,
        characterId,
        categoryIds: edit.categoryIds || item.categoryIds || [],
        commentary: edit.commentary || '',
        description: edit.description || '',
        originalPath: edit.originalPath || null,
        sourceUrl: item.sourceUrl || null,
        passes,
        legacyData: { sourcePath: item.sourcePath, editorial: edit },
      }
    })
    .filter((item) => item.passes && item.id)
}

async function importCategories() {
  const rows = readJson<any[]>('categories.json')
  const result = new Map<string, any>()
  for (const [index, row] of rows.entries()) {
    const doc = await upsert('categories', 'categoryId', row.id, {
      categoryId: row.id,
      name: row.name,
      description: row.description || '',
      status: row.status || 'active',
      legacyOrder: index,
      legacyData: row,
    })
    result.set(row.id, doc)
  }
  return result
}

async function importCharacters() {
  const rows = readJson<any[]>('characters.json')
  const result = new Map<string, any>()
  for (const [index, row] of rows.entries()) {
    const doc = await upsert('characters', 'characterId', row.id, {
      characterId: row.id,
      name: row.name,
      aliases: tagsToArray(row.aliases),
      status: row.status || 'active',
      inSubmissionForm: Boolean(row.inSubmissionForm),
      legacyOrder: index,
      legacyData: row,
    })
    result.set(row.id, doc)
  }
  return result
}

async function importEditorialSnapshot() {
  const text = readText('blue-fish-editorial.json')
  await upsert('legacy-snapshots', 'key', 'blue-fish-editorial', {
    key: 'blue-fish-editorial',
    text,
    eol: text.includes('\r\n') ? 'crlf' : 'lf',
  })
}

function pathToContent(rawPath: string | null | undefined): string | null {
  if (!rawPath) return null
  const clean = String(rawPath).replace(/^\/+/, '')
  if (clean.startsWith('dist/')) return path.join(contentDir, clean)
  return path.join(contentDir, 'dist', clean)
}

async function importOneWork(raw: any, kind: 'blue-fish' | 'owner-picks' | 'submission', order: number, characterMap: Map<string, any>, categoryMap: Map<string, any>) {
  const characterId = String(raw.characterId || '').trim()
  const character = characterMap.get(characterId)
  if (!character) throw new Error(`找不到角色 ${characterId}`)
  const categoryIds = Array.isArray(raw.categoryIds) ? raw.categoryIds.filter((id: string) => categoryMap.has(id)) : []

  let previewPath: string | null = null

  if (kind === 'submission') {
    const sourceStem = path.parse(basenameFromUrl(raw.path || '')).name
    previewPath = raw.thumbnailPath
      ? pathToContent(raw.thumbnailPath)
      : sourceStem
        ? path.join(contentDir, 'dist', 'submissions', 'previews', characterId, `${sourceStem}.webp`)
        : null
  } else if (kind === 'owner-picks') {
    const previewRelative = raw.thumbnailPath || raw.fullPath
    previewPath = previewRelative ? path.join(contentDir, previewRelative) : null
  } else {
    previewPath = raw.previewPath
      ? path.join(contentDir, 'dist', 'data', 'blue-fish', 'previews', path.basename(raw.previewPath))
      : null
  }

  const previewMedia = await ensureMedia(previewPath, {
    alt: raw.name,
    isAnimated: Boolean(raw.isAnimated),
    role: 'preview',
    sourcePath: previewPath ? relativeSource(previewPath) : null,
    externalUrl: raw.path || raw.sourceUrl || null,
  })

  const channel = kind === 'owner-picks' ? 'owner' : kind === 'blue-fish' ? 'blue-fish' : submissionSource(raw)
  const workData: Record<string, any> = {
    workId: raw.id,
    slug: raw.slug || undefined,
    name: raw.name,
    description: raw.description || '',
    commentary: raw.commentary || '',
    kind,
    channel,
    submissionId: kind === 'submission' ? `legacy_${raw.id}` : undefined,
    sha256: raw.sha256 || undefined,
    character: character.id,
    categories: categoryIds.map((id: string) => categoryMap.get(id).id),
    tags: tagsToArray(raw.tags),
    preview: previewMedia || undefined,
    legacyPaths: {
      path: raw.path || raw.sourceUrl || null,
      thumbnailPath: raw.thumbnailPath || raw.previewPath || null,
      fullPath: raw.fullPath || null,
      externalOriginalUrl: raw.path || raw.sourceUrl || null,
    },
    format: raw.format || undefined,
    mimeType: raw.mimeType || mediaMime(previewPath),
    isAnimated: Boolean(raw.isAnimated),
    width: raw.width || undefined,
    height: raw.height || undefined,
    fileSize: raw.fileSize || undefined,
    submitter: raw.submitter || {},
    origin: raw.origin || (kind === 'blue-fish'
      ? { type: 'archive', author: 'EDMOK/blue-fish-archive', sourceUrl: raw.sourceUrl || null, note: '蓝色大肥鱼档案馆历史归档' }
      : {}),
    license: raw.license || (kind === 'blue-fish'
      ? { type: 'unknown', note: '历史归档，授权状态不明' }
      : {}),
    status: raw.status === 'deleted' ? 'removed' : ['hidden', 'removed', 'draft', 'pending'].includes(raw.status) ? raw.status : 'published',
    needsPublish: false,
    changeAction: null,
    publishedAt: safeDate(raw.createdAt),
    review: raw.review ?? undefined,
    legacySource: kind === 'blue-fish' ? 'blue-fish-archive' : kind === 'owner-picks' ? 'owner-picks.json' : 'works.json',
    legacyOrder: order,
    legacyData: kind === 'blue-fish' ? raw.legacyData : raw,
  }

  await upsert('works', 'workId', raw.id, workData)

  if (kind === 'submission' && !skipSubmissions) {
    const asset = previewMedia
    if (!asset) {
      stats.submissions.skipped += 1
      return
    }
    await upsert('submissions', 'submissionId', `legacy_${raw.id}`, {
      title: raw.name,
      submissionId: `legacy_${raw.id}`,
      source: submissionSource(raw),
      sourceIds: [{ value: String(raw.id) }],
      media: asset,
      fields: {
        name: raw.name,
        description: raw.description || '',
        characterId,
        categoryIds,
        tags: Array.isArray(raw.tags) ? raw.tags : [],
      },
      state: 'published',
      review: { schema: 'legacy-import/1', verdict: 'pass', confidence: 1, reason: '历史作品迁移，不代表真实审核结论' },
      stateHistory: [{ event: 'legacy.import', from: null, to: 'published', at: safeDate(raw.createdAt) || new Date().toISOString(), actor: 'import', reason: '历史作品迁移' }],
      origin: raw.origin || {},
      syncedAt: safeDate(raw.updatedAt) || new Date().toISOString(),
    })
  }
}

async function importWorks(characterMap: Map<string, any>, categoryMap: Map<string, any>) {
  const datasets: Array<{ file: string; kind: 'owner-picks' | 'submission'; rows: any[] }> = [
    { file: 'works.json', kind: 'submission', rows: readJson<any[]>('works.json') },
    { file: 'owner-picks.json', kind: 'owner-picks', rows: readJson<any[]>('owner-picks.json') },
  ]
  if (!skipBlueFish) datasets.push({ file: 'blue-fish-classification.json', kind: 'submission', rows: blueFishRows().map((row) => ({ ...row, kind: 'blue-fish' })) })

  for (const dataset of datasets) {
    const selected = limit > 0 ? dataset.rows.slice(0, limit) : dataset.rows
    console.log(`[导入] ${dataset.file}: ${selected.length} 条`)
    for (const [order, raw] of selected.entries()) {
      const kind = (raw.kind || dataset.kind) as 'blue-fish' | 'owner-picks' | 'submission'
      try {
        await importOneWork(raw, kind, order, characterMap, categoryMap)
      } catch (error) {
        const message = `${dataset.file} / ${raw.id || raw.sourcePath || raw.name}: ${(error as Error).message}`
        stats.errors.push(message)
        console.error(`[失败] ${message}`)
      }
    }
  }
}

async function importTopics(workIds: Map<string, any>) {
  const rows = readJson<any[]>('topics.json')
  for (const raw of rows) {
    const works = Array.isArray(raw.workIds) ? raw.workIds.map((id: string) => workIds.get(id)).filter(Boolean) : []
    await upsert('topics', 'topicId', raw.id, {
      topicId: raw.id,
      name: raw.name,
      summary: raw.summary || '',
      nameEn: raw.i18n?.en?.name || raw.nameEn || undefined,
      summaryEn: raw.i18n?.en?.summary || raw.summaryEn || undefined,
      nameJa: raw.i18n?.ja?.name || raw.nameJa || undefined,
      summaryJa: raw.i18n?.ja?.summary || raw.summaryJa || undefined,
      cover: works.find((doc: any) => doc.workId === raw.coverWorkId)?.id || works[0]?.id || undefined,
      works: works.map((doc: any) => doc.id),
      status: raw.status || 'draft',
      order: Number(raw.order) || 0,
      needsPublish: false,
    })
  }
}

async function main() {
  if (!fs.existsSync(contentDir)) throw new Error(`内容仓不存在：${contentDir}`)
  console.log(`内容仓：${contentDir}`)
  console.log(`数据目录：${dataDir}`)
  console.log(dryRun ? '模式：dry-run（不会写数据库）' : '模式：写入数据库')
  if (previewsOnly) console.log('提示：--previews-only 已为默认行为，参数保留兼容且无额外作用。')
  console.log('素材：只导入预览图；原图和大图不会写入后台。')
  if (noMedia) console.log('素材：--no-media 已指定，跳过所有文件上传')

  const categoryMap = await importCategories()
  const characterMap = await importCharacters()
  await importWorks(characterMap, categoryMap)
  await importEditorialSnapshot()
  const allWorks = await payload.find({ collection: 'works', depth: 0, limit: 2000, overrideAccess: true, pagination: false })
  const workIds = new Map(allWorks.docs.map((doc: any) => [doc.workId, doc]))
  await importTopics(workIds)

  console.log('\n[完成]')
  console.log(JSON.stringify(stats, null, 2))
  if (stats.errors.length > 0) process.exitCode = 1
}

await main()
process.exit(process.exitCode || 0)
