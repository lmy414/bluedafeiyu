import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { locales } from '../../../lib/i18n';
import { loadWork } from '../../../lib/page-data';

const routes = new Set(['submissions', 'submissions/zip', 'creators']);
const failure = (status: number) => Response.json({ ok: false }, { status, headers: { 'Cache-Control': 'no-store' } });
const workRoute = /^works\/([^/]{1,200})(?:\/(view|download))?$/;
const validWork = (id: string) => id !== '.' && id !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(id);

export const GET: APIRoute = async ({ params, url }) => {
  const [, id, operation] = workRoute.exec(params.publicAction ?? '') ?? [];
  if (!id || operation || !validWork(id)) return failure(404);
  const lang = url.searchParams.get('lang');
  const result = await loadWork(locales.find(locale => locale === lang) ?? 'zh', id);
  return result.ok ? Response.json(result.value, { headers: { 'Cache-Control': 'no-store' } }) : failure(result.status);
};

export const POST: APIRoute = async ({ params, request, url, clientAddress }) => {
  const action = params.publicAction;
  const [, id, operation] = workRoute.exec(action ?? '') ?? [];
  const metric = id && operation && validWork(id);
  if (!action || !metric && !routes.has(action)) return failure(404);
  const origin = request.headers.get('Origin');
  if (origin !== url.origin) return failure(403);
  const headers = new Headers({ Accept: 'application/json', Origin: origin });
  if (metric) {
    const agent = request.headers.get('User-Agent');
    if (agent) headers.set('User-Agent', agent);
    headers.set('X-Forwarded-For', request.headers.get('X-Forwarded-For') || clientAddress);
    try {
      const upstream = await fetch(new URL(`/api/v1/works/${encodeURIComponent(id)}/${operation}`, apiBase()), {
        method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(3500),
      });
      return new Response(upstream.body, { status: upstream.status, headers: { 'Cache-Control': 'no-store', 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' } });
    } catch { return failure(503); }
  }
  const contentType = request.headers.get('Content-Type');
  const contentLength = request.headers.get('Content-Length');
  if (contentType) headers.set('Content-Type', contentType);
  if (contentLength) headers.set('Content-Length', contentLength);
  try {
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST', headers, body: request.body, duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(120_000),
    };
    const upstream = await fetch(new URL(`/api/v1/${action}`, apiBase()), init);
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' });
    const retry = upstream.headers.get('Retry-After');
    if (retry) responseHeaders.set('Retry-After', retry);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return failure(503); }
};
