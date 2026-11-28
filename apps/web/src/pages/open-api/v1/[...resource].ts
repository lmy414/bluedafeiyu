import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';

export const GET: APIRoute = async ({ params, request }) => {
  const resource = params.resource;
  if (!resource || !/^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*\.json$/u.test(resource)) return new Response(null, { status: 404 });
  try {
    const headers = new Headers({ Accept: 'application/json' });
    const etag = request.headers.get('If-None-Match');
    if (etag) headers.set('If-None-Match', etag);
    const upstream = await fetch(new URL(`/open-api/v1/${resource.split('/').map(encodeURIComponent).join('/')}`, apiBase()), { headers, redirect: 'error', signal: AbortSignal.timeout(6000) });
    const responseHeaders = new Headers();
    for (const key of ['Content-Type', 'Cache-Control', 'ETag', 'Access-Control-Allow-Origin']) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders.set(key, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
};
