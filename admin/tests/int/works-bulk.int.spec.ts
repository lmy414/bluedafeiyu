// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'

import { bulkHandler } from '@/endpoints/works-bulk'

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

async function makeFixture(options: { state?: string; reviewContent?: unknown } = {}) {
  const digest = 'a'.repeat(64)
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
      if (input.collection === 'submissions' && input.id === submission.id) Object.assign(submission, input.data)
      return input.data
    },
  }
  return { calls, payload, submission, works }
}

function request(user: AnyRecord, body: AnyRecord, payload: AnyRecord) {
  return { json: async () => body, payload, user } as any
}

const completeContent = {
  categoryIds: ['cat-1'],
  characterId: 'char-1',
  commentary: '人工确认后的详情正文',
  description: '人工确认后的说明',
  name: '人工确认名称',
  tags: ['测试', '人工复审'],
}

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

  it('lets the owner explicitly include a rejected submission using edited content', async () => {
    const fixture = await makeFixture({ state: 'auto_rejected' })
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
    expect(fixture.calls.workCreates[0].data.review).toEqual(fixture.submission.review)
    expect(fixture.calls.workCreates[0].data.origin).toEqual(fixture.submission.origin)
    expect(fixture.calls.workCreates[0].data.workId).toBe(`sticker_${fixture.submission.sha256.slice(0, 24)}`)
    expect(fixture.calls.submissionUpdates[0].data.work).toBe('work-1')
    expect(fixture.calls.auditCreates[0].data.action).toBe('submissions.manual-include')
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
