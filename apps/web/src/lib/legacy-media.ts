import { apiBase, publicUrl } from './api';

const legacyPrefix = /^\/(?:dist\/)?(?:submissions|owner-picks|data\/blue-fish|character-portraits|creator-avatars|author-avatars|og)\//i;
const legacyFiles = new Set(['/qq-group.png', '/community/qq-1134100615-bc8e49b662df6b84.png']);

function redirectLocation(value: unknown, request: URL) {
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(value)) return;
  const rootRelative = value.startsWith('/') && !value.startsWith('//');
  const absolute = rootRelative ? new URL(value, request.origin) : /^https?:\/\/[^/]/i.test(value) ? publicUrl(value) : undefined;
  if (!absolute) return;
  const target = new URL(absolute);
  if (target.origin === request.origin && target.pathname === request.pathname) return;
  if (!rootRelative) return target.href;
  if (!target.pathname.startsWith('//')) return `${target.pathname}${target.search}${target.hash}`;
}

export async function legacyMediaResponse(url: URL, method: string) {
  if (method !== 'GET' && method !== 'HEAD') return;
  if (!legacyPrefix.test(url.pathname) && !legacyFiles.has(url.pathname)) return;
  const unavailable = () => new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    const upstream = new URL('/api/v1/legacy-media', apiBase());
    upstream.searchParams.set('path', url.pathname);
    const result = await fetch(upstream, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(3500) });
    if (result.status === 404) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    if (result.status !== 200) return unavailable();
    const payload = await result.json();
    const location = payload?.ok === true && payload.status === 301 && redirectLocation(payload.location, url);
    return location ? new Response(null, { status: 301, headers: { Location: location, 'Cache-Control': 'public, max-age=86400, s-maxage=604800' } }) : unavailable();
  } catch { return unavailable(); }
}
