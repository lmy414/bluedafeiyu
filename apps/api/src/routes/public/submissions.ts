import { buildR2Keys, submissionFieldsSchema } from '@dafeiyu/shared';
import { eq } from 'drizzle-orm';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../../app.js';
import { creators, submissions, works } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { inspectImage, MAX_IMAGE_BYTES } from '../../services/image.js';
import { lockHash, resolveTaxonomy } from '../../services/publish.js';
import { clientIp } from '../../services/ratelimit.js';
import { object, safeUrl, text } from '../../services/work-data.js';
import { MAX_ZIP_BYTES, unpackImages } from '../../services/zip.js';
import { boundedForm, boundedJson } from '../body.js';

export function peerIp(c: Context): string | undefined {
  try { return getConnInfo(c).remote.address; }
  catch { return undefined; }
}

function authorize(ctx: AppContext, c: Context) {
  const origin = c.req.header('origin');
  if (!origin || ![ctx.config.SITE_PUBLIC_URL, ...ctx.config.ALLOWED_ORIGINS].includes(origin)) throw new ApiError(403, 'invalid_origin', '请求来源未授权');
  const ip = clientIp(peerIp(c), c.req.header('x-forwarded-for'), ctx.config.TRUST_PROXY_HOPS);
  const limit = ctx.services.submissionLimit.consume(ip ?? 'unknown');
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfter));
    throw new ApiError(429, 'rate_limit', '提交过于频繁，请稍后重试');
  }
  return ip;
}

async function verify(ctx: AppContext, token: unknown, ip?: string) {
  if (!await ctx.services.turnstile.verify(token, ip)) throw new ApiError(403, 'turnstile_failed', '人机验证失败');
}

function arrayField(value: unknown): unknown[] | undefined {
  if (typeof value !== 'string') return Array.isArray(value) ? value : undefined;
  try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch { /* Delimited form values. */ }
  return value.split(/[,，\n]/).map(part => part.trim()).filter(Boolean);
}

function fieldsFrom(input: unknown) {
  const data = object(input);
  const categories = arrayField(data.categoryIds);
  if (categories && (categories.length !== 1 || (data.categoryId && data.categoryId !== categories[0]))) throw new ApiError(422, 'invalid_category', '分类必须单选');
  const fields = submissionFieldsSchema.safeParse({
    name: data.name ?? data.title, description: data.description, character: data.character ?? data.characterId ?? data.primaryCharacterId,
    characterIds: arrayField(data.characterIds), categoryId: data.categoryId ?? categories?.[0], tags: arrayField(data.tags),
    nonAi: typeof data.nonAi === 'string' ? ['true', 'yes', 'on', '1'].includes(data.nonAi) : data.nonAi,
    credit: data.credit === '' ? undefined : data.credit, creditName: data.creditName, creditUrl: data.creditUrl,
  });
  if (!fields.success) throw new ApiError(422, 'invalid_submission_fields', '投稿字段不完整', fields.error.issues);
  return fields.data;
}

function fileFrom(form: FormData, keys: string[]): File | null {
  for (const key of keys) {
    const value = form.get(key);
    if (value instanceof File && value.size) return value;
  }
  return null;
}

export function formFields(form: FormData): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of form) {
    if (typeof value !== 'string') continue;
    if (key === 'fields' || key === 'metadata') {
      try { Object.assign(result, object(JSON.parse(value))); }
      catch { throw new ApiError(400, 'invalid_fields', '表单字段 JSON 无效'); }
    } else if (['characterIds', 'categoryIds', 'tags'].includes(key) && form.getAll(key).length > 1) {
      result[key] = form.getAll(key);
    } else result[key] = value;
  }
  return result;
}

function decodeImage(value: unknown) {
  const base64 = text(value).replace(/^data:image\/(?:a?png|jpeg|gif|webp);base64,/i, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) throw new ApiError(422, 'invalid_image_data', '缺少有效的 Base64 图片');
  return Buffer.from(base64, 'base64');
}

async function enqueue(ctx: AppContext, files: { name: string; bytes: Buffer; input: Record<string, unknown> }[]) {
  const { db, config, services } = ctx;
  const prepared: Array<(typeof files)[number] & Awaited<ReturnType<typeof inspectImage>> & { fields: ReturnType<typeof fieldsFrom>; sourceUrl: string | null }> = [];
  for (const file of files) {
    const image = await inspectImage(file.bytes);
    const fields = fieldsFrom(file.input);
    const source = file.input.sourceUrl ?? object(file.input.origin).sourceUrl;
    const sourceUrl = safeUrl(source);
    if (source && !sourceUrl) throw new ApiError(422, 'invalid_source', '作品来源链接无效');
    prepared.push({ ...file, ...image, fields, sourceUrl });
  }
  const uploaded: string[] = [];
  try {
    return await db.transaction(async tx => {
      for (const hash of [...new Set(prepared.map(file => file.sha256))].sort()) await lockHash(tx, hash);
      const result = [];
      for (const file of prepared) {
        const { sha256, fields } = file;
        const [tombstone] = await tx.select({ id: works.id }).from(works).where(eq(works.sha256, sha256));
        const [existing] = await tx.select({ id: submissions.id }).from(submissions).where(eq(submissions.sha256, sha256));
        if (tombstone || existing) {
          result.push({ name: file.name, state: 'duplicate' as const, ...(existing && !tombstone && { id: existing.id }) });
          continue;
        }
        await resolveTaxonomy(tx, fields.character, fields.characterIds, fields.categoryId);
        const id = `sub_${sha256.slice(0, 24)}`;
        const { stagingKey } = buildR2Keys(sha256, file.extension, id);
        const now = new Date();
        await tx.insert(submissions).values({ id, sha256, source: 'web', r2StagingKey: stagingKey, fields,
          origin: { type: 'web', ...(file.sourceUrl && { sourceUrl: file.sourceUrl }) }, stateHistory: [{ event: 'received', to: 'received', actor: 'web', at: now.toISOString() }] });
        uploaded.push(stagingKey);
        await services.r2.putObject(config.R2_STAGING_BUCKET, stagingKey, file.bytes, file.mimeType);
        result.push({ id, name: file.name, state: 'received' as const });
      }
      return result;
    });
  } catch (error) {
    // A retry might have accepted the same submission while a previous commit result was uncertain.
    for (const key of uploaded) {
      const hash = key.split('/').at(-1)?.split('.')[0];
      if (!hash) continue;
      await db.transaction(async tx => {
        await lockHash(tx, hash);
        const [stored] = await tx.select({ id: submissions.id }).from(submissions).where(eq(submissions.r2StagingKey, key));
        if (!stored) await services.r2.deleteObject(config.R2_STAGING_BUCKET, key);
      }).catch(cleanupError => console.error('Staging rollback cleanup failed', cleanupError));
    }
    throw error;
  }
}

export function createSubmissionRoutes(ctx: AppContext) {
  const routes = new Hono();
  for (const path of ['/submissions', '/submissions/zip', '/creators']) {
    routes.use(path, async (c, next) => {
      if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
      c.header('Cache-Control', 'no-store');
      c.header('Vary', 'Origin', { append: true });
      const origin = c.req.header('origin');
      if (origin && [ctx.config.SITE_PUBLIC_URL, ...ctx.config.ALLOWED_ORIGINS].includes(origin)) {
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type');
        c.header('Access-Control-Expose-Headers', 'Retry-After');
      }
      if (c.req.method === 'OPTIONS') return c.body(null, 204);
      await next();
    });
  }
  routes.post('/submissions', async c => {
    c.header('Cache-Control', 'no-store');
    const ip = authorize(ctx, c);
    const multipart = c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data');
    const form = multipart ? await boundedForm(c.req.raw, MAX_IMAGE_BYTES + 128 * 1024) : null;
    const input = form ? formFields(form) : object(await boundedJson(c.req.raw, Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 128 * 1024));
    await verify(ctx, input.turnstileToken ?? input['cf-turnstile-response'] ?? input.turnstile, ip);
    const file = form ? fileFrom(form, ['image', 'file']) : null;
    const bytes = file ? Buffer.from(await file.arrayBuffer()) : decodeImage(input.imageBase64 ?? input.image ?? input.data);
    const [result] = await enqueue(ctx, [{ bytes, input: { ...input, ...object(input.fields) }, name: file?.name ?? '' }]);
    if (result?.state === 'duplicate') throw new ApiError(409, 'duplicate_submission', '此图片已有投稿或收录记录');
    return c.json({ ok: true, ...result, submissionId: result?.id }, 201);
  });
  routes.post('/submissions/zip', async c => {
    c.header('Cache-Control', 'no-store');
    const ip = authorize(ctx, c);
    const form = await boundedForm(c.req.raw, MAX_ZIP_BYTES + 256 * 1024);
    const input = formFields(form);
    await verify(ctx, input.turnstileToken ?? input['cf-turnstile-response'] ?? input.turnstile, ip);
    const file = fileFrom(form, ['zip', 'file', 'archive']);
    if (!file) throw new ApiError(422, 'missing_zip', '请选择 ZIP 文件');
    const files = unpackImages(Buffer.from(await file.arrayBuffer()));
    const fileFields = object(input.files);
    const result = await enqueue(ctx, files.map(image => ({ ...image, input: { ...input, name: input.name || image.name.split('/').at(-1)?.replace(/\.[^.]+$/, ''), ...object(fileFields[image.name]) } })));
    const accepted = result.filter(row => row.state === 'received').length;
    return c.json({ ok: true, items: result, accepted, duplicates: result.length - accepted }, accepted ? 201 : 409);
  });
  routes.post('/creators', async c => {
    c.header('Cache-Control', 'no-store');
    const ip = authorize(ctx, c);
    const data = c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data') ?
      formFields(await boundedForm(c.req.raw, 32 * 1024)) : object(await boundedJson(c.req.raw, 32 * 1024));
    await verify(ctx, data.turnstileToken ?? data['cf-turnstile-response'] ?? data.turnstile, ip);
    const raw = text(data.homepage ?? data.url ?? data.bilibiliUrl ?? data.uid).trim();
    const uid = /^\d{1,20}$/.test(raw) ? raw : safeUrl(raw)?.match(/^https?:\/\/space\.bilibili\.com\/(\d{1,20})(?:[/?#]|$)/)?.[1];
    if (!uid || /^0+$/.test(uid)) throw new ApiError(422, 'invalid_bilibili_homepage', '请填写有效的哔哩哔哩作者空间地址或 UID');
    const intro = text(data.intro).trim();
    if (intro.length > 500) throw new ApiError(422, 'invalid_creator_intro', '作者简介不能超过 500 字');
    const normalized = uid.replace(/^0+/, '');
    const id = `bilibili-${normalized}`;
    const [row] = await ctx.db.insert(creators).values({ id, uid: normalized, intro, homepage: `https://space.bilibili.com/${normalized}`, status: 'queued' })
      .onConflictDoNothing({ target: creators.uid }).returning({ id: creators.id, status: creators.status });
    if (!row) throw new ApiError(409, 'duplicate_creator', '此作者已登记');
    return c.json({ ok: true, ...row }, 201);
  });
  return routes;
}
