/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { Endpoint, PayloadRequest } from 'payload'

import { writeAudit } from '../lib/audit'
import { json, readJsonBody, requireOwnerOrBot, requireWorker } from '../lib/endpoint-auth'

type IssueReplyBody = {
  body?: string
  close?: boolean
  stateReason?: 'completed' | 'not_planned'
  submissionId?: string
}

function issueReplyDir(): string {
  const configured = process.env.ADMIN_ISSUE_REPLY_DIR
  return path.resolve(
    configured || path.join(process.env.ADMIN_PUBLISH_REQUEST_DIR || '/srv/apps/dafeiyu-admin/run', 'issue-replies'),
  )
}

function positiveIssue(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

export const issueReplyHandler = async (req: PayloadRequest): Promise<Response> => {
  const role = (req.user as any)?.role
  if (role !== 'owner') {
    const denied = requireWorker(req)
    if (denied) return denied
  }

  let requestBody: IssueReplyBody
  try {
    requestBody = await readJsonBody<IssueReplyBody>(req)
  } catch {
    return json({ ok: false, error: '请求体不是合法 JSON' }, 400)
  }

  const submissionId = typeof requestBody.submissionId === 'string' ? requestBody.submissionId.trim() : ''
  const body = typeof requestBody.body === 'string' ? requestBody.body.trim() : ''
  const close = requestBody.close === undefined ? true : requestBody.close
  const stateReason = requestBody.stateReason === undefined ? 'not_planned' : requestBody.stateReason

  if (!submissionId) return json({ ok: false, error: 'submissionId 必填' }, 400)
  if (!body || body.length > 5000) return json({ ok: false, error: 'body 必须为 1-5000 字' }, 400)
  if (typeof close !== 'boolean') return json({ ok: false, error: 'close 必须是布尔值' }, 400)
  if (stateReason !== 'completed' && stateReason !== 'not_planned') {
    return json({ ok: false, error: 'stateReason 非法' }, 400)
  }

  const payload = req.payload as any
  const result = await payload.find({
    collection: 'submissions',
    where: { submissionId: { equals: submissionId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const submission = result.docs[0]
  if (!submission) return json({ ok: false, error: '投稿不存在' }, 404)

  const origin = submission.origin && typeof submission.origin === 'object' && !Array.isArray(submission.origin)
    ? submission.origin
    : {}
  const issue = positiveIssue(origin.issue)
  if (submission.source !== 'github-issue' || issue === null) {
    return json({ ok: false, error: '该投稿不是有效的 GitHub Issue 投稿' }, 400)
  }

  const requestedAt = new Date().toISOString()
  const user = req.user as any
  const requestedBy = user?.email || user?.id
  const targetDir = issueReplyDir()
  const filename = `${Date.now()}-${crypto.randomUUID()}.json`
  const target = path.join(targetDir, filename)
  const temp = `${target}.tmp`

  try {
    await fs.mkdir(targetDir, { recursive: true, mode: 0o770 })
    await fs.writeFile(temp, `${JSON.stringify({
      schema: 'issue-reply/1',
      issue,
      submissionId: submission.submissionId,
      body,
      close,
      stateReason,
      requestedBy,
      requestedAt,
    })}\n`, { encoding: 'utf8', mode: 0o660 })
    await fs.rename(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    return json({ ok: false, error: `写 Issue 回复请求失败：${(error as Error).message}` }, 500)
  }

  await writeAudit(req, {
    action: 'issue.reply',
    after: { close, issue, requestedAt, stateReason, submissionId: submission.submissionId },
    targetId: submission.submissionId,
    targetType: 'submissions',
  })

  return json({ ok: true, queued: true, issue })
}

export const IssueReplyEndpoints: Endpoint[] = [
  { handler: issueReplyHandler, method: 'post', path: '/issue-reply' },
]
