import crypto from 'node:crypto'

export function topicSourceHash(name: unknown, summary: unknown) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ name: String(name || '').trim(), summary: String(summary || '').trim() }))
    .digest('hex')
}

export type TopicLocale = { name: string; summary: string }

export function topicDraftOf(doc: any) {
  return { name: String(doc?.name || ''), summary: String(doc?.summary || '') }
}

/** 主题译文只接受两个中文字段对应的英/日名称与简介；拒绝额外字段。 */
export function parseTopicLocale(value: unknown, language: 'en' | 'ja'): TopicLocale {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${language} 译文必须是对象`)
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).filter((key) => !['name', 'summary'].includes(key))
  if (unknown.length) throw new Error(`${language} 译文包含不允许的字段：${unknown.join('、')}`)
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const summary = typeof input.summary === 'string' ? input.summary.trim() : ''
  if (!name) throw new Error(`${language} 名称不能为空`)
  if (!summary) throw new Error(`${language} 简介不能为空`)
  if (name.length > 200) throw new Error(`${language} 名称过长`)
  if (summary.length > 2000) throw new Error(`${language} 简介过长`)
  return { name, summary }
}

export function validateTopicI18n(i18n: any, sourceHash: string) {
  if (!i18n || typeof i18n !== 'object') throw new Error('缺少主题译文')
  if (i18n.sourceHash !== sourceHash) throw new Error('译文与当前中文不一致，请重新生成')
  return {
    en: parseTopicLocale(i18n.en, 'en'),
    ja: parseTopicLocale(i18n.ja, 'ja'),
    sourceHash,
  }
}
