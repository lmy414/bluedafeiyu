import { Hono } from 'hono';
import type { Context } from 'hono';
import { adminAgent } from './admin.js';
import type { HermesContext } from './context.js';
import { qqInbound } from './intake.js';
import { json, ProtocolError, readBody, sameToken } from './protocol.js';
import { requestAgent } from './request.js';
import { submissionAgent } from './submission.js';
import { topicUpsert } from './topics.js';
import { videoAgent } from './video.js';

export type { HermesContext } from './context.js';

export function createHermesRoutes(ctx: HermesContext) {
  const app = new Hono();
  const worker = (request: Request, submission = false) => {
    const token = submission ? ctx.config.HERMES_REVIEW_TOKEN || process.env.SUBMISSION_HERMES_REVIEW_TOKEN : ctx.config.ADMIN_WORKER_TOKEN;
    if (!token) return json({ ok: false, error: submission ? 'internal review not configured' : 'worker token not configured' }, 503);
    if (!sameToken(request.headers.get('authorization'), token)) {
      const response = json({ ok: false, error: 'unauthorized' }, 401);
      if (submission) response.headers.set('WWW-Authenticate', 'Bearer');
      return response;
    }
    return null;
  };
  const handle = async (run: () => Promise<Response>, options: { fallback?: number; bare?: boolean } = {}) => {
    try { return await run(); }
    catch (error) {
      const value = error as { status?: number; message?: string; path?: string; details?: { path?: (string | number)[] }[] };
      const status = value.status || options.fallback || 500;
      if (!(error instanceof ProtocolError) && status >= 500) console.error('Hermes request failed', error);
      const message = status === 500 && !(error instanceof ProtocolError) ? '请求处理失败' : value.message || '请求处理失败';
      const issuePath = Array.isArray(value.details) ? value.details[0]?.path : undefined;
      return json(options.bare ? { error: message } : { ok: false, error: message, path: value.path || (Array.isArray(issuePath) ? issuePath.join('.') : null) }, status);
    }
  };
  app.post('/api/v1/internal/agent', (c: Context) => handle(async () => worker(c.req.raw, true) || submissionAgent(ctx, await readBody(c.req.raw))));
  app.post('/cms-api/agent', (c: Context) => handle(async () => worker(c.req.raw) || adminAgent(ctx, await readBody(c.req.raw))));
  app.post('/cms-api/video-agent', (c: Context) => handle(async () => worker(c.req.raw) || videoAgent(ctx, await readBody(c.req.raw)), { fallback: 502, bare: true }));
  app.post('/cms-api/request-agent', (c: Context) => handle(async () => worker(c.req.raw) || requestAgent(ctx, await readBody(c.req.raw), c.req.raw.headers.get('x-github-read-token'))));
  app.post('/cms-api/submissions/sync', (c: Context) => handle(async () => {
    const denied = worker(c.req.raw);
    if (denied) return denied;
    await readBody(c.req.raw);
    return json({ ok: true, status: 'ok', synced: 0, errors: [] });
  }));
  app.post('/api/v1/adapters/qq/events', (c: Context) => handle(() => qqInbound(ctx, c.req.raw)));
  app.post('/cms-api/topics/upsert', (c: Context) => handle(() => topicUpsert(ctx, c.req.raw)));
  return app;
}
