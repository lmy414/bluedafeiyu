import crypto from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'
import { json, readJsonBody } from '../lib/endpoint-auth'
import { syncSubmissions } from '../lib/sync-submissions'
import { writeAudit } from '../lib/audit'
import { createBulkJob } from './bulk-jobs'

const denied = (req: PayloadRequest) =>
  req.user?.role === 'owner'
    ? null
    : json({ error: '仅站长可使用本地管理通道' }, req.user ? 403 : 401)
export async function uploadWork(req: PayloadRequest) {
  const auth = denied(req)
  if (auth) return auth
  const body = await readJsonBody<any>(req)
  if (typeof body.dataBase64 !== 'string' || body.dataBase64.length > 23 * 1024 * 1024)
    return json({ error: '图片缺失或超过 16 MiB' }, 400)
  if (!process.env.SUBMISSION_ADMIN_TOKEN) return json({ error: '投稿服务未配置' }, 503)
  const upstream = await fetch(
    (process.env.SUBMISSION_ADMIN_API_URL || 'http://127.0.0.1:8788').replace(/\/$/, '') +
      '/api/v1/admin-upload',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.SUBMISSION_ADMIN_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, actor: req.user!.displayName || '本地站长' }),
      signal: AbortSignal.timeout(60_000),
    },
  )
  const result = await upstream.json()
  if (!upstream.ok) return json({ error: result.error || '上传失败' }, upstream.status)
  const stats = await syncSubmissions(req.payload, { ids: [result.id] })
  if (stats.errors.length)
    return json(
      {
        error: '原图已保存，但后台同步失败；可安全重试上传',
        submissionId: result.id,
        errors: stats.errors,
      },
      502,
    )
  const found = await req.payload.find({
    collection: 'submissions',
    where: { submissionId: { equals: result.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = found.docs[0]
  if (!doc) return json({ error: '上传已保存，尚未找到后台记录，请同步投稿' }, 502)
  await writeAudit(req, {
    action: 'automation.upload',
    targetType: 'submissions',
    targetId: result.id,
    after: { duplicate: result.duplicate },
  })
  if (body.include === true && !doc.work) {
    const response = await createBulkJob({
      ...req,
      json: async () => ({
        operation: 'manual-include',
        target: 'submissions',
        ids: [result.id],
        confirm: 'MANUAL_INCLUDE',
        requestId: body.requestId,
      }),
    } as PayloadRequest)
    const queued = await response.json()
    return json({ ...result, ...queued, submissionId: result.id }, response.status)
  }
  return json(
    { ...result, submissionId: result.id, href: `/admin/review?mode=rejected&item=${doc.id}` },
    upstream.status,
  )
}
export async function devices(req: PayloadRequest) {
  const auth = denied(req)
  if (auth) return auth
  const found = await req.payload.find({
    collection: 'users',
    where: { email: { contains: '@automation.local' } },
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })
  return json({
    docs: found.docs.map((d) => ({
      id: d.id,
      displayName: d.displayName,
      role: d.role,
      enableAPIKey: d.enableAPIKey,
      hasAPIKey: Boolean(d.apiKey),
      updatedAt: d.updatedAt,
    })),
  })
}
export async function createDevice(req: PayloadRequest) {
  const auth = denied(req)
  if (auth) return auth
  const body = await readJsonBody<any>(req),
    name = String(body.name || '').trim()
  if (!name || name.length > 80) return json({ error: '设备名称必填且不超过 80 字' }, 400)
  const apiKey = crypto.randomBytes(32).toString('hex')
  const user = await req.payload.create({
    collection: 'users',
    data: {
      email: crypto.randomUUID() + '@automation.local',
      password: crypto.randomUUID() + crypto.randomUUID(),
      role: 'owner',
      displayName: name,
      enableAPIKey: true,
      apiKey,
    },
    overrideAccess: true,
    req,
  })
  return json({ id: user.id, displayName: name, role: 'owner', apiKey }, 201)
}
export const AutomationEndpoints: Endpoint[] = [
  { path: '/automation/upload', method: 'post', handler: uploadWork },
  { path: '/automation/devices', method: 'get', handler: devices },
  { path: '/automation/devices', method: 'post', handler: createDevice },
  {
    path: '/automation/me',
    method: 'get',
    handler: (req) => {
      const auth = denied(req)
      return (
        auth ||
        json({
          id: req.user!.id,
          displayName: req.user!.displayName,
          role: 'owner',
          capabilities: 'all-owner-operations',
        })
      )
    },
  },
]
