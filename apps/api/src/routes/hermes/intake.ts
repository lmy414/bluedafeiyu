import { arrayContains, eq, sql } from 'drizzle-orm';
import { submissions, works } from '../../db/schema.js';
import type { DbTransaction } from '../../db/client.js';
import { lockHash } from '../../services/publish.js';
import { charactersOf } from './editorial.js';
import { fail, imageFormat, json, object, readBody, readBytes, sameToken, sha256 } from './protocol.js';
import type { Wire } from './protocol.js';
import { vocabulary } from './context.js';
import type { HermesContext } from './context.js';

export async function fetchAttachment(url: string, allowed: (url: URL) => boolean, limit: number, timeoutMs: number, headers: HeadersInit = {}, fetcher = fetch) {
  const signal = AbortSignal.timeout(timeoutMs);
  let target = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (target.protocol !== 'https:' || target.username || target.password || target.port || !allowed(target)) fail('图片地址不在白名单', 403);
    const response = await fetcher(target, { redirect: 'manual', signal, headers });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      target = new URL(location, target);
      continue;
    }
    if (!response.ok) fail(`图片请求 HTTP ${response.status}`, 400);
    return readBytes(response, limit);
  }
  fail('图片地址跳转次数过多', 400);
}

type Intake = { source: 'qq' | 'github-issue'; sourceId: string; bytes: Buffer; fields: Wire; origin: Wire; now: Date };
export async function stageSubmission(tx: DbTransaction, ctx: Pick<HermesContext, 'config' | 'services'>, input: Intake, beforeCreate?: () => void) {
  const { bytes, sourceId, source, now } = input;
  const type = imageFormat(bytes);
  if (!type) fail('文件头不是已知图片格式', 400);
  const digest = sha256(bytes);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`source:${sourceId}`}, 0))`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`submission:${digest}`}, 0))`);
  const [bySource] = await tx.select().from(submissions).where(arrayContains(submissions.sourceIds, [sourceId])).limit(1);
  if (bySource) return { id: bySource.id, state: bySource.state, created: false };
  const [existing] = await tx.select().from(submissions).where(eq(submissions.sha256, digest)).for('update');
  if (existing) {
    await tx.update(submissions).set({ sourceIds: [...existing.sourceIds, sourceId].sort(), updatedAt: now }).where(eq(submissions.id, existing.id));
    return { id: existing.id, state: existing.state, created: false };
  }
  const id = `sub_${digest.slice(0, 24)}`;
  await lockHash(tx, digest);
  const [work] = await tx.select({ id: works.id, status: works.status }).from(works).where(eq(works.sha256, digest));
  const state = work ? work.status === 'published' ? 'published' : 'rejected' : 'received';
  const key = work ? '' : `submissions/${id}/${digest}.${type.ext}`;
  if (!work) {
    beforeCreate?.();
    await ctx.services.r2.putObject(ctx.config.R2_STAGING_BUCKET, key, bytes, type.mime);
  }
  const inserted = await tx.insert(submissions).values({
    id, source, sourceIds: [sourceId], sha256: digest, r2StagingKey: key, fields: input.fields, origin: work ? { ...input.origin, duplicateWork: work.id } : input.origin, state,
    workId: work?.id, createdAt: now, updatedAt: now,
    stateHistory: [{ event: 'enqueue', from: null, to: state, actor: source, at: now.toISOString(), reason: '' }],
  }).onConflictDoNothing({ target: submissions.sha256 }).returning({ id: submissions.id });
  if (!inserted.length) {
    const [winner] = await tx.select().from(submissions).where(eq(submissions.sha256, digest)).for('update');
    if (!winner) throw new Error('投稿去重结果不可读取');
    await tx.update(submissions).set({ sourceIds: [...new Set([...winner.sourceIds, sourceId])].sort(), updatedAt: now }).where(eq(submissions.id, winner.id));
    return { id: winner.id, state: winner.state, created: false };
  }
  return { id, state, created: !work };
}

const envList = (key: string) => (process.env[key] || '').split(/[,\s]+/).filter(Boolean);
export async function qqInbound(ctx: HermesContext, request: Request) {
  const inboundToken = ctx.config.QQ_INBOUND_TOKEN || process.env.SUBMISSION_QQ_INBOUND_TOKEN;
  const groups = envList('SUBMISSION_QQ_GROUP_ALLOWLIST');
  const hosts = envList('SUBMISSION_QQ_IMAGE_HOST_ALLOWLIST');
  const limit = Number(process.env.SUBMISSION_MAX_BYTES || 16 * 1024 * 1024);
  const enabled = process.env.SUBMISSION_QQ_ENABLED?.trim().toLowerCase();
  if (enabled ? enabled !== 'true' : !inboundToken)
    return json({ ok: false, error: 'QQ 入站未开启（SUBMISSION_QQ_ENABLED 未设为 true）' }, 503);
  if (!inboundToken || !groups.length) return json({ ok: false, error: 'QQ 入站未配置令牌或群白名单' }, 503);
  if (!sameToken(request.headers.get('authorization'), inboundToken)) return json({ ok: false, error: '鉴权失败' }, 401);
  const payload = await readBody(request, Math.ceil(limit * 4 / 3) + 16_384);
  const groupId = String(payload.groupId ?? payload.group_id ?? '');
  if (!groups.includes(groupId)) return json({ ok: false, error: '群不在白名单' }, 403);
  const base64 = payload.image?.base64 ?? payload.imageBase64;
  const url = payload.image?.url ?? payload.imageUrl;
  let bytes: Buffer;
  if (base64) bytes = Buffer.from(String(base64).split(',').at(-1)!, 'base64');
  else if (url) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return json({ ok: false, error: '图片地址不在白名单' }, 403); }
    if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !hosts.includes(parsed.hostname)) return json({ ok: false, error: '图片地址不在白名单' }, 403);
    try { bytes = await fetchAttachment(url, next => hosts.includes(next.hostname), limit, Number(process.env.SUBMISSION_QQ_TIMEOUT_MS || 20_000)); }
    catch (error) { return json({ ok: false, error: `图片获取失败：${(error as Error).message}` }, 400); }
  } else return json({ ok: false, error: '缺少图片内容' }, 400);
  if (!bytes.length) return json({ ok: false, error: '图片内容为空' }, 400);
  if (bytes.length > limit) return json({ ok: false, error: `图片超过大小上限 ${limit} 字节` }, 413);
  if (!imageFormat(bytes)) return json({ ok: false, error: '文件头不是已知图片格式' }, 400);
  const nested = object(payload.fields) ? payload.fields : {};
  const first = (...values: unknown[]) => values.map(value => String(value ?? '').trim()).find(Boolean) || '';
  const fields: Wire = {
    name: first(payload.name, payload.title, nested.name, nested.title).slice(0, 200),
    character: first(payload.character, payload.role, nested.character, nested.role, payload.characterIds?.[0], nested.characterIds?.[0]),
    description: String(payload.description ?? nested.description ?? '').slice(0, 2000),
    tags: (Array.isArray(payload.tags) ? payload.tags : Array.isArray(nested.tags) ? nested.tags : []).map(String).filter(Boolean).slice(0, 20),
  };
  if (Object.hasOwn(payload, 'characterIds') || Object.hasOwn(nested, 'characterIds')) {
    try {
      const ids = payload.characterIds ?? nested.characterIds;
      if (!Array.isArray(ids)) fail('角色集合非法', 400);
      const selected = charactersOf({ characterId: fields.character, characterIds: ids }, (await vocabulary(ctx.db)).characterIds);
      fields.character = selected.characterId;
      fields.characterIds = selected.characterIds;
    } catch { return json({ ok: false, error: '角色集合非法' }, 400); }
  }
  const messageId = String(payload.messageId ?? payload.message_id ?? '') || 'unknown';
  const userId = String(payload.userId ?? payload.user_id ?? '');
  const sourceId = `qq:${groupId}:${messageId}:${sha256(bytes).slice(0, 16)}`;
  return ctx.db.transaction(async tx => {
    const now = new Date();
    const hour = Math.floor(now.valueOf() / 3_600_000) * 3_600_000;
    const limit = 10;
    const resetAt = new Date(hour + 3_600_000).toISOString();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('qq-submission-hour', 0))`);
    const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(submissions)
      .where(sql`${submissions.source} = 'qq' and ${submissions.createdAt} >= ${new Date(hour).toISOString()}::timestamptz and ${submissions.origin}->>'imageVia' is not null and ${submissions.origin}->>'duplicateWork' is null`);
    const used = usage?.count ?? 0;
    let result;
    try {
      result = await stageSubmission(tx, ctx, {
        source: 'qq', sourceId, bytes, fields, now,
        origin: { type: 'qq-group', via: 'qq-group', groupId, userId, messageId, imageVia: base64 ? 'base64' : 'url' },
      }, () => { if (used >= limit) fail('本小时投稿名额已用完', 429); });
    } catch (error) {
      if ((error as { status?: number }).status !== 429) throw error;
      const reset = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(resetAt));
      return json({ ok: false, error: `本小时投稿名额已用完（每小时 10 张），${reset} 后再试`, remaining: 0, limit, resetAt }, 429);
    }
    return json({ ok: true, id: result.id, status: result.state, remaining: Math.max(0, limit - used - Number(result.created)), limit, resetAt }, result.created ? 202 : 200);
  });
}
