export function workCharacterIds(record) {
  const values = Array.isArray(record.characterIds) ? record.characterIds : [record.characterId];
  return [...new Set(values.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
}
