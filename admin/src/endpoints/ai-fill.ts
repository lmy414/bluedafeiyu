/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Endpoint, PayloadRequest } from 'payload'
import { createBulkJob } from './bulk-jobs'
import { json, readJsonBody } from '../lib/endpoint-auth'
import { missingFields } from '../lib/ai-fill'

/** Generation is asynchronous and performed exclusively by Hermes Agent tools. */
export const aiFillHandler = async (req: PayloadRequest): Promise<Response> => {
  if (req.user?.role !== 'owner')
    return json({ error: '仅站长可提交 Hermes 编辑任务' }, req.user ? 403 : 401)
  const body = await readJsonBody<any>(req)
  const target = body.workId ? 'works' : 'submissions'
  const id = String(body.workId || body.submissionId || '')
  if (!id) return json({ error: 'workId 或 submissionId 必填' }, 400)
  const response = await createBulkJob({
    ...req,
    json: async () => ({
      operation:
        Array.isArray(body.fields) && body.fields.every((f: string) => f === 'i18n')
          ? 'translate'
          : 'ai-fill',
      target,
      ids: [id],
      drafts: body.draft ? { [id]: body.draft } : {},
      suggestOnly: !body.apply,
      requestId: body.requestId,
    }),
  } as PayloadRequest)
  return response
}

export const aiFillMissingHandler = async (req: PayloadRequest): Promise<Response> => {
  if (req.user?.role !== 'owner') return json({ error: 'unauthorized' }, 401)
  const result = await (req.payload as any).find({
    collection: 'works',
    where: { status: { in: ['published', 'pending'] } },
    limit: 5000,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  })
  const items = result.docs
    .map((doc: any) => ({
      workId: doc.workId,
      kind: doc.kind,
      status: doc.status,
      name: doc.name,
      missing: missingFields(doc),
    }))
    .filter((item: any) => item.missing.length)
  return json({ ok: true, total: items.length, items })
}

export const AiFillEndpoints: Endpoint[] = [
  { handler: aiFillHandler, method: 'post', path: '/ai-fill' },
  { handler: aiFillMissingHandler, method: 'get', path: '/ai-fill/missing' },
]
