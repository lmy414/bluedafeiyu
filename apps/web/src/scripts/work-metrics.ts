type Counts = { viewCount?: number; downloadCount?: number; viewed?: boolean };
const numbers = new Intl.NumberFormat(document.documentElement.lang);
const cached = new Map<string, Counts>();
const pendingViews = new Set<string>();
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const storageKey = (slug: string) => `dafeiyu-metrics:${slug}`;

declare global {
  interface Window {
    gtag?: (command: 'event', name: string, parameters: Record<string, string | number>) => void;
  }
}

export function trackAnalytics(name: 'work_view' | 'work_download' | 'topic_download', parameters: Record<string, string | number>) {
  const measurementId = document.documentElement.dataset.gaMeasurement;
  if (measurementId) window.gtag?.('event', name, { ...parameters, send_to: measurementId, transport_type: 'beacon' });
}

export function reportWorkView(slug: string, id: string | undefined, viewType: 'detail' | 'preview') {
  if (id) trackAnalytics('work_view', { work_id: id, view_type: viewType });
  void reportMetric(slug, 'view');
}

function readCounts(slug: string): Counts {
  const existing = cached.get(slug);
  if (existing) return existing;
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey(slug)) ?? 'null') as Counts | null;
    if (stored && isCount(stored.viewCount) && isCount(stored.downloadCount)) {
      cached.set(slug, stored);
      return stored;
    }
  } catch { /* In-memory metrics still apply. */ }
  return {};
}

export function showCounts(panel: HTMLElement, slug: string, initial?: Counts) {
  panel.dataset.workSlug = slug;
  const latest = readCounts(slug);
  for (const [name, selector] of [['viewCount', '[data-view-count]'], ['downloadCount', '[data-download-count]']] as const) {
    const recorded = initial?.[name];
    const count = Math.max(latest[name] ?? -1, isCount(recorded) ? recorded : -1);
    const element = panel.querySelector(selector);
    if (element) element.textContent = isCount(count) ? numbers.format(count) : '—';
  }
}

export function restoreCounts(scope: HTMLElement) {
  for (const panel of scope.querySelectorAll<HTMLElement>('[data-work-counts][data-work-slug]')) {
    const slug = panel.dataset.workSlug!;
    showCounts(panel, slug, { viewCount: Number(panel.dataset.initialViews), downloadCount: Number(panel.dataset.initialDownloads) });
  }
}

export async function reportMetric(slug: string, event: 'view' | 'download') {
  if (!slug) return;
  const view = event === 'view';
  if (view) {
    if (readCounts(slug).viewed || pendingViews.has(slug)) return;
    pendingViews.add(slug);
  }
  try {
    const response = await fetch(`/api/v1/works/${encodeURIComponent(slug)}/${event}`, { method: 'POST', keepalive: true });
    if (!response.ok) return;
    const counts = await response.json() as Counts & { slug?: string };
    if (!isCount(counts.viewCount) || !isCount(counts.downloadCount)) return;
    const prior = readCounts(slug);
    const latest = { viewCount: Math.max(prior.viewCount ?? 0, counts.viewCount), downloadCount: Math.max(prior.downloadCount ?? 0, counts.downloadCount), viewed: view || prior.viewed };
    cached.set(slug, latest);
    try { sessionStorage.setItem(storageKey(slug), JSON.stringify(latest)); } catch { /* The current document still remembers the counts. */ }
    for (const panel of document.querySelectorAll<HTMLElement>('[data-work-counts]')) {
      if (panel.dataset.workSlug === slug) showCounts(panel, slug);
    }
  } catch { /* A failed metrics request does not prevent viewing or downloading. */ }
  finally { if (view) pendingViews.delete(slug); }
}
