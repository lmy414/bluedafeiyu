/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'node:path'

import type { Payload, PayloadRequest } from 'payload'

import { exportSiteData, type SiteDataTexts } from './export-site-data'
import { writeAudit } from './audit'

export type PublishPlan = {
  added: any[]
  updated: any[]
  hidden: any[]
  restored: any[]
  deleted: any[]
  topics: any[]
  summary: { added: number; updated: number; hidden: number; restored: number; deleted: number; topics: number }
}

function briefWork(doc: any) {
  return { id: doc.id, workId: doc.workId, name: doc.name, kind: doc.kind, status: doc.status, changeAction: doc.changeAction || null }
}

function briefTopic(doc: any) {
  return { id: doc.id, topicId: doc.topicId, name: doc.name, status: doc.status }
}

export async function buildPublishPlan(payload: Payload): Promise<PublishPlan> {
  const [works, topics] = await Promise.all([
    (payload as any).find({ collection: 'works', depth: 0, limit: 2000, overrideAccess: true, pagination: false }),
    (payload as any).find({ collection: 'topics', depth: 0, limit: 1000, overrideAccess: true, pagination: false }),
  ])
  const plan: PublishPlan = {
    added: [],
    updated: [],
    hidden: [],
    restored: [],
    deleted: [],
    topics: [],
    summary: { added: 0, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 },
  }
  for (const work of works.docs) {
    if (!work.needsPublish && work.status !== 'pending') continue
    if (work.status === 'pending') plan.added.push(briefWork(work))
    else if (work.status === 'hidden') plan.hidden.push(briefWork(work))
    else if (work.status === 'deleted' || work.status === 'removed') plan.deleted.push(briefWork(work))
    else if (work.status === 'published' && work.changeAction === 'restore') plan.restored.push(briefWork(work))
    else plan.updated.push(briefWork(work))
  }
  for (const topic of topics.docs) {
    if (topic.needsPublish) plan.topics.push(briefTopic(topic))
  }
  plan.summary = {
    added: plan.added.length,
    updated: plan.updated.length,
    hidden: plan.hidden.length,
    restored: plan.restored.length,
    deleted: plan.deleted.length,
    topics: plan.topics.length,
  }
  return plan
}

function extFromWork(work: any): string {
  const sourceExt = path.extname(String(work.legacyPaths?.path || '')).toLowerCase()
  if (sourceExt) return sourceExt === '.jpeg' ? '.jpg' : sourceExt
  const format = String(work.format || 'png').toLowerCase().replace(/^\./, '')
  return `.${format === 'jpeg' ? 'jpg' : (format || 'png')}`
}

export function targetOriginalPath(work: any): string {
  const characterId = String(work.character?.characterId || work.characterId || work.character || 'unknown')
  const digest = String(work.sha256 || '').slice(0, 16)
  return `dist/submissions/originals/${characterId}/${digest}${extFromWork(work)}`
}

function relativeContentPath(value: unknown, kind: string): string | null {
  if (!value) return null
  let text = String(value).trim()
  if (!text) return null
  try {
    const url = new URL(text)
    const marker = '/main/'
    const index = url.pathname.indexOf(marker)
    if (index >= 0) text = url.pathname.slice(index + marker.length)
    else text = url.pathname.replace(/^\/+/, '')
  } catch {
    text = text.replace(/\\/g, '/').replace(/^\/+/, '')
  }
  if (text.startsWith('data/blue-fish/previews/')) return null
  if (kind === 'blue-fish' && text.startsWith('dist/data/blue-fish/')) return null
  if (text.startsWith('dist/')) return text
  if (text.startsWith('submissions/')) return `dist/${text}`
  if (text.startsWith('owner-picks/')) return text
  return null
}

export function contentPathsForWork(work: any): string[] {
  const paths = work.legacyPaths || {}
  const values = [paths.path, paths.thumbnailPath, paths.fullPath, work.preview?.sourcePath]
  const result: string[] = []
  for (const value of values) {
    const relative = relativeContentPath(value, work.kind)
    if (relative && !result.includes(relative)) result.push(relative)
  }
  return result
}

export async function buildPublishSnapshot(payload: Payload, run: any): Promise<{
  runId: string
  files: SiteDataTexts
  originals: any[]
  deletions: any[]
  summary: PublishPlan['summary']
}> {
  const plan = await buildPublishPlan(payload)
  const allWorks = await (payload as any).find({ collection: 'works', depth: 2, limit: 2000, overrideAccess: true, pagination: false })
  const originalUrlByWorkId: Record<string, string> = {}
  const originals: any[] = []
  for (const work of allWorks.docs) {
    if (work.status !== 'pending' || work.kind !== 'submission' || !work.submissionId || !work.sha256) continue
    const targetPath = targetOriginalPath(work)
    originalUrlByWorkId[work.workId] = `https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/${targetPath}`
    originals.push({
      workId: work.workId,
      sha256: work.sha256,
      characterId: String(work.character?.characterId || work.character || 'unknown'),
      ext: extFromWork(work),
      targetPath,
      submissionId: work.submissionId,
    })
  }
  const deletions = allWorks.docs
    .filter((work: any) => work.status === 'deleted')
    .map((work: any) => ({ workId: work.workId, kind: work.kind, contentPaths: contentPathsForWork(work) }))
  const files = await exportSiteData(payload, { originalUrlByWorkId, treatPendingAsPublished: true })
  return { runId: run.runId, files, originals, deletions, summary: plan.summary }
}

export async function applyPublishStatus(
  req: PayloadRequest,
  run: any,
  body: any,
): Promise<{ publishedWorks: number; updatedTopics: number }> {
  const payload = req.payload
  const transactionID = await (payload.db as any).beginTransaction()
  let publishedWorks = 0
  let updatedTopics = 0
  try {
    const works = await (payload as any).find({ collection: 'works', where: { needsPublish: { equals: true } }, depth: 0, limit: 2000, overrideAccess: true, pagination: false })
    const results = new Map<string, any>((body.results?.works || []).map((result: any) => [String(result.workId), result]))
    const finishedAt = new Date().toISOString()
    for (const work of works.docs) {
      const result = results.get(String(work.workId))
      // 发布期间同步的新投稿不在本批原图和结果中，留待下一批处理。
      // 否则会被误标为 published，且原图、派生图路径仍为空。
      if (work.status === 'pending' && !result) continue
      const mergeLegacy = (current: any) => {
        const base = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {}
        if (result) {
          for (const [key, value] of Object.entries({
            slug: result.slug,
            path: result.path,
            thumbnailPath: result.thumbnailPath,
            fullPath: result.fullPath,
            width: result.width,
            height: result.height,
            fileSize: result.fileSize,
            format: result.format,
            mimeType: result.mimeType,
          })) {
            if (value !== undefined && value !== null && value !== '') base[key] = value
          }
        }
        if (work.legacySource === 'submission-sync' && base.createdAt && work.updatedAt) base.updatedAt = work.updatedAt
        return base
      }
      const data: Record<string, any> = {
        needsPublish: false,
        changeAction: null,
        lastPublishedAt: finishedAt,
        lastPublishRun: run.id,
        legacyData: mergeLegacy(work.legacyData),
      }
      if (work.status === 'pending') data.status = 'published'
      if (result) {
        data.slug = result.slug || work.slug || undefined
        data.legacyPaths = {
          ...(work.legacyPaths || {}),
          path: result.path || work.legacyPaths?.path || '',
          thumbnailPath: result.thumbnailPath || work.legacyPaths?.thumbnailPath || '',
          fullPath: result.fullPath || work.legacyPaths?.fullPath || '',
        }
        data.width = result.width ?? work.width
        data.height = result.height ?? work.height
        data.fileSize = result.fileSize ?? work.fileSize
        data.format = result.format ?? work.format
        data.mimeType = result.mimeType ?? work.mimeType
      }
      await (payload as any).update({
        collection: 'works',
        id: work.id,
        data,
        context: { audit: false, skipNeedsPublish: true, skipFieldAccess: true },
        overrideAccess: true,
        req: { transactionID },
      })
      publishedWorks += 1
    }

    const topics = await (payload as any).find({ collection: 'topics', where: { needsPublish: { equals: true } }, depth: 0, limit: 1000, overrideAccess: true, pagination: false })
    for (const topic of topics.docs) {
      await (payload as any).update({
        collection: 'topics',
        id: topic.id,
        data: { needsPublish: false, lastPublishedAt: finishedAt, lastPublishRun: run.id },
        context: { audit: false, skipNeedsPublish: true },
        overrideAccess: true,
        req: { transactionID },
      })
      updatedTopics += 1
    }
    await (payload.db as any).commitTransaction(transactionID)
  } catch (error) {
    await (payload.db as any).rollbackTransaction(transactionID)
    throw error
  }

  const deleted = await (payload as any).find({ collection: 'works', where: { status: { equals: 'deleted' } }, limit: 2000, depth: 1, overrideAccess: true, pagination: false })
  for (const work of deleted.docs) {
    for (const relation of [work.preview]) {
      if (!relation) continue
      const mediaId = typeof relation === 'object' ? relation.id : relation
      await (payload as any).delete({ collection: 'media', id: mediaId, context: { audit: false }, overrideAccess: true }).catch(() => undefined)
    }
  }

  await writeAudit(req, {
    action: 'publish.succeeded',
    after: { commits: body.commits, releasePath: body.releasePath, results: body.results, runId: run.runId },
    targetId: run.id,
    targetType: 'publish-runs',
  })
  return { publishedWorks, updatedTopics }
}
