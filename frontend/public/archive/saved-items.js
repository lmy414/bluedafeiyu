const key = type => 'bluefish-demo:' + type;

export function readSaved(type, storage) {
  try {
    storage ??= globalThis.localStorage;
    const value = JSON.parse(storage.getItem(key(type)) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string'))] : [];
  } catch { return []; }
}

export function toggleSaved(type, id, storage) {
  storage ??= globalThis.localStorage;
  const values = new Set(readSaved(type, storage));
  const active = !values.has(id);
  if (active) values.add(id); else values.delete(id);
  storage.setItem(key(type), JSON.stringify([...values]));
  return active;
}

export function renderSaveButton(type, id, {translate = (_key, fallback) => fallback, className = ''} = {}) {
  const creator = type === 'creators';
  const labelKey = creator ? 'saveCreator' : 'saveWork';
  const label = translate('d.' + labelKey, creator ? '收藏作者' : '收藏作品');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  return `<button type="button" class="save-button ${className}" data-save="${escape(type)}" data-id="${escape(id)}" aria-label="${escape(label)}" aria-pressed="false" data-i18n-attr="aria-label:d.${labelKey}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 4c-3-3-6-1-8 1-2-2-5-4-8-1-3 3-1 7 8 15 9-8 11-12 8-15z"/></svg><span data-i18n="d.${labelKey}">${escape(label)}</span></button>`;
}
