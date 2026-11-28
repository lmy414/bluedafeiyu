import type { Locale } from '../lib/i18n';
import type { WorkPreview, WorkView } from '../lib/work-view';
import { clearComments, showComments } from './giscus';
import { reportWorkView, restoreCounts, showCounts } from './work-metrics';

export function isPlainClick(event: MouseEvent) {
  return event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

function initializeCanvas(bench: HTMLElement) {
  const stage = bench.querySelector<HTMLElement>('[data-view-stage]')!;
  const image = bench.querySelector<HTMLImageElement>('[data-view-image]')!;
  const reset = bench.querySelector<HTMLButtonElement>('[data-view-zoom="reset"]')!;
  let scale = 1;
  let x = 0;
  let y = 0;
  let drag: { id: number; x: number; y: number } | undefined;
  const pan = () => {
    const maxX = image.clientWidth * Math.max(0, scale - 1) / 2;
    const maxY = image.clientHeight * Math.max(0, scale - 1) / 2;
    x = Math.max(-maxX, Math.min(maxX, x));
    y = Math.max(-maxY, Math.min(maxY, y));
    stage.style.setProperty('--pan-x', `${x}px`);
    stage.style.setProperty('--pan-y', `${y}px`);
  };
  function zoom(value: number) {
    scale = Math.min(6, Math.max(0.5, value));
    x = y = 0;
    pan();
    stage.style.setProperty('--zoom', String(scale));
    stage.toggleAttribute('data-zoomed', scale > 1);
    reset.textContent = `${Math.round(scale * 100)}%`;
  }
  for (const button of bench.querySelectorAll<HTMLButtonElement>('[data-view-zoom]')) {
    button.addEventListener('click', () => zoom(button === reset ? 1 : scale * (button.dataset.viewZoom === 'in' ? 1.25 : 0.8)));
  }
  stage.addEventListener('wheel', event => {
    if (event.ctrlKey || document.activeElement !== stage) return;
    event.preventDefault();
    zoom(scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });
  image.addEventListener('dragstart', event => event.preventDefault());
  stage.addEventListener('pointerdown', event => {
    if (scale <= 1 || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX - x, y: event.clientY - y };
    stage.setPointerCapture(event.pointerId);
    stage.setAttribute('data-dragging', '');
  });
  stage.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    x = event.clientX - drag.x;
    y = event.clientY - drag.y;
    pan();
  });
  stage.addEventListener('lostpointercapture', () => {
    drag = undefined;
    stage.removeAttribute('data-dragging');
  });
  return () => zoom(1);
}

function setImage(image: HTMLImageElement, src: string, alt: string, width?: number, height?: number) {
  image.alt = alt;
  for (const [key, value] of [['width', width], ['height', height]] as const) {
    if (value) image.setAttribute(key, String(value)); else image.removeAttribute(key);
  }
  if (src) {
    if (image.getAttribute('src') !== src) image.src = src;
  } else image.removeAttribute('src');
  image.hidden = !src;
}

function preview(link: HTMLAnchorElement): WorkPreview | undefined {
  try {
    const item = JSON.parse(link.dataset.preview ?? '') as WorkPreview;
    if (item.slug && item.title && item.display && new URL(item.href, location.href).origin === location.origin) return item;
  } catch { /* Ordinary navigation is still available. */ }
}

export function initializeWorkbenches(toast: (message: string) => void) {
  const dialog = document.querySelector<HTMLDialogElement>('#preview-modal');
  for (const bench of document.querySelectorAll<HTMLElement>('[data-workbench]')) {
    const resetZoom = initializeCanvas(bench);
    const comments = bench.querySelector<HTMLElement>('[data-giscus-panel]')!;
    const isModal = dialog?.contains(bench);
    if (!isModal) {
      showComments(comments);
      restoreCounts(bench);
      if (bench.dataset.workSlug) reportWorkView(bench.dataset.workSlug, bench.dataset.workId, 'detail');
    }
    bench.querySelector('[data-work-comments]')?.addEventListener('click', event => {
      event.preventDefault();
      comments.focus({ preventScroll: true });
      comments.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    bench.querySelector<HTMLButtonElement>('[data-work-copy]')?.addEventListener('click', async event => {
      const trigger = event.currentTarget as HTMLButtonElement;
      if (!bench.dataset.workHref) return;
      const href = new URL(bench.dataset.workHref, location.href).href;
      try {
        await navigator.clipboard.writeText(href);
        toast(trigger.dataset.copied ?? '');
      } catch {
        const input = document.createElement('textarea');
        input.className = 'visually-hidden';
        input.value = href;
        bench.append(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        trigger.focus({ preventScroll: true });
        if (copied) toast(trigger.dataset.copied ?? '');
        else window.prompt(trigger.textContent?.trim(), href);
      }
    });
    if (dialog && isModal) initializePreview(dialog, bench, comments, resetZoom);
  }
}

function initializePreview(dialog: HTMLDialogElement, bench: HTMLElement, comments: HTMLElement, resetZoom: () => void) {
  const scroller = dialog.querySelector<HTMLElement>('.sheet-modal-scroll')!;
  const locale = bench.dataset.locale as Locale;
  const title = bench.querySelector<HTMLElement>('[data-view-title]')!;
  const image = bench.querySelector<HTMLImageElement>('[data-view-image]')!;
  const download = bench.querySelector<HTMLAnchorElement>('[data-download]')!;
  const counts = bench.querySelector<HTMLElement>('[data-work-counts]')!;
  const nav = bench.querySelector<HTMLElement>('[data-view-nav]')!;
  const prev = nav.querySelector<HTMLButtonElement>('[data-view-prev]')!;
  const next = nav.querySelector<HTMLButtonElement>('[data-view-next]')!;
  const position = nav.querySelector<HTMLElement>('[data-view-position]')!;
  const status = bench.querySelector<HTMLElement>('.wb-fetch-status')!;
  const message = status.querySelector<HTMLElement>('[role="status"]')!;
  const retry = status.querySelector<HTMLButtonElement>('[data-work-retry]')!;
  const related = bench.querySelector<HTMLElement>('[data-work-related]')!;
  const grid = related.querySelector('.wb-related-grid')!;
  const card = bench.querySelector<HTMLTemplateElement>('template[data-work-recommendation]')!.content.firstElementChild as HTMLAnchorElement;
  const historyKey = Math.random().toString(36).slice(2);
  const seeds = new Map<string, WorkPreview>();
  let sequence: WorkPreview[] = [];
  let current: WorkPreview | undefined;
  let detail: WorkView | undefined;
  let request: AbortController | undefined;
  let listTitle = document.title;
  let listScroll = 0;
  let closing = false;

  function updateNavigation() {
    const index = sequence.findIndex(item => item.slug === current?.slug);
    prev.disabled = index >= 0 ? index === 0 : !detail?.previous;
    next.disabled = index >= 0 ? index === sequence.length - 1 : !detail?.next;
    position.textContent = index >= 0 ? `${index + 1} / ${sequence.length}` : '';
    position.hidden = index < 0;
    nav.hidden = prev.disabled && next.disabled && index < 0;
  }

  function render(item: WorkPreview, full?: WorkView) {
    bench.dataset.workSlug = item.slug;
    bench.dataset.workId = item.id;
    bench.dataset.workHref = item.href;
    title.textContent = item.title;
    document.title = `${item.title} · ${bench.dataset.site}`;
    const metadata = { ...item, specs: full?.specs || '—' };
    for (const node of bench.querySelectorAll<HTMLElement>('[data-view-text]')) node.textContent = String(metadata[node.dataset.viewText as keyof typeof metadata] ?? '');
    for (const node of bench.querySelectorAll<HTMLElement>('[data-view-optional]')) node.hidden = !metadata[node.dataset.viewOptional as 'commentary' | 'description'];
    const links = { characterHref: item.characterHref, categoryHref: item.categoryHref, original: item.original };
    for (const link of bench.querySelectorAll<HTMLAnchorElement>('[data-view-link]')) {
      const href = links[link.dataset.viewLink as keyof typeof links];
      link.hidden = !href;
      if (href) link.href = href; else link.removeAttribute('href');
    }
    download.dataset.fileName = item.title;
    download.dataset.fileFormat = item.format ?? '';
    download.dataset.workSlug = item.slug;
    setImage(image, item.display, item.alt, item.displayWidth, item.displayHeight);
    showCounts(counts, item.slug, full);
    for (const group of bench.querySelectorAll<HTMLElement>('[data-work-group]')) {
      const key = group.dataset.workGroup as keyof WorkView['links'];
      const entries = full?.links[key] ?? (key === 'characters' && item.characterHref ? [{ label: item.character, href: item.characterHref }] : key === 'category' && item.categoryHref ? [{ label: item.category, href: item.categoryHref }] : []);
      group.hidden = !entries.length;
      group.querySelector('.wb-chips')!.replaceChildren(...entries.map(({ href, label }) => {
        const link = document.createElement('a');
        link.className = 'spec-tag';
        link.href = href;
        link.textContent = label;
        return link;
      }));
    }
    for (const row of bench.querySelectorAll<HTMLElement>('[data-work-fact]')) {
      const key = row.dataset.workFact as keyof WorkView['facts'];
      const fact = full?.facts[key];
      row.hidden = key === 'sourceNote' && !fact?.text;
      const value = row.querySelector<HTMLElement>('[data-fact-text]')!;
      value.textContent = fact?.text || '—';
      value.hidden = Boolean(fact?.href && !fact.linkLabel);
      value.toggleAttribute('data-fact-muted', key === 'license' && !fact?.external);
      const link = row.querySelector<HTMLAnchorElement>('[data-fact-link]')!;
      link.hidden = !fact?.href;
      if (fact?.href) link.href = fact.href; else link.removeAttribute('href');
      link.querySelector('[data-fact-label]')!.textContent = fact?.linkLabel || fact?.text || '';
      link.target = fact?.external ? '_blank' : '';
      link.rel = fact?.external ? 'noopener noreferrer' : '';
      for (const part of ['note', 'notice'] as const) {
        const node = row.querySelector<HTMLElement>(`[data-fact-${part}]`)!;
        node.textContent = fact?.[part] ?? '';
        node.hidden = !fact?.[part];
      }
    }
    related.hidden = !full?.recommendations.length;
    grid.replaceChildren(...(full?.recommendations ?? []).map(recommendation => {
      const link = card.cloneNode(true) as HTMLAnchorElement;
      link.href = recommendation.href;
      link.dataset.preview = JSON.stringify(recommendation);
      link.querySelector('.wb-rec-title')!.textContent = recommendation.title;
      setImage(link.querySelector('img')!, recommendation.thumb, recommendation.alt, recommendation.thumbWidth, recommendation.thumbHeight);
      return link;
    }));
    updateNavigation();
  }

  async function load(item: WorkPreview) {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    status.hidden = false;
    retry.hidden = true;
    message.textContent = message.dataset.loading ?? '';
    try {
      const [response, { workView }, { normalizeWorkDetail }, { prepareLocale }] = await Promise.all([
        fetch(`/api/v1/works/${encodeURIComponent(item.slug)}?lang=${locale}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) }),
        import('../lib/work-view'), import('../lib/api'), import('../lib/i18n'),
      ]);
      await prepareLocale(locale);
      const result = response.ok && normalizeWorkDetail(await response.json());
      if (controller.signal.aborted) return;
      if (!result || result.work.slug !== item.slug) throw new Error('Work details unavailable');
      const full = workView(locale, result);
      detail = full;
      render(full, full);
      showComments(comments, `sticker-${full.id}`, full.href);
      status.hidden = true;
    } catch {
      if (controller.signal.aborted) return;
      message.textContent = message.dataset.error ?? '';
      retry.hidden = false;
      if (item.id) showComments(comments, `sticker-${item.id}`, item.href);
    }
  }

  function open(item: WorkPreview, mode: 'push' | 'replace' | 'restore') {
    if (closing) return;
    seeds.set(item.href, item);
    if (mode === 'push') {
      listScroll = window.scrollY;
      listTitle = document.title;
      history.pushState({ workPreview: historyKey }, '', item.href);
    } else if (mode === 'replace') history.replaceState(history.state, '', item.href);
    current = item;
    detail = undefined;
    clearComments(comments);
    comments.removeAttribute('data-term');
    render(item);
    resetZoom();
    if (!dialog.open) dialog.showModal();
    scroller.scrollTop = 0;
    if (mode === 'replace') {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
    void load(item);
    reportWorkView(item.slug, item.id, 'preview');
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || !isPlainClick(event) || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[data-preview]');
    const selected = link && preview(link);
    if (!selected) return;
    event.preventDefault();
    if (dialog.open) {
      open(selected, 'replace');
      return;
    }
    const listing = link.closest('[data-work-listing]');
    const group = listing ?? document;
    const items = new Map<string, WorkPreview>();
    // Masonry preserves DOM order, including appended batches.
    for (const tile of group.querySelectorAll<HTMLAnchorElement>('.tile-link[data-preview]')) {
      const candidate = preview(tile);
      if (candidate) items.set(candidate.slug, candidate);
    }
    sequence = items.has(selected.slug) ? [...items.values()] : [selected, ...items.values()];
    open(selected, 'push');
  });

  const step = (direction: -1 | 1) => {
    const index = sequence.findIndex(item => item.slug === current?.slug);
    const candidate = index >= 0 ? sequence[index + direction] : undefined;
    if (candidate) open(candidate, 'replace');
    else if (index < 0) {
      const href = direction < 0 ? detail?.previous : detail?.next;
      if (!href) return;
      const match = detail?.recommendations.find(item => item.href === href) ?? seeds.get(href);
      if (match) open(match, 'replace');
      else {
        const slug = decodeURIComponent(href.split('/').at(-1)!.replace(/\.html$/, ''));
        open({ id: '', slug, href, title: bench.dataset.previewTitle ?? '', alt: '', description: '', commentary: '', character: '', category: '', characterHref: '', categoryHref: '', original: '', display: '', thumb: '', thumbWidth: undefined, thumbHeight: undefined, displayWidth: undefined, displayHeight: undefined, format: undefined }, 'replace');
      }
    }
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  retry.addEventListener('click', () => { if (current) void load(current); });
  dialog.addEventListener('keydown', event => {
    if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  });
  function closeViaHistory(event?: Event) {
    if (history.state?.workPreview !== historyKey) return;
    event?.preventDefault();
    if (!closing) {
      closing = true;
      history.back();
    }
  }
  dialog.querySelector('form[method="dialog"]')?.addEventListener('submit', closeViaHistory);
  dialog.addEventListener('cancel', closeViaHistory);
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    request?.abort();
    clearComments(comments);
    image.removeAttribute('src');
    const toastElement = dialog.querySelector<HTMLElement>('[data-toast]');
    if (toastElement) { toastElement.hidden = true; document.body.append(toastElement); }
    closeViaHistory();
  });
  window.addEventListener('popstate', event => {
    closing = false;
    if (event.state?.workPreview === historyKey) {
      const href = location.pathname;
      const item = seeds.get(href);
      if (item) open(item, 'restore');
      return;
    }
    if (!current) return;
    current = undefined;
    if (dialog.open) dialog.close();
    document.title = listTitle;
    requestAnimationFrame(() => window.scrollTo({ top: listScroll, behavior: 'instant' }));
  });
}
