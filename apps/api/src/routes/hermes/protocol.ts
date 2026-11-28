import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

// JSON stored by the Hermes bridge is versioned by the wire contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Wire = Record<string, any>;
export const leaseMs = 600_000;
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const object = (value: unknown): value is Wire => !!value && typeof value === 'object' && !Array.isArray(value);
export const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export class ProtocolError extends Error {
  readonly status: number;
  readonly path: string | null;
  constructor(message: string, status = 409, path: string | null = null) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

export function fail(message: string, status = 409, path: string | null = null): never {
  throw new ProtocolError(message, status, path);
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function sameToken(header: string | null, token?: string) {
  if (!token || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readBody(req: Request, limit = 128 * 1024): Promise<Wire> {
  const raw = await readBytes(req, limit);
  let value: unknown;
  try { value = raw.length ? JSON.parse(raw.toString('utf8')) : {}; }
  catch { fail('invalid json', 400); }
  if (!object(value)) fail('请求体必须是 JSON 对象', 400);
  return value;
}

export async function readBytes({ body, headers }: Request | Response, limit: number) {
  if (Number(headers.get('content-length')) > limit) fail(`请求体超过上限 ${limit} 字节`, 413);
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        fail(`请求体超过上限 ${limit} 字节`, 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

export function imageResponse(bytes: Uint8Array, mime: string) {
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': mime, 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store' },
  });
}

export function imageFormat(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { ext: 'png', mime: 'image/png' };
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return { ext: 'jpg', mime: 'image/jpeg' };
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return { ext: 'gif', mime: 'image/gif' };
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

export function available(progress: Wire, now: number) {
  return !(progress.expiresAt > now || progress.retryAt > now || progress.attempt >= 3 || ['blocked', 'manual'].includes(progress.stage));
}

export function ownLease(progress: Wire, token: unknown, now: number, message: string) {
  if (!token || progress.token !== token || !(progress.expiresAt > now)) fail(message);
}

export function claimLease(progress: Wire, body: Wire, now: number, stage: string): Wire {
  const batch = body.batchId ? {
    batchId: String(body.batchId).slice(0, 200),
    batchLabel: body.batchLabel ? String(body.batchLabel).slice(0, 200) : null,
    sourceKind: body.sourceKind ? String(body.sourceKind).slice(0, 50) : 'hermes',
  } : null;
  return {
    ...progress, token: randomUUID(), expiresAt: now + leaseMs, stage,
    attempt: (progress.attempt || 0) + 1, claimedAt: new Date(now).toISOString(),
    ...(batch && { ...batch, batchHistory: [...(progress.batchHistory || []), { ...batch, claimedAt: new Date(now).toISOString(), status: 'claimed' }].slice(-20) }),
  };
}

export function finishBatch(progress: Wire, now: number, entry: Wire) {
  const history = Array.isArray(progress.batchHistory) ? progress.batchHistory.slice(-20) : [];
  if (history.length) history[history.length - 1] = { ...history.at(-1), ...entry, finishedAt: new Date(now).toISOString() };
  return { ...progress, batchHistory: history };
}

export function releaseLease(progress: Wire, reason: unknown, now: number, fallback = '本轮未完成') {
  const lastError = String(reason || fallback).slice(0, 1000);
  const blocked = progress.attempt >= 3;
  return {
    ...finishBatch(progress, now, { status: 'released', error: lastError }),
    token: null, expiresAt: 0, stage: blocked ? 'blocked' : 'retry',
    retryAt: blocked ? Number.MAX_SAFE_INTEGER : now + 300_000, lastError,
  };
}

export function topicHash(name: string, summary: string) {
  return hash({ name: name.trim(), summary: summary.trim() });
}
