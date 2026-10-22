// Older reviewed copy can contain literal translations of a confirmed role.
// Normalize that vocabulary only; uploader identities remain verbatim.
export function videoTerminology(text, language, characterIds = [], identities = []) {
  if (!characterIds.includes('deepseek') || language !== 'en') return text;
  const names = [...new Set(identities.filter(Boolean))].sort((a, b) => b.length - a.length);
  const parts = names.length ? String(text).split(new RegExp('(' + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g')) : [String(text)];
  return parts.map(part => names.includes(part) ? part : part.replace(/\b(?:(?:Big\s+)?Fat Fish|Blue Fish|Whale[ -]?(?:Chan|Girl))\b/gi, 'DeepSeek Chan')).join('');
}
