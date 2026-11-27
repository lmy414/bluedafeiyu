import type { AdminEvent, Page } from './models';

const prefix = '/api/v1/admin';
const loginPath = '/admin/login';

export type Query = Record<string, string | number | boolean | undefined>;
type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
};

function responseMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const message = responseMessage(record.message) || responseMessage(record.error);
  const issues = record.issues ?? record.details;
  if (!Array.isArray(issues)) return message;
  const fields = issues.map((item: unknown) => {
    if (!item || typeof item !== 'object') return responseMessage(item);
    const issue = item as Record<string, unknown>;
    const path = Array.isArray(issue.path) ? issue.path.join('.') : issue.path;
    return [path, issue.message].filter(Boolean).join(' ');
  }).filter(Boolean);
  return [message, ...fields].filter(Boolean).join(' · ');
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${prefix}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const multipart = options.body instanceof FormData;
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    method: options.method ?? 'GET',
    signal: options.signal,
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}),
    },
    body: multipart ? options.body as FormData : JSON.stringify(options.body),
  });
  if (response.status === 401 && window.location.pathname.replace(/\/$/, '') !== loginPath) {
    const next = window.location.pathname + window.location.search;
    window.location.replace(`${loginPath}?${new URLSearchParams({ next })}`);
  }
  if (response.status === 204) return undefined as T;

  const json = response.headers.get('content-type')?.includes('json');
  const payload: unknown = json ? await response.json() : undefined;
  if (!response.ok) {
    throw new ApiError(response.status, responseMessage(payload) || `请求失败（HTTP ${response.status}）`);
  }
  if (!json) throw new ApiError(response.status, '后台接口未返回 JSON，请检查 API 路由');
  return payload as T;
}

export function recordPath(resource: string, id: string): string {
  return `/${resource}/${encodeURIComponent(id)}`;
}

type EventBody = Omit<AdminEvent, 'id'>;

export const adminApi = Object.assign(request, {
  events: (signal?: AbortSignal) => request<Page<AdminEvent>>('/events', { signal }),
  createEvent: (body: EventBody) => request<AdminEvent>('/events', { method: 'POST', body }),
  updateEvent: (id: string, body: Partial<EventBody>) => request<AdminEvent>(recordPath('events', id), { method: 'PATCH', body }),
  deleteEvent: (id: string) => request(recordPath('events', id), { method: 'DELETE' }),
});

export function loginReturnPath(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next?.startsWith('/admin/')) return '/';
  const target = new URL(next, window.location.origin);
  if (target.origin !== window.location.origin || !target.pathname.startsWith('/admin/')) return '/';
  const path = target.pathname.slice('/admin'.length);
  return /^\/login\/?$/.test(path) || path.startsWith('//') ? '/' : `${path}${target.search}${target.hash}`;
}
