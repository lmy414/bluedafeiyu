/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPayload } from 'payload'

import config from '../src/payload.config.js'

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
const mediaBySha = new Map<string, string>()
const hashCache = new Map<string, string>()
type UpsertCollection = 'categories' | 'characters' | 'submissions' | 'works'
const stats = {
  categories: { created: 0, updated: 0, skipped: 0 },
  characters: { created: 0, updated: 0, skipped: 0 },
  media: { created: 0, reused: 0, missing: 0, skipped: 0 },
  works: { created: 0, updated: 0, skipped: 0 },
  submissions: { created: 0, updated: 0, skipped: 0 },
  errors: [] as string[],
}

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf8')) as T
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

async function upsert(
  collection: UpsertCollection,
  field: string,
  value: unknown,
  data: Record<string, any>,
): Promise<any> {
  const existing = await findOne(collection, field, value)
  if (existing && noUpdate) {
    stats[collection].skipped += 1
    return existing
  }
  if (dryRun) {
    if (existing) stats[collection].updated += 1
    else stats[collection].created += 1
    return existing ?? { id: `dry-${collection}-${String(value)}` }
  }
  if (existing) {
    const updated = await payload.update({ collection, id: existing.id, data, overrideAccess: true } as any)
    stats[collection].updated += 1
    return updated
  }
  const created = await payload.create({ collection, data, overrideAccess: true } as any)
  stats[collection].created += 1
  return created
}

async function ensureMedia(
  filename: string | null,
  meta: {
    alt: string
    externalUrl?: string | null
    role: 'attachment' | 'large' | 'original' | 'preview'
    sourcePath?: string | null
  },
): Promise<string | null> {
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
    overrideAccess: true,
    data: {
      alt: String(meta.alt || path.basename(filename)).slice(0, 200),
      sha256,
      mediaRole: meta.role,
      storageKind: 'content-repository',
      sourcePath: meta.sourcePath || relativeSource(filename),
      externalUrl: meta.externalUrl || null,
      isAnimated: ext === '.gif',
    },
  } as any)
  const createdID = String(created.id)
  mediaBySha.set(sha256, createdID)
  stats.media.created += 1
  return createdID
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

function submissionSource(raw: any): 'github-issue' | 'manual' {
  if (raw.sourceIssue !== null && raw.sourceIssue !== undefined) return 'github-issue'
  if (raw.submitter?.github) return 'github-issue'
  return 'manual'
}

async function importCategories() {
  const rows = readJson<any[]>('categories.json')
  const result = new Map<string, any>()
  for (const row of rows) {
    const doc = await upsert('categories', 'categoryId', row.id, {
      categoryId: row.id,
      name: row.name,
      description: row.description || '',
      status: row.status || 'active',
    })
    result.set(row.id, doc)
  }
  return result
}

async function importCharacters() {
  const rows = readJson<any[]>('characters.json')
  const result = new Map<string, any>()
  for (const row of rows) {
    const doc = await upsert('characters', 'characterId', row.id, {
      characterId: row.id,
      name: row.name,
      aliases: tagsToArray(row.aliases),
      status: row.status || 'active',
      inSubmissionForm: Boolean(row.inSubmissionForm),
    })
    result.set(row.id, doc)
  }
  return result
}

async function importWorks(characterMap: Map<string, any>, categoryMap: Map<string, any>) {
  const datasets: Array<{ file: string; kind: 'blue-fish' | 'owner-picks' | 'submission' }> = [
    { file: 'works.json', kind: 'submission' },
    { file: 'owner-picks.json', kind: 'owner-picks' },
  ]

  if (!skipBlueFish) datasets.push({ file: 'blue-fish.json', kind: 'blue-fish' })

  for (const dataset of datasets) {
    const rows = dataset.file === 'blue-fish.json' ? buildBlueFishRows() : readJson<any[]>(dataset.file)
    const selected = limit > 0 ? rows.slice(0, limit) : rows
    console.log(`[导入] ${dataset.file}: ${selected.length} 条`)
    for (const raw of selected) {
      try {
        await importOneWork(raw, dataset.kind, characterMap, categoryMap)
      } catch (error) {
        const message = `${dataset.file} / ${raw.id || raw.sourcePath || raw.name}: ${(error as Error).message}`
        stats.errors.push(message)
        console.error(`[失败] ${message}`)
      }
    }
  }
}

function buildBlueFishRows(): any[] {
  const classification = readJson<any[]>('blue-fish-classification.json')
  const editorial = readJson<Record<string, any>>('blue-fish-editorial.json')
  const ids = readJson<Record<string, any>>('blue-fish-ids.json')
  return classification
    .map((item) => {
      const edit = editorial[item.sourcePath] || {}
      const identity = ids[item.sourcePath] || {}
      return {
        ...item,
        ...edit,
        id: identity.id || `sticker_bf_${item.sourcePath}`,
        slug: identity.slug || `blue-fish-${item.sourcePath}`,
        sourcePath: item.sourcePath,
        previewPath: item.previewPath,
        name: edit.name || item.name,
        tags: edit.tags || item.tags || [],
        characterId: edit.characterId || item.characterId,
        categoryIds: edit.categoryIds || item.categoryIds || [],
        commentary: edit.commentary || '',
        description: edit.description || '',
        originalPath: edit.originalPath || null,
        sourceUrl: item.sourceUrl || null,
      }
    })
    .filter((item) => item.name && item.tags.length > 0 && item.characterId)
}

async function importOneWork(
  raw: any,
  kind: 'blue-fish' | 'owner-picks' | 'submission',
  characterMap: Map<string, any>,
  categoryMap: Map<string, any>,
) {
  const character = characterMap.get(raw.characterId)
  if (!character) throw new Error(`找不到角色 ${raw.characterId}`)
  const categoryIds = Array.isArray(raw.categoryIds) ? raw.categoryIds.filter((id: string) => categoryMap.has(id)) : []

  let originalPath: string | null = null
  let previewPath: string | null = null
  let largePath: string | null = null
  let externalOriginalUrl: string | null = raw.path || raw.sourceUrl || null

  if (kind === 'submission') {
    const originalName = basenameFromUrl(raw.path)
    originalPath = path.join(contentDir, 'dist', 'submissions', 'originals', raw.characterId, originalName)
    previewPath = raw.thumbnailPath ? path.join(contentDir, 'dist', raw.thumbnailPath) : null
    largePath = raw.fullPath ? path.join(contentDir, 'dist', raw.fullPath) : null
  } else if (kind === 'owner-picks') {
    const originalName = basenameFromUrl(raw.path)
    originalPath = path.join(contentDir, 'owner-picks', originalName)
    previewPath = raw.thumbnailPath ? path.join(contentDir, 'dist', raw.thumbnailPath) : null
    largePath = raw.fullPath ? path.join(contentDir, 'dist', raw.fullPath) : null
  } else {
    previewPath = raw.previewPath
      ? path.join(contentDir, 'dist', 'data', 'blue-fish', 'previews', path.basename(raw.previewPath))
      : null
    originalPath = raw.originalPath ? path.join(contentDir, raw.originalPath) : null
    externalOriginalUrl = raw.sourceUrl || null
  }

  const original = previewsOnly
    ? null
    : await ensureMedia(originalPath, {
        alt: raw.name,
        role: 'original',
        sourcePath: originalPath ? relativeSource(originalPath) : null,
        externalUrl: externalOriginalUrl,
      })
  const preview = await ensureMedia(previewPath, {
    alt: raw.name,
    role: 'preview',
    sourcePath: previewPath ? relativeSource(previewPath) : null,
    externalUrl: externalOriginalUrl,
  })
  const large = previewsOnly
    ? null
    : await ensureMedia(largePath, {
        alt: raw.name,
        role: 'large',
        sourcePath: largePath ? relativeSource(largePath) : null,
        externalUrl: externalOriginalUrl,
      })

  const workData = {
    workId: raw.id,
    slug: raw.slug,
    name: raw.name,
    description: raw.description || '',
    commentary: raw.commentary || '',
    kind,
    character: character.id,
    categories: categoryIds.map((id: string) => categoryMap.get(id).id),
    tags: tagsToArray(raw.tags),
    original: original || undefined,
    preview: preview || original || undefined,
    large: large || undefined,
    legacyPaths: {
      path: raw.path || raw.sourceUrl || null,
      thumbnailPath: raw.thumbnailPath || raw.previewPath || null,
      fullPath: raw.fullPath || raw.largePath || null,
      externalOriginalUrl,
    },
    submitter: raw.submitter || {},
    origin: raw.origin || (kind === 'blue-fish' ? {
      type: 'archive',
      author: 'EDMOK/blue-fish-archive',
      sourceUrl: raw.sourceUrl || null,
      note: '蓝色大肥鱼档案馆历史归档',
    } : {}),
    license: raw.license || (kind === 'blue-fish' ? {
      type: 'unknown',
      note: '历史归档，授权状态不明',
    } : {}),
    status: raw.status || 'published',
    publishedAt: safeDate(raw.createdAt) || new Date().toISOString(),
    legacySource: kind === 'blue-fish' ? 'blue-fish-archive' : kind === 'owner-picks' ? 'owner-picks.json' : 'works.json',
    legacyData: raw,
  }

  await upsert('works', 'workId', raw.id, workData)

  if (kind === 'submission' && !skipSubmissions) {
    const asset = original || preview || large
    if (!asset) {
      stats.submissions.skipped += 1
      return
    }
    const submissionId = `legacy_${raw.id}`
    await upsert('submissions', 'submissionId', submissionId, {
      title: raw.name,
      submissionId,
      source: submissionSource(raw),
      sourceId: raw.sourceIssue !== null && raw.sourceIssue !== undefined ? String(raw.sourceIssue) : raw.id,
      sourceIds: [{ value: String(raw.id) }],
      asset,
      sha256: raw.sha256 ? String(raw.sha256) : fileHash(originalPath || previewPath || ''),
      format: raw.format || path.extname(originalPath || previewPath || '').replace('.', ''),
      mime: raw.mimeType || mediaMime(originalPath || previewPath),
      bytes: raw.fileSize || undefined,
      fields: {
        name: raw.name,
        characterText: raw.characterId,
        description: raw.description || '',
        tags: Array.isArray(raw.tags) ? raw.tags.join(',') : '',
        originType: raw.origin?.type || '',
        originAuthor: raw.origin?.author || '',
        originUrl: raw.origin?.sourceUrl || '',
        licenseType: raw.license?.type || '',
        licenseNote: raw.license?.note || '',
      },
      state: 'published',
      review: {
        schema: 'legacy-import/1',
        verdict: 'pass',
        confidence: 1,
        reason: '历史作品迁移，不代表真实审核结论',
      },
      stateHistory: [{
        event: 'legacy.import',
        from: null,
        to: 'published',
        at: safeDate(raw.createdAt) || new Date().toISOString(),
        actor: 'import',
        reason: '历史作品迁移',
      }],
      submitter: raw.submitter || {},
      origin: raw.origin || {},
      humanDecision: {
        decision: 'approved',
        reason: '历史作品迁移',
        actor: 'import',
        at: safeDate(raw.updatedAt) || new Date().toISOString(),
      },
    })
  }
}

async function main() {
  if (!fs.existsSync(contentDir)) throw new Error(`内容仓不存在：${contentDir}`)
  console.log(`内容仓：${contentDir}`)
  console.log(`数据目录：${dataDir}`)
  console.log(dryRun ? '模式：dry-run（不会写数据库）' : '模式：写入数据库')
  if (previewsOnly) console.log('素材：只导入预览图')
  if (noMedia) console.log('素材：跳过所有文件上传')

  const categoryMap = await importCategories()
  const characterMap = await importCharacters()
  await importWorks(characterMap, categoryMap)

  console.log('\n[完成]')
  console.log(JSON.stringify(stats, null, 2))
  if (stats.errors.length > 0) process.exitCode = 1
}

await main()
process.exit(process.exitCode || 0)






