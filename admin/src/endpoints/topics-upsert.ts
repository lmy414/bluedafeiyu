/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Endpoint, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'

import { writeAudit } from '../lib/audit'
import { json, readJsonBody, requireOwnerOrBot } from '../lib/endpoint-auth'

/** topicId 与集合字段校验保持一致：小写字母/数字分段、短横线连接。 */
const TOPIC_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 三态哨兵：author 键省略 = 保留旧值，显式 null = 清空，对象 = 覆盖。
 * 用独立 Symbol 而不是 undefined，避免把「没传」和「传了空对象」混为一谈。
 */
const KEEP = Symbol('keep')

/**
 * 严格白名单。机器人只允许通过这些字段维护专题元数据；
 * works / cover / needsPublish / id / 时间戳等一律拒绝，绝不静默丢弃。
 */
const ALLOWED_KEYS = new Set([
  'topicId',
  'name',
  'summary',
  'nameEn',
  'summaryEn',
  'nameJa',
  'summaryJa',
  'author',
  'status',
  'order',
])

const AUTHOR_KEYS = new Set(['name', 'url', 'bio', 'channels'])
const CHANNEL_KEYS = new Set(['platform', 'label', 'url'])

/** 输入校验失败：带中文字段信息与 details，最终统一转成 400。 */
class InputError extends Error {
  details: Record<string, string>

  constructor(message: string, details: Record<string, string> = {}) {
    super(message)
    this.name = 'InputError'
    this.details = details
  }
}

type ChannelInput = { label: string; platform: string; url: string }
type AuthorInput = { bio: string; channels: ChannelInput[]; name: string; url: string }

type UpsertInput = {
  author: typeof KEEP | AuthorInput | null
  name?: string
  nameEn?: string
  nameJa?: string
  order?: number
  status?: 'active' | 'draft'
  summary?: string
  summaryEn?: string
  summaryJa?: string
  topicId: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function textField(value: unknown, field: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') throw new InputError(`${field} 必须是字符串`, { [field]: '必须是字符串' })
  return value.trim()
}

function assertKnownKeys(value: Record<string, unknown>, allowed: Set<string>, scope: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort()
  if (unknown.length) {
    throw new InputError(
      `${scope}不支持字段：${unknown.join('、')}`,
      Object.fromEntries(unknown.map((key) => [scope ? `${scope}.${key}` : key, '不支持该字段'])),
    )
  }
}

/**
 * 只做形状与数据类型归一：未知键、非字符串、非数组一律在这里以中文报错。
 * 作者业务规则（必须有作者名 / 首选渠道、URL 限 http/https）交给集合字段校验，
 * 让真实 Payload 成为这类非法值的判官，接口不重复实现一遍。
 */
function parseAuthor(value: unknown): AuthorInput | null {
  if (value === null) return null
  if (!isPlainObject(value)) throw new InputError('author 必须是对象或 null', { author: '必须是对象或 null' })
  assertKnownKeys(value, AUTHOR_KEYS, 'author')

  const name = textField(value.name, 'author.name')
  const url = textField(value.url, 'author.url')
  const bio = textField(value.bio, 'author.bio')
  const rawChannels = value.channels
  if (rawChannels !== undefined && rawChannels !== null && !Array.isArray(rawChannels)) {
    throw new InputError('author.channels 必须是数组', { 'author.channels': '必须是数组' })
  }

  const channels: ChannelInput[] = []
  if (Array.isArray(rawChannels)) {
    rawChannels.forEach((raw, index) => {
      const field = `author.channels[${index}]`
      if (!isPlainObject(raw)) throw new InputError(`author.channels 第 ${index + 1} 项必须是对象`, { [field]: '必须是对象' })
      assertKnownKeys(raw, CHANNEL_KEYS, `author.channels 第 ${index + 1} 项`)
      channels.push({
        label: textField(raw.label, `${field}.label`),
        platform: textField(raw.platform, `${field}.platform`),
        url: textField(raw.url, `${field}.url`),
      })
    })
  }

  // 整组全空：按普通专题处理（等同清空），与后台「清空作者」的归一一致。
  if (!name && !url && !bio && channels.length === 0) return null
  return { bio, channels, name, url }
}

function parseUpsertBody(body: unknown): UpsertInput {
  if (!isPlainObject(body)) throw new InputError('请求体必须是 JSON 对象')
  assertKnownKeys(body, ALLOWED_KEYS, '')

  const topicId = textField(body.topicId, 'topicId')
  if (!topicId) throw new InputError('topicId 不能为空', { topicId: '不能为空' })
  if (!TOPIC_ID_PATTERN.test(topicId)) throw new InputError('topicId 必须是 kebab-case', { topicId: '必须是 kebab-case' })

  const input: UpsertInput = { author: KEEP, topicId }
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)

  if (has('name')) input.name = textField(body.name, 'name')
  if (has('summary')) input.summary = textField(body.summary, 'summary')
  if (has('nameEn')) input.nameEn = textField(body.nameEn, 'nameEn')
  if (has('summaryEn')) input.summaryEn = textField(body.summaryEn, 'summaryEn')
  if (has('nameJa')) input.nameJa = textField(body.nameJa, 'nameJa')
  if (has('summaryJa')) input.summaryJa = textField(body.summaryJa, 'summaryJa')

  if (has('status')) {
    const status = body.status
    if (status === 'draft' || status === 'active') input.status = status
    else throw new InputError('status 只能是 draft 或 active', { status: '只能是 draft 或 active' })
  }
  if (has('order')) {
    const order = body.order
    if (typeof order !== 'number' || !Number.isFinite(order)) throw new InputError('order 必须是有限数字', { order: '必须是有限数字' })
    input.order = order
  }
  if (has('author')) input.author = parseAuthor(body.author)
  return input
}

/** 把输入作者归一成与库里读出的形态一致，便于比较（渠道行忽略 Payload 自动生成的 id）。 */
function normalizeInputAuthor(author: AuthorInput | null) {
  if (!author) return null
  return { bio: author.bio, channels: author.channels, name: author.name, url: author.url }
}

function normalizeStoredAuthor(value: unknown): AuthorInput | null {
  if (!isPlainObject(value)) return null
  const name = textOf(value.name)
  const url = textOf(value.url)
  const bio = textOf(value.bio)
  const channels = (Array.isArray(value.channels) ? value.channels : []).map((raw: any) => ({
    label: textOf(raw?.label),
    platform: textOf(raw?.platform),
    url: textOf(raw?.url),
  }))
  if (!name && !url && !bio && channels.length === 0) return null
  return { bio, channels, name, url }
}

function sameChannels(left: ChannelInput[], right: ChannelInput[]): boolean {
  if (left.length !== right.length) return false
  return left.every((channel, index) => channel.platform === right[index].platform && channel.label === right[index].label && channel.url === right[index].url)
}

function sameAuthor(left: AuthorInput | null, right: AuthorInput | null): boolean {
  if (!left || !right) return left === right
  return left.name === right.name && left.url === right.url && left.bio === right.bio && sameChannels(left.channels, right.channels)
}

/** 落库形态：与集合字段校验的「显式 null 子字段 + channels 数组」保持一致。 */
function authorData(author: AuthorInput | null): Record<string, unknown> {
  if (!author) return { bio: null, channels: [], name: null, url: null }
  return {
    bio: author.bio || null,
    channels: author.channels.map((channel) => ({ ...(channel.label ? { label: channel.label } : {}), platform: channel.platform, url: channel.url })),
    name: author.name,
    url: author.url || null,
  }
}

/** 只挑出真正有变化的字段；空 patch 直接短路，避免每次都把 needsPublish 顶成 true。 */
function buildPatch(existing: any, input: UpsertInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const changedText = (key: 'name' | 'summary' | 'nameEn' | 'summaryEn' | 'nameJa' | 'summaryJa') =>
    input[key] !== undefined && textOf(input[key]) !== textOf(existing[key])

  for (const key of ['name', 'summary', 'nameEn', 'summaryEn', 'nameJa', 'summaryJa'] as const) {
    if (changedText(key)) patch[key] = input[key]
  }
  if (input.status !== undefined && input.status !== existing.status) patch.status = input.status
  if (input.order !== undefined && Number(input.order) !== Number(existing.order)) patch.order = input.order
  if (input.author !== KEEP && !sameAuthor(normalizeInputAuthor(input.author), normalizeStoredAuthor(existing.author))) {
    patch.author = authorData(input.author)
  }
  return patch
}

function hasWorks(doc: any): boolean {
  return Array.isArray(doc?.works) && doc.works.length > 0
}

function errorResponse(error: unknown): Response {
  if (error instanceof InputError) return json({ ok: false, error: error.message, details: error.details }, 400)
  if (error instanceof ValidationError) {
    const errors = ((error.data as any)?.errors ?? []) as Array<{ message: string; path?: string }>
    const details: Record<string, string> = {}
    errors.forEach((item, index) => {
      details[item.path ? String(item.path) : String(index)] = item.message
    })
    const message = errors.map((item) => item.message).filter(Boolean).join('；') || error.message || '字段校验失败'
    return json({ ok: false, error: message, details }, 400)
  }
  const message = error instanceof Error ? error.message : String(error)
  // 并发写入同一 topicId 时唯一约束会直接抛错，转成 409 让调用方重试。
  if (/UNIQUE constraint failed|SQLITE_CONSTRAINT|duplicate key/i.test(message)) {
    return json({ ok: false, error: 'topicId 已存在，请重试', details: { topicId: '唯一键冲突' } }, 409)
  }
  return json({ ok: false, error: `专题写入失败：${message}` }, 500)
}

/**
 * 真正写库时用的 req 克隆。Payload 的本地 API 会把传入 context 合并进 req.context，
 * 若直接用原 req，`{ audit: false }` 会被写进原 req.context，导致随后手写的
 * writeAudit 因 `req.context.audit === false` 被静默跳过。克隆一层即可隔离。
 */
function clonedReq(req: PayloadRequest): PayloadRequest {
  return { ...req, context: { ...req.context } } as PayloadRequest
}

function success(created: boolean, changed: boolean, doc: any): Response {
  return json({ ok: true, created, changed, id: doc.id, topicId: doc.topicId, status: doc.status })
}

async function createTopic(req: PayloadRequest, input: UpsertInput): Promise<Response> {
  if (input.name === undefined) throw new InputError('创建专题时 name 必填', { name: '必填' })
  if (input.summary === undefined) throw new InputError('创建专题时 summary 必填', { summary: '必填' })
  if (!input.name) throw new InputError('name（名称）不能为空', { name: '不能为空' })
  if (!input.summary) throw new InputError('summary（简介）不能为空', { summary: '不能为空' })

  const data: Record<string, unknown> = {
    topicId: input.topicId,
    name: input.name,
    summary: input.summary,
    status: input.status ?? 'draft',
    order: input.order ?? 0,
  }
  for (const key of ['nameEn', 'summaryEn', 'nameJa', 'summaryJa'] as const) {
    if (input[key] !== undefined) data[key] = input[key]
  }
  if (input.author !== KEEP) data.author = authorData(input.author)

  const payload = req.payload as any
  const created = await payload.create({ collection: 'topics', data, context: { audit: false }, overrideAccess: true, req: clonedReq(req) })
  await writeAudit(req, { action: 'topics.create', after: created, before: null, targetId: created.id, targetType: 'topics' })
  return success(true, true, created)
}

async function updateTopic(req: PayloadRequest, role: string | undefined, input: UpsertInput, existing: any): Promise<Response> {
  // 机器人不得把「已关联作品的专题」下线；站长不受限。
  const nextStatus = input.status !== undefined ? input.status : existing.status
  if (role === 'bot' && nextStatus === 'draft' && existing.status === 'active' && hasWorks(existing)) {
    return json({ ok: false, error: '机器人不能把已关联作品的专题改为草稿' }, 403)
  }

  const patch = buildPatch(existing, input)
  if (Object.keys(patch).length === 0) return success(false, false, existing)

  const payload = req.payload as any
  const updated = await payload.update({ collection: 'topics', id: existing.id, data: patch, context: { audit: false }, overrideAccess: true, req: clonedReq(req) })
  await writeAudit(req, { action: 'topics.update', after: updated, before: existing, targetId: updated.id, targetType: 'topics' })
  return success(false, true, updated)
}

export const topicsUpsertHandler = async (req: PayloadRequest): Promise<Response> => {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  const role = (req.user as any)?.role
  const payload = req.payload as any

  // JSON 解析单独处理：请求体畸形是客户端输入错误，应是 400 而不是 500。
  // 必须在任何 find/create/update/audit 之前拦下，此时尚未产生任何副作用。
  let rawBody: unknown
  try {
    rawBody = await readJsonBody<Record<string, unknown>>(req)
  } catch {
    return json({ ok: false, error: '请求体不是合法 JSON' }, 400)
  }

  try {
    const input = parseUpsertBody(rawBody)
    const found = await payload.find({ collection: 'topics', where: { topicId: { equals: input.topicId } }, depth: 0, limit: 1, overrideAccess: true })
    const existing = found.docs[0]
    return existing ? await updateTopic(req, role, input, existing) : await createTopic(req, input)
  } catch (error) {
    return errorResponse(error)
  }
}

export const TopicsUpsertEndpoint: Endpoint = {
  handler: topicsUpsertHandler,
  method: 'post',
  path: '/upsert',
}
