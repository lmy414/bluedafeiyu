function storageHas(key: string): boolean {
  try { if (localStorage.getItem(key) !== null) return true; } catch { /* Try the session instead. */ }
  try { return sessionStorage.getItem(key) !== null; } catch { return false; }
}

function storeSeen(key: string) {
  try { localStorage.setItem(key, '1'); } catch {
    try { sessionStorage.setItem(key, '1'); } catch { /* Storage can be disabled. */ }
  }
}

export function initializeEventModal() {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-event-promo]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const { dataset } = dialog;
  const preview = dataset.preview !== undefined;
  const key = `dafeiyu:event-popup:v1:${dataset.eventId}:${dataset.popupVersion || '1'}`;
  if (!preview && dataset.eventsPage !== undefined) {
    storeSeen(key);
    return;
  }
  if (!preview && storageHas(key)) return;

  window.setTimeout(() => {
    if (document.querySelector('dialog[open]')) return;
    if (!preview && (storageHas(key) || (dataset.endsAt && Date.now() > Date.parse(dataset.endsAt)))) return;
    dialog.showModal();
    if (!preview) storeSeen(key);
  }, preview ? 200 : 450);

  dialog.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('a[href]')) dialog.close();
  });
}
