import crypto from 'node:crypto'

export const LOCALE_FIELDS = [
  'name',
  'description',
  'commentary',
  'tags',
  'seoTitle',
  'seoDescription',
  'faq',
  'originNote',
  'licenseNote',
]
export function sourceText(work) {
  return {
    name: work.name || '',
    description: work.description || '',
    commentary: work.commentary || '',
    tags: work.tags || [],
    characterId: work.characterId,
    categoryIds: work.categoryIds || [],
    originNote: work.origin?.note || '',
    licenseNote: work.license?.note || '',
  }
}
export function sourceHash(work) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(sourceText(work)))
    .digest('hex')
}

function invalid(path, message) {
  throw Object.assign(new Error(`${path}: ${message}`), { code: 'LOCALIZATION_INVALID', path })
}

/** A language can be validated and saved independently. Never invokes a model. */
export function validateLocale(entry, language, original = {}) {
  const path = `i18n.${language}`
  if (!['en', 'ja'].includes(language)) invalid(path, 'Unsupported language')
  if (!entry || typeof entry !== 'object' || Array.isArray(entry))
    invalid(path, `Invalid ${language} fields`)
  for (const key of Object.keys(entry))
    if (!LOCALE_FIELDS.includes(key)) invalid(`${path}.${key}`, 'Unknown field')
  for (const key of LOCALE_FIELDS.filter((k) => !['tags', 'faq'].includes(k))) {
    if (
      typeof entry[key] !== 'string' ||
      (['name', 'seoTitle', 'seoDescription'].includes(key) && !entry[key].trim()) ||
      entry[key].length > 2500
    )
      invalid(`${path}.${key}`, `Invalid ${language}.${key}`)
  }
  if (
    !Array.isArray(entry.tags) ||
    entry.tags.length !== (original.tags || []).length ||
    entry.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 80)
  )
    invalid(`${path}.tags`, `Invalid ${language} tag alignment`)
  if (!Array.isArray(entry.faq) || entry.faq.length !== 2)
    invalid(`${path}.faq`, `Invalid ${language} FAQ`)
  const texts = LOCALE_FIELDS.filter((k) => !['tags', 'faq'].includes(k)).map((k) => [k, entry[k]])
  entry.tags.forEach((t, i) => texts.push([`tags[${i}]`, t]))
  entry.faq.forEach((q, i) => {
    if (
      !q ||
      typeof q !== 'object' ||
      Array.isArray(q) ||
      Object.keys(q).some((k) => !['question', 'answer'].includes(k))
    )
      invalid(`${path}.faq[${i}]`, `Invalid ${language} FAQ`)
    for (const key of ['question', 'answer']) {
      if (typeof q[key] !== 'string' || !q[key].trim() || q[key].length > 1500)
        invalid(`${path}.faq[${i}].${key}`, `Invalid ${language} FAQ`)
      texts.push([`faq[${i}].${key}`, q[key]])
    }
  })
  // Only exact, known attribution is exempt from language checks. Safety checks
  // still inspect the original text, including exempt names and URLs.
  const protectedNames = [original.origin?.author, original.submitter?.name].filter(
    (v) => typeof v === 'string' && v.trim(),
  )
  for (const [key, text] of texts) {
    if (
      /(?:javascript|vbscript|data)\s*:|\bon[a-z]+\s*=|<\/?[A-Za-z!]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(
        text,
      )
    )
      invalid(`${path}.${key}`, 'Unsafe localized prose')
    let prose = text
    if (['originNote', 'licenseNote'].includes(key))
      for (const name of protectedNames) prose = prose.split(name).join('')
    const namesOnly = prose.replace(
      /\b(?:DeepSeek|Claude|GPT|Gemini|Qwen|Kimi|Doubao|Grok|GLM|StepFun|MiMo) Chan\b/g,
      '',
    )
    if (
      /Whale[ -]?Chan/i.test(namesOnly) ||
      /Blue Fish|Fat Fish|鯨娘|鲸娘|鲸鱼娘/.test(namesOnly) ||
      /\b(?:DeepSeek|Claude|GPT|Gemini|Qwen|Kimi|Doubao|Grok|GLM|StepFun|MiMo)[- ]chan\b/i.test(
        namesOnly,
      )
    )
      invalid(`${path}.${key}`, 'Wrong character terminology')
    if (language === 'en' && /[\u3400-\u9fff]/u.test(prose))
      invalid(`${path}.${key}`, 'Chinese left in English prose')
    if (language === 'ja' && /鲸|蓝|这|图|们|什么|机翻/u.test(prose))
      invalid(`${path}.${key}`, 'Simplified Chinese left in Japanese prose')
  }
  if (
    language === 'en' &&
    /whale[ -]?girl/i.test(entry.name) &&
    !entry.name.includes('DeepSeek Chan')
  )
    invalid(`${path}.name`, 'Whale alias used as title name')
  if (language === 'ja' && entry.tags.some((t) => /^Q\s*版$/u.test(t)))
    invalid(`${path}.tags`, 'Use native Japanese chibi tags: ちびキャラ or デフォルメ')
  return structuredClone(entry)
}

export function validateI18n(value, original) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !['en', 'ja', 'sourceHash'].includes(k))
  )
    invalid('i18n', 'Invalid i18n object')
  return {
    en: validateLocale(value.en, 'en', original),
    ja: validateLocale(value.ja, 'ja', original),
  }
}
