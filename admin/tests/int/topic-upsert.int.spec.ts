// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// 受鉴权的专题 upsert 接口。分两层：
// 1) mock 模式（参考 works-bulk.int.spec.ts）覆盖字段白名单、鉴权、短路与审计；
// 2) 内存 SQLite 模式（参考 sync-submissions.int.spec.ts）用真实 Payload 覆盖
//    ValidationError 转换与审计落库（能发现 req.context 被写库污染导致审计被跳过）。
// 用内存库和 mkdtemp 临时媒体目录，绝不触碰真实 admin/admin.db。
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, getPayload, ValidationError, type Payload } from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Categories } from '@/collections/Categories'
import { Characters } from '@/collections/Characters'
import { Media } from '@/collections/Media'
import { PublishRuns } from '@/collections/PublishRuns'
import { Topics } from '@/collections/Topics'
import { AuditEvents } from '@/collections/AuditEvents'
import { Users } from '@/collections/Users'
import { Works } from '@/collections/Works'
import { topicsUpsertHandler } from '@/endpoints/topics-upsert'

type AnyRecord = Record<string, any>

const owner = { displayName: '站长', email: 'owner@example.test', id: 1, role: 'owner' }
const bot = { displayName: 'hermes', email: 'hermes@example.test', id: 2, role: 'bot' }
const viewer = { displayName: '游客', email: 'viewer@example.test', id: 3, role: null }

function ownerReq(body: AnyRecord, payload: AnyRecord): any {
  return { context: {}, headers: new Headers(), json: async () => body, payload, user: owner } as any
}

function botReq(body: AnyRecord, payload: AnyRecord): any {
  return { context: {}, headers: new Headers(), json: async () => body, payload, user: bot } as any
}

function unauthorizedReq(body: AnyRecord, payload: AnyRecord): any {
  return { context: {}, headers: new Headers(), json: async () => body, payload, user: viewer } as any
}

const kebabTopic = {
  author: undefined as any,
  id: 'topic-1',
  order: 0,
  status: 'draft',
  summary: '示例简介',
  topicId: 'cat-whale',
  name: '猫鲸专题',
  works: [],
}

/** mock payload：find 只支持 topicId equals（接口唯一用到的查询），create/update 记录调用。 */
function makeFixture(docs: AnyRecord[] = []) {
  const topics = docs.map((doc) => ({ ...doc }))
  const calls = {
    auditCreates: [] as AnyRecord[],
    creates: [] as AnyRecord[],
    updates: [] as AnyRecord[],
  }
  const payload = {
    create: async (input: AnyRecord) => {
      if (input.collection === 'audit-events') {
        calls.auditCreates.push(input)
        return { id: `audit-${calls.auditCreates.length}`, ...input.data }
      }
      if (input.collection === 'topics') {
        calls.creates.push(input)
        const created = { createdAt: '2026-10-02T00:00:00.000Z', id: `topic-${calls.creates.length + 100}`, updatedAt: '2026-10-02T00:00:00.000Z', ...input.data }
        topics.push(created)
        return created
      }
      throw new Error(`unexpected create collection: ${input.collection}`)
    },
    find: async (input: AnyRecord) => {
      if (input.collection === 'topics') {
        const wanted = input.where?.topicId?.equals
        // 返回克隆件：真实 Payload 的 find 不会把库对象交给调用方，克隆能保证
        // update 记录里的 before 仍是更新前的值（否则会被 update 的赋值一起改掉）。
        return { docs: topics.filter((topic) => topic.topicId === wanted).map((topic) => ({ ...topic })) }
      }
      throw new Error(`unexpected find collection: ${input.collection}`)
    },
    update: async (input: AnyRecord) => {
      if (input.collection === 'topics') {
        calls.updates.push(input)
        const target = topics.find((topic) => topic.id === input.id)
        if (!target) throw new Error(`mock 中找不到要更新的专题 ${input.id}`)
        Object.assign(target, input.data)
        return { ...target }
      }
      throw new Error(`unexpected update collection: ${input.collection}`)
    },
  }
  return { calls, payload, topics }
}

const storedAuthor = {
  bio: '画师，主要画 AI 娘',
  channels: [{ id: 'payload-row-id', label: '小电视', platform: 'Bilibili', url: 'https://space.bilibili.com/1' }],
  name: '猫鲸',
  url: 'https://example.com/me',
}

describe('topics upsert handler（mock）', () => {
  it('owner 可以创建专题，落库字段被显式挑出，写库用克隆 req', async () => {
    const fixture = makeFixture()
    const req = ownerReq({ summary: '简介', topicId: 'cat-whale', name: '猫鲸专题' }, fixture.payload)
    const response = await topicsUpsertHandler(req)
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toMatchObject({ ok: true, created: true, changed: true, topicId: 'cat-whale', status: 'draft' })
    expect(fixture.calls.creates).toHaveLength(1)
    expect(fixture.calls.creates[0].data).toMatchObject({ topicId: 'cat-whale', name: '猫鲸专题', summary: '简介' })
    // 创建走 audit:false，且 req 是克隆件，原 req.context 不被写库污染。
    expect(fixture.calls.creates[0].context).toEqual({ audit: false })
    expect(fixture.calls.creates[0].req).not.toBe(req)
    expect(fixture.calls.creates[0].req.context).not.toBe(req.context)
    // 手写审计在 create 之后，确实产出 topics.create。
    expect(fixture.calls.auditCreates).toHaveLength(1)
    expect(fixture.calls.auditCreates[0].data).toMatchObject({ action: 'topics.create', targetType: 'topics', targetId: 'topic-101' })
    expect(fixture.calls.auditCreates[0].data.after).toMatchObject({ topicId: 'cat-whale' })
  })

  it('bot 可以新建 active 专题', async () => {
    const fixture = makeFixture()
    const response = await topicsUpsertHandler(botReq({ summary: '简介', topicId: 'cat-whale', name: '猫鲸专题', status: 'active' }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toMatchObject({ created: true, status: 'active' })
  })

  it('请求体不是合法 JSON 时 400，且不触发 find/create/update/audit', async () => {
    const fixture = makeFixture()
    const req = {
      context: {},
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      },
      payload: fixture.payload,
      user: bot,
    } as any
    const response = await topicsUpsertHandler(req)
    const result = await response.json()

    expect(response.status).toBe(400)
    expect(result).toMatchObject({ ok: false, error: '请求体不是合法 JSON' })
    expect(fixture.calls.creates).toHaveLength(0)
    expect(fixture.calls.updates).toHaveLength(0)
    expect(fixture.calls.auditCreates).toHaveLength(0)
  })

  it('缺少鉴权时 401，且不落任何写操作', async () => {
    const fixture = makeFixture()
    const response = await topicsUpsertHandler(unauthorizedReq({ summary: '简介', topicId: 'cat-whale', name: '猫鲸专题' }, fixture.payload))

    expect(response.status).toBe(401)
    expect(fixture.calls.creates).toHaveLength(0)
    expect(fixture.calls.auditCreates).toHaveLength(0)
  })

  it('创建缺 name / summary 时中文报错，不再触发写库', async () => {
    const fixture = makeFixture()
    const missingName = await topicsUpsertHandler(botReq({ summary: '简介', topicId: 'cat-whale' }, fixture.payload))
    const missingSummary = await topicsUpsertHandler(botReq({ topicId: 'cat-whale', name: '猫鲸专题' }, fixture.payload))

    expect(missingName.status).toBe(400)
    expect((await missingName.json()).error).toContain('name')
    expect(missingSummary.status).toBe(400)
    expect((await missingSummary.json()).error).toContain('summary')
    expect(fixture.calls.creates).toHaveLength(0)
  })

  it('白名单外的键整批 400，并报出键名（works/cover/needsPublish/id 等）', async () => {
    const fixture = makeFixture()
    const response = await topicsUpsertHandler(
      botReq({ cover: 3, id: 9, needsPublish: true, summary: '简介', topicId: 'cat-whale', works: [1, 2], name: '猫鲸专题' }, fixture.payload),
    )
    const result = await response.json()

    expect(response.status).toBe(400)
    for (const key of ['cover', 'id', 'needsPublish', 'works']) expect(result.error).toContain(key)
    expect(Object.keys(result.details).sort()).toEqual(['cover', 'id', 'needsPublish', 'works'])
    expect(fixture.calls.creates).toHaveLength(0)
    expect(fixture.calls.updates).toHaveLength(0)
  })

  it('author 渠道按输入顺序写入，首选渠道是第一项，且不写 Payload 行 id', async () => {
    const fixture = makeFixture()
    const response = await topicsUpsertHandler(
      ownerReq(
        {
          author: {
            channels: [
              { label: '小电视', platform: 'Bilibili', url: 'https://space.bilibili.com/1' },
              { platform: 'Pixiv', url: 'https://www.pixiv.net/users/2' },
            ],
            name: '猫鲸',
          },
          summary: '简介',
          topicId: 'cat-whale',
          name: '猫鲸专题',
        },
        fixture.payload,
      ),
    )

    expect(response.status).toBe(200)
    const written = fixture.calls.creates[0].data.author
    expect(written.channels.map((channel: AnyRecord) => channel.platform)).toEqual(['Bilibili', 'Pixiv'])
    expect(written.channels[0]).not.toHaveProperty('id')
    expect(written.name).toBe('猫鲸')
  })

  it('作者业务规则交给字段校验：mock 下缺渠道的作者原样转发给写库', async () => {
    const fixture = makeFixture()
    const response = await topicsUpsertHandler(botReq({ author: { name: '猫鲸' }, summary: '简介', topicId: 'cat-whale', name: '猫鲸专题' }, fixture.payload))

    expect(response.status).toBe(200)
    expect(fixture.calls.creates[0].data.author).toMatchObject({ channels: [], name: '猫鲸' })
  })

  it('author 形状错误（channels 不是数组、未知键）中文报错且不写库', async () => {
    const fixture = makeFixture()
    const badChannels = await topicsUpsertHandler(botReq({ author: { channels: 'x', name: '猫鲸' }, summary: '简介', topicId: 'cat-whale', name: '猫鲸专题' }, fixture.payload))
    const unknownKey = await topicsUpsertHandler(botReq({ author: { name: '猫鲸', Website: 'x' }, summary: '简介', topicId: 'cat-whale', name: '猫鲸专题' }, fixture.payload))

    expect(badChannels.status).toBe(400)
    expect((await badChannels.json()).error).toContain('channels')
    expect(unknownKey.status).toBe(400)
    expect((await unknownKey.json()).error).toContain('Website')
    expect(fixture.calls.creates).toHaveLength(0)
  })

  it('author 显式 null 清空、全空对象等同清空', async () => {
    const withAuthor = () => makeFixture([{ ...kebabTopic, author: storedAuthor, id: 'topic-1', status: 'active' }])
    const cleared = withAuthor()
    expect((await topicsUpsertHandler(botReq({ author: null, topicId: 'cat-whale' }, cleared.payload))).status).toBe(200)
    expect(cleared.calls.updates[0].data.author).toEqual({ bio: null, channels: [], name: null, url: null })

    const emptied = withAuthor()
    expect((await topicsUpsertHandler(botReq({ author: {}, topicId: 'cat-whale' }, emptied.payload))).status).toBe(200)
    expect(emptied.calls.updates[0].data.author).toEqual({ bio: null, channels: [], name: null, url: null })
  })

  it('省略 author 只改 order 时 patch 不带 author 键', async () => {
    const fixture = makeFixture([{ ...kebabTopic, author: storedAuthor, id: 'topic-1', status: 'active' }])
    const kept = await topicsUpsertHandler(botReq({ order: 7, topicId: 'cat-whale' }, fixture.payload))

    expect(kept.status).toBe(200)
    expect(fixture.calls.updates[0].data).toEqual({ order: 7 })
    expect(fixture.calls.updates[0].data).not.toHaveProperty('author')
  })

  it('相同有效输入短路 changed:false，不调用 update（避免误设 needsPublish）', async () => {
    const fixture = makeFixture([{ ...kebabTopic, author: storedAuthor, id: 'topic-1', status: 'active' }])
    const response = await topicsUpsertHandler(
      botReq(
        {
          author: {
            bio: storedAuthor.bio,
            channels: [{ label: '小电视', platform: 'Bilibili', url: 'https://space.bilibili.com/1' }],
            name: '猫鲸',
            url: 'https://example.com/me',
          },
          summary: '示例简介',
          topicId: 'cat-whale',
          name: '猫鲸专题',
        },
        fixture.payload,
      ),
    )
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toMatchObject({ ok: true, created: false, changed: false, id: 'topic-1' })
    expect(fixture.calls.updates).toHaveLength(0)
    expect(fixture.calls.auditCreates).toHaveLength(0)
  })

  it('更新真实字段时 patch 只含变化项，且不写 topicId', async () => {
    const fixture = makeFixture([{ ...kebabTopic, author: storedAuthor, id: 'topic-1', status: 'active' }])
    const response = await topicsUpsertHandler(botReq({ name: '猫鲸专题·改', order: 5, topicId: 'cat-whale' }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toMatchObject({ created: false, changed: true })
    expect(fixture.calls.updates[0].data).toEqual({ name: '猫鲸专题·改', order: 5 })
    expect(fixture.calls.updates[0].data).not.toHaveProperty('topicId')
    // 更新审计带 before / after。
    expect(fixture.calls.auditCreates[0].data).toMatchObject({ action: 'topics.update', targetType: 'topics', targetId: 'topic-1' })
    expect(fixture.calls.auditCreates[0].data.before).toMatchObject({ name: '猫鲸专题' })
    expect(fixture.calls.auditCreates[0].data.after).toMatchObject({ name: '猫鲸专题·改' })
  })

  it('status/order 类型错误中文报错', async () => {
    const fixture = makeFixture([{ ...kebabTopic, id: 'topic-1' }])
    const badStatus = await topicsUpsertHandler(botReq({ status: 'published', topicId: 'cat-whale' }, fixture.payload))
    const badOrder = await topicsUpsertHandler(botReq({ order: '3', topicId: 'cat-whale' }, fixture.payload))

    expect(badStatus.status).toBe(400)
    expect((await badStatus.json()).error).toContain('status')
    expect(badOrder.status).toBe(400)
    expect((await badOrder.json()).error).toContain('order')
    expect(fixture.calls.updates).toHaveLength(0)
  })

  it('bot 不能把已关联作品的 active 专题改草稿（403），owner 可以', async () => {
    const withWorks = { ...kebabTopic, author: storedAuthor, id: 'topic-1', status: 'active', works: [{ id: 11 }] }
    const botFixture = makeFixture([withWorks])
    const botDenied = await topicsUpsertHandler(botReq({ status: 'draft', topicId: 'cat-whale' }, botFixture.payload))
    expect(botDenied.status).toBe(403)
    expect(botFixture.calls.updates).toHaveLength(0)

    const ownerFixture = makeFixture([withWorks])
    const ownerAllowed = await topicsUpsertHandler(ownerReq({ status: 'draft', topicId: 'cat-whale' }, ownerFixture.payload))
    expect(ownerAllowed.status).toBe(200)
    expect(ownerFixture.calls.updates[0].data).toEqual({ status: 'draft' })
  })

  it('bot 可以把没有作品的 active 专题改草稿', async () => {
    const fixture = makeFixture([{ ...kebabTopic, id: 'topic-1', status: 'active', works: [] }])
    const response = await topicsUpsertHandler(botReq({ status: 'draft', topicId: 'cat-whale' }, fixture.payload))

    expect(response.status).toBe(200)
    expect(fixture.calls.updates[0].data).toEqual({ status: 'draft' })
  })

  it('ValidationError 转 400，带中文字段信息与 details', async () => {
    const topics = [{ ...kebabTopic, id: 'topic-1' }]
    const payload = {
      create: async () => {
        throw new ValidationError({ errors: [{ message: '作者主页不是有效的 http/https 地址', path: 'author.url' }] })
      },
      find: async () => ({ docs: topics }),
      update: async () => {
        throw new ValidationError({ errors: [{ message: 'name 不能为空', path: 'name' }] })
      },
    }
    const response = await topicsUpsertHandler(botReq({ name: '新名字', topicId: 'cat-whale' }, payload as any))
    const result = await response.json()

    expect(response.status).toBe(400)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('name 不能为空')
    expect(result.details).toEqual({ name: 'name 不能为空' })
  })

  it('唯一键并发冲突转 409', async () => {
    const payload = {
      create: async () => {
        throw new Error('UNIQUE constraint failed: topics.topic_id')
      },
      find: async () => ({ docs: [] }),
      update: async () => ({}),
    }
    const response = await topicsUpsertHandler(botReq({ summary: '简介', topicId: 'cat-whale', name: '猫鲸专题' }, payload as any))

    expect(response.status).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// 真实 Payload + 临时 SQLite：覆盖字段校验转 400 与审计确实落库。
// ---------------------------------------------------------------------------

let tempRoot = ''
let payload: Payload | undefined
let ownerUser: AnyRecord
let botUser: AnyRecord

function live(): AnyRecord {
  if (!payload) throw new Error('测试库尚未初始化')
  return payload as AnyRecord
}

async function realReq(user: AnyRecord, body: AnyRecord): Promise<any> {
  const req = { context: {}, headers: new Headers(), json: async () => body, payload, user } as AnyRecord
  // 模拟 Payload 本地 API：把传入的 context 合并进「被传入的 req」。接口若直接传原 req，
  // 原 req.context 就会被写上 audit:false，随后手写的 writeAudit 会被静默跳过——
  // 这正是本文件要防的回归。写库调用应传克隆 req，这里只污染克隆件。
  const sim = {
    create: async (input: AnyRecord) => {
      if (input.context && input.req?.context) Object.assign(input.req.context, input.context)
      return live().create(input)
    },
    find: (input: AnyRecord) => live().find(input),
    update: async (input: AnyRecord) => {
      if (input.context && input.req?.context) Object.assign(input.req.context, input.context)
      return live().update(input)
    },
  }
  req.payload = sim
  return req
}

beforeAll(async () => {
  // 先建目录、末位赋 tempRoot：即使 getPayload 抛错，afterAll 也能拿到路径清理。
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bluedafeiyu-topic-upsert-'))
  tempRoot = root
  const config = buildConfig({
    collections: [
      Characters,
      Categories,
      {
        ...Media,
        upload: { ...(Media.upload as any), staticDir: path.join(root, 'media') },
      },
      Works,
      Topics,
      PublishRuns,
      AuditEvents,
      Users,
    ],
    db: sqliteAdapter({ client: { url: 'file::memory:' }, push: true }),
    secret: 'topic-upsert-test-secret',
    sharp,
  })
  payload = await getPayload({ config })
  ownerUser = await live().create({ collection: 'users', data: { email: 'owner@example.test', password: 'test-password', role: 'owner', displayName: '站长' }, context: { audit: false }, overrideAccess: true })
  botUser = await live().create({ collection: 'users', data: { email: 'hermes@example.test', password: 'test-password', role: 'bot', displayName: 'hermes' }, context: { audit: false }, overrideAccess: true })
})

afterAll(async () => {
  // 关闭内存库连接后清理临时媒体目录（payload 未初始化则跳过）。
  const client = (payload as any)?.db?.client
  if (client && typeof client.close === 'function') client.close()
  if (tempRoot) await fs.rm(tempRoot, { force: true, maxRetries: 3, recursive: true })
})

describe('topics upsert handler（真实 Payload + 内存 SQLite）', () => {
  it('非法作者链接被真实字段校验拦下并转成 400', async () => {
    const response = await topicsUpsertHandler(
      await realReq(botUser, {
        author: { channels: [{ platform: 'Bilibili', url: 'javascript:alert(1)' }], name: '猫鲸' },
        summary: '简介',
        topicId: 'bad-url-topic',
        name: '坏链接专题',
      }),
    )
    const result = await response.json()

    expect(response.status).toBe(400)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('http')
    const stored = await live().find({ collection: 'topics', where: { topicId: { equals: 'bad-url-topic' } }, depth: 0, overrideAccess: true })
    expect(stored.docs).toHaveLength(0)
  })

  it('作者型专题缺首选渠道被真实字段校验拦下', async () => {
    const response = await topicsUpsertHandler(
      await realReq(botUser, { author: { name: '猫鲸' }, summary: '简介', topicId: 'no-channel-topic', name: '缺渠道专题' }),
    )
    const result = await response.json()

    expect(response.status).toBe(400)
    expect(result.error).toContain('渠道')
    const stored = await live().find({ collection: 'topics', where: { topicId: { equals: 'no-channel-topic' } }, depth: 0, overrideAccess: true })
    expect(stored.docs).toHaveLength(0)
  })

  it('真实 update 后审计落库（能发现 req.context 被污染跳过审计）', async () => {
    const created = await topicsUpsertHandler(await realReq(ownerUser, { summary: '初始简介', topicId: 'audit-topic', name: '审计专题' }))
    expect(created.status).toBe(200)

    const beforeCount = (await live().find({ collection: 'audit-events', where: { action: { equals: 'topics.update' } }, depth: 0, overrideAccess: true, pagination: false })).docs.length
    const updated = await topicsUpsertHandler(await realReq(botUser, { name: '审计专题·改', topicId: 'audit-topic' }))
    expect(updated.status).toBe(200)
    expect((await updated.json()).changed).toBe(true)

    const after = (await live().find({ collection: 'audit-events', where: { action: { equals: 'topics.update' } }, depth: 0, overrideAccess: true, pagination: false })).docs
    expect(after.length).toBe(beforeCount + 1)
    const topicDoc = (await live().find({ collection: 'topics', where: { topicId: { equals: 'audit-topic' } }, depth: 0, overrideAccess: true })).docs[0]
    const entry = after.find((doc: AnyRecord) => String(doc.targetId) === String(topicDoc.id))
    expect(entry).toBeDefined()
    expect(entry.actorName).toBe('hermes')
    expect(entry.targetType).toBe('topics')
    expect(entry.after).toMatchObject({ name: '审计专题·改' })
    expect(entry.before).toMatchObject({ name: '审计专题' })
  })

  it('真实更新相同输入短路：needsPublish 不被反复置真', async () => {
    await topicsUpsertHandler(await realReq(ownerUser, { summary: '幂等简介', topicId: 'idem-topic', name: '幂等专题', status: 'active' }))
    // 先手动把 needsPublish 归零，短路不应把它重新置真。
    const found = await live().find({ collection: 'topics', where: { topicId: { equals: 'idem-topic' } }, depth: 0, overrideAccess: true })
    await live().update({ collection: 'topics', id: found.docs[0].id, data: { needsPublish: false }, context: { audit: false, skipNeedsPublish: true }, overrideAccess: true })

    const again = await topicsUpsertHandler(await realReq(botUser, { summary: '幂等简介', topicId: 'idem-topic', name: '幂等专题', status: 'active' }))
    expect((await again.json()).changed).toBe(false)

    const reloaded = await live().find({ collection: 'topics', where: { topicId: { equals: 'idem-topic' } }, depth: 0, overrideAccess: true })
    expect(reloaded.docs[0].needsPublish).toBe(false)
  })

  it('真实库中 bot 不能把已关联作品的 active 专题改草稿', async () => {
    const character = await live().create({ collection: 'characters', data: { characterId: 'upsert-char', name: '测试角色', status: 'active' }, context: { audit: false }, overrideAccess: true })
    const category = await live().create({ collection: 'categories', data: { categoryId: 'upsert-category', name: '测试类型', status: 'active' }, context: { audit: false }, overrideAccess: true })
    const work = await live().create({
      collection: 'works',
      data: { workId: 'sticker_upsert_work', name: '测试作品', kind: 'submission', channel: 'manual', character: character.id, categories: [category.id], status: 'published' },
      context: { audit: false, skipNeedsPublish: true },
      overrideAccess: true,
    })
    await live().create({
      collection: 'topics',
      data: { topicId: 'linked-topic', name: '已关联专题', summary: '简介', status: 'active', order: 0, works: [work.id] },
      context: { audit: false, skipNeedsPublish: true },
      overrideAccess: true,
    })

    const denied = await topicsUpsertHandler(await realReq(botUser, { status: 'draft', topicId: 'linked-topic' }))
    expect(denied.status).toBe(403)
    const stillActive = await live().find({ collection: 'topics', where: { topicId: { equals: 'linked-topic' } }, depth: 0, overrideAccess: true })
    expect(stillActive.docs[0].status).toBe('active')
  })
})
