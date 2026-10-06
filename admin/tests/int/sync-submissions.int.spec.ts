// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, getPayload, type Payload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { Categories } from '@/collections/Categories'
import { AuditEvents } from '@/collections/AuditEvents'
import { Characters } from '@/collections/Characters'
import { LegacySnapshots } from '@/collections/LegacySnapshots'
import { Media } from '@/collections/Media'
import { PublishRuns } from '@/collections/PublishRuns'
import { Submissions } from '@/collections/Submissions'
import { Topics } from '@/collections/Topics'
import { Users } from '@/collections/Users'
import { Works } from '@/collections/Works'
import { exportSiteData } from '@/lib/export-site-data'
import { applyPublishStatus } from '@/lib/publish'
import { syncSubmissions } from '@/lib/sync-submissions'
import { fixtureI18n } from '../../../tools/localization/test-fixture.mjs'

const VALID_CREATED_AT = '2026-09-20T01:02:03.456Z'
const ORIGINAL_FETCH = globalThis.fetch

let payload: Payload
let firstBuffer: Buffer
let secondBuffer: Buffer
let firstDigest: string
let secondDigest: string
let queueItems: any[]
let rawStatusById = new Map<string, number>()
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
    if (url.pathname === '/api/v1/items') return jsonResponse({ items: queueItems })
    if (url.pathname.endsWith('/raw')) {
      const id = decodeURIComponent(url.pathname.split('/').slice(-2, -1)[0] || '')
      const status = rawStatusById.get(id)
      if (status && status !== 200) return { ok: false, status } as Response
      const bytes = bytesById.get(id)
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
  it('uses an existing preview for a released original and skips when no preview exists', async () => {
    const previewItem = { ...queueItems[0], id: 'sub_released_preview_123' }
    const missingBuffer = await makeJpeg(1, 2, 3)
    const missingItem = queueItem({ buffer: missingBuffer, name: '已释放无预览', suffix: 'released' })
    missingItem.id = 'sub_released_missing_123'
    rawStatusById.set(previewItem.id, 410)
    rawStatusById.set(missingItem.id, 410)
    queueItems.push(previewItem, missingItem)

    const existingWork = await (payload as any).find({ collection: 'works', where: { sha256: { equals: firstDigest } }, limit: 1, depth: 0, overrideAccess: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const stats = await syncSubmissions(payload, { baseUrl: 'http://submission.test', limit: 10, token: 'test-token' })
      expect(stats.errors).toEqual([])
      expect(stats.skipped).toBe(2)

      const releasedSubmission = await (payload as any).find({ collection: 'submissions', where: { submissionId: { equals: previewItem.id } }, limit: 1, depth: 0, overrideAccess: true })
      expect(releasedSubmission.docs).toHaveLength(1)
      expect(String(releasedSubmission.docs[0].media)).toBe(String(existingWork.docs[0].preview))

      const missingSubmission = await (payload as any).find({ collection: 'submissions', where: { submissionId: { equals: missingItem.id } }, limit: 1, depth: 0, overrideAccess: true })
      expect(missingSubmission.docs).toHaveLength(0)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('原图已释放且 Payload 中没有预览'))
    } finally {
      warn.mockRestore()
      queueItems.splice(queueItems.length - 2, 2)
    }
  })
})
