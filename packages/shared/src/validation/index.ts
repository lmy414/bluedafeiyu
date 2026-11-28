import { z } from 'zod'
import { CATEGORY_IDS, TOPIC_STATUSES, WORK_LICENSE_TYPES } from '../types/index.js'

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#]/i.test(value)) return false
  if (/[\s\\\u0000-\u001f\u007f]/u.test(value)) return false

  try {
    const { hostname, protocol, username, password } = new URL(value)
    return Boolean(hostname) && (protocol === 'http:' || protocol === 'https:') && !username && !password
  } catch {
    return false
  }
}

export const safeHttpUrlSchema = z.string().trim().refine(isSafeHttpUrl, '请输入有效的 HTTP 或 HTTPS 链接')
export const categoryIdSchema = z.enum(CATEGORY_IDS)
export const singleCategorySchema = z.tuple([categoryIdSchema])

const optionalUrl = z.string().trim().pipe(z.union([z.literal(''), safeHttpUrlSchema])).optional()
const characterId = z.string().trim().min(1).max(64)
const characterIds = z.array(characterId).min(1).refine(
  ids => ids.length === new Set(ids).size,
  '角色不能重复',
)
const tags = z.array(z.string().trim().min(1).max(40)).max(20)

export const submissionFieldsSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  character: characterId.optional(),
  characterIds: characterIds.optional(),
  categoryId: categoryIdSchema,
  tags: tags.optional(),
  nonAi: z.boolean().optional(),
  credit: z.enum(['named', 'anonymous']).optional(),
  creditName: z.string().trim().max(120).optional(),
  creditUrl: optionalUrl,
}).superRefine((value, ctx) => {
  const main = value.character ?? value.characterIds?.[0]
  if (!main) ctx.addIssue({ code: 'custom', path: ['character'], message: '至少选择一个角色' })
  if (main && value.characterIds && !value.characterIds.includes(main)) {
    ctx.addIssue({ code: 'custom', path: ['characterIds'], message: '角色列表必须包含主角色' })
  }
  if (value.credit === 'named' && !value.creditName) {
    ctx.addIssue({ code: 'custom', path: ['creditName'], message: '请填写署名名称' })
  }
  if (!value.credit && (value.creditName || value.creditUrl)) {
    ctx.addIssue({ code: 'custom', path: ['credit'], message: '请选择署名方式' })
  }
}).transform(({ character, characterIds, description, credit, creditName, creditUrl, ...fields }) => {
  // 已通过至少一个角色的校验。兼容旧表单仅传 character，以及新版仅传 characterIds。
  const primary = character ?? characterIds![0]!
  return {
    ...fields,
    character: primary,
    characterIds: [primary, ...(characterIds ?? []).filter(id => id !== primary)],
    description: description ?? '',
    ...(credit ? {
      credit,
      creditName: credit === 'named' ? (creditName ?? '') : '',
      creditUrl: credit === 'named' ? (creditUrl ?? '') : '',
    } : {}),
  }
})

const workName = z.string().trim().min(1).max(200)
const workProse = z.string().trim().max(2000)
const translationName = z.string().trim().min(1).max(2500)
const translationProse = z.string().trim().max(2500)

const workTranslationSchema = z.strictObject({
  name: translationName.optional(),
  description: translationProse.optional(),
  commentary: translationProse.optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  licenseNote: translationProse.optional(),
  originNote: translationProse.optional(),
  seoTitle: translationProse.optional(),
  seoDescription: translationProse.optional(),
  faq: z.array(z.strictObject({
    question: z.string().trim().min(1).max(1500),
    answer: z.string().trim().min(1).max(1500),
  })).optional(),
})

export const workI18nSchema = z.strictObject({
  en: workTranslationSchema.optional(),
  ja: workTranslationSchema.optional(),
})

const submitterSchema = z.strictObject({
  credit: z.enum(['named', 'anonymous']).optional(),
  name: z.string().trim().max(120).optional(),
  url: optionalUrl,
  github: z.string().trim().optional(),
})

const originSchema = z.strictObject({
  type: z.string().trim().min(1),
  author: z.string().trim().optional(),
  sourceUrl: optionalUrl,
  issueUrl: optionalUrl,
  note: workProse.optional(),
})

const licenseSchema = z.strictObject({
  type: z.enum(WORK_LICENSE_TYPES),
  note: workProse.optional(),
  url: optionalUrl,
})

export const workEditSchema = z.strictObject({
  name: workName.optional(),
  description: workProse.optional(),
  commentary: workProse.optional(),
  primaryCharacterId: characterId.optional(),
  characterIds: characterIds.optional(),
  categoryId: categoryIdSchema.optional(),
  tags: tags.optional(),
  submitter: submitterSchema.nullable().optional(),
  origin: originSchema.nullable().optional(),
  license: licenseSchema.nullable().optional(),
  i18n: workI18nSchema.optional(),
}).superRefine(({ primaryCharacterId, characterIds }, ctx) => {
  if (primaryCharacterId && characterIds && !characterIds.includes(primaryCharacterId)) {
    ctx.addIssue({ code: 'custom', path: ['characterIds'], message: '角色列表必须包含主角色' })
  }
})

const authorChannelSchema = z.strictObject({
  platform: z.string().trim().min(1),
  label: z.string().trim().optional(),
  url: safeHttpUrlSchema,
})

// 旧专题接口接受 null 或整组空值来清除作者资料。
export const topicAuthorSchema = z.strictObject({
  name: z.string().trim().nullish(),
  url: optionalUrl.nullable(),
  bio: z.string().trim().nullish(),
  channels: z.array(authorChannelSchema).nullish(),
}).nullable().transform((value, ctx) => {
  if (!value) return null
  const { name, url, bio, channels } = value
  if (!name && !url && !bio && !channels?.length) return null
  if (!name) ctx.addIssue({ code: 'custom', path: ['name'], message: '作者名称必填' })
  if (!channels?.length) ctx.addIssue({ code: 'custom', path: ['channels'], message: '至少填写一个作者渠道' })
  if (!name || !channels?.length) return z.NEVER
  return { name, channels, ...(url ? { url } : {}), ...(bio ? { bio } : {}) }
})

const topicText = z.string().trim().nullish().transform(value => value ?? '').optional()

export const topicUpsertSchema = z.strictObject({
  topicId: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '专题 ID 必须使用 kebab-case'),
  name: topicText,
  summary: topicText,
  nameEn: topicText,
  summaryEn: topicText,
  nameJa: topicText,
  summaryJa: topicText,
  author: topicAuthorSchema.optional(),
  status: z.enum(TOPIC_STATUSES).optional(),
  order: z.number().optional(),
})

const completeTranslationSchema = workTranslationSchema.extend({
  name: translationName,
  description: translationProse.min(1),
})
const han = /\p{Script=Han}/u
const simplifiedChinese = /[鲸蓝这图们译暂显该为发]|什么|机翻|待翻譯|待補充/u
const placeholder = /^(?:[-–—_….。?？\s]+|(?:todo|tbd|n\/?a|placeholder|pending(?: translation)?|translation pending|待翻[译譯]|待補充|待补充|占位(?:文本|符)?|仮訳|翻訳待ち|未翻訳)[\p{P}\s]*)$/iu

export const trilingualContentSchema = z.object({
  name: workName,
  description: workProse.min(1),
  commentary: workProse.optional(),
  i18n: z.strictObject({ en: completeTranslationSchema, ja: completeTranslationSchema }),
}).superRefine((value, ctx) => {
  if (placeholder.test(value.name)) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: '原文名称不能是占位文案' })
  }
  if (placeholder.test(value.description)) {
    ctx.addIssue({ code: 'custom', path: ['description'], message: '原文描述不能是占位文案' })
  }
  for (const locale of ['en', 'ja'] as const) {
    const translated = value.i18n[locale]
    for (const field of ['name', 'description', 'commentary'] as const) {
      const text = translated[field] ?? ''
      const source = value[field] ?? ''
      if (!text && !source) continue
      const chinese = locale === 'en' ? han.test(text) : simplifiedChinese.test(text)
      const copiedChineseProse = locale === 'ja' && field !== 'name' && text === source && han.test(source)
      if (!text || placeholder.test(text) || chinese || copiedChineseProse) {
        ctx.addIssue({ code: 'custom', path: ['i18n', locale, field], message: '请填写完整译文并清除占位文案或中文残留' })
      }
    }
  }
})

export function validateTrilingualCompleteness(input: unknown) {
  return trilingualContentSchema.safeParse(input)
}

export type SubmissionFields = z.output<typeof submissionFieldsSchema>
export type WorkEditInput = z.input<typeof workEditSchema>
export type TopicUpsertInput = z.input<typeof topicUpsertSchema>
export type TrilingualContent = z.output<typeof trilingualContentSchema>

/** 新投稿沿用旧队列按原图摘要生成的 ID。历史或外部 ID 可显式传入。 */
export function buildR2Keys(sha256: string, ext: string, submissionId?: string) {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new TypeError('Invalid SHA-256 digest')
  const hash = sha256.toLowerCase()
  const extension = ext.toLowerCase().replace(/^\./, '')
  if (!/^[a-z0-9]{1,10}$/.test(extension)) throw new TypeError('Invalid file extension')
  const id = submissionId ?? `sub_${hash.slice(0, 24)}`
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new TypeError('Invalid submission ID')

  const prefix = hash.slice(0, 2)
  return {
    originalKey: `originals/${prefix}/${hash}.${extension}`,
    thumbKey: `thumbs/${prefix}/${hash}.webp`,
    displayKey: `display/${prefix}/${hash}.webp`,
    stagingKey: `submissions/${id}/${hash}.${extension}`,
  }
}

/** 摘要仅覆盖调用方传入的公开 JSON 字段，调用方应先完成公开字段投影。 */
export async function computeWorkRevision(publicWorkPayload: object): Promise<string> {
  const stableJson = JSON.stringify(publicWorkPayload, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    const fields = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(fields).sort().map(key => [key, fields[key]]))
  })
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson))
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** 用原始对象键片段生成公开地址，保留层级并编码空格、中文及保留字符。 */
export function buildR2PublicUrl(baseUrl: string, key: string): string {
  if (!isSafeHttpUrl(baseUrl) || /[?#]/.test(baseUrl)) throw new TypeError('Invalid R2 public base URL')
  const segments = key.split('/')
  if (segments.some(part => !part || part === '.' || part === '..')) throw new TypeError('Invalid R2 object key')
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${segments.map(encodeURIComponent).join('/')}`
  return url.href
}

/** 为新记录生成 URL 片段，结果为空时由调用方提供备用标识。 */
export function normalizeSlug(input: string): string {
  return input.normalize('NFKD').toLowerCase().replace(/\p{Mark}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
