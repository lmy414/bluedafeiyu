/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Endpoint, PayloadRequest } from 'payload'

import { json, readJsonBody } from '../lib/endpoint-auth'
import { createBulkJob } from './bulk-jobs'
import { findTopic } from '../lib/topics-membership'
import { topicSourceHash } from '../lib/topics-translation'

const ownerOnly = (req: PayloadRequest) =>
  req.user?.role === 'owner'
    ? null
    : json({ ok: false, error: '专题翻译仅限站长' }, req.user ? 403 : 401)

async function translateTopic(req: PayloadRequest) {
  const denied = ownerOnly(req)
  if (denied) return denied
  const body = await readJsonBody<any>(req)
  const topicId = String(body.topicId || '').trim()
  if (!topicId) return json({ ok: false, error: 'topicId 不能为空' }, 400)
  let topic = await findTopic(req.payload, topicId, req)
  if (!topic) return json({ ok: false, error: '专题不存在' }, 404)
  if (body.draft && typeof body.draft === 'object') {
    const name = typeof body.draft.name === 'string' ? body.draft.name.trim().slice(0, 200) : undefined
    const summary = typeof body.draft.summary === 'string' ? body.draft.summary.trim().slice(0, 2000) : undefined
    if (name === '' && summary === undefined)
      return json({ ok: false, error: '中文名称不能为空' }, 400)
    topic = await (req.payload as any).update({
      collection: 'topics',
      id: topic.id,
      data: { ...(name !== undefined ? { name } : {}), ...(summary !== undefined ? { summary } : {}) },
      overrideAccess: true,
      req,
    })
  }
  const sourceHash = topicSourceHash(topic.name, topic.summary)
  const requestId = typeof body.requestId === 'string' ? body.requestId : undefined
  const response = await createBulkJob({
    ...req,
    json: async () => ({
      operation: 'translate-topic',
      target: 'topics',
      ids: [topicId],
      requestId,
      baseTranslationRevision: Number(topic.translationRevision || 0),
      sourceHash,
      force: body.force === true,
      ...(body.force === true ? { confirm: 'OVERWRITE' } : {}),
    }),
  } as PayloadRequest)
  const payload = await response.json()
  if (!response.ok) return json(payload, response.status)
  const job = payload.job
  return json({ ok: true, job, sourceHash }, 202)
}

export const TopicTranslationEndpoints: Endpoint[] = [
  { path: '/translate', method: 'post', handler: translateTopic },
]
