/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import { validateI18n } from './localization.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { submissionAttribution } from './attribution.mjs'

import type { Payload } from 'payload'
import sharp, { type Metadata } from 'sharp'

const PREVIEW_EDGE = 480
const PREVIEW_QUALITY = 76
const PREVIEW_EFFORT = 6

export const CONTENT_KEYS = ['name', 'description', 'commentary', 'characterId', 'categoryIds', 'tags', 'i18n'] as const

const TEXT_LIMITS = {
  name: 200,
  description: 2000,
  commentary: 2000,
  characterId: 64,
  categoryId: 64,
  categoryIds: 1,
  tags: 20,
  tagLength: 40,
}

const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|<\/?[A-Za-z!]|(?:javascript|vbscript|data)\s*:|\bon[a-z]+\s*=/i

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function normalizeDigest(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeImageFormat(value: unknown): string {
  const format = String(value || '').trim().toLowerCase().replace(/^\./, '')
  return format === 'jpeg' ? 'jpg' : format
}

function originalFormat(item: any, metadata: Metadata): string {
  const ext = normalizeImageFormat(item.ext)
  if (ext) return ext
  return normalizeImageFormat(metadata.format) || 'png'
}

function normalizeIso(value: unknown): string | null {
  const text = String(value || '')
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null
}

function mimeForFormat(format: string, item: any): string {
  const explicit = String(item.mimeType || '').trim().toLowerCase()
  if (explicit) return explicit
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg'
  if (format === 'apng') return 'image/apng'
  return `image/${format || 'png'}`
}

export type SubmissionPreview = {
  bytes: Buffer
  fileSize: number
  format: string
  height: number
  isAnimated: boolean
  mimeType: string
  sha256: string
  width: number
}

export async function prepareSubmissionPreview(buffer: Buffer, item: any): Promise<SubmissionPreview> {
  const digest = sha256(buffer)
  const expected = normalizeDigest(item?.sha256)
  if (expected && expected !== digest) throw new Error(`投稿原图 sha256 与队列记录不一致：${item?.id || ''}`)

  const metadata = await sharp(buffer, { animated: true }).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`无法读取原图尺寸：${item?.id || ''}`)
  const orientation = Number(metadata.orientation || 1)
  const rotated = orientation >= 5 && orientation <= 8
  const width = rotated ? metadata.height : metadata.width
  const height = rotated ? metadata.width : (metadata.pageHeight || metadata.height)
  const format = originalFormat(item, metadata)
  const isAnimated = Boolean(metadata.pages && metadata.pages > 1) || format === 'gif' || format === 'apng'

  const { data } = await sharp(buffer, { animated: true })
    .rotate()
    .resize({ fit: 'inside', height: PREVIEW_EDGE, kernel: 'lanczos3', width: PREVIEW_EDGE, withoutEnlargement: true })
    .webp({ effort: PREVIEW_EFFORT, quality: PREVIEW_QUALITY })
    .toBuffer({ resolveWithObject: true })

  return {
    bytes: data,
    fileSize: buffer.length,
    format,
    height,
    isAnimated,
    mimeType: mimeForFormat(format, item),
    sha256: digest,
    width,
  }
}

function normalizeSource(source: unknown): 'github-issue' | 'manual' | 'qq' | 'web' {
  const value = String(source || '').toLowerCase()
  if (value === 'github' || value === 'github-issue') return 'github-issue'
  if (value === 'qq') return 'qq'
  if (value === 'web') return 'web'
  return 'manual'
}

function textOk(value: unknown, max: number, required = false): boolean {
  if (typeof value !== 'string') return false
  if (FORBIDDEN.test(value)) return false
  if (required && !value.trim()) return false
  return value.length <= max
}

export function validateContent(content: unknown, vocabulary: { characterIds: Set<string>; categoryIds: Set<string> }): { ok: true; value: any } | { ok: false; errors: string[] } {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return { ok: false, errors: ['content 不是对象'] }
  const object = content as Record<string, unknown>
  const keys = Object.keys(object)
  const errors: string[] = []
  for (const key of keys) if (!CONTENT_KEYS.includes(key as any)) errors.push(`content 含未知字段 ${key}`)
  for (const key of CONTENT_KEYS) if (key !== 'i18n' && !(key in object)) errors.push(`content 缺少字段 ${key}`)
  if (errors.length) return { ok: false, errors }

  if (!textOk(object.name, TEXT_LIMITS.name, true)) errors.push('content.name 非法')
  if (!textOk(object.description, TEXT_LIMITS.description)) errors.push('content.description 非法')
  if (!textOk(object.commentary, TEXT_LIMITS.commentary)) errors.push('content.commentary 非法')
  if (!textOk(object.characterId, TEXT_LIMITS.characterId, true)) errors.push('content.characterId 非法')
  if (!Array.isArray(object.categoryIds) || object.categoryIds.length === 0 || object.categoryIds.length > TEXT_LIMITS.categoryIds) {
    errors.push('content.categoryIds 非法')
  } else {
    for (const id of object.categoryIds) {
      if (!textOk(id, TEXT_LIMITS.categoryId, true)) errors.push(`content.categoryIds 含非法项 ${String(id)}`)
    }
  }
  if (!Array.isArray(object.tags) || object.tags.length > TEXT_LIMITS.tags) {
    errors.push('content.tags 非法')
  } else {
    for (const tag of object.tags) {
      if (!textOk(tag, TEXT_LIMITS.tagLength)) errors.push(`content.tags 含非法项 ${String(tag)}`)
    }
  }
  const categoryIdsRaw = object.categoryIds
  const tagsRaw = object.tags
  const characterId = String(object.characterId || '').trim()
  if (!vocabulary.characterIds.has(characterId)) errors.push(`content.characterId 不在角色词表内：${characterId}`)
  for (const id of Array.isArray(categoryIdsRaw) ? (categoryIdsRaw as unknown[]) : []) {
    if (!vocabulary.categoryIds.has(String(id).trim())) errors.push(`content.categoryIds 不在分类词表内：${String(id)}`)
  }
  if (errors.length) return { ok: false, errors }
  let i18n
  if ('i18n' in object) { try { i18n = validateI18n(object.i18n, object) } catch(error) { return {ok:false,errors:['content.i18n: '+(error as Error).message]} } }
  return {
    ok: true,
    value: {
      ...(i18n ? {i18n} : {}),
      name: String(object.name).trim(),
      description: String(object.description).trim(),
      commentary: String(object.commentary).trim(),
      characterId,
      categoryIds: (categoryIdsRaw as unknown[]).map((id: unknown) => String(id).trim()),
      tags: (tagsRaw as unknown[]).map((tag: unknown) => String(tag).trim()).filter(Boolean),
    },
  }
}

async function requestJson(token: string, url: string): Promise<any> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`投稿服务请求失败 ${response.status}：${await response.text()}`)
  return response.json()
}

async function requestBytes(token: string, url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    const error = new Error(`读取投稿原图失败 ${response.status}`) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return Buffer.from(await response.arrayBuffer())
}

async function findOne(payload: Payload, collection: string, field: string, value: unknown): Promise<any | null> {
  const result = await (payload as any).find({ collection, where: { [field]: { equals: value } }, limit: 1, depth: 0, overrideAccess: true })
  return result.docs[0] ?? null
}

async function ensureSubmissionMedia(payload: Payload, item: any, preview: SubmissionPreview, dryRun: boolean): Promise<number | string | null> {
  const digest = preview.sha256
  if (dryRun) return `dry-media-${digest.slice(0, 12)}`
  const existing = await findOne(payload, 'media', 'sha256', digest)
  if (existing) return existing.id
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafeiyu-submission-preview-'))
  const filePath = path.join(tempDir, `${digest}.webp`)
  try {
    await fs.writeFile(filePath, preview.bytes)
    const created = await (payload as any).create({
      collection: 'media',
      filePath,
      data: {
        alt: item.fields?.name || `投稿 ${item.id}`,
        sha256: digest,
        mediaRole: 'preview',
        storageKind: 'payload-private',
        sourcePath: `submission/${item.id}.webp`,
        isAnimated: preview.isAnimated,
      },
      context: { audit: false, skipNeedsPublish: true },
      overrideAccess: true,
    })
    return created.id
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

export async function syncSubmissions(payload: Payload, options: { baseUrl?: string; dryRun?: boolean; limit?: number; source?: string; state?: string; token?: string } = {}) {
  const baseUrl = String(options.baseUrl || process.env.SUBMISSION_ADMIN_API_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '')
  const token = options.token || process.env.SUBMISSION_ADMIN_TOKEN || ''
  if (!token) throw new Error('缺少 SUBMISSION_ADMIN_TOKEN')
  const limit = Number.isSafeInteger(options.limit) && Number(options.limit) > 0 ? Number(options.limit) : 500
  const query = new URLSearchParams({ limit: String(limit) })
  if (options.state) query.set('state', options.state)
  if (options.source) query.set('source', options.source)
  const list = await requestJson(token, `${baseUrl}/api/v1/items?${query.toString()}`)
  const items = Array.isArray(list.items) ? list.items : []

  const characterResult = await (payload as any).find({ collection: 'characters', where: { status: { equals: 'active' } }, limit: 1000, depth: 0, overrideAccess: true })
  const categoryResult = await (payload as any).find({ collection: 'categories', where: { status: { equals: 'active' } }, limit: 1000, depth: 0, overrideAccess: true })
  const vocabulary = {
    characterIds: new Set(characterResult.docs.map((doc: any) => String(doc.characterId)) as string[]),
    categoryIds: new Set(categoryResult.docs.map((doc: any) => String(doc.categoryId)) as string[]),
  }
  const stats = { createdSubmissions: 0, updatedSubmissions: 0, createdWorks: 0, linkedWorks: 0, skipped: 0, errors: [] as string[] }

  for (const [index, item] of items.entries()) {
    try {
      const submissionId = String(item.id)
      const existingSubmission = await findOne(payload, 'submissions', 'submissionId', submissionId)
      const queuedDigest = normalizeDigest(item.sha256)
      const existingWork = queuedDigest ? await findOne(payload, 'works', 'sha256', queuedDigest) : null
      let linkedWorkId = existingWork?.id
      let mediaId: number | string | null = existingSubmission?.media || null
      let preview: SubmissionPreview | null = null
      let content: any = null

      if (!mediaId && !options.dryRun) {
        try {
          const raw = await requestBytes(token, `${baseUrl}/api/v1/items/${encodeURIComponent(submissionId)}/raw`)
          preview = await prepareSubmissionPreview(raw, item)
          mediaId = await ensureSubmissionMedia(payload, item, preview, false)
        } catch (error) {
          if ((error as any)?.status !== 410) throw error
          const existingPreview = existingSubmission?.media || existingWork?.preview
          if (!existingPreview) {
            stats.skipped += 1
            console.warn(`[同步] ${submissionId} 原图已释放且 Payload 中没有预览，跳过`)
            continue
          }
          mediaId = typeof existingPreview === 'object' ? existingPreview.id : existingPreview
          stats.skipped += 1
          console.warn(`[同步] ${submissionId} 原图已释放，使用 Payload 已有预览`)
        }
      } else if (!mediaId) {
        mediaId = `dry-media-${queuedDigest.slice(0, 12)}`
      }
      const digest = preview?.sha256 || queuedDigest || String(existingWork?.sha256 || '')
      if (digest && queuedDigest && digest !== queuedDigest) throw new Error(`投稿 sha256 不一致：${submissionId}`)

      if (item.state === 'auto_passed' && !existingWork) {
        const check = validateContent(item.review?.content, vocabulary)
        if (!check.ok) {
          stats.skipped += 1
          console.warn(`[同步] ${submissionId} 内容未通过：${check.errors.join('；')}`)
        } else {
          content = check.value
          const workId = `sticker_${digest.slice(0, 24)}`
          if (options.dryRun) {
            linkedWorkId = `dry-work-${digest.slice(0, 24)}`
          } else {
            const createdAt = normalizeIso(item.createdAt) || new Date().toISOString()
            const created = await (payload as any).create({
              collection: 'works',
              data: {
                workId,
                name: content.name,
                description: content.description,
                commentary: content.commentary,
                kind: 'submission',
                channel: normalizeSource(item.source),
                submissionId,
                sha256: digest,
                format: preview?.format,
                mimeType: preview?.mimeType,
                isAnimated: preview?.isAnimated,
                width: preview?.width,
                height: preview?.height,
                fileSize: preview?.fileSize,
                character: characterResult.docs.find((doc: any) => doc.characterId === content.characterId)?.id,
                categories: content.categoryIds.map((id: string) => categoryResult.docs.find((doc: any) => doc.categoryId === id)!.id),
                tags: content.tags.map((value: string) => ({ value })),
                preview: mediaId || undefined,
                status: 'pending',
                needsPublish: true,
                changeAction: 'add',
                review: item.review || null,
                origin: item.origin || {},
                submitter: submissionAttribution(item.fields || {}) || undefined,
                legacySource: 'submission-sync',
                legacyData: { createdAt, updatedAt: createdAt },
                createdAt,
                updatedAt: createdAt,
              },
              context: { audit: false, skipNeedsPublish: true, skipFieldAccess: true },
              overrideAccess: true,
            })
            linkedWorkId = created.id
          }
        }
      } else if (existingWork) {
        stats.linkedWorks += 1
      }

      const submissionData: Record<string, any> = {
        title: item.fields?.name || `投稿 ${submissionId}`,
        submissionId,
        source: normalizeSource(item.source),
        sourceIds: (Array.isArray(item.sourceIds) ? item.sourceIds : []).map((value: unknown) => ({ value: String(value) })),
        sha256: digest || undefined,
        media: mediaId || undefined,
        fields: item.fields || {},
        review: item.review || null,
        state: item.state || 'received',
        stateHistory: item.stateHistory || [],
        origin: item.origin || {},
        work: linkedWorkId || undefined,
        syncedAt: new Date().toISOString(),
      }

      if (options.dryRun) {
        if (existingSubmission) stats.updatedSubmissions += 1
        else stats.createdSubmissions += 1
      } else if (existingSubmission) {
        await (payload as any).update({
          collection: 'submissions',
          id: existingSubmission.id,
          data: submissionData,
          context: { audit: false, skipNeedsPublish: true },
          overrideAccess: true,
        })
        stats.updatedSubmissions += 1
      } else {
        await (payload as any).create({
          collection: 'submissions',
          data: submissionData,
          context: { audit: false, skipNeedsPublish: true },
          overrideAccess: true,
        })
        stats.createdSubmissions += 1
      }

      if (index + 1 >= limit) break
    } catch (error) {
      stats.errors.push(`${item.id}: ${(error as Error).message}`)
    }
  }
  return stats
}
