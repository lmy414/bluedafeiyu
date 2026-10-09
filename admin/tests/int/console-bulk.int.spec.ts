// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, getPayload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Users } from '@/collections/Users'
import { BulkJobs } from '@/collections/BulkJobs'
import { Works } from '@/collections/Works'
import { Submissions } from '@/collections/Submissions'
import { Categories } from '@/collections/Categories'
import { Characters } from '@/collections/Characters'
import { Media } from '@/collections/Media'
import { Topics } from '@/collections/Topics'
import { PublishRuns } from '@/collections/PublishRuns'
import { AuditEvents } from '@/collections/AuditEvents'
import { createBulkJob, cancelBulkJob, retryBulkJob } from '@/endpoints/bulk-jobs'
import { stepJob } from '@/lib/bulk-jobs'
import { consoleList, consoleAuthors, parseConsoleQuery } from '@/lib/console-list'
import { sourceHash } from '@/lib/localization.mjs'
import { fixtureI18n } from '../../../tools/localization/test-fixture.mjs'

let payload: any, owner: any, bot: any, char: any, category: any, media: any, root: string, imageBytes: Buffer
const request = (body: any, user = owner) => ({ payload, user, context: {}, json: async () => body, url: 'http://localhost' }) as any
const query = (params: string) => parseConsoleQuery(new URL('http://localhost/?' + params))
async function createWork(key: string, data: any = {}) {
  return payload.create({ collection: 'works', data: { workId: key, name: key, character: char.id, categories: [category.id], channel: 'web', kind: 'submission', status: 'published', needsPublish: false, preview: media.id, ...data }, overrideAccess: true, context: { audit: false, skipNeedsPublish: true } })
}
async function createSubmission(key: string, data: any = {}) {
  return payload.create({ collection: 'submissions', data: { submissionId: key, title: key, source: 'web', state: 'needs_manual', fields: { name: key, character: 'deepseek', categoryId: 'meme' }, media: media.id, ...data }, overrideAccess: true, context: { audit: false } })
}
async function enqueue(operation: string, target: string, ids: string[], extras: any = {}) {
  const response = await createBulkJob(request({ operation, target, ids, ...extras }))
  expect(response.status).toBe(202)
  const body = await response.json()
  return (await payload.find({ collection: 'bulk-jobs', where: { jobId: { equals: body.job.jobId } }, overrideAccess: true })).docs[0]
}
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'console-bulk-'))
  process.env.MEDIA_DIR = path.join(root, 'media')
  const config = buildConfig({ collections: [Users, BulkJobs, Works, Submissions, Categories, Characters, { ...Media, upload: { ...(Media.upload as any), staticDir: process.env.MEDIA_DIR } }, Topics, PublishRuns, AuditEvents], db: sqliteAdapter({ client: { url: `file:${path.join(root, 'test.db').replace(/\\/g, '/')}` }, push: true, transactionOptions: { behavior: 'immediate' } }), secret: 'console-bulk-test', sharp })
  payload = await getPayload({ config })
  owner = await payload.create({ collection: 'users', data: { email: 'owner@bulk.test', password: 'test-password', role: 'owner' }, overrideAccess: true, context: { audit: false } })
  bot = { id: owner.id, role: 'bot' }
  char = await payload.create({ collection: 'characters', data: { characterId: 'deepseek', name: 'DeepSeek娘', status: 'active' }, overrideAccess: true, context: { audit: false } })
  category = await payload.create({ collection: 'categories', data: { categoryId: 'meme', name: '梗图', status: 'active' }, overrideAccess: true, context: { audit: false } })
  const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#123456' } }).webp().toBuffer()
  imageBytes = bytes
  const image = path.join(root, 'fixture.webp'); await fs.writeFile(image, bytes)
  media = await payload.create({ collection: 'media', data: { alt: '测试', mediaRole: 'preview' }, filePath: image, overrideAccess: true, context: { audit: false } })
}, 30000)
afterAll(async () => { await payload?.destroy(); payload?.db?.client?.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })

describe('轻量列表服务端分页', () => {
  it('只返回当前页；作者统计覆盖全部匹配记录；不输出大段译文', async () => {
    for (let n = 0; n < 55; n++) await createWork(`page_${n}`, { origin: { author: n === 54 ? '远端作者' : '普通作者' }, review: { confidence: .9, content: { huge: 'x'.repeat(20000) } } })
    const list = await consoleList(payload, query('kind=works&limit=48'))
    expect(list.docs).toHaveLength(48); expect(list.totalDocs).toBe(55); expect(list.totalPages).toBe(2)
    expect(JSON.stringify(list).includes('huge')).toBe(false)
    const second = await consoleList(payload, query('kind=works&limit=48&page=2'))
    expect(second.docs).toHaveLength(7)
    expect(new Set([...list.docs, ...second.docs].map(x => x.id)).size).toBe(55)
    const authors = await consoleAuthors(payload, query('kind=works'))
    expect(authors.find(x => x.value === '远端作者')?.count).toBe(1)
    const filtered = await consoleList(payload, query('kind=works&author=' + encodeURIComponent('远端作者')))
    expect(filtered.totalDocs).toBe(1)
    expect(filtered.docs[0].effectiveAuthor).toBe('远端作者')
    const oldEnv = { property: process.env.GA4_PROPERTY_ID, stream: process.env.GA4_STREAM_ID, start: process.env.GA4_START_DATE, file: process.env.GA4_CACHE_FILE }
    try {
      process.env.GA4_PROPERTY_ID = '123'; process.env.GA4_STREAM_ID = '456'; process.env.GA4_START_DATE = '2026-10-03'; process.env.GA4_CACHE_FILE = path.join(root, 'analytics.json')
      await fs.writeFile(process.env.GA4_CACHE_FILE, JSON.stringify({ version: 1, propertyId: '123', streamId: '456', startDate: '2026-10-03', syncedAt: new Date().toISOString(), works: { page_0: { views: 999, downloads: 888 } } }))
      const ranked = await consoleList(payload, query('kind=works&sort=downloads&limit=1'))
      expect((ranked.docs[0] as any).workId).toBe('page_0')
      expect((ranked.docs[0] as any).metrics?.downloads).toBe(888)
    } finally {
      for (const [key, value] of Object.entries({ GA4_PROPERTY_ID: oldEnv.property, GA4_STREAM_ID: oldEnv.stream, GA4_START_DATE: oldEnv.start, GA4_CACHE_FILE: oldEnv.file })) if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }, 30000)
  it('参数化搜索防注入，字面 % 不匹配全部；人工列表按关联状态区分', async () => {
    expect((await consoleList(payload, query('keyword=%25'))).totalDocs).toBe(0)
    expect((await consoleList(payload, query('keyword=' + encodeURIComponent("' OR 1=1 --")))).totalDocs).toBe(0)
    const work = await createWork('handled_work')
    await createSubmission('sub_unhandled')
    await createSubmission('sub_handled', { work: work.id })
    expect((await consoleList(payload, query('kind=submissions&mode=rejected'))).totalDocs).toBe(1)
    expect((await consoleList(payload, query('kind=submissions&mode=reviewed'))).totalDocs).toBe(1)
  })
})

describe('持久化批量任务', () => {
  it('只排队；无前端请求时执行器继续写入，断点恢复不重复审计', async () => {
    await createWork('bulk_a'); await createWork('bulk_b')
    const job = await enqueue('write-fields', 'works', ['bulk_a', 'bulk_b'], { patch: { description: '统一说明' } })
    expect((await payload.find({ collection: 'works', where: { workId: { equals: 'bulk_a' } } })).docs[0].description).toBeNull()
    const first = await stepJob(request({}), job)
    expect(first.cursor).toBe(1); expect(first.status).toBe('running')
    // 重新从持久库读取模拟前端关闭、执行器重启后续跑。
    const stored = await payload.findByID({ collection: 'bulk-jobs', id: job.id, overrideAccess: true })
    const last = await stepJob(request({}), stored)
    expect(last.status).toBe('succeeded'); expect(last.results).toHaveLength(2)
    const duplicateStep = await stepJob(request({}), stored)
    expect(duplicateStep.cursor).toBe(2)
    expect((await payload.find({ collection: 'audit-events', where: { action: { equals: 'bulk.write-fields' } } })).totalDocs).toBe(2)
  })
  it('批量修改投稿草稿后同步不会覆盖原字段和 AI 结论', async () => {
    const doc = await createSubmission('sub_editorial', { review: { verdict: 'manual', reason: 'AI 原结论' } })
    const job = await enqueue('write-fields', 'submissions', [doc.submissionId], { patch: { commentary: '人工草稿点评' } })
    const done = await stepJob(request({}), job)
    expect(done.status).toBe('succeeded')
    const saved = await payload.findByID({ collection: 'submissions', id: doc.id, overrideAccess: true })
    expect(saved.editorial.commentary).toBe('人工草稿点评'); expect(saved.review).toEqual(doc.review); expect(saved.fields).toEqual(doc.fields)
  })
  it('并发编辑不覆盖；逐条错误隔离，并可重试失败项', async () => {
    const one = await createWork('race_a'); await createWork('race_b')
    const job = await enqueue('write-fields', 'works', ['race_a', 'race_b'], { patch: { commentary: '批量点评' } })
    await payload.update({ collection: 'works', id: one.id, data: { commentary: '人工新点评' }, overrideAccess: true, context: { audit: false } })
    const next = await stepJob(request({}), job); const end = await stepJob(request({}), next)
    expect(end.status).toBe('partial'); expect(end.results[0].status).toBe('failed'); expect(end.results[1].status).toBe('succeeded')
    const retry = await retryBulkJob(request({ jobId: job.jobId })); expect(retry.status).toBe(202)
    const retried = (await payload.find({ collection: 'bulk-jobs', where: { jobId: { equals: (await retry.json()).job.jobId } }, overrideAccess: true })).docs[0]
    await cancelBulkJob(request({ jobId: retried.jobId }))
  })
  it('明确确认后才收录；缺译文失败；收录与关联在同一事务中', async () => {
    const content = { name: '看图确认', description: '画面说明', commentary: '人工点评', characterId: 'deepseek', categoryIds: ['meme'], tags: ['测试'] }
    const doc = await createSubmission('sub_include', { sha256: crypto.createHash('sha256').update(imageBytes).digest('hex'), editorial: { ...content, i18n: { sourceHash: sourceHash({ ...content, origin: {}, license: {} }), ...fixtureI18n(content.tags) } } })
    expect((await createBulkJob(request({ operation: 'manual-include', target: 'submissions', ids: [doc.submissionId] }))).status).toBe(400)
    const job = await enqueue('manual-include', 'submissions', [doc.submissionId], { confirm: 'MANUAL_INCLUDE' })
    const fetchImpl = globalThis.fetch
    process.env.SUBMISSION_ADMIN_TOKEN = 'offline-test-token'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(imageBytes))))
    let end: any
    try { end = await stepJob(request({}), job) } finally { vi.stubGlobal('fetch', fetchImpl); delete process.env.SUBMISSION_ADMIN_TOKEN }
    expect(end.status).toBe('succeeded')
    const saved = await payload.findByID({ collection: 'submissions', id: doc.id, depth: 1, overrideAccess: true })
    expect(saved.state).toBe('needs_manual'); expect(saved.work.status).toBe('pending'); expect(saved.work.needsPublish).toBe(true)
    const bad = await createSubmission('sub_no_i18n', { sha256: 'c'.repeat(64), editorial: content })
    const failed = await stepJob(request({}), await enqueue('manual-include', 'submissions', [bad.submissionId], { confirm: 'MANUAL_INCLUDE' }))
    expect(failed.status).toBe('failed'); expect(failed.results[0].message).toContain('翻译')
  })
  it('AI 批量翻译在服务端保存英日版本；失败不会改写中文', async () => {
    const content = { name: '中文标题', description: '中文说明', commentary: '中文点评', characterId: 'deepseek', categoryIds: ['meme'], tags: ['测试'] }
    const doc = await createWork('translate_a', { name: content.name, description: content.description, commentary: content.commentary, tags: [{ value: '测试' }] })
    const call = vi.fn(async () => JSON.stringify(fixtureI18n(content.tags)))
    const done = await stepJob(request({}), await enqueue('translate', 'works', [doc.workId]), call)
    expect(done.status).toBe('succeeded'); expect(call).toHaveBeenCalledOnce()
    const saved = await payload.findByID({ collection: 'works', id: doc.id, overrideAccess: true })
    expect(saved.legacyData.i18n.en).toBeDefined(); expect(saved.name).toBe(content.name)
    const skipped = await stepJob(request({}), await enqueue('translate', 'works', [doc.workId]), call)
    expect(skipped.results[0].status).toBe('skipped')
  })
  it('单条数据库写入失败会回滚本条并继续后续条目', async () => {
    await createWork('db_fail_a'); await createWork('db_fail_b')
    const job = await enqueue('write-fields', 'works', ['db_fail_a', 'db_fail_b'], { patch: { description: '数据库回滚测试' } })
    const originalUpdate = payload.update.bind(payload)
    const spy = vi.spyOn(payload, 'update').mockImplementation(async (args: any) => {
      if (args.collection === 'works') throw new Error('模拟单条校验失败')
      return originalUpdate(args)
    })
    let next: any
    try { next = await stepJob(request({}), job) } finally { spy.mockRestore() }
    expect(next.cursor).toBe(1); expect(next.results[0].status).toBe('failed')
    const done = await stepJob(request({}), next)
    expect(done.status).toBe('partial'); expect(done.results[1].status).toBe('succeeded')
  })

  it('取消任务不再写入；机器人不能调用任何批量任务入口', async () => {
    await createWork('cancel_a')
    const job = await enqueue('write-fields', 'works', ['cancel_a'], { patch: { description: '不应写入' } })
    await cancelBulkJob(request({ jobId: job.jobId }))
    expect((await stepJob(request({}), job)).status).toBe('cancelled')
    expect((await createBulkJob(request({ operation: 'write-fields', target: 'works', ids: ['cancel_a'] }, bot))).status).toBe(403)
    expect((await createBulkJob(request({ operation: 'write-fields', target: 'works', ids: ['cancel_a'], patch: { slug: 'bad' } }))).status).toBe(400)
  })
})
