import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { adminUsers, auditEvents, topicWorks, topics } from '../../db/schema.js';
import { purgeTopic } from './context.js';
import type { HermesContext } from './context.js';
import { json, object, ProtocolError, readBody, topicHash } from './protocol.js';
import type { Wire } from './protocol.js';

const keys = ['topicId', 'name', 'summary', 'nameEn', 'summaryEn', 'nameJa', 'summaryJa', 'author', 'status', 'order'];

class InputError extends Error {
  constructor(message: string, readonly details: Record<string, string> = {}) { super(message); }
}

function known(value: Wire, allowed: string[], scope = '') {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key)).sort();
  if (unknown.length) throw new InputError(`${scope}不支持字段：${unknown.join('、')}`, Object.fromEntries(unknown.map(key => [scope ? `${scope}.${key}` : key, '不支持该字段'])));
}

function string(value: unknown, field: string) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new InputError(`${field} 必须是字符串`, { [field]: '必须是字符串' });
  return value.trim();
}

function url(value: string, field: string) {
  try {
    const parsed = new URL(value);
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return value;
  } catch { /* Invalid URL. */ }
  throw new InputError(`${field} 只接受 http/https URL`, { [field]: '网址无效' });
}

function author(value: unknown) {
  if (value === null) return null;
  if (!object(value)) throw new InputError('author 必须是对象或 null', { author: '必须是对象或 null' });
  known(value, ['name', 'url', 'bio', 'channels'], 'author');
  const name = string(value.name, 'author.name');
  const homepage = string(value.url, 'author.url');
  const bio = string(value.bio, 'author.bio');
  if (value.channels != null && !Array.isArray(value.channels)) throw new InputError('author.channels 必须是数组', { 'author.channels': '必须是数组' });
  const channels = (value.channels || []).map((item: unknown, i: number) => {
    const field = `author.channels[${i}]`;
    if (!object(item)) throw new InputError(`${field} 必须是对象`, { [field]: '必须是对象' });
    known(item, ['platform', 'label', 'url'], field);
    const platform = string(item.platform, `${field}.platform`);
    const label = string(item.label, `${field}.label`);
    if (!platform) throw new InputError(`${field}.platform 不能为空`, { [`${field}.platform`]: '不能为空' });
    return { platform, ...(label && { label }), url: url(string(item.url, `${field}.url`), `${field}.url`) };
  });
  if (!name && !homepage && !bio && !channels.length) return null;
  if (!name || !channels.length) throw new InputError('作者名称与首选渠道必填', { 'author.name': !name ? '必填' : '', 'author.channels': !channels.length ? '缺少首选渠道' : '' });
  return { name, bio: bio || null, url: homepage ? url(homepage, 'author.url') : null, channels };
}

export async function topicUpsert(ctx: HermesContext, request: Request) {
  const token = request.headers.get('authorization')?.match(/^(?:Bearer|users API-Key) ([^\s]+)$/i)?.[1];
  let actor = await ctx.services.authenticateAdmin?.(request);
  if (!actor && token) {
    const [row] = await ctx.db.select({ id: adminUsers.id, role: adminUsers.role }).from(adminUsers)
      .where(eq(adminUsers.apiTokenHash, createHash('sha256').update(token).digest('hex')));
    actor = row;
  }
  if (!actor) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!token) {
    const origin = request.headers.get('origin');
    const fetchSite = request.headers.get('sec-fetch-site');
    if (origin ? ![ctx.config.SITE_PUBLIC_URL, ...ctx.config.ALLOWED_ORIGINS].includes(origin) : fetchSite === 'cross-site')
      return json({ ok: false, error: '请求来源未授权' }, 403);
  }
  const user = actor;
  try {
    const body = await readBody(request).catch(error => {
      if (error instanceof ProtocolError && error.status === 400) throw new InputError(error.message === 'invalid json' ? '请求体不是合法 JSON' : error.message);
      throw error;
    });
    known(body, keys);
    const id = string(body.topicId, 'topicId');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new InputError(id ? 'topicId 必须是 kebab-case' : 'topicId 不能为空', { topicId: id ? '必须是 kebab-case' : '不能为空' });
    const changes: Wire = Object.fromEntries(keys.slice(1, 7).filter(key => Object.hasOwn(body, key)).map(key => [key, string(body[key], key)]));
    if (Object.hasOwn(body, 'status') && !['active', 'draft'].includes(body.status)) throw new InputError('status 只能是 draft 或 active', { status: '只能是 draft 或 active' });
    if (Object.hasOwn(body, 'order') && (!Number.isInteger(body.order) || Math.abs(body.order) > 2_147_483_647)) throw new InputError('order 必须是整数', { order: '必须是整数' });
    if (Object.hasOwn(body, 'author')) changes.author = author(body.author);
    const outcome = await ctx.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`topic:${id}`}, 0))`);
      const [existing] = await tx.select().from(topics).where(eq(topics.id, id)).for('update');
      const name = changes.name ?? existing?.name;
      const summary = changes.summary ?? existing?.summary;
      if (!name || !summary) throw new InputError(`${!name ? 'name（名称）' : 'summary（简介）'}不能为空`, { [!name ? 'name' : 'summary']: '不能为空' });
      const status = body.status ?? existing?.status ?? 'draft';
      if (user.role === 'bot' && existing?.status === 'active' && status === 'draft') {
        const [member] = await tx.select({ id: topicWorks.workId }).from(topicWorks).where(eq(topicWorks.topicId, id)).limit(1);
        if (member || existing.coverWorkId) return null;
      }
      const i18n: Wire = { ...existing?.i18n };
      for (const [language, suffix] of [['en', 'En'], ['ja', 'Ja']] as const) {
        if (changes[`name${suffix}`] !== undefined || changes[`summary${suffix}`] !== undefined) i18n[language] = {
          ...i18n[language], ...(changes[`name${suffix}`] !== undefined && { name: changes[`name${suffix}`] }),
          ...(changes[`summary${suffix}`] !== undefined && { summary: changes[`summary${suffix}`] }),
        };
      }
      const translationChanged = ['nameEn', 'summaryEn', 'nameJa', 'summaryJa'].some(key => changes[key] !== undefined);
      if (translationChanged && i18n.en?.name && i18n.en?.summary && i18n.ja?.name && i18n.ja?.summary &&
          (!existing || existing.name === name && existing.summary === summary || ['nameEn', 'summaryEn', 'nameJa', 'summaryJa'].every(key => changes[key] !== undefined))) i18n.sourceHash = topicHash(name, summary);
      const values = { name, summary, status, sortOrder: body.order ?? existing?.sortOrder ?? 0, author: Object.hasOwn(changes, 'author') ? changes.author : existing?.author ?? null, i18n };
      if (existing && Object.entries(values).every(([key, value]) => isDeepStrictEqual(value, (existing as Wire)[key])))
        return { ok: true, created: false, changed: false, id, topicId: id, status };
      if (existing) await tx.update(topics).set({ ...values, updatedAt: new Date() }).where(eq(topics.id, id));
      else await tx.insert(topics).values({ id, ...values });
      await tx.insert(auditEvents).values({ actorType: user.role === 'owner' ? 'owner' : 'hermes', actorId: user.id, entityType: 'topics', entityId: id,
        action: existing ? 'topics.update' : 'topics.create', diff: values,
      });
      return { ok: true, created: !existing, changed: true, id, topicId: id, status };
    });
    if (!outcome) return json({ ok: false, error: '机器人不能把已关联作品的专题改为草稿' }, 403);
    if (outcome.changed) await purgeTopic(ctx, id);
    return json(outcome);
  } catch (error) {
    if (error instanceof InputError) return json({ ok: false, error: error.message, details: error.details }, 400);
    throw error;
  }
}
