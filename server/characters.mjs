/* Strict boundary validation; legacy single-role records remain accepted. */
import { workCharacterIds } from '../tools/work-characters.mjs';
export function validateCharacterSelection(record, vocabulary, primaryKey = 'characterId') {
  const allowed = vocabulary instanceof Set ? vocabulary : new Set(vocabulary || []);
  const raw = Object.hasOwn(record, 'characterIds') ? record.characterIds : [record[primaryKey]];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > allowed.size) return { error: 'characterIds 必须是非空角色数组且不超过词表数量' };
  const ids = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !value.trim() || !allowed.has(value.trim())) return { error: 'characterIds 含非法角色' };
    const id = value.trim();
    if (ids.includes(id)) return { error: 'characterIds 出现重复角色' };
    ids.push(id);
  }
  const primary = record[primaryKey] === undefined ? ids[0] : record[primaryKey];
  if (typeof primary !== 'string' || !ids.includes(primary.trim())) return { error: '代表角色必须在 characterIds 中' };
  return { value: { characterId: primary.trim(), characterIds: ids } };
}

export function normalizedCharacterIds(record, primaryKey = 'characterId') {
  return workCharacterIds({ ...record, characterId: record[primaryKey] });
}
