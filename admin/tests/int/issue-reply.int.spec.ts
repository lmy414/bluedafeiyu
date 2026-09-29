// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { issueReplyHandler } from '@/endpoints/issue-reply'

type AnyRecord = Record<string, any>

const owner = { displayName: '站长', email: 'owner@test', id: 1, role: 'owner' }
const bot = { displayName: '机器人', email: 'bot@test', id: 2, role: 'bot' }

let replyDir: string | undefined

function request(user: AnyRecord, body: AnyRecord, payload: AnyRecord) {
  return { json: async () => body, payload, user } as any
}

function makePayload(submission: AnyRecord) {
  const calls = {
    auditCreates: [] as AnyRecord[],
    finds: [] as AnyRecord[],
  }
  const payload = {
    create: vi.fn(async (input: AnyRecord) => {
      calls.auditCreates.push(input)
      return { id: 'audit-1', ...input.data }
    }),
    find: vi.fn(async (input: AnyRecord) => {
      calls.finds.push(input)
      if (input.collection === 'submissions') return { docs: [submission] }
      throw new Error(`unexpected find collection: ${input.collection}`)
    }),
  }
  return { calls, payload }
}

async function makeReplyDir() {
  replyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bluedafeiyu-issue-reply-'))
  process.env.ADMIN_ISSUE_REPLY_DIR = replyDir
  return replyDir
}

afterEach(async () => {
  delete process.env.ADMIN_ISSUE_REPLY_DIR
  if (replyDir) await fs.rm(replyDir, { force: true, recursive: true })
  replyDir = undefined
})

describe('issue reply endpoint', () => {
  it('queues a trimmed owner reply with the default close settings', async () => {
    const targetDir = await makeReplyDir()
    const submission = {
      id: 10,
      origin: { issue: 42, issueUrl: 'https://github.com/example/issues/42' },
      source: 'github-issue',
      submissionId: 'sub_issue_42',
    }
    const fixture = makePayload(submission)
    const response = await issueReplyHandler(request(owner, {
      body: '  谢谢投稿！  ',
      submissionId: submission.submissionId,
    }, fixture.payload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toEqual({ ok: true, queued: true, issue: 42 })
    expect(fixture.calls.finds[0]).toMatchObject({
      collection: 'submissions',
      where: { submissionId: { equals: submission.submissionId } },
    })
    expect(fixture.calls.auditCreates[0].data.action).toBe('issue.reply')

    const files = await fs.readdir(targetDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d+-[0-9a-f-]+\.json$/)
    const queued = JSON.parse(await fs.readFile(path.join(targetDir, files[0]), 'utf8'))
    expect(queued).toMatchObject({
      body: '谢谢投稿！',
      close: true,
      issue: 42,
      requestedBy: owner.email,
      schema: 'issue-reply/1',
      stateReason: 'not_planned',
      submissionId: submission.submissionId,
    })
    expect(Number.isNaN(Date.parse(queued.requestedAt))).toBe(false)
  })

  it('rejects submissions that are not GitHub issues', async () => {
    const fixture = makePayload({
      id: 11,
      origin: { issue: 43 },
      source: 'web',
      submissionId: 'sub_web_43',
    })
    const response = await issueReplyHandler(request(owner, {
      body: '谢谢投稿',
      submissionId: 'sub_web_43',
    }, fixture.payload))

    expect(response.status).toBe(400)
    expect(fixture.calls.auditCreates).toHaveLength(0)
  })

  it('rejects an empty body', async () => {
    const fixture = makePayload({
      id: 12,
      origin: { issue: 44 },
      source: 'github-issue',
      submissionId: 'sub_issue_44',
    })
    const response = await issueReplyHandler(request(owner, {
      body: '   ',
      submissionId: 'sub_issue_44',
    }, fixture.payload))

    expect(response.status).toBe(400)
    expect(fixture.calls.finds).toHaveLength(0)
  })

  it('rejects non-owner users', async () => {
    const fixture = makePayload({
      id: 13,
      origin: { issue: 45 },
      source: 'github-issue',
      submissionId: 'sub_issue_45',
    })
    const response = await issueReplyHandler(request(bot, {
      body: '谢谢投稿',
      submissionId: 'sub_issue_45',
    }, fixture.payload))

    expect(response.status).toBe(403)
    expect(fixture.calls.finds).toHaveLength(0)
    expect(fixture.calls.auditCreates).toHaveLength(0)
  })
})
