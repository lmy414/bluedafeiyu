/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 历史作品图片元数据回填。
 *
 * 早期同步在预览媒体已存在时创建作品，format / mimeType / isAnimated / 尺寸没有落库，
 * 后续发布把原图按 `.png` 保存，GIF 动图因此进不了 `/gifs.html`。本模块从**本地内容仓
 * 原图**重新探测并按原图校正元数据后回填 CMS；不下载、不重命名、不改 legacyPaths / id / slug。
 * 只处理已发布且缺 format/mimeType 的历史作品；写入时显式置 needsPublish，下一次发布
 * 即可重导出 works.json。已有的 add/remove/hide 等待发布动作不会被覆盖。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { Payload } from 'payload'

import { readSubmissionImageMetadata } from './sync-submissions'

export const REPAIR_SCHEMA = 'image-metadata-repair/1'

const ORIGINAL_PREFIXES = ['dist/submissions/originals/', 'owner-picks/', 'blue-fish-originals/'] as const

export type RepairChange = {
  workId: string
  slug: string | null
  format: string
  mimeType: string
  isAnimated: boolean
  width: number
  height: number
  fileSize: number
}

export type RepairReport = {
  schema: typeof REPAIR_SCHEMA
  mode: 'dry-run' | 'write'
  contentDir: string
  scanned: number
  candidates: number
  repaired: number
  skipped: number
  errors: string[]
  changes: RepairChange[]
}

export type RepairOptions = {
  write?: boolean
  limit?: number
  workIds?: string[]
  contentDir: string
}

/** 从 legacyPaths/legacyData 的公开地址还原内容仓相对路径。 */
function relativeOriginalPath(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  let rel = text.replace(/\\/g, '/')
  try {
    const url = new URL(text)
    const marker = '/main/'
    const index = url.pathname.indexOf(marker)
    if (index < 0) return null
    rel = url.pathname.slice(index + marker.length)
  } catch {
    rel = rel.replace(/^\/+/, '')
  }
  const normalized = path.posix.normalize(rel)
  if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) return null
  return ORIGINAL_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ? normalized : null
}

function localOriginalPath(work: any, contentDir: string): string | null {
  const values = [work.legacyPaths?.path, work.legacyData?.path, work.legacyPaths?.externalOriginalUrl]
  const root = path.resolve(contentDir)
  for (const value of values) {
    const rel = relativeOriginalPath(value)
    if (!rel) continue
    const absolute = path.resolve(root, rel)
    if (!absolute.startsWith(`${root}${path.sep}`)) continue
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute
  }
  return null
}

function candidateWork(work: any): boolean {
  return work?.status === 'published' && Boolean(work.sha256) && (!work.format || !work.mimeType)
}

export async function repairWorkImageMetadata(payload: Payload, options: RepairOptions): Promise<RepairReport> {
  const contentDir = path.resolve(String(options.contentDir || ''))
  if (!fs.existsSync(contentDir) || !fs.statSync(contentDir).isDirectory()) {
    throw new Error(`内容仓目录不存在：${contentDir}`)
  }
  const write = options.write === true
  const report: RepairReport = {
    schema: REPAIR_SCHEMA,
    mode: write ? 'write' : 'dry-run',
    contentDir,
    scanned: 0,
    candidates: 0,
    repaired: 0,
    skipped: 0,
    errors: [],
    changes: [],
  }

  const workIds = Array.isArray(options.workIds) ? options.workIds.filter(Boolean) : []
  const works: any[] = []
  for (let page = 1; ; page += 1) {
    const found = await (payload as any).find({
      collection: 'works',
      where: workIds.length ? { workId: { in: workIds } } : { kind: { equals: 'submission' } },
      depth: 0,
      limit: 200,
      page,
      overrideAccess: true,
    })
    works.push(...(Array.isArray(found.docs) ? found.docs : []))
    if (!found.hasNextPage) break
  }
  const limit = Number.isSafeInteger(options.limit) && Number(options.limit) > 0 ? Number(options.limit) : 0
  let processed = 0

  for (const work of works) {
    report.scanned += 1
    if (!candidateWork(work)) continue
    if (limit && processed >= limit) break
    processed += 1
    report.candidates += 1

    const localPath = localOriginalPath(work, contentDir)
    if (!localPath) {
      report.skipped += 1
      report.errors.push(`${work.workId}: 内容仓找不到原图`)
      continue
    }

    let buffer: Buffer
    try {
      buffer = fs.readFileSync(localPath)
    } catch (error) {
      report.skipped += 1
      report.errors.push(`${work.workId}: 读取原图失败：${(error as Error).message}`)
      continue
    }
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== String(work.sha256).toLowerCase()) {
      report.skipped += 1
      report.errors.push(`${work.workId}: 原图 sha256 与记录不一致`)
      continue
    }

    let metadata
    try {
      metadata = await readSubmissionImageMetadata(buffer, {}, String(work.sha256))
    } catch (error) {
      report.skipped += 1
      report.errors.push(`${work.workId}: 无法读取原图元数据：${(error as Error).message}`)
      continue
    }

    const patch: Record<string, unknown> = {}
    if (String(work.format || '').toLowerCase() !== metadata.format) patch.format = metadata.format
    if (String(work.mimeType || '').toLowerCase() !== metadata.mimeType) patch.mimeType = metadata.mimeType
    if (Boolean(work.isAnimated) !== metadata.isAnimated) patch.isAnimated = metadata.isAnimated
    if (Number(work.width) !== metadata.width) patch.width = metadata.width
    if (Number(work.height) !== metadata.height) patch.height = metadata.height
    if (Number(work.fileSize) !== metadata.fileSize) patch.fileSize = metadata.fileSize
    if (Object.keys(patch).length === 0) {
      report.skipped += 1
      continue
    }

    const change: RepairChange = {
      workId: String(work.workId),
      slug: work.slug ?? null,
      format: metadata.format,
      mimeType: metadata.mimeType,
      isAnimated: metadata.isAnimated,
      width: metadata.width,
      height: metadata.height,
      fileSize: metadata.fileSize,
    }
    report.changes.push(change)

    if (write) {
      const data: Record<string, unknown> = { ...patch, needsPublish: true }
      // 只补元数据，不改变待发布语义；没有动作或本来就是 update 才写 update。
      if (!work.changeAction || work.changeAction === 'update') data.changeAction = 'update'
      await (payload as any).update({
        collection: 'works',
        id: work.id,
        data,
        context: { audit: false, skipNeedsPublish: true, skipFieldAccess: true },
        overrideAccess: true,
      })
    }
    report.repaired += 1
  }

  return report
}
