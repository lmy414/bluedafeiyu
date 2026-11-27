const host = 'https://giscus.app';
const sessionKey = 'giscus-session';
const frames = new Map<HTMLIFrameElement, URL>();
let session = '';
let initialized = false;

export function clearComments(panel: HTMLElement) {
  const mount = panel.querySelector('[data-giscus-mount]');
  const frame = mount?.querySelector('iframe');
  if (frame) frames.delete(frame);
  mount?.replaceChildren();
}

export function updateGiscus(frame?: HTMLIFrameElement) {
  for (const item of frame ? [frame] : frames.keys()) {
    item.contentWindow?.postMessage({ giscus: { setConfig: { theme: document.documentElement.dataset.theme } } }, host);
  }
}

function initialize() {
  if (initialized) return;
  initialized = true;
  const current = new URL(location.href);
  const token = current.searchParams.get('giscus');
  try {
    if (token) localStorage.setItem(sessionKey, JSON.stringify(token));
    session = token ?? JSON.parse(localStorage.getItem(sessionKey) ?? '""') ?? '';
  } catch { session = token ?? ''; }
  if (token) {
    current.searchParams.delete('giscus');
    history.replaceState(history.state, '', current);
  }
  window.addEventListener('message', event => {
    if (event.origin !== host) return;
    const data = event.data?.giscus;
    if (!data) return;
    for (const [frame] of frames) {
      if (event.source !== frame.contentWindow) continue;
      const height = Number(data.resizeHeight);
      if (Number.isFinite(height) && height > 0) frame.style.height = `${height}px`;
      if (data.signOut || (session && typeof data.error === 'string' && /Bad credentials|Invalid state value|State has expired/.test(data.error))) {
        session = '';
        try { localStorage.removeItem(sessionKey); } catch { /* The widget can still be signed out. */ }
        for (const [active, url] of frames) {
          url.searchParams.delete('session');
          active.src = url.href;
        }
      }
      break;
    }
  });
}

export function showComments(panel: HTMLElement, term = panel.dataset.term, href = panel.dataset.href) {
  const mount = panel.querySelector<HTMLElement>('[data-giscus-mount]');
  if (!mount || !term) return;
  if (panel.dataset.term === term && mount.querySelector('iframe')) return;
  initialize();
  clearComments(panel);
  panel.dataset.term = term;
  const back = new URL(href || location.pathname, location.origin);
  const lang = panel.dataset.lang ?? 'en';
  const widget = new URL(`/${lang}/widget`, host);
  widget.search = new URLSearchParams({
    origin: back.href, backLink: back.href, term,
    repo: 'lmy414/lmy414-blog-comments', repoId: 'R_kgDOTUvnVw',
    category: 'Announcements', categoryId: 'DIC_kwDOTUvnV84DF4fs',
    theme: document.documentElement.dataset.theme ?? 'light',
    reactionsEnabled: '1', emitMetadata: '0', inputPosition: 'bottom', strict: '0',
    ...(session ? { session } : {}),
  }).toString();
  const frame = document.createElement('iframe');
  frame.className = 'giscus-frame';
  frame.title = mount.dataset.title ?? 'Comments';
  frame.allow = 'clipboard-write';
  frame.src = widget.href;
  frame.addEventListener('load', () => updateGiscus(frame));
  frames.set(frame, widget);
  mount.append(frame);
}
