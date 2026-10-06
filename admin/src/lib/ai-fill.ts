/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI 补全作品空字段。
 *
 * 规则：
 *   1. 只补空字段（或已知的占位说明），人工已经填过的一律不动。
 *   2. description 是「图片说明」：作者原始说明优先，没有才让 AI 看图客观描述。
 *   3. commentary 是「蓝色大肥鱼」第一人称点评，和说明是两件事，分开生成、分开校验。
 *   4. 视觉模型配置只从环境变量读取（AI_FILL_* 优先，其次复用 HERMES_VISION_*），没配就报错，不假造内容。
 */
import sharp from 'sharp'

import { isPlaceholderDescription } from './placeholder'
import {sourceHash, validateI18n} from './localization.mjs'

export { isPlaceholderDescription }

export const FILL_FIELDS = ['name', 'description', 'commentary', 'tags', 'categories', 'dimensions', 'i18n'] as const
export type FillField = (typeof FILL_FIELDS)[number]
type TextField = 'name' | 'description' | 'commentary'

const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|<\/?[A-Za-z!]|(?:javascript|vbscript|data)\s*:|\bon[a-z]+\s*=/i
const LIMITS = { name: 60, description: 300, commentary: 600, tag: 20, tags: 6 }
const MAX_EDGE = 1024

function blank(value: unknown): boolean {
  return !String(value ?? '').trim()
}

/** 作者在投稿时写的原始说明（排除占位句）。 */
export function authorDescription(work: any, submission?: any): string {
  const candidates = [
    submission?.fields?.description,
    submission?.fields?.note,
    work?.legacyData?.description,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && !isPlaceholderDescription(value)) return value.trim()
  }
  return ''
}

/** 算出这件作品有哪些字段需要补。 */
export function missingFields(work: any): FillField[] {
  const missing: FillField[] = []
  if (blank(work.name)) missing.push('name')
  if (isPlaceholderDescription(work.description)) missing.push('description')
  if (blank(work.commentary)) missing.push('commentary')
  if (!Array.isArray(work.tags) || !work.tags.some((tag: any) => !blank(tag?.value ?? tag))) missing.push('tags')
  if (!Array.isArray(work.categories) || work.categories.length === 0) missing.push('categories')
  if (!Number(work.width) || !Number(work.height)) missing.push('dimensions')
  return missing
}

export type VisionConfig = { apiKey: string; endpoint: string; model: string; timeoutMs: number }

export function visionConfig(env: NodeJS.ProcessEnv = process.env): VisionConfig | null {
  const endpoint = String(env.AI_FILL_ENDPOINT || env.HERMES_VISION_ENDPOINT || '').trim()
  const apiKey = String(env.AI_FILL_API_KEY || env.HERMES_VISION_API_KEY || '').trim()
  if (!endpoint || !apiKey) return null
  return {
    endpoint,
    apiKey,
    model: String(env.AI_FILL_MODEL || env.HERMES_VISION_MODEL || '').trim(),
    timeoutMs: Number(env.AI_FILL_TIMEOUT_MS) > 0 ? Number(env.AI_FILL_TIMEOUT_MS) : 90_000,
  }
}

const SYSTEM_PROMPT = [
  '你是 AI 娘二创图片站的编辑。看图后为这张图补写内容字段，只输出一个 JSON 对象，不要 Markdown、不要解释。',
  '字段含义（只输出用户要求的字段）：',
  'name：图片名称，12 字以内，优先用图中可读的标题或梗。',
  'description：图片说明。客观描述画面内容，一到两句，第三人称；写清角色、动作、画面里的文字或梗；不评价、不用第一人称；不超过 80 字。',
  'commentary：「蓝色大肥鱼」（DeepSeek 娘，傲娇、嘴硬、爱吐槽的蓝发鲸鱼娘）的第一人称点评，两到三句；必须针对这张图的具体内容，不能是通用模板，不要复述 description。',
  'tags：1 到 4 个中文短标签，每个不超过 8 字。',
  'categoryIds：从给定分类 id 里选 1 个；多格分镜、四格、条漫只能选 comic。',
].join('\n')

type Vocabulary = { categories: Array<{ categoryId: string; name?: string; description?: string }> }

function userPrompt(input: { name: string; characterName: string; fields: string[]; authorText: string; vocabulary: Vocabulary }): string {
  const lines = [
    `作品名：${input.name || '(未填)'}；角色：${input.characterName || '(未填)'}`,
    `需要输出的字段：${input.fields.join(', ')}`,
  ]
  if (input.authorText) lines.push(`作者原始说明（仅供理解，不要改写进 description）：${input.authorText}`)
  if (input.fields.includes('categoryIds')) {
    lines.push(`可选分类：${input.vocabulary.categories.map((item) => `${item.categoryId}（${item.name || ''}：${item.description || ''}）`).join('；')}`)
  }
  return lines.join('\n')
}

/** 缩到 1024 内并转 webp；模型拒收过大的原图。 */
export async function normalizeImage(buffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const meta = await sharp(buffer, { animated: false }).metadata()
  const rotated = Number(meta.orientation || 1) >= 5
  const width = Number(rotated ? meta.height : meta.width) || 0
  const height = Number(rotated ? meta.width : (meta.pageHeight || meta.height)) || 0
  const data = await sharp(buffer, { animated: false })
    .rotate()
    .resize({ fit: 'inside', height: MAX_EDGE, width: MAX_EDGE, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
  return { data, width, height }
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > max || FORBIDDEN.test(text)) return null
  return text
}

function parseModelJson(content: string): Record<string, unknown> {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 返回的不是 JSON')
  const parsed = JSON.parse(trimmed.slice(start, end + 1))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI 返回的不是对象')
  return parsed
}

export type FillSuggestion = {
  i18n?: {sourceHash:string;en:any;ja:any}
  categoryIds?: string[]
  commentary?: string
  description?: string
  descriptionSource?: 'author' | 'ai'
  height?: number
  name?: string
  tags?: string[]
  width?: number
}

export type FillRequest = {
  current?: any
  authorText: string
  characterName: string
  fields: FillField[]
  image: Buffer
  name: string
  vocabulary: Vocabulary
}

export type VisionCaller = (input: { system: string; user: string; image: Buffer }) => Promise<string>

export function httpVisionCaller(cfg: VisionConfig, fetchImpl: typeof fetch = fetch): VisionCaller {
  return async ({ system, user, image }) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
    try {
      const response = await fetchImpl(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model || undefined,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: `data:image/webp;base64,${image.toString('base64')}` } }] },
          ],
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`)
      const data: any = await response.json()
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('AI 服务没有返回内容')
      return content
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * 生成补全建议。只返回 fields 里要求且校验通过的字段；
 * description 有作者原文时直接用原文，不调模型。
 */
export async function suggestFill(request: FillRequest, call: VisionCaller): Promise<{ suggestion: FillSuggestion; errors: string[] }> {
  const suggestion: FillSuggestion = {}
  const errors: string[] = []
  const wanted = new Set(request.fields)
  const normalized = await normalizeImage(request.image)
  const finish = async () => {
    if (request.current) {
      const source={...request.current, ...Object.fromEntries(['name','description','commentary','tags','categoryIds'].filter(k=>k in suggestion).map(k=>[k,(suggestion as any)[k]]))}
      const raw=await call({
        system:'你是英语和日语母语的二创档案编辑。分别根据给定中文事实撰写真正自然的英文和日文，不逐字翻译，不编造画面、作者、授权、热度。英文角色和站名 DeepSeek Chan；鲸娘、鲸鱼娘、蓝色大肥鱼都是 DeepSeek Chan，绝不能 Whale Chan、Whale Girl、Blue Fish、Fat Fish。其他角色为模型名 Chan，如 Claude Chan、StepFun Chan、GPT Chan。日文角色为模型名ちゃん，如 DeepSeekちゃん、Claudeちゃん；日文站名保留 DeepSeek Chan。产品名称保持官方模型名。每种语言提供 name、description、commentary、tags（与中文同数量同顺序）、seoTitle、seoDescription、faq（两组作品专属 question/answer）、originNote、licenseNote 字符串；FAQ 只据已知事实回答，未知来源/授权不能编造。英文不能残留中文，日文用自然日语。只输出 JSON {"en":{...},"ja":{...}}。',
        user:JSON.stringify(source), image:normalized.data,
      })
      suggestion.i18n={sourceHash:sourceHash(source),...validateI18n(parseModelJson(raw),source)}
    }
    return {suggestion,errors}
  }

  if (wanted.has('dimensions') && normalized.width && normalized.height) {
    suggestion.width = normalized.width
    suggestion.height = normalized.height
  }
  if (wanted.has('description') && request.authorText) {
    const author = cleanText(request.authorText, LIMITS.description)
    if (author) {
      suggestion.description = author
      suggestion.descriptionSource = 'author'
      wanted.delete('description')
    } else errors.push('作者说明不合法，改由 AI 描述')
  }

  const modelFields: string[] = []
  for (const field of ['name', 'description', 'commentary', 'tags'] as const) if (wanted.has(field)) modelFields.push(field)
  if (wanted.has('categories')) modelFields.push('categoryIds')
  if (!modelFields.length) return finish()

  const raw = await call({
    system: SYSTEM_PROMPT,
    user: userPrompt({ name: request.name, characterName: request.characterName, fields: modelFields, authorText: request.authorText, vocabulary: request.vocabulary }),
    image: normalized.data,
  })
  const parsed = parseModelJson(raw)

  const text = (field: TextField, max: number) => {
    if (!modelFields.includes(field)) return
    const value = cleanText(parsed[field], max)
    if (value) suggestion[field] = value
    else errors.push(`${field} 不合法或为空`)
  }
  text('name', LIMITS.name)
  text('description', LIMITS.description)
  if (suggestion.description && !suggestion.descriptionSource) suggestion.descriptionSource = 'ai'
  text('commentary', LIMITS.commentary)
  if (suggestion.description && suggestion.commentary && suggestion.description === suggestion.commentary) {
    delete suggestion.commentary
    errors.push('commentary 与 description 相同，已丢弃')
  }
  if (modelFields.includes('tags')) {
    const tags = Array.isArray(parsed.tags) ? parsed.tags.map((tag) => cleanText(tag, LIMITS.tag)).filter((tag): tag is string => Boolean(tag)) : []
    const unique = [...new Set(tags)].slice(0, LIMITS.tags)
    if (unique.length) suggestion.tags = unique
    else errors.push('tags 为空')
  }
  if (modelFields.includes('categoryIds')) {
    const allowed = new Set(request.vocabulary.categories.map((item) => item.categoryId))
    const ids = Array.isArray(parsed.categoryIds) ? parsed.categoryIds.map(String).filter((id) => allowed.has(id)) : []
    if (ids.length) suggestion.categoryIds = [...new Set(ids)].slice(0, 2)
    else errors.push('categoryIds 不在分类词表内')
  }
  return finish()
}
