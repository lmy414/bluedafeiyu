/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs/promises'
import path from 'node:path'

import type { Endpoint, PayloadRequest } from 'payload'

import { FILL_FIELDS, type FillField, authorDescription, httpVisionCaller, missingFields, suggestFill, visionConfig } from '../lib/ai-fill'
import { writeAudit } from '../lib/audit'
import { json, readJsonBody, requireWorker } from '../lib/endpoint-auth'

type FillBody = {
  apply?: boolean
  /** 抽屉里当前表单为空的字段；不传则按作品库里的缺失字段算。 */
  fields?: string[]
  submissionId?: string
  workId?: string
}

const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024

function mediaDir(): string {
  return path.resolve(process.env.MEDIA_DIR || path.resolve(process.cwd(), 'media'))
}

async function readMedia(payload: any, media: unknown): Promise<Buffer | null> {
  const id = media && typeof media === 'object' ? (media as any).id : media
  if (id === null || id === undefined || id === '') return null
  const doc = typeof media === 'object' && (media as any).filename ? media : await payload.findByID({ collection: 'media', id, depth: 0, overrideAccess: true }).catch(() => null)
  const filename = String((doc as any)?.filename || '')
  if (!filename || filename.includes('/') || filename.includes('\\')) return null
  return fs.readFile(path.join(mediaDir(), filename)).catch(() => null)
}

async function readOriginal(url: unknown): Promise<Buffer | null> {
  const text = String(url || '').trim()
  if (!/^https:\/\//i.test(text)) return null
  let target = text
  try {
    const parsed = new URL(text)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parsed.hostname === 'github.com' && parts.length > 4 && parts[2] === 'blob') {
      target = `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join('/')}`
    }
  } catch {
    return null
  }
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) return null
    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    if (contentType && !contentType.startsWith('image/')) return null
    const length = Number(response.headers.get('content-length') || 0)
    if (length > MAX_ORIGINAL_BYTES) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.length > MAX_ORIGINAL_BYTES ? null : buffer
  } catch {
    return null
  }
}

function normalizeFields(value: unknown): FillField[] | null {
  if (!Array.isArray(value)) return null
  return value.map(String).filter((field): field is FillField => (FILL_FIELDS as readonly string[]).includes(field))
}

async function loadTarget(req: PayloadRequest, body: FillBody): Promise<{ work: any | null; submission: any | null }> {
  const payload = req.payload as any
  let work: any = null
  let submission: any = null
  if (body.workId) {
    const found = await payload.find({ collection: 'works', where: { workId: { equals: String(body.workId) } }, limit: 1, depth: 1, overrideAccess: true })
    work = found.docs[0] || null
  }
  const submissionId = body.submissionId || work?.submissionId
  if (submissionId) {
    const found = await payload.find({ collection: 'submissions', where: { submissionId: { equals: String(submissionId) } }, limit: 1, depth: 1, overrideAccess: true })
    submission = found.docs[0] || null
  }
  return { work, submission }
}

export const aiFillHandler = async (req: PayloadRequest): Promise<Response> => {
  const role = (req.user as any)?.role
  // 站长走后台会话；批量补全走执行器令牌。机器人账号不能写。
  const viaWorker = role !== 'owner'
  if (viaWorker) {
    const denied = requireWorker(req)
    if (denied) return denied
  }
  const cfg = visionConfig()
  if (!cfg) return json({ ok: false, error: '视觉模型未配置（AI_FILL_ENDPOINT / AI_FILL_API_KEY 或 HERMES_VISION_*）' }, 503)

  const body = await readJsonBody<FillBody>(req)
  if (!body.workId && !body.submissionId) return json({ ok: false, error: 'workId 或 submissionId 必填' }, 400)
  if (viaWorker && !body.apply) return json({ ok: false, error: '执行器调用必须明确 apply=true' }, 400)
  const { work, submission } = await loadTarget(req, body)
  if (!work && !submission) return json({ ok: false, error: '找不到作品或投稿' }, 404)
  if (body.apply && !work) return json({ ok: false, error: '只有已入库的作品才能直接写入' }, 400)

  const requested = normalizeFields(body.fields)
  const base = work || { name: submission?.fields?.name, description: submission?.fields?.description }
  const fields = work ? (requested ? requested.filter((field) => field === 'dimensions' ? (!Number(work.width) || !Number(work.height)) : missingFields(work).includes(field)) : missingFields(work)) : (requested || [])
  if (!fields.length) return json({ ok: true, workId: work?.workId, fields: [], suggestion: {}, applied: false })

  const payload = req.payload as any
  const original = await readOriginal(work?.legacyPaths?.path)
  const image = original || (await readMedia(payload, work?.preview)) || (await readMedia(payload, submission?.media))
  if (!image) return json({ ok: false, error: '读不到这张图，无法补全' }, 422)
  // 原图读不到时使用后台预览图；预览图经过同步时已保留真实宽高，可用于补齐字段。
  const effective = fields

  const categoryResult = await payload.find({ collection: 'categories', where: { status: { equals: 'active' } }, limit: 1000, depth: 0, overrideAccess: true })
  const character = work?.character && typeof work.character === 'object' ? work.character : null

  let result
  try {
    result = await suggestFill({
      authorText: authorDescription(work, submission),
      characterName: String(character?.name || submission?.fields?.characterId || ''),
      fields: effective,
      image,
      name: String(base?.name || ''),
      vocabulary: { categories: categoryResult.docs.map((doc: any) => ({ categoryId: String(doc.categoryId), name: doc.name, description: doc.description })) },
    }, httpVisionCaller(cfg))
  } catch (error) {
    return json({ ok: false, error: `AI 补全失败：${error instanceof Error ? error.message : String(error)}` }, 502)
  }
  const { suggestion, errors } = result

  if (!body.apply) return json({ ok: true, workId: work?.workId, fields: effective, suggestion, errors, applied: false })

  // 写回：只写缺失字段，再核对一次，防止并发期间人工已经填了。
  const fresh = await payload.findByID({ collection: 'works', id: work.id, depth: 0, overrideAccess: true })
  const stillMissing = new Set(missingFields(fresh))
  const data: Record<string, any> = {}
  if (suggestion.name && stillMissing.has('name')) data.name = suggestion.name
  if (suggestion.description && stillMissing.has('description')) data.description = suggestion.description
  if (suggestion.commentary && stillMissing.has('commentary')) data.commentary = suggestion.commentary
  if (suggestion.tags && stillMissing.has('tags')) data.tags = suggestion.tags.map((value) => ({ value }))
  if (suggestion.categoryIds && stillMissing.has('categories')) {
    data.categories = categoryResult.docs.filter((doc: any) => suggestion.categoryIds!.includes(String(doc.categoryId))).map((doc: any) => doc.id)
  }
  if (suggestion.width && suggestion.height && stillMissing.has('dimensions')) {
    data.width = suggestion.width
    data.height = suggestion.height
  }
  if (!Object.keys(data).length) return json({ ok: true, workId: work.workId, fields: effective, suggestion, errors, applied: false })

  data.needsPublish = true
  if (!fresh.changeAction) data.changeAction = 'update'
  await payload.update({ collection: 'works', id: work.id, data, context: { audit: false, skipFieldAccess: true }, overrideAccess: true, req })
  await writeAudit(req, {
    action: 'works.ai-fill',
    before: Object.fromEntries(Object.keys(data).map((key) => [key, fresh[key] ?? null])),
    after: { ...data, descriptionSource: suggestion.descriptionSource || null, model: cfg.model || null, via: viaWorker ? 'worker' : 'owner' },
    targetId: work.workId,
    targetType: 'works',
  })
  return json({ ok: true, workId: work.workId, fields: effective, suggestion, errors, applied: true, written: Object.keys(data).filter((key) => key !== 'needsPublish' && key !== 'changeAction') })
}

/** 列出有缺失字段的作品，供批量补全使用。 */
export const aiFillMissingHandler = async (req: PayloadRequest): Promise<Response> => {
  if ((req.user as any)?.role !== 'owner') {
    const denied = requireWorker(req)
    if (denied) return denied
  }
  const result = await (req.payload as any).find({ collection: 'works', where: { status: { in: ['published', 'pending'] } }, limit: 5000, depth: 0, overrideAccess: true, pagination: false })
  const items = result.docs
    .map((doc: any) => ({ workId: doc.workId, kind: doc.kind, status: doc.status, name: doc.name, missing: missingFields(doc) }))
    .filter((item: any) => item.missing.length)
  return json({ ok: true, total: items.length, items })
}

export const AiFillEndpoints: Endpoint[] = [
  { handler: aiFillHandler, method: 'post', path: '/ai-fill' },
  { handler: aiFillMissingHandler, method: 'get', path: '/ai-fill/missing' },
]