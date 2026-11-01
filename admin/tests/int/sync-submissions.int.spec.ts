// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer, type RequestListener } from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, getPayload, type Payload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { Categories } from '@/collections/Categories'
import { AuditEvents } from '@/collections/AuditEvents'
import { BulkJobs } from '@/collections/BulkJobs'
import { TakedownRequests } from '@/collections/TakedownRequests'
import { Characters } from '@/collections/Characters'
import { LegacySnapshots } from '@/collections/LegacySnapshots'
import { Media } from '@/collections/Media'
import { PublishRuns } from '@/collections/PublishRuns'
import { Submissions } from '@/collections/Submissions'
import { Topics } from '@/collections/Topics'
import { Users } from '@/collections/Users'
import { Creators } from '@/collections/Creators'
import { Videos } from '@/collections/Videos'
import { Works } from '@/collections/Works'
import { exportSiteData } from '@/lib/export-site-data'
import { repairWorkImageMetadata } from '@/lib/image-metadata-repair'
import { applyPublishStatus, buildPublishSnapshot } from '@/lib/publish'
import { syncSubmissions } from '@/lib/sync-submissions'
import { listTasks } from '@/endpoints/tasks'
import { isGifWork } from '../../../frontend/public/archive/work-format.js'
import { fixtureI18n } from '../../../tools/localization/test-fixture.mjs'
import { resolveConfig } from '../../../server/config.mjs'
import { createAdminHandler } from '../../../server/http.mjs'
import { createQueue } from '../../../server/queue.mjs'

type AdminHandlerFactory = (options: {
  cfg: unknown
  queue: unknown
  reviewer: string | null
  bridge: null
  logger: Console
}) => RequestListener

// server/http.mjs 是 JS 模块，TS 对解构参数推断不完整；这里只固定测试用到的形状。
const makeAdminHandler = createAdminHandler as unknown as AdminHandlerFactory

const VALID_CREATED_AT = '2026-09-20T01:02:03.456Z'
const ORIGINAL_FETCH = globalThis.fetch

let payload: Payload
let firstBuffer: Buffer
let secondBuffer: Buffer
let firstDigest: string
let secondDigest: string
let queueItems: any[]
let rawStatusById = new Map<string, number>()
const extraBytesById = new Map<string, Buffer>()
let categoryRelationId: number

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
    text: async () => JSON.stringify(value),
  } as unknown as Response
}

function bytesResponse(value: Buffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => value,
  } as unknown as Response
}

async function makeJpeg(red: number, green: number, blue: number): Promise<Buffer> {
  return sharp({
    create: {
      background: { b: blue, g: green, r: red },
      channels: 3,
      height: 24,
      width: 32,
    },
  }).jpeg().toBuffer()
}

async function makeGif(): Promise<Buffer> {
  const frame = (red: number) => sharp({
    create: { background: { b: 0, g: 0, r: red, alpha: 1 }, channels: 4, height: 8, width: 8 },
  }).png().toBuffer()
  return sharp([await frame(240), await frame(20)], { join: { animated: true } }).gif({ delay: 100 }).toBuffer()
}

function queueItem(input: { buffer: Buffer; createdAt?: string; name: string; suffix: string }) {
  const digest = crypto.createHash('sha256').update(input.buffer).digest('hex')
  return {
    id: `sub_${digest.slice(0, 24)}`,
    sha256: digest,
    ext: input.suffix === 'first' ? '.jpg' : '.jpeg',
    format: 'jpeg',
    mime: 'image/jpeg',
    source: 'web',
    sourceIds: [`web:${input.suffix}`],
    fields: { name: input.name },
    review: {
      content: {
        name: input.name,
        description: '',
        commentary: '',
        characterId: 'sync-test-character',
        categoryIds: ['sync-test-category'],
        tags: ['sync-test'],
      },
    },
    state: 'auto_passed',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    stateHistory: [],
    origin: { via: 'web' },
  }
}

beforeAll(async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bluedafeiyu-sync-test-'))
  const dbPath = path.join(tempRoot, 'admin.db')
  const config = buildConfig({
    collections: [
      Creators, Videos,
      Characters,
      Categories,
      AuditEvents,
      {
        ...Media,
        upload: {
          ...(Media.upload as any),
          staticDir: path.join(tempRoot, 'media'),
        },
      },
      Submissions,
      Works,
      Topics,
      LegacySnapshots,
      PublishRuns,
      BulkJobs,
      TakedownRequests,
      Users,
    ],
    db: sqliteAdapter({
      client: { url: `file:${dbPath.replace(/\\/g, '/')}` },
      transactionOptions: { behavior: 'immediate' },
      busyTimeout: 5000,
      push: true,
    }),
    secret: 'sync-test-secret',
    sharp,
  })
  payload = await getPayload({ config })

  const character = await (payload as any).create({
    collection: 'characters',
    data: { characterId: 'sync-test-character', name: '同步测试角色', status: 'active' },
    context: { audit: false },
    overrideAccess: true,
  })
  const category = await (payload as any).create({
    collection: 'categories',
    data: { categoryId: 'sync-test-category', name: '同步测试分类', status: 'active' },
    context: { audit: false },
    overrideAccess: true,
  })
  categoryRelationId = category.id
  await (payload as any).create({
    collection: 'categories',
    data: { categoryId: 'sync-test-category-second', name: '同步测试第二分类', status: 'active' },
    context: { audit: false },
    overrideAccess: true,
  })
  for (const [legacyOrder, workId] of [[0, 'sticker_legacy_order_0'], [1, 'sticker_legacy_order_1']] as const) {
    await (payload as any).create({
      collection: 'works',
      data: {
        workId,
        name: `旧有序作品${legacyOrder}`,
        kind: 'submission',
        channel: 'manual',
        character: character.id,
        categories: [category.id],
        status: 'published',
        needsPublish: false,
        legacyOrder,
        legacySource: 'works.json',
      },
      context: { audit: false, skipNeedsPublish: true },
      overrideAccess: true,
    })
  }

  firstBuffer = await makeJpeg(20, 80, 160)
  secondBuffer = await makeJpeg(200, 120, 40)
  firstDigest = crypto.createHash('sha256').update(firstBuffer).digest('hex')
  secondDigest = crypto.createHash('sha256').update(secondBuffer).digest('hex')
  const firstItem: any = queueItem({ buffer: firstBuffer, createdAt: VALID_CREATED_AT, name: '时间测试作品', suffix: 'first' })
  firstItem.review.content.categoryIds = ['sync-test-category']
  firstItem.review.content.i18n = fixtureI18n(firstItem.review.content.tags)
  const secondItem: any = queueItem({ buffer: secondBuffer, name: '无时间测试作品', suffix: 'second' })
  firstItem.fields = { ...firstItem.fields, credit: 'named', creditName: '小鱼', creditUrl: 'https://home.example/me' }
  firstItem.origin = { ...firstItem.origin, author: '原作者', sourceUrl: 'https://source.example/art' }
  secondItem.fields = { ...secondItem.fields, credit: 'anonymous', creditName: '不公开的名字' }
  secondItem.origin = { ...secondItem.origin, submitter: 'private-github-login', sourceUrl: 'https://source.example/second' }
  const bytesById = new Map([
    [firstItem.id, firstBuffer],
    [secondItem.id, secondBuffer],
  ])
  queueItems = [firstItem, secondItem]
  rawStatusById = new Map()

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/v1/item-versions') return jsonResponse({ items: queueItems.map(item => ({ id: item.id, version: crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex') })) })
    if (url.pathname === '/api/v1/items') {
      if (url.searchParams.has('ids')) return jsonResponse({ items: queueItems.filter(item => url.searchParams.get('ids')!.split(',').includes(item.id)), nextCursor: null })
      const limit = Number(url.searchParams.get('limit')) || 200
      const offset = Number(url.searchParams.get('cursor')) || 0
      return jsonResponse({ items: queueItems.slice(offset, offset + limit), nextCursor: offset + limit < queueItems.length ? String(offset + limit) : null })
    }
    if (url.pathname.endsWith('/raw')) {
      const id = decodeURIComponent(url.pathname.split('/').slice(-2, -1)[0] || '')
      const status = rawStatusById.get(id)
      if (status && status !== 200) return { ok: false, status } as Response
      const bytes = bytesById.get(id) || extraBytesById.get(id)
      if (!bytes) throw new Error(`unexpected raw request: ${id}`)
      return bytesResponse(bytes)
    }
    throw new Error(`unexpected fetch: ${url.toString()}`)
  }))
})

afterAll(() => {
  vi.unstubAllGlobals()
  globalThis.fetch = ORIGINAL_FETCH
})

describe('syncSubmissions timestamps and formats', () => {
  it('syncs all 530 items across pages, including manual records after item 500', async () => {
    const originalItems = queueItems
    const items = Array.from({ length: 530 }, (_, index) => ({
      id: `sub_page_${index}`, sha256: index.toString(16).padStart(64, '0'), source: 'web',
      fields: { name: `分页投稿 ${index}` }, state: index >= 500 ? 'needs_manual' : 'received',
      review: index >= 500 ? { verdict: 'manual', reason: '待人工看图' } : null,
      original: { released: true }, createdAt: VALID_CREATED_AT,
    }))
    queueItems = items
    try {
      const stats = await syncSubmissions(payload, { baseUrl: 'http://submission.test', limit: 200, token: 'test-token' })
      expect(stats.errors).toEqual([])
      expect(stats.pages).toBe(3)
      expect(stats.scanned).toBe(530)
      expect(stats.createdSubmissions).toBe(530)
      expect(stats.createdWorks).toBe(0)
      const manual = await (payload as any).find({ collection: 'submissions', where: { state: { equals: 'needs_manual' } }, limit: 100, depth: 0, overrideAccess: true })
      expect(manual.docs).toHaveLength(30)
      expect(manual.docs.some((doc: any) => doc.submissionId === 'sub_page_529')).toBe(true)
      const repeat = await syncSubmissions(payload, { baseUrl: 'http://submission.test', limit: 200, token: 'test-token', incremental: true })
      expect(repeat.scanned).toBe(0)
      expect(repeat.createdSubmissions).toBe(0)
      expect(repeat.updatedSubmissions).toBe(0)
      expect(repeat.unchanged).toBe(530)
      items[529].fields.name = '审核后修改的旧投稿'
      const changed = await syncSubmissions(payload, { baseUrl: 'http://submission.test', token: 'test-token', incremental: true })
      expect(changed.scanned).toBe(1)
      expect(changed.updatedSubmissions).toBe(1)
    } finally {
      queueItems = originalItems
      await (payload as any).delete({ collection: 'submissions', where: { submissionId: { in: items.map((item) => item.id) } }, context: { audit: false }, overrideAccess: true })
    }
  }, 60_000)

  it('retains manual metadata on image download failure and retries the preview next time', async () => {
    const originalItems = queueItems
    const item = { ...queueItems[0], id: 'sub_preview_failure', sha256: 'f'.repeat(64), state: 'needs_manual' }
    queueItems = [item]
    rawStatusById.set(item.id, 500)
    try {
      const stats = await syncSubmissions(payload, { baseUrl: 'http://submission.test', token: 'test-token' })
      expect(stats.errors).toHaveLength(1)
      expect(stats.previewUnavailable).toBe(1)
      const saved = await (payload as any).find({ collection: 'submissions', where: { submissionId: { equals: item.id } }, depth: 0, overrideAccess: true })
      expect(saved.docs).toHaveLength(1)
      expect(saved.docs[0].state).toBe('needs_manual')
      expect(saved.docs[0].media).toBeNull()
      expect(saved.docs[0].work).toBeNull()
    } finally {
      rawStatusById.delete(item.id)
      queueItems = originalItems
      await (payload as any).delete({ collection: 'submissions', where: { submissionId: { equals: item.id } }, context: { audit: false }, overrideAccess: true })
    }
  })

  it('rejects a malformed list instead of silently reporting an empty successful sync', async () => {
    const fetchImpl = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    try {
      await expect(syncSubmissions(payload, { baseUrl: 'http://submission.test', token: 'test-token' })).rejects.toThrow('items')
    } finally {
      vi.stubGlobal('fetch', fetchImpl)
    }
  })

  it('uses queue createdAt, normalizes jpeg to jpg, and lets later edits update updatedAt', async () => {
    const beforeFallback = Date.now()
    const stats = await syncSubmissions(payload, { baseUrl: 'http://submission.test', limit: 10, token: 'test-token' })
    const afterFallback = Date.now()

    expect(stats.errors).toEqual([])
    const works = await (payload as any).find({ collection: 'works', depth: 0, limit: 10, overrideAccess: true, pagination: false })
    expect(works.docs).toHaveLength(4)

    const timed = works.docs.find((work: any) => work.sha256 === firstDigest)
    const fallback = works.docs.find((work: any) => work.sha256 === secondDigest)
    expect(timed).toBeDefined()
    expect(fallback).toBeDefined()
    expect(timed.createdAt).toBe(VALID_CREATED_AT)
    expect(timed.updatedAt).toBe(VALID_CREATED_AT)
    expect(timed.format).toBe('jpg')
    expect(timed.mimeType).toBe('image/jpeg')
    expect(fallback.format).toBe('jpg')
    expect(fallback.mimeType).toBe('image/jpeg')
    expect(fallback.createdAt).toBe(fallback.updatedAt)
    const fallbackTime = Date.parse(fallback.createdAt)
    expect(fallbackTime).toBeGreaterThanOrEqual(beforeFallback)
    expect(fallbackTime).toBeLessThanOrEqual(afterFallback)

    const exported = JSON.parse((await exportSiteData(payload, { treatPendingAsPublished: true }))['data/works.json'])
    const exportedTimed = exported.find((record: any) => record.id === timed.workId)
    const exportedFallback = exported.find((record: any) => record.id === fallback.workId)
    expect(exportedTimed.createdAt).toBe(VALID_CREATED_AT)
    expect(exportedTimed.updatedAt).toBe(VALID_CREATED_AT)
    expect(exportedTimed.format).toBe('jpg')
    // The single type must survive synchronization and export without dropping native content.
    expect(exportedTimed.categoryIds).toEqual(['sync-test-category'])
    expect(exportedTimed.i18n.en.name).toBe(queueItems[0].review.content.i18n.en.name)
    expect(exportedTimed.i18n.ja.name).toBe(queueItems[0].review.content.i18n.ja.name)
    expect(exportedFallback.createdAt).toBe(fallback.createdAt)
    expect(exportedFallback.updatedAt).toBe(fallback.updatedAt)
    expect(exportedFallback.format).toBe('jpg')
    expect(exportedTimed.submitter).toMatchObject({ credit: 'named', name: '小鱼', url: 'https://home.example/me', github: '' })
    expect(exportedTimed.origin).toMatchObject({ author: '原作者', sourceUrl: 'https://source.example/art' })
    expect(exportedFallback.submitter).toEqual({ credit: 'anonymous', name: '', url: '', github: '' })
    expect(exportedFallback.origin.submitter).toBeUndefined()
    expect(exportedFallback.origin.sourceUrl).toBe('https://source.example/second')
    const exportedIds = exported.map((record: any) => record.id)
    expect(exportedIds.slice(0, 2)).toEqual(['sticker_legacy_order_0', 'sticker_legacy_order_1'])
    expect(exportedIds.slice(-2)).toEqual([timed.workId, fallback.workId])

    const edited = await (payload as any).update({
      collection: 'works',
      id: timed.id,
      data: { name: '时间测试作品（已编辑）' },
      context: { audit: false, skipNeedsPublish: true },
      overrideAccess: true,
    })
    expect(edited.createdAt).toBe(VALID_CREATED_AT)
    expect(edited.updatedAt).not.toBe(VALID_CREATED_AT)

    const run = await (payload as any).create({
      collection: 'publish-runs',
      data: { mode: 'publish', runId: 'test-run', status: 'in_progress', trigger: 'manual' },
      context: { audit: false },
      overrideAccess: true,
    })
    const publishResult = await applyPublishStatus(
      { context: { audit: false }, payload } as any,
      run,
      { results: { works: [timed, fallback].map((work) => ({
        workId: work.workId,
        slug: `test-${work.id}`,
        path: `https://raw.example/${work.sha256}.jpg`,
        thumbnailPath: `submissions/previews/${work.sha256}.webp`,
        fullPath: `submissions/large/${work.sha256}.webp`,
      })) } },
    )
    expect(publishResult.publishedWorks).toBe(2)

    const afterPublish = await (payload as any).find({ collection: 'works', depth: 0, limit: 10, overrideAccess: true, pagination: false })
    const publishedTimed = afterPublish.docs.find((work: any) => work.sha256 === firstDigest)
    const publishedFallback = afterPublish.docs.find((work: any) => work.sha256 === secondDigest)
    expect(publishedTimed.createdAt).toBe(VALID_CREATED_AT)
    expect(publishedTimed.legacyData.createdAt).toBe(VALID_CREATED_AT)
    expect(publishedTimed.legacyData.updatedAt).toBe(edited.updatedAt)
    expect(publishedFallback.createdAt).toBe(fallback.createdAt)
    expect(publishedFallback.legacyData.updatedAt).toBe(fallback.createdAt)

    const publishedExport = JSON.parse((await exportSiteData(payload))['data/works.json'])
    const exportedEdited = publishedExport.find((record: any) => record.id === timed.workId)
    const exportedUntouched = publishedExport.find((record: any) => record.id === fallback.workId)
    expect(exportedEdited.createdAt).toBe(VALID_CREATED_AT)
    expect(exportedEdited.updatedAt).toBe(edited.updatedAt)
    expect(exportedUntouched.createdAt).toBe(fallback.createdAt)
    expect(exportedUntouched.updatedAt).toBe(fallback.createdAt)
    const publishedExportIds = publishedExport.map((record: any) => record.id)
    expect(publishedExportIds.slice(-2)).toEqual([timed.workId, fallback.workId])
  })
  it('keeps a submission synced during publication pending when it has no result in the batch', async () => {
    const character = await (payload as any).find({ collection: 'characters', limit: 1, overrideAccess: true })
    const lateWork = await (payload as any).create({
      collection: 'works',
      data: {
        workId: 'sticker_synced_during_publish',
        name: '发布过程中同步的新投稿',
        kind: 'submission',
        channel: 'qq',
        character: character.docs[0].id,
        categories: [categoryRelationId],
        status: 'pending',
        needsPublish: true,
        changeAction: 'add',
        legacySource: 'submission-sync',
      },
      context: { audit: false, skipNeedsPublish: true },
      overrideAccess: true,
    })
    const run = await (payload as any).find({ collection: 'publish-runs', limit: 1, overrideAccess: true })

    const result = await applyPublishStatus(
      { context: { audit: false }, payload } as any,
      run.docs[0],
      { results: { works: [] } },
    )

    expect(result.publishedWorks).toBe(0)
    const saved = await (payload as any).findByID({ collection: 'works', id: lateWork.id, overrideAccess: true })
    expect(saved.status).toBe('pending')
    expect(saved.needsPublish).toBe(true)
    expect(saved.changeAction).toBe('add')
    expect(saved.lastPublishedAt).toBeNull()
    expect(saved.legacyPaths.path).toBeNull()
    const published = JSON.parse((await exportSiteData(payload))['data/works.json'])
    expect(published.some((work: any) => work.id === lateWork.workId)).toBe(false)
  })
  it('writes the work and its audit event in the same SQLite transaction', async () => {
    const character = await (payload as any).find({ collection: 'characters', limit: 1, overrideAccess: true })
    const work = await (payload as any).create({
      collection: 'works',
      data: { workId: 'sticker_audit_transaction', name: '审计事务测试', kind: 'submission', channel: 'manual', character: character.docs[0].id, categories: [categoryRelationId], status: 'published', needsPublish: false },
      context: { skipNeedsPublish: true },
      overrideAccess: true,
    })
    const audit = await (payload as any).find({ collection: 'audit-events', where: { targetId: { equals: String(work.id) } }, overrideAccess: true })
    expect(audit.docs).toHaveLength(1)
    expect(audit.docs[0].action).toBe('works.create')
    await (payload as any).delete({ collection: 'works', id: work.id, context: { audit: false }, overrideAccess: true })
  })
  it('rolls back all work status updates when a later slug conflicts with a hidden work', async () => {
    const character = await (payload as any).find({ collection: 'characters', limit: 1, overrideAccess: true })
    const create = (data: any) => (payload as any).create({
      collection: 'works',
      data: { name: '事务回归作品', kind: 'submission', channel: 'manual', character: character.docs[0].id, categories: [categoryRelationId], ...data },
      context: { audit: false, skipNeedsPublish: true },
      overrideAccess: true,
    })
    const hidden = await create({ workId: 'sticker_transaction_hidden', slug: 'transaction-reserved', status: 'hidden', needsPublish: false })
    const conflicting = await create({ workId: 'sticker_transaction_conflict', status: 'pending', needsPublish: true, createdAt: '2026-10-06T00:00:00Z' })
    const valid = await create({ workId: 'sticker_transaction_valid', status: 'pending', needsPublish: true, createdAt: '2026-10-06T00:01:00Z' })
    const run = await (payload as any).find({ collection: 'publish-runs', limit: 1, overrideAccess: true })
    const updates: number[] = []
    const update = (payload as any).update.bind(payload)
    const spy = vi.spyOn(payload as any, 'update').mockImplementation(async (args: any) => {
      const result = await update(args)
      if (args.collection === 'works') updates.push(args.id)
      return result
    })
    try {
      await expect(applyPublishStatus(
        { context: { audit: false }, payload } as any,
        run.docs[0],
        { results: { works: [
          { workId: valid.workId, slug: 'transaction-new' },
          { workId: conflicting.workId, slug: hidden.slug },
        ] } },
      )).rejects.toThrow()
      expect(updates).toContain(valid.id)
      for (const work of [valid, conflicting]) {
        const saved = await (payload as any).findByID({ collection: 'works', id: work.id, overrideAccess: true })
        expect(saved.status).toBe('pending')
        expect(saved.needsPublish).toBe(true)
        expect(saved.slug).toBeNull()
        expect(saved.lastPublishRun).toBeNull()
      }
    } finally {
      spy.mockRestore()
      for (const work of [valid, conflicting, hidden]) await (payload as any).delete({ collection: 'works', id: work.id, context: { audit: false }, overrideAccess: true })
    }
  })
  it('uses an existing preview for a released original and keeps metadata when no preview exists', async () => {
    const previewItem = { ...queueItems[0], id: 'sub_released_preview_123' }
    const missingBuffer = await makeJpeg(1, 2, 3)
    const missingItem = queueItem({ buffer: missingBuffer, name: '已释放无预览', suffix: 'released' })
    missingItem.id = 'sub_released_missing_123'
    rawStatusById.set(previewItem.id, 410)
    rawStatusById.set(missingItem.id, 410)
    queueItems.push(previewItem, missingItem)

    const existingWork = await (payload as any).find({ collection: 'works', where: { sha256: { equals: firstDigest } }, limit: 1, depth: 0, overrideAccess: true })
    try {
      const stats = await syncSubmissions(payload, { baseUrl: 'http://submission.test', limit: 10, token: 'test-token' })
      expect(stats.errors).toEqual([])
      expect(stats.previewUnavailable).toBe(1)

      const releasedSubmission = await (payload as any).find({ collection: 'submissions', where: { submissionId: { equals: previewItem.id } }, limit: 1, depth: 0, overrideAccess: true })
      expect(releasedSubmission.docs).toHaveLength(1)
      expect(String(releasedSubmission.docs[0].media)).toBe(String(existingWork.docs[0].preview))

      const missingSubmission = await (payload as any).find({ collection: 'submissions', where: { submissionId: { equals: missingItem.id } }, limit: 1, depth: 0, overrideAccess: true })
      expect(missingSubmission.docs).toHaveLength(1)
      expect(missingSubmission.docs[0].media).toBeNull()
      expect(missingSubmission.docs[0].work).toBeNull()
    } finally {
      queueItems.splice(queueItems.length - 2, 2)
    }
  })

  it('keeps GIF format and animation metadata when a later sync reuses an existing preview', async () => {
    const originalItems = queueItems
    const gif = await makeGif()
    const item: any = queueItem({ buffer: gif, name: '二次同步 GIF', suffix: 'gif' })
    item.ext = '.gif'
    item.format = 'gif'
    item.mime = 'image/gif'
    item.state = 'received'
    item.review = null
    const digest = crypto.createHash('sha256').update(gif).digest('hex')
    queueItems = [item]
    extraBytesById.set(item.id, gif)
    try {
      const first = await syncSubmissions(payload, { baseUrl: 'http://submission.test', limit: 10, token: 'test-token' })
      expect(first.errors).toEqual([])
      const mirrored = await (payload as any).find({ collection: 'submissions', where: { submissionId: { equals: item.id } }, limit: 1, depth: 0, overrideAccess: true })
      expect(mirrored.docs[0].media).toBeTruthy()

      item.state = 'auto_passed'
      item.review = { content: { name: '二次同步 GIF', description: '', commentary: '第一人称点评', characterId: 'sync-test-character', categoryIds: ['sync-test-category'], tags: ['gif'] } }
      const second = await syncSubmissions(payload, { baseUrl: 'http://submission.test', limit: 10, token: 'test-token' })
      expect(second.errors).toEqual([])

      const work = await (payload as any).find({ collection: 'works', where: { sha256: { equals: digest } }, limit: 1, depth: 0, overrideAccess: true })
      expect(work.docs).toHaveLength(1)
      expect(work.docs[0].format).toBe('gif')
      expect(work.docs[0].mimeType).toBe('image/gif')
      expect(work.docs[0].isAnimated).toBe(true)
      expect(work.docs[0].width).toBe(8)
      expect(work.docs[0].height).toBe(8)
      expect(work.docs[0].fileSize).toBe(gif.length)

      const snapshot = await buildPublishSnapshot(payload, { runId: 'gif-metadata-test', plannedChanges: null })
      const records = JSON.parse(snapshot.files['data/works.json'])
      const record = records.find((entry: any) => entry.id === work.docs[0].workId)
      expect(record.format).toBe('gif')
      expect(record.mimeType).toBe('image/gif')
      expect(record.isAnimated).toBe(true)
      expect(record.path).toMatch(/\.gif$/)
      expect(isGifWork({ format: record.format, mimeType: record.mimeType, originalUrl: record.path })).toBe(true)
      const original = snapshot.originals.find((entry: any) => entry.workId === work.docs[0].workId)
      expect(original.ext).toBe('.gif')
      expect(original.targetPath).toMatch(/\.gif$/)
    } finally {
      queueItems = originalItems
      extraBytesById.delete(item.id)
      await (payload as any).delete({ collection: 'works', where: { sha256: { equals: digest } }, context: { audit: false }, overrideAccess: true })
      await (payload as any).delete({ collection: 'submissions', where: { submissionId: { equals: item.id } }, context: { audit: false }, overrideAccess: true })
    }
  }, 60_000)

  it('repairs historical missing GIF metadata from the local content repo without moving published paths', async () => {
    const gif = await makeGif()
    const digest = crypto.createHash('sha256').update(gif).digest('hex')
    const rel = `dist/submissions/originals/sync-test-character/${digest.slice(0, 16)}.png`
    const contentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bluedafeiyu-repair-'))
    const localFile = path.join(contentDir, rel)
    await fs.mkdir(path.dirname(localFile), { recursive: true })
    await fs.writeFile(localFile, gif)
    const rawUrl = `https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/${rel}`
    const character = await (payload as any).find({ collection: 'characters', where: { characterId: { equals: 'sync-test-character' } }, limit: 1, overrideAccess: true })
    const created = await (payload as any).create({
      collection: 'works',
      data: {
        workId: `sticker_${digest.slice(0, 24)}`,
        slug: `repair-${digest.slice(0, 8)}`,
        name: '历史 GIF 元数据回填',
        kind: 'submission',
        channel: 'web',
        submissionId: `sub_${digest.slice(0, 24)}`,
        sha256: digest,
        format: '',
        mimeType: '',
        isAnimated: false,
        width: 0,
        height: 0,
        fileSize: 0,
        character: character.docs[0].id,
        characters: [character.docs[0].id],
        categories: [categoryRelationId],
        status: 'published',
        needsPublish: false,
        legacyPaths: { path: rawUrl },
      },
      context: { audit: false, skipNeedsPublish: true, skipFieldAccess: true },
      overrideAccess: true,
    })
    try {
      const dry = await repairWorkImageMetadata(payload, { contentDir, workIds: [created.workId] })
      expect(dry.mode).toBe('dry-run')
      expect(dry.repaired).toBe(1)
      const untouched = await (payload as any).findByID({ collection: 'works', id: created.id, overrideAccess: true })
      expect(untouched.format).toBe('')
      expect(untouched.needsPublish).toBe(false)

      const written = await repairWorkImageMetadata(payload, { contentDir, workIds: [created.workId], write: true })
      expect(written.errors).toEqual([])
      expect(written.repaired).toBe(1)
      const saved = await (payload as any).findByID({ collection: 'works', id: created.id, overrideAccess: true })
      expect(saved.format).toBe('gif')
      expect(saved.mimeType).toBe('image/gif')
      expect(saved.isAnimated).toBe(true)
      expect(saved.width).toBe(8)
      expect(saved.height).toBe(8)
      expect(saved.fileSize).toBe(gif.length)
      expect(saved.needsPublish).toBe(true)
      expect(saved.legacyPaths.path).toBe(rawUrl)
      expect(saved.slug).toBe(`repair-${digest.slice(0, 8)}`)

      const exported = JSON.parse((await exportSiteData(payload, { treatPendingAsPublished: true }))['data/works.json'])
      const record = exported.find((entry: any) => entry.id === created.workId)
      expect(isGifWork(record)).toBe(true)
    } finally {
      await (payload as any).delete({ collection: 'works', id: created.id, context: { audit: false }, overrideAccess: true })
      await fs.rm(contentDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('smoke: real queue + admin HTTP + sync keeps a GIF out of the png fallback', async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bluedafeiyu-gif-smoke-'))
    const cfg = resolveConfig({
      storageRoot,
      adminToken: 'smoke-admin-token',
      hermesReviewToken: 'smoke-hermes-token',
      adminHost: '127.0.0.1',
      adminPort: 18788,
      publicHost: '127.0.0.1',
      publicPort: 18790,
    })
    const queue = await createQueue(cfg)
    const server = createServer(makeAdminHandler({
      cfg,
      queue,
      reviewer: null,
      bridge: null,
      logger: console,
    }))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('admin smoke server 未取得端口')
    const baseUrl = `http://127.0.0.1:${address.port}`

    const character = await (payload as any).find({ collection: 'characters', where: { characterId: { equals: 'deepseek' } }, limit: 1, overrideAccess: true })
    const category = await (payload as any).find({ collection: 'categories', where: { categoryId: { equals: 'meme' } }, limit: 1, overrideAccess: true })
    const smokeCharacter = character.docs[0] || await (payload as any).create({
      collection: 'characters', data: { characterId: 'deepseek', name: 'DeepSeek娘', status: 'active' }, context: { audit: false }, overrideAccess: true,
    })
    const smokeCategory = category.docs[0] || await (payload as any).create({
      collection: 'categories', data: { categoryId: 'meme', name: '梗图', status: 'active' }, context: { audit: false }, overrideAccess: true,
    })

    const gif = await makeGif()
    const digest = crypto.createHash('sha256').update(gif).digest('hex')
    let submissionId = ''
    const stubbedFetch = globalThis.fetch
    globalThis.fetch = ORIGINAL_FETCH
    try {
      const queued = await queue.enqueue({
        source: 'web',
        sourceId: `smoke:${digest}`,
        buffer: gif,
        fields: { name: '真实 GIF 冒烟', character: 'deepseek', categoryId: 'meme' },
        origin: { via: 'web' },
      }) as unknown as { item: { id: string } }
      submissionId = queued.item.id

      const first = await syncSubmissions(payload, { baseUrl, limit: 10, token: 'smoke-admin-token' })
      expect(first.errors).toEqual([])

      const reviewResponse = await fetch(`${baseUrl}/api/v1/internal/review-results`, {
        method: 'POST',
        headers: { Authorization: 'Bearer smoke-hermes-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewer: 'hermes',
          submissionId,
          verdict: 'pass',
          confidence: 0.99,
          reason: 'smoke',
          content: {
            name: '真实 GIF 冒烟',
            description: '真实 GIF 投稿冒烟验证',
            commentary: '我来看看这张动图。',
            characterId: 'deepseek',
            categoryIds: ['meme'],
            tags: ['gif'],
          },
        }),
      })
      expect(reviewResponse.status).toBe(200)
      expect((await reviewResponse.json()).state).toBe('auto_passed')

      const second = await syncSubmissions(payload, { baseUrl, limit: 10, token: 'smoke-admin-token' })
      expect(second.errors).toEqual([])
      const work = await (payload as any).find({ collection: 'works', where: { sha256: { equals: digest } }, limit: 1, depth: 0, overrideAccess: true })
      expect(work.docs).toHaveLength(1)
      expect(work.docs[0].format).toBe('gif')
      expect(work.docs[0].mimeType).toBe('image/gif')
      expect(work.docs[0].isAnimated).toBe(true)
      expect(work.docs[0].width).toBe(8)
      expect(work.docs[0].height).toBe(8)
      expect(work.docs[0].fileSize).toBe(gif.length)

      const snapshot = await buildPublishSnapshot(payload, { runId: 'gif-smoke', plannedChanges: null })
      const records = JSON.parse(snapshot.files['data/works.json'])
      const record = records.find((entry: any) => entry.id === work.docs[0].workId)
      expect(record.path).toMatch(/\.gif$/)
      expect(isGifWork(record)).toBe(true)
      expect(snapshot.originals.find((entry: any) => entry.workId === work.docs[0].workId).ext).toBe('.gif')
    } finally {
      globalThis.fetch = stubbedFetch
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await fs.rm(storageRoot, { recursive: true, force: true })
      if (submissionId) await (payload as any).delete({ collection: 'submissions', where: { submissionId: { equals: submissionId } }, context: { audit: false }, overrideAccess: true })
      await (payload as any).delete({ collection: 'works', where: { sha256: { equals: digest } }, context: { audit: false }, overrideAccess: true })
      if (!character.docs[0]) await (payload as any).delete({ collection: 'characters', id: smokeCharacter.id, context: { audit: false }, overrideAccess: true })
      if (!category.docs[0]) await (payload as any).delete({ collection: 'categories', id: smokeCategory.id, context: { audit: false }, overrideAccess: true })
    }
  }, 60_000)

  it('server Agent HTTP -> admin sync -> console keeps the real Hermes batch', async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bluedafeiyu-batch-smoke-'))
    const cfg = resolveConfig({
      storageRoot,
      adminToken: 'batch-admin-token',
      hermesReviewToken: 'batch-hermes-token',
      adminHost: '127.0.0.1',
      adminPort: 18789,
      publicHost: '127.0.0.1',
      publicPort: 18791,
    })
    const queue = await createQueue(cfg)
    const server = createServer(makeAdminHandler({ cfg, queue, reviewer: 'hermes', bridge: null, logger: console }))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('batch smoke server 未取得端口')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const gif = await makeGif()
    const digest = crypto.createHash('sha256').update(gif).digest('hex')
    let submissionId = ''
    const stubbedFetch = globalThis.fetch
    globalThis.fetch = ORIGINAL_FETCH
    try {
      const queued = await queue.enqueue({
        source: 'web',
        sourceId: `batch:${digest}`,
        buffer: gif,
        fields: { name: '服务器批次投稿', character: 'deepseek', categoryId: 'meme' },
        origin: { via: 'web' },
      }) as unknown as { item: { id: string } }
      submissionId = queued.item.id
      const call = async (body: Record<string, unknown>) => {
        const response = await fetch(`${baseUrl}/api/v1/internal/agent`, {
          method: 'POST',
          headers: { Authorization: 'Bearer batch-hermes-token', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const value = await response.json()
        return { httpStatus: response.status, ...value }
      }
      const batchId = 'cron:b0f01cac9b53:e2e-batch'
      const claim = await call({ action: 'claim', id: submissionId, batchId, batchLabel: 'Hermes 审核批次', sourceKind: 'hermes' })
      expect(claim.httpStatus).toBe(200)
      const imageResponse = await fetch(`${baseUrl}/api/v1/internal/agent`, {
        method: 'POST',
        headers: { Authorization: 'Bearer batch-hermes-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'image', id: submissionId, token: claim.token }),
      })
      expect(imageResponse.status).toBe(200)
      expect((await imageResponse.arrayBuffer()).byteLength).toBeGreaterThan(0)
      const draft = await call({
        action: 'draft',
        id: submissionId,
        token: claim.token,
        review: { verdict: 'manual', confidence: 0.6, reason: '证据不足，保留复核' },
        content: {
          name: '服务器批次投稿',
          description: '真实服务器批次链路',
          commentary: '等待人工复核。',
          characterId: 'deepseek',
          characterIds: ['deepseek'],
          categoryIds: ['meme'],
          tags: ['批次'],
        },
      })
      expect(draft.httpStatus).toBe(200)
      const complete = await call({ action: 'complete', id: submissionId, token: claim.token })
      expect(complete.httpStatus).toBe(200)
      expect(complete.state).toBe('needs_manual')
      const synced = await syncSubmissions(payload, { baseUrl, limit: 10, token: 'batch-admin-token' })
      expect(synced.errors).toEqual([])
      const mirrored = await (payload as any).find({ collection: 'submissions', where: { submissionId: { equals: submissionId } }, limit: 1, depth: 0, overrideAccess: true })
      expect(mirrored.docs[0].agentProgress).toMatchObject({ batchId, sourceKind: 'hermes' })
      expect(mirrored.docs[0].agentProgress.batchHistory.at(-1)).toMatchObject({ batchId, status: 'completed' })
      const owner = await (payload as any).create({ collection: 'users', data: { email: `batch-${Date.now()}@test.local`, password: 'test-password', role: 'owner' }, overrideAccess: true, context: { audit: false } })
      try {
        const tasks = await (await listTasks({ payload, user: owner, url: `http://localhost/?task=${encodeURIComponent(submissionId)}` } as any)).json()
        expect(tasks.docs[0]).toMatchObject({ kind: 'submission', batchId, sourceKind: 'hermes', sourceLabel: 'Hermes Agent', batchItemCount: 1 })
        expect(tasks.docs[0].group).toBe('decide')
        const history = await (await listTasks({ payload, user: owner, url: 'http://localhost/?group=history&sourceKind=hermes' } as any)).json()
        expect(history.batches.some((batch: any) => batch.batchId === batchId && batch.itemCount === 1 && batch.status === 'finished')).toBe(true)
        expect(history.batchTotal).toBeGreaterThanOrEqual(1)
        const inBatch = await (await listTasks({ payload, user: owner, url: `http://localhost/?batch=${encodeURIComponent(batchId)}` } as any)).json()
        expect(inBatch.docs.some((row: any) => row.sourceId === submissionId)).toBe(true)
      } finally {
        await (payload as any).delete({ collection: 'users', id: owner.id, overrideAccess: true, context: { audit: false } })
      }
    } finally {
      globalThis.fetch = stubbedFetch
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await fs.rm(storageRoot, { recursive: true, force: true })
      if (submissionId) await (payload as any).delete({ collection: 'submissions', where: { submissionId: { equals: submissionId } }, context: { audit: false }, overrideAccess: true })
    }
  }, 60_000)
})
