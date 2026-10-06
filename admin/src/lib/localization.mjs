import crypto from 'node:crypto';

export const LOCALE_FIELDS = ['name','description','commentary','tags','seoTitle','seoDescription','faq','originNote','licenseNote'];
export function sourceText(work) {
  return { name: work.name || '', description: work.description || '', commentary: work.commentary || '', tags: work.tags || [], characterId: work.characterId, categoryIds: work.categoryIds || [], originNote: work.origin?.note || '', licenseNote: work.license?.note || '' };
}
export function sourceHash(work) { return crypto.createHash('sha256').update(JSON.stringify(sourceText(work))).digest('hex'); }
export function validateI18n(value, original) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!['en','ja','sourceHash'].includes(k))) throw Error('Invalid i18n object');
  for (const language of ['en','ja']) {
    const entry=value[language];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(k=>!LOCALE_FIELDS.includes(k))) throw Error('Invalid '+language+' fields');
    for (const key of LOCALE_FIELDS.filter(k=>!['tags','faq'].includes(k))) {
      if (typeof entry[key] !== 'string' || (['name','seoTitle','seoDescription'].includes(key) && !entry[key].trim()) || entry[key].length>2500) throw Error('Invalid '+language+'.'+key);
    }
    if (!Array.isArray(entry.tags) || entry.tags.length !== (original.tags || []).length || entry.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>80)) throw Error('Invalid '+language+' tag alignment');
    if (!Array.isArray(entry.faq) || entry.faq.length!==2 || entry.faq.some(q=>!q || Object.keys(q).some(k=>!['question','answer'].includes(k)) || ['question','answer'].some(k=>typeof q[k]!=='string'||!q[k].trim()||q[k].length>1500))) throw Error('Invalid '+language+' FAQ');
    const prose=LOCALE_FIELDS.filter(k=>!['tags','faq'].includes(k)).map(k=>entry[k]).concat(entry.tags,entry.faq.flatMap(q=>[q.question,q.answer])).join(' ');
    const namesOnly=prose.replace(/\b(?:DeepSeek|Claude|GPT|Gemini|Qwen|Kimi|Doubao|Grok|GLM|StepFun|MiMo) Chan\b/g,'');
    if (/Whale[ -]?Chan/i.test(namesOnly) || /Blue Fish|Fat Fish|鯨娘|鲸娘|鲸鱼娘/.test(namesOnly) || /\b(?:DeepSeek|Claude|GPT|Gemini|Qwen|Kimi|Doubao|Grok|GLM|StepFun|MiMo)[- ]chan\b/i.test(namesOnly)) throw Error('Wrong character terminology');
    if(language==='en' && /whale[ -]?girl/i.test(entry.name) && !entry.name.includes('DeepSeek Chan')) throw Error('Whale alias used as title name');
    if (language==='en' && /[\u3400-\u9fff]/u.test(prose)) throw Error('Chinese left in English prose');
    if (language==='ja' && /鲸|蓝|这|图|们|什么|机翻/u.test(prose)) throw Error('Simplified Chinese left in Japanese prose');
    if (/(?:javascript|vbscript|data)\s*:|\bon[a-z]+\s*=|<\/?[A-Za-z!]|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(prose)) throw Error('Unsafe localized prose');
  }
  return { en:value.en, ja:value.ja };
}
