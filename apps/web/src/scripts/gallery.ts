import { initializeSelects } from './ui-select';

import { initializeWorkbenches, isPlainClick } from './workbench';
import { initializeReader } from './comic-reader';
import { reportMetric, trackAnalytics } from './work-metrics';
import { updateGiscus } from './giscus';

type PackFile = { original: string; name: string; format?: string };

const root = document.documentElement;
const search = document.querySelector<HTMLInputElement>('[data-global-search]');
const previewDialog = document.querySelector<HTMLDialogElement>('#preview-modal');
const navigation = document.querySelector<HTMLDialogElement>('#mobile-navigation');
const themeButtons = document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let toastTimer = 0;

function recoverImage(element: EventTarget | null) {
  if (!(element instanceof HTMLImageElement) || !element.matches('[data-video-cover], [data-fallback-image]')) return;
  const fallback = element.dataset.fallbackSrc;
  if (fallback && element.src !== new URL(fallback, location.href).href) element.src = fallback;
  else element.hidden = true;
}
document.addEventListener('error', (event) => recoverImage(event.target), true);
for (const image of document.querySelectorAll<HTMLImageElement>('[data-video-cover], [data-fallback-image]')) {
  if (image.complete && !image.naturalWidth) recoverImage(image);
}

function toast(message: string, fallback?: string) {
  const element = document.querySelector<HTMLElement>('[data-toast]');
  if (!element) return;
  (previewDialog?.open ? previewDialog : document.body).append(element);
  element.replaceChildren(message);
  if (fallback) {
    const link = document.createElement('a');
    link.href = fallback;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = document.body.dataset.openOriginal ?? fallback;
    element.append(' ', link);
  }
  element.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { element.hidden = true; }, 5000);
}

function setTheme(theme: 'light' | 'dark') {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  for (const control of themeButtons) control.setAttribute('aria-pressed', String(theme === 'dark'));
  updateGiscus();
}

let explicitTheme: string | null = null;
try { explicitTheme = localStorage.getItem('dafeiyu-theme'); } catch { /* Preferences are still active for this page. */ }
setTheme(root.dataset.theme === 'dark' ? 'dark' : 'light');
for (const control of themeButtons) {
  control.hidden = false;
  control.addEventListener('click', () => {
    const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    explicitTheme = theme;
    try { localStorage.setItem('dafeiyu-theme', theme); } catch { /* This page still updates. */ }
    setTheme(theme);
  });
}
systemTheme.addEventListener('change', (event) => {
  if (explicitTheme !== 'light' && explicitTheme !== 'dark') setTheme(event.matches ? 'dark' : 'light');
});
window.addEventListener('storage', (event) => {
  if (event.key !== 'dafeiyu-theme') return;
  explicitTheme = event.newValue;
  setTheme(explicitTheme === 'light' || explicitTheme === 'dark' ? explicitTheme : systemTheme.matches ? 'dark' : 'light');
});
const navButton = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
navButton?.addEventListener('click', () => navigation?.showModal());
window.matchMedia('(min-width: 900px)').addEventListener('change', (event) => {
  if (event.matches && navigation?.open) navigation.close();
});

if (!('closedBy' in HTMLDialogElement.prototype)) {
  for (const modal of document.querySelectorAll<HTMLDialogElement>('dialog[closedby="any"]')) {
    const outside = (event: PointerEvent) => {
      const rect = modal.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    let pressedOutside = false;
    modal.addEventListener('pointerdown', (event) => { pressedOutside = outside(event); });
    modal.addEventListener('pointerup', (event) => { if (pressedOutside && outside(event)) modal.close(); });
  }
}

const menus = document.querySelectorAll<HTMLDetailsElement>('[data-disclosure]');
function closeMenus(except?: HTMLElement) {
  for (const menu of menus) if (menu.open && menu !== except) menu.open = false;
}
document.addEventListener('click', (event) => {
  if (event.target instanceof Element && !event.target.closest('[data-disclosure]')) closeMenus();
});
for (const menu of menus) menu.addEventListener('toggle', () => { if (menu.open) closeMenus(menu); });
for (const form of document.querySelectorAll<HTMLFormElement>('[data-auto-filter]')) {
  form.addEventListener('change', event => { if (!(event.target instanceof HTMLSelectElement && event.target.multiple) && !(event.target instanceof HTMLInputElement)) form.requestSubmit(); });
}
initializeSelects();
document.addEventListener('keydown', event => {
  if (event.key !== ' ' || !(event.target instanceof HTMLAnchorElement) || !event.target.matches('.creation-toggle[role="button"]')) return;
  event.preventDefault();
  if (!event.repeat) event.target.click();
});
root.classList.add('js');

const gallery = document.querySelector<HTMLElement>('[data-work-listing]');
const grid = gallery?.querySelector<HTMLElement>('.gallery-grid');
let loadingPage = false;
gallery?.addEventListener('click', async (event) => {
  if (!isPlainClick(event) || !(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>('[data-work-more]');
  const message = gallery.querySelector<HTMLElement>('[data-work-status]');
  if (!link || !grid || !message) return;
  event.preventDefault();
  if (loadingPage) return;
  loadingPage = true;
  link.setAttribute('aria-disabled', 'true');
  message.textContent = message.dataset.loading ?? '';
  try {
    const response = await fetch(link.href, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Page unavailable');
    const nextPage = new DOMParser().parseFromString(await response.text(), 'text/html');
    const tiles = [...nextPage.querySelectorAll<HTMLElement>('[data-work-listing] > .gallery-grid > [data-work-card]')];
    if (!tiles.length) throw new Error('Missing page');
    const start = grid.childElementCount;
    for (const [index, tile] of tiles.entries()) {
      tile.dataset.order = String(start + index);
      for (const image of tile.querySelectorAll<HTMLImageElement>('img')) image.loading = 'lazy';
    }
    const replacement = nextPage.querySelector<HTMLAnchorElement>('[data-work-more]');
    const keepFocus = link === gallery.ownerDocument.activeElement;
    grid.append(...tiles);
    grid.dispatchEvent(new Event('masonry:append'));
    if (replacement) link.href = new URL(replacement.getAttribute('href') ?? '', response.url).href;
    else link.remove();
    if (keepFocus) tiles[0]?.querySelector<HTMLAnchorElement>('.tile-link')?.focus({ preventScroll: true });
    message.textContent = message.dataset.loaded ?? '';
  } catch {
    message.textContent = message.dataset.error ?? '';
  } finally {
    loadingPage = false;
    link.removeAttribute('aria-disabled');
  }
});

initializeWorkbenches(toast);
const reader = document.querySelector<HTMLElement>('[data-reader]');
if (reader) initializeReader(reader);

function typing(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input,textarea,select')));
}

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
  if (previewDialog?.open) return;
  if (event.key === 'Escape') {
    const activeMenu = [...menus].find((menu) => menu.open);
    if (activeMenu) {
      event.preventDefault();
      activeMenu.open = false;
      activeMenu.querySelector('summary')?.focus();
    } else if (document.activeElement === search && search?.value) {
      event.preventDefault();
      search.value = '';
    }
    return;
  }
  if (navigation?.open || typing(event.target)) return;
  if (event.key === '/' && search) { event.preventDefault(); search.focus(); search.select(); }
  const direction = event.key === 'ArrowLeft' ? 'prev' : event.key === 'ArrowRight' ? 'next' : '';
  const readerLink = direction && document.querySelector<HTMLAnchorElement>(`[data-reader] a[rel="${direction}"][href], main [data-workbench] a[rel="${direction}"][href]`);
  if (readerLink) { event.preventDefault(); location.assign(readerLink.href); }
});

function safeName(value: string) {
  const name = value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  return (name && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? Array.from(name).slice(0, 110).join('') : `image${name ? `-${name}` : ''}`);
}

function filename(name: string, url: string, format?: string) {
  const extension = /\.([a-z\d]{2,6})$/i.exec(new URL(url).pathname)?.[1] ?? (/^[a-z\d]{2,6}$/i.test(format ?? '') ? format : undefined);
  const clean = safeName(name);
  return extension && !clean.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? `${clean}.${extension}` : clean;
}

function downloadBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

const activeDownloads = new WeakSet<HTMLAnchorElement>();
document.addEventListener('click', async (event) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>('[data-download]');
  if (!link?.href) return;
  const id = link.closest<HTMLElement>('[data-work-id]')?.dataset.workId;
  if (id && !activeDownloads.has(link)) trackAnalytics('work_download', { work_id: id });
  if (!isPlainClick(event)) return;
  event.preventDefault();
  if (activeDownloads.has(link)) return;
  activeDownloads.add(link);
  link.setAttribute('aria-busy', 'true');
  const { href, dataset } = link;
  if (dataset.workSlug) void reportMetric(dataset.workSlug, 'download');
  const name = filename(dataset.fileName ?? '', href, dataset.fileFormat);
  try {
    const response = await fetch(href, { credentials: 'omit', signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error('Original unavailable');
    downloadBlob(await response.blob(), name);
  } catch {
    toast(document.body.dataset.downloadFail ?? '', href);
  } finally {
    activeDownloads.delete(link);
    link.removeAttribute('aria-busy');
  }
});

for (const section of document.querySelectorAll<HTMLElement>('[data-zip]')) {
  const start = section.querySelector<HTMLButtonElement>('[data-zip-start]')!;
  const cancel = section.querySelector<HTMLButtonElement>('[data-zip-cancel]')!;
  const controls = section.querySelector<HTMLElement>('[data-zip-controls]')!;
  const progress = section.querySelector<HTMLProgressElement>('progress')!;
  const status = section.querySelector<HTMLElement>('[data-zip-status]')!;
  let controller: AbortController | undefined;
  cancel.addEventListener('click', () => controller?.abort());
  start.addEventListener('click', async () => {
    if (controller) return;
    controller = new AbortController();
    const { signal } = controller;
    start.disabled = true;
    controls.hidden = false;
    progress.value = 0;
    status.textContent = section.dataset.loading ?? '';
    try {
      const entries = JSON.parse(section.dataset.files ?? '[]') as PackFile[];
      const { Zip, ZipPassThrough } = await import('fflate');
      const chunks: ArrayBuffer[] = [];
      const zip = new Zip((error, bytes, final) => {
        if (error) throw error;
        chunks.push(Uint8Array.from(bytes).buffer);
        if (final && !signal.aborted) {
          downloadBlob(new Blob(chunks, { type: 'application/zip' }), `${safeName(section.dataset.name ?? '')}.zip`);
          if (section.dataset.topicId) trackAnalytics('topic_download', { topic_id: section.dataset.topicId, image_count: entries.length, failed_count: 0 });
        }
      });
      const usedNames = new Set<string>();
      for (const [index, file] of entries.entries()) {
        signal.throwIfAborted();
        const reply = await fetch(file.original, { credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) });
        if (!reply.ok || !reply.body) throw new Error('Original unavailable');
        const name = filename(file.name, file.original, file.format);
        const extension = /\.[^.]+$/.exec(name)?.[0] ?? '';
        const stem = extension ? name.slice(0, -extension.length) : name;
        let unique = name;
        for (let copy = 2; usedNames.has(unique.toLowerCase()); copy++) unique = `${stem} (${copy})${extension}`;
        usedNames.add(unique.toLowerCase());
        const entry = new ZipPassThrough(unique);
        zip.add(entry);
        const reader = reply.body.getReader();
        try {
          for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            signal.throwIfAborted();
            entry.push(chunk.value);
          }
          entry.push(new Uint8Array(), true);
        } finally {
          reader.releaseLock();
        }
        progress.value = index + 1;
        status.textContent = `${index + 1} / ${entries.length}`;
      }
      signal.throwIfAborted();
      zip.end();
      status.textContent = section.dataset.ready ?? '';
    } catch {
      status.textContent = (signal.aborted ? section.dataset.cancelled : section.dataset.error) ?? '';
    } finally {
      controller = undefined;
      controls.hidden = true;
      start.disabled = false;
    }
  });
}

if (document.querySelector('[data-submit]')) void import('./submission').then(({ initializeSubmission }) => initializeSubmission());
