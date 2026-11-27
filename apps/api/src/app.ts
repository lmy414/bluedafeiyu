import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { getMimeType } from 'hono/utils/mime';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { ApiError } from './errors.js';
import { createAdminAuth } from './routes/admin/auth.js';
import { createAdminRoutes } from './routes/admin/index.js';
import { createHermesRoutes } from './routes/hermes/index.js';
import { createCatalogRoutes } from './routes/public/catalog.js';
import { createLegacyMediaRoutes } from './routes/public/legacy-media.js';
import { createOpenApiRoutes } from './routes/public/open-api.js';
import { createSubmissionRoutes } from './routes/public/submissions.js';
import { createPublicWorkRoutes } from './routes/public/works.js';
import { writeAudit } from './services/audit.js';
import type { AuditEntry } from './services/audit.js';
import { createCloudflare } from './services/cloudflare.js';
import { createFeishu } from './services/feishu.js';
import { inspectImage, prepareImage } from './services/image.js';
import { createPublisher } from './services/publish.js';
import { createR2 } from './services/r2.js';
import { createRateLimiter } from './services/ratelimit.js';
import { createTurnstile } from './services/turnstile.js';

export function createServices(db: Database, config: Config) {
  const r2 = createR2(config);
  const cloudflare = createCloudflare(config);
  const feishu = createFeishu(db, config);
  const publish = createPublisher({ db, config, r2, cloudflare, feishu });
  const auth = createAdminAuth(db, config);
  return { r2, cloudflare, feishu, publish, auth, authenticateAdmin: auth.authenticateAdmin,
    image: { inspectImage, prepareImage }, audit: (entry: AuditEntry) => writeAudit(db, entry),
    turnstile: createTurnstile(config.TURNSTILE_SECRET_KEY), submissionLimit: createRateLimiter() };
}

export type Services = ReturnType<typeof createServices>;
export interface AppContext { db: Database; config: Config; services: Services }
export type AppDependencies = Pick<AppContext, 'db' | 'config'> & { services?: Partial<Services> };

function within(root: string, path: string) {
  const portion = relative(root, path);
  return portion !== '..' && !portion.startsWith(`..${sep}`) && !isAbsolute(portion);
}

async function staticAdmin(request: Request, dist: string): Promise<Response> {
  const url = new URL(request.url);
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname.slice('/admin'.length)).replace(/^\/+/, ''); }
  catch { return new Response('Not found', { status: 404 }); }
  if (pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('\0')) return new Response('Not found', { status: 404 });
  const root = await realpath(resolve(dist)).catch(() => null);
  if (!root) return new Response('Not found', { status: 404 });
  const read = async (key: string) => {
    const path = await realpath(resolve(root, key)).catch(() => null);
    if (!path || !within(root, path)) return null;
    const entry = await stat(path).catch(() => null);
    if (!entry?.isFile()) return null;
    const headers = { 'Content-Type': getMimeType(path) ?? 'application/octet-stream', 'Content-Length': String(entry.size), 'Cache-Control': 'no-store' };
    const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    return new Response(body, { headers });
  };
  const file = pathname && await read(pathname);
  if (file) return file;
  if (pathname.startsWith('assets/') || (pathname.split('/').at(-1)?.includes('.'))) return new Response('Not found', { status: 404 });
  return await read('index.html') ?? new Response('Not found', { status: 404 });
}

export function createApp(deps: AppDependencies) {
  const { db, config } = deps;
  const defaults = createServices(db, config);
  const services = { ...defaults, ...deps.services };
  if (deps.services?.auth && !deps.services.authenticateAdmin) services.authenticateAdmin = deps.services.auth.authenticateAdmin;
  if (!deps.services?.publish && (deps.services?.r2 || deps.services?.cloudflare || deps.services?.feishu)) {
    services.publish = createPublisher({ db, config, r2: services.r2, cloudflare: services.cloudflare, feishu: services.feishu });
  }
  const ctx: AppContext = { db, config, services };
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ ok: false, error: error.code, message: error.message, details: error.details }, error.status);
    if (error instanceof ZodError) return c.json({ ok: false, error: 'invalid_input', message: '输入字段无效', details: error.issues }, 422);
    const code = error.cause && typeof error.cause === 'object' && 'code' in error.cause ? error.cause.code : 'code' in error ? error.code : undefined;
    if (code === '23503' || code === '23505') {
      return c.json({ ok: false, error: 'record_conflict', message: '记录重复或仍被其他记录引用' }, 409);
    }
    console.error('API request failed', c.req.method, c.req.path, error);
    return c.json({ ok: false, error: 'internal_error', message: '请求处理失败' }, 500);
  });
  app.notFound(c => c.json({ ok: false, error: 'not_found', message: '接口不存在' }, 404));
  for (const path of ['/admin', '/admin/*', '/api/v1/admin/*', '/api/v1/submissions', '/api/v1/submissions/*']) {
    app.use(path, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  }
  for (const path of ['/health', '/api/v1/health']) app.get(path, c => c.json({ ok: true }));
  app.route('/api/v1', createPublicWorkRoutes(ctx));
  app.route('/api/v1', createCatalogRoutes(ctx));
  app.route('/api/v1', createLegacyMediaRoutes(ctx));
  app.route('/api/v1', createSubmissionRoutes(ctx));
  app.route('/open-api/v1', createOpenApiRoutes(ctx));
  app.route('/api/v1/admin', createAdminRoutes(ctx));
  app.route('/', createHermesRoutes(ctx));
  const dist = config.ADMIN_DIST_DIR;
  if (dist) app.get('/admin', c => staticAdmin(c.req.raw, dist)).get('/admin/*', c => staticAdmin(c.req.raw, dist));
  return app;
}
