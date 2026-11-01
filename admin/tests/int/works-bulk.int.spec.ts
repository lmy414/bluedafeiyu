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

import { AuditEvents } from '@/collections/AuditEvents'
import { Categories } from '@/collections/Categories'
import { Characters } from '@/collections/Characters'
import { Media } from '@/collections/Media'
import { PublishRuns } from '@/collections/PublishRuns'
import { Topics } from '@/collections/Topics'
import { Users } from '@/collections/Users'
import { Works } from '@/collections/Works'
import { bulkHandler } from '@/endpoints/works-bulk'
import { sourceHash } from '@/lib/localization.mjs'
import { buildSiteDataTexts } from '@/lib/export-site-data'
import { fixtureI18n } from '../../../tools/localization/test-fixture.mjs'

type AnyRecord = Record<string, any>

const owner = { displayName: '站长', email: 'owner@test', id: 1, role: 'owner' }
const bot = { displayName: '机器人', email: 'bot@test', id: 2, role: 'bot' }

function matchCondition(value: unknown, condition: AnyRecord): boolean {
  if (Object.prototype.hasOwnProperty.call(condition, 'equals')) {
    return String(value ?? '') === String(condition.equals ?? '')
  }
  if (Array.isArray(condition.in)) return condition.in.map(String).includes(String(value ?? ''))
  return true
}

function matches(doc: AnyRecord, where: AnyRecord): boolean {
  if (Array.isArray(where.or)) return where.or.some((entry: AnyRecord) => matches(doc, entry))
  return Object.entries(where).every(([field, condition]) => matchCondition(doc[field], condition as AnyRecord))
}

const ORIGINAL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const DIGEST = crypto.createHash('sha256').update(ORIGINAL).digest('hex')

beforeAll(() => {
  vi.stubEnv('SUBMISSION_ADMIN_TOKEN', 'bulk-test-token')
  vi.stubEnv('SUBMISSION_ADMIN_API_URL', 'http://submission.test')
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/v1/items') {
      return { ok: true, status: 200, json: async () => ({ items: [{ id: `sub_${DIGEST.slice(0, 24)}`, sha256: DIGEST, ext: '.png', format: 'png', mime: 'image/png', original: { released: false } }] }) } as unknown as Response
    }
    if (url.pathname.endsWith('/raw')) {
      return { ok: true, status: 200, arrayBuffer: async () => ORIGINAL } as unknown as Response
    }
    throw new Error(`unexpected fetch: ${url.toString()}`)
  }))
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function makeFixture(options: { state?: string; reviewContent?: unknown } = {}) {
  const digest = DIGEST
  const submission: AnyRecord = {
    fields: { name: '投稿字段名' },
    id: 20,
    media: { id: 10 },
    origin: { via: 'web' },
    review: {
      content: options.reviewContent === undefined ? null : options.reviewContent,
      reason: 'AI 拒绝理由',
      verdict: 'reject',
    },
    sha256: digest,
    source: 'web',
    state: options.state || 'auto_rejected',
    submissionId: `sub_${digest.slice(0, 24)}`,
  }
  const characters = [{ characterId: 'char-1', id: 1, name: '角色一' }]
  const categories = [{ categoryId: 'cat-1', id: 11, name: '分类一' }]
  const works: AnyRecord[] = []
  const calls = {
    auditCreates: [] as AnyRecord[],
    submissionUpdates: [] as AnyRecord[],
    workCreates: [] as AnyRecord[],
    workUpdates: [] as AnyRecord[],
  }
  const payload = {
    create: async (input: AnyRecord) => {
      if (input.collection === 'audit-events') {
        calls.auditCreates.push(input)
        return { id: `audit-${calls.auditCreates.length}`, ...input.data }
      }
      if (input.collection === 'works') {
        calls.workCreates.push(input)
        const created = { id: `work-${calls.workCreates.length}`, ...input.data }
        works.push(created)
        return created
      }
      throw new Error(`unexpected create collection: ${input.collection}`)
    },
    find: async (input: AnyRecord) => {
      if (input.collection === 'characters') return { docs: characters }
      if (input.collection === 'categories') return { docs: categories }
      if (input.collection === 'submissions') return { docs: matches(submission, input.where) ? [submission] : [] }
      if (input.collection === 'works') return { docs: works.filter((work) => matches(work, input.where)) }
      throw new Error(`unexpected find collection: ${input.collection}`)
    },
    update: async (input: AnyRecord) => {
      if (input.collection === 'submissions') calls.submissionUpdates.push(input)
      if (input.collection === 'works') calls.workUpdates.push(input)
      if (input.collection === 'submissions' && input.id === submission.id) Object.assign(submission, input.data)
      return input.data
    },
  }
  return { calls, payload, submission, works }
}

function request(user: AnyRecord, body: AnyRecord, payload: AnyRecord, context: AnyRecord = {}) {
  return { context, json: async () => body, payload, user } as any
}

const sourceContent = {
  categoryIds: ['cat-1'],
  characterId: 'char-1',
  commentary: '人工确认后的详情正文',
  description: '人工确认后的说明',
  name: '人工确认名称',
  tags: ['测试', '人工复审'],
}
const completeContent = { ...sourceContent, i18n: { sourceHash: sourceHash(sourceContent), ...fixtureI18n(sourceContent.tags) } }

describe('works-bulk original media model', () => {
  it('keeps the HEAD batch include path on the original sha256 and media id', async () => {
    const fixture = await makeFixture({ state: 'auto_passed', reviewContent: completeContent })
    const response = await bulkHandler(request(owner, { action: 'include', ids: [fixture.submission.submissionId] }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.workIds).toHaveLength(1)
    expect(fixture.calls.workCreates[0].data.sha256).toBe(fixture.submission.sha256)
    expect(fixture.calls.workCreates[0].data.preview).toBe(10)
  })

  it('批量收录先全量校验，再返回真实的逐项成功/失败，不冒充原子结果', async () => {
    const fixture = await makeFixture({ state: 'auto_passed', reviewContent: completeContent })
    const response = await bulkHandler(request(owner, { action: 'include', ids: [fixture.submission.submissionId, 'missing_sub'] }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.ok).toBe(false)
    expect(result.workIds).toHaveLength(1)
    expect(result.results).toEqual([
      { id: fixture.submission.submissionId, status: 'succeeded', workId: fixture.works[0].workId },
      { id: 'missing_sub', status: 'failed', reason: '找不到投稿 missing_sub' },
    ])
    expect(result.failed).toEqual(['missing_sub'])
    expect(result.errors[0]).toContain('找不到投稿 missing_sub')
    expect(fixture.calls.workCreates).toHaveLength(1)
  })

  it('批量隐藏先校验全部状态，不会前面的作品已改、后面的作品才报错', async () => {
    const fixture = await makeFixture()
    fixture.works.push({ id: 11, status: 'published', workId: 'bulk_hide_ok' }, { id: 12, status: 'pending', workId: 'bulk_hide_bad' })
    const response = await bulkHandler(request(owner, { action: 'hide', ids: ['bulk_hide_ok', 'bulk_hide_bad'] }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(400)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('bulk_hide_bad')
    expect(fixture.calls.workUpdates).toHaveLength(0)
  })

  it('批量隐藏成功时返回 affected 和逐项 succeeded', async () => {
    const fixture = await makeFixture()
    fixture.works.push({ id: 11, status: 'published', workId: 'bulk_hide_a' }, { id: 12, status: 'published', workId: 'bulk_hide_b' })
    const response = await bulkHandler(request(owner, { action: 'hide', ids: ['bulk_hide_a', 'bulk_hide_b'] }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.ok).toBe(true)
    expect(result.affected).toEqual(['bulk_hide_a', 'bulk_hide_b'])
    expect(result.results).toEqual([
      { id: 'bulk_hide_a', status: 'succeeded', workId: 'bulk_hide_a' },
      { id: 'bulk_hide_b', status: 'succeeded', workId: 'bulk_hide_b' },
    ])
    expect(result.failed).toEqual([])
  })

  it('lets the owner explicitly include a rejected submission using edited content', async () => {
    const fixture = await makeFixture({ state: 'auto_rejected' })
    fixture.submission.fields = { ...fixture.submission.fields, credit: 'named', creditName: '小鱼', creditUrl: 'https://home.example/me' }
    fixture.submission.origin = { ...fixture.submission.origin, author: '原作者', sourceUrl: 'https://source.example/art' }
    const response = await bulkHandler(request(owner, {
      action: 'manual-include',
      confirm: 'MANUAL_INCLUDE',
      content: completeContent,
      submissionId: fixture.submission.submissionId,
    }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.workId).toBe(`sticker_${fixture.submission.sha256.slice(0, 24)}`)
    expect(fixture.calls.workCreates).toHaveLength(1)
    expect(fixture.calls.workCreates[0].data.sha256).toBe(fixture.submission.sha256)
    expect(fixture.calls.workCreates[0].data.preview).toBe(10)
    expect(fixture.calls.workCreates[0].data.format).toBe('png')
    expect(fixture.calls.workCreates[0].data.mimeType).toBe('image/png')
    expect(fixture.calls.workCreates[0].data.width).toBe(1)
    expect(fixture.calls.workCreates[0].data.height).toBe(1)
    expect(fixture.calls.workCreates[0].data.review).toEqual(fixture.submission.review)
    expect(fixture.calls.workCreates[0].data.origin).toEqual(fixture.submission.origin)
    expect(fixture.calls.workCreates[0].data.submitter).toEqual({ credit: 'named', name: '小鱼', url: 'https://home.example/me', github: '' })
    expect(fixture.calls.workCreates[0].data.workId).toBe(`sticker_${fixture.submission.sha256.slice(0, 24)}`)
    expect(fixture.calls.submissionUpdates[0].data.work).toBe('work-1')
    expect(fixture.calls.auditCreates[0].data.action).toBe('submissions.manual-include')
  })

  it('fails manual include instead of creating a work when original metadata is unavailable', async () => {
    const fixture = await makeFixture({ state: 'auto_rejected' })
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ ...fixture.submission, id: fixture.submission.submissionId, review: undefined, original: { released: true } }] }),
    } as unknown as Response)))
    try {
      const response = await bulkHandler(request(owner, {
        action: 'manual-include',
        confirm: 'MANUAL_INCLUDE',
        content: completeContent,
        submissionId: fixture.submission.submissionId,
      }, fixture.payload))
      expect(response.status).toBe(502)
      expect((await response.json()).error).toContain('原图已释放')
      expect(fixture.calls.workCreates).toHaveLength(0)
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('rejects manual include for a submission that is not rejected or needs_manual', async () => {
    const fixture = await makeFixture({ state: 'auto_passed', reviewContent: completeContent })
    const response = await bulkHandler(request(owner, {
      action: 'manual-include',
      confirm: 'MANUAL_INCLUDE',
      content: completeContent,
      submissionId: fixture.submission.submissionId,
    }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(400)
    expect(result.error).toContain('不是拒绝或转人工状态')
    expect(fixture.calls.workCreates).toHaveLength(0)
  })

  it('persists manual translations with source notes and exports both locales without replacing the AI verdict', async () => {
    const fixture = await makeFixture()
    fixture.submission.origin = { via: 'web', note: '已核对的原始来源说明' }
    const content = { ...sourceContent, i18n: { sourceHash: sourceHash({ ...sourceContent, origin: fixture.submission.origin }), ...fixtureI18n(sourceContent.tags) } }
    const response = await bulkHandler(request(owner, { action: 'manual-include', confirm: 'MANUAL_INCLUDE', content, submissionId: fixture.submission.submissionId }, fixture.payload))
    expect(response.status).toBe(200)
    const created = fixture.calls.workCreates[0].data
    expect(created.review).toEqual(fixture.submission.review)
    expect(created.legacyData.i18n).toEqual(content.i18n)
    const text = buildSiteDataTexts({ works: [{ ...created, character: { characterId: 'char-1' }, categories: [{ categoryId: 'cat-1' }], slug: 'manual-test' }], characters: [], categories: [], topics: [], treatPendingAsPublished: true })['data/works.json']
    const exported = JSON.parse(text)[0]
    expect(exported.i18n).toEqual(content.i18n)
  })

  it('rejects missing or stale manual translations before creating pending work', async () => {
    for (const content of [sourceContent, { ...completeContent, description: '修改过的中文说明' }]) {
      const fixture = await makeFixture()
      const response = await bulkHandler(request(owner, { action: 'manual-include', confirm: 'MANUAL_INCLUDE', content, submissionId: fixture.submission.submissionId }, fixture.payload))
      expect([400, 409]).toContain(response.status)
      expect((await response.json()).error).toContain('英文和日文')
      expect(fixture.calls.workCreates).toHaveLength(0)
      expect(fixture.calls.submissionUpdates).toHaveLength(0)
    }
  })

  it('requires explicit confirmation and owner role', async () => {
    const fixture = await makeFixture()
    const missingConfirmation = await bulkHandler(request(owner, {
      action: 'manual-include',
      content: completeContent,
      submissionId: fixture.submission.submissionId,
    }, fixture.payload))
    const nonOwner = await bulkHandler(request(bot, {
      action: 'manual-include',
      confirm: 'MANUAL_INCLUDE',
      content: completeContent,
      submissionId: fixture.submission.submissionId,
    }, fixture.payload))

    expect(missingConfirmation.status).toBe(400)
    expect((await missingConfirmation.json()).error).toContain('明确确认')
    expect(nonOwner.status).toBe(403)
    expect(fixture.calls.workCreates).toHaveLength(0)
  })

  it('rejects a duplicate original sha256 on manual include', async () => {
    const fixture = await makeFixture()
    fixture.works.push({ id: 'existing', sha256: fixture.submission.sha256, workId: 'sticker_existing' })
    const response = await bulkHandler(request(owner, {
      action: 'manual-include',
      confirm: 'MANUAL_INCLUDE',
      content: completeContent,
      submissionId: fixture.submission.submissionId,
    }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(409)
    expect(result.workId).toBe('sticker_existing')
    expect(fixture.calls.workCreates).toHaveLength(0)
  })

})

// ---------------------------------------------------------------------------
// 真实 Payload + 临时 SQLite：覆盖 add-to-topic 的关系 ID 归一。
// 回归点：旧实现把数字 works.id 用 String() 写回关系字段，真实 Payload 会因关系
// 字段收到字符串抛 ValidationError（SQLite 的 works.id 是 number）。
// 复用 sync-submissions / topic-upsert 的临时库 setup 约定（内存 SQLite + mkdtemp
// 临时媒体目录），绝不触碰真实 admin/admin.db。
// ---------------------------------------------------------------------------

let tempRoot = ''
let realPayload: Payload | undefined
let ownerUser: AnyRecord
let characterId = 0
let categoryId = 0

/** 关系值可能是数字 ID、字符串 ID，或 depth>0 时填充出的对象；取其中的数字 ID。 */
function numberAt(value: unknown): number | undefined {
  const raw = value && typeof value === 'object' ? (value as AnyRecord).id : value
  return typeof raw === 'number' ? raw : undefined
}

function live(): AnyRecord {
  if (!realPayload) throw new Error('测试库尚未初始化')
  return realPayload as AnyRecord
}

/** 生产同款调用：直接把真实 payload 与真实 req 形状交给接口，不模拟/伪造 context。 */
function realReq(user: AnyRecord, body: AnyRecord): any {
  return { context: {}, headers: new Headers(), json: async () => body, payload: realPayload, user } as any
}

async function createWork(workId: string): Promise<AnyRecord> {
  return live().create({
    collection: 'works',
    data: { character: characterId, categories: [categoryId], channel: 'manual', kind: 'submission', name: `作品 ${workId}`, status: 'published', workId },
    context: { audit: false, skipNeedsPublish: true },
    overrideAccess: true,
  })
}

async function findTopic(topicId: string): Promise<AnyRecord> {
  const result = await live().find({ collection: 'topics', where: { topicId: { equals: topicId } }, depth: 0, overrideAccess: true })
  return result.docs[0]
}

const seededAuthor = {
  bio: '画师',
  channels: [{ label: '小电视', platform: 'Bilibili', url: 'https://space.bilibili.com/1' }],
  name: '猫鲸',
  url: 'https://example.com/me',
}

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bluedafeiyu-works-bulk-'))
  const config = buildConfig({
    collections: [
      Users,
      Characters,
      Categories,
      { ...Media, upload: { ...(Media.upload as any), staticDir: path.join(tempRoot, 'media') } },
      Works,
      Topics,
      PublishRuns,
      AuditEvents,
    ],
    db: sqliteAdapter({ client: { url: 'file::memory:' }, push: true }),
    secret: 'works-bulk-test-secret',
    sharp,
  })
  realPayload = await getPayload({ config })

  ownerUser = await live().create({
    collection: 'users',
    data: { displayName: '站长', email: 'owner@example.test', password: 'test-password', role: 'owner' },
    context: { audit: false },
    overrideAccess: true,
  })
  const character = await live().create({
    collection: 'characters',
    data: { characterId: 'bulk-char', name: '测试角色', status: 'active' },
    context: { audit: false },
    overrideAccess: true,
  })
  characterId = Number(character.id)
  const category = await live().create({ collection: 'categories', data: { categoryId: 'bulk-type', name: '测试类型', status: 'active' }, context: { audit: false }, overrideAccess: true })
  categoryId = Number(category.id)

  for (const topic of [
    { name: '收集专题', topicId: 'bulk-add-topic', works: [] as number[] },
    { name: '去重专题', topicId: 'bulk-repeat-topic', works: [] as number[] },
    { author: seededAuthor, name: '作者专题', topicId: 'bulk-author-topic', works: [] as number[] },
  ]) {
    await live().create({
      collection: 'topics',
      data: { order: 0, summary: '测试简介', status: 'active', ...topic },
      context: { audit: false, skipNeedsPublish: true },
      overrideAccess: true,
    })
  }
})

afterAll(async () => {
  const client = (realPayload as any)?.db?.client
  if (client && typeof client.close === 'function') client.close()
  if (tempRoot) await fs.rm(tempRoot, { force: true, maxRetries: 3, recursive: true })
})

describe('works-bulk add-to-topic（真实 Payload + 内存 SQLite）', () => {
  it('批量类型修改拒绝空值和多个类型，单类型写入后仍只有一个关系', async () => {
    const work = await createWork('sticker_bulk_type')
    for (const categoryIds of [[], ['bulk-type', 'bulk-type']]) {
      const response = await bulkHandler(realReq(ownerUser, { action: 'set-categories', ids: [work.workId], categoryIds }))
      expect(response.status).toBe(400)
    }
    const response = await bulkHandler(realReq(ownerUser, { action: 'set-categories', ids: [work.workId], categoryIds: ['bulk-type'] }))
    expect(response.status).toBe(200)
    const stored = await live().findByID({ collection: 'works', id: work.id, depth: 0, overrideAccess: true })
    expect(stored.categories).toEqual([categoryId])
  })

  it('Works 数据字段也拒绝空类型和多个类型', async () => {
    const work = await createWork('sticker_type_constraint')
    for (const categories of [[], [categoryId, categoryId]]) {
      await expect(live().update({ collection: 'works', id: work.id, data: { categories }, context: { audit: false }, overrideAccess: true })).rejects.toThrow()
    }
  })
  it('把稳定 ID 对应作品的数字 work.id 写入关系并成功落库', async () => {
    const work = await createWork('sticker_bulk_add')
    const before = await findTopic('bulk-add-topic')
    expect(before.works).toHaveLength(0)

    const response = await bulkHandler(realReq(ownerUser, { action: 'add-to-topic', ids: ['sticker_bulk_add'], topicId: 'bulk-add-topic' }))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.affected).toEqual(['sticker_bulk_add'])

    const stored = await findTopic('bulk-add-topic')
    expect(stored.works.map(numberAt)).toEqual([Number(work.id)])
    expect(stored.works.every((item: unknown) => typeof numberAt(item) === 'number')).toBe(true)
  })

  it('重复加入同一作品时专题关系不增加', async () => {
    await createWork('sticker_bulk_dup')

    const first = await bulkHandler(realReq(ownerUser, { action: 'add-to-topic', ids: ['sticker_bulk_dup'], topicId: 'bulk-repeat-topic' }))
    const once = await findTopic('bulk-repeat-topic')
    const second = await bulkHandler(realReq(ownerUser, { action: 'add-to-topic', ids: ['sticker_bulk_dup'], topicId: 'bulk-repeat-topic' }))
    const stored = await findTopic('bulk-repeat-topic')

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(once.works).toHaveLength(1)
    expect(stored.works).toHaveLength(1)
  })

  it('active + author 专题追加作品后 author 保留', async () => {
    const work = await createWork('sticker_bulk_author')
    const before = await findTopic('bulk-author-topic')
    expect(before.author?.name).toBe('猫鲸')

    const response = await bulkHandler(realReq(ownerUser, { action: 'add-to-topic', ids: ['sticker_bulk_author'], topicId: 'bulk-author-topic' }))
    const stored = await findTopic('bulk-author-topic')

    expect(response.status).toBe(200)
    expect(stored.works.map(numberAt)).toEqual([Number(work.id)])
    expect(stored.author?.name).toBe('猫鲸')
    expect(stored.author?.channels?.[0]?.url).toBe('https://space.bilibili.com/1')
  })
})
