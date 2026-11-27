import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import { adminUsers } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { writeAudit } from '../../services/audit.js';
import { clientIp, createRateLimiter } from '../../services/ratelimit.js';
import { boundedJson } from '../body.js';
import { peerIp } from '../public/submissions.js';

const COOKIE = 'dafeiyu_admin';
const MAX_AGE = 12 * 60 * 60;
const DUMMY_HASH = `scrypt:${Buffer.alloc(16).toString('hex')}:${Buffer.alloc(64).toString('hex')}`;
const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived));
});
export const ownerEmail = z.email().max(254).transform(value => value.toLowerCase());
export const ownerPassword = z.string().min(12).max(256);
export const apiTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/.exec(stored);
  if (!match?.[1] || !match[2] || password.length > 256) return false;
  return safeEqual(await derive(password, Buffer.from(match[1], 'hex')), Buffer.from(match[2], 'hex'));
}

const publicUser = { id: adminUsers.id, email: adminUsers.email, role: adminUsers.role };
const sessionSignature = (secret: string, value: string) => createHmac('sha256', secret).update(`admin-session-v1:${value}`).digest();

export function createAdminAuth(db: Database, config: Config) {
  const signSession = (id: string) => {
    const value = Buffer.from(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
    return `${value}.${sessionSignature(config.SESSION_SECRET, value).toString('base64url')}`;
  };

  async function authenticateAdmin(req: Request) {
    const auth = req.headers.get('authorization');
    if (auth) {
      const token = /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(auth)?.[1];
      if (!token) return null;
      const [bot] = await db.select(publicUser).from(adminUsers).where(and(eq(adminUsers.apiTokenHash, apiTokenHash(token)), eq(adminUsers.role, 'bot')));
      return bot ?? null;
    }
    const cookie = req.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const match = /^([A-Za-z0-9_-]{1,300})\.([A-Za-z0-9_-]{43})$/.exec(cookie ?? '');
    if (!match?.[1] || !match[2] || !safeEqual(Buffer.from(match[2], 'base64url'), sessionSignature(config.SESSION_SECRET, match[1]))) return null;
    const { id, exp } = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as { id?: string; exp?: number };
    if (!id || !exp || exp <= Date.now() / 1000) return null;
    const [owner] = await db.select(publicUser).from(adminUsers).where(and(eq(adminUsers.id, id), eq(adminUsers.role, 'owner')));
    return owner ?? null;
  }

  return { signSession, authenticateAdmin };
}

export function assertAdminOrigin({ config }: AppContext, c: Context) {
  const origin = c.req.header('origin');
  const allowed = origin && [config.SITE_PUBLIC_URL, ...config.ALLOWED_ORIGINS].includes(origin);
  if (!allowed && (origin || c.req.header('sec-fetch-site') !== 'same-origin')) throw new ApiError(403, 'invalid_origin', '请求来源未授权');
}

const loginBody = z.strictObject({ email: ownerEmail, password: z.string().min(1).max(256) });
export type Owner = { id: string; email: string; role: 'owner' };
export type AdminEnv = { Variables: { owner: Owner } };

export function createAdminAuthRoutes(ctx: AppContext) {
  const { db, config, services } = ctx;
  const routes = new Hono<AdminEnv>();
  const attempts = createRateLimiter({ windowMs: 15 * 60_000 });
  const cookie = { path: '/', httpOnly: true, secure: config.SITE_PUBLIC_URL.startsWith('https:'), sameSite: 'Strict' } as const;
  routes.post('/login', async c => {
    assertAdminOrigin(ctx, c);
    const ip = clientIp(peerIp(c), c.req.header('x-forwarded-for'), config.TRUST_PROXY_HOPS);
    const rate = attempts.consume(ip ?? 'unknown');
    if (!rate.allowed) {
      c.header('Retry-After', String(rate.retryAfter));
      throw new ApiError(429, 'login_rate_limit', '尝试次数过多，请稍后重试');
    }
    const body = loginBody.safeParse(await boundedJson(c.req.raw, 4096));
    if (!body.success) throw new ApiError(400, 'invalid_login', '邮箱或密码格式无效');
    const [owner] = await db.select().from(adminUsers).where(and(eq(adminUsers.email, body.data.email), eq(adminUsers.role, 'owner')));
    const authenticated = await verifyPassword(body.data.password, owner?.passwordHash ?? DUMMY_HASH);
    if (!owner?.passwordHash || !authenticated) throw new ApiError(401, 'invalid_credentials', '邮箱或密码错误');
    await db.transaction(async tx => {
      await tx.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, owner.id));
      await writeAudit(tx, { actorType: 'owner', actorId: owner.id, entityType: 'admin_user', entityId: owner.id, action: 'login' });
    });
    setCookie(c, COOKIE, services.auth.signSession(owner.id), { ...cookie, maxAge: MAX_AGE });
    return c.json({ user: { id: owner.id, email: owner.email, role: owner.role } });
  });
  routes.post('/logout', c => {
    assertAdminOrigin(ctx, c);
    deleteCookie(c, COOKIE, cookie);
    return c.body(null, 204);
  });
  routes.use('*', async (c, next) => {
    const user = await services.authenticateAdmin(c.req.raw);
    if (user?.role !== 'owner') throw new ApiError(401, 'authentication_required', '请登录管理员账号');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) assertAdminOrigin(ctx, c);
    c.set('owner', { ...user, role: 'owner' });
    await next();
  });
  routes.get('/me', c => c.json({ user: c.get('owner') }));
  return routes;
}

export async function initializeOwner(db: Database, email: string, password: string) {
  const normalized = ownerEmail.parse(email.trim());
  const passwordHash = await hashPassword(ownerPassword.parse(password));
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dafeiyu:initial-owner'))`);
    const [existing] = await tx.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.role, 'owner')).limit(1);
    if (existing) throw new Error('管理员已初始化');
    const id = `owner_${randomBytes(16).toString('hex')}`;
    await tx.insert(adminUsers).values({ id, email: normalized, passwordHash, role: 'owner' });
    return { id, email: normalized };
  });
}
