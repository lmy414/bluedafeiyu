import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Database, DbTransaction } from '../db/client.js';
import { notifyOutbox } from '../db/schema.js';

type FeishuReply = { code?: number; tenant_access_token?: string; expire?: number; data?: { message_id?: string } };
export type Notification = { eventType: string; text: string; dedupeKey?: string };

function notificationId(event: Notification): string {
  if (!event.dedupeKey) return randomUUID();
  const hex = createHash('sha256').update(`${event.eventType}\0${event.dedupeKey}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function createFeishu(db: Database, config: Config, request: typeof fetch = fetch) {
  const { FEISHU_NOTIFY_APP_ID: appId, FEISHU_NOTIFY_APP_SECRET: appSecret, FEISHU_NOTIFY_CHAT_ID: chatId } = config;
  let cached: { token: string; expiresAt: number } | undefined;
  let refreshing: Promise<string> | undefined;

  async function post(path: string, body: object, token?: string): Promise<FeishuReply> {
    const response = await request(`https://open.feishu.cn/open-apis${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const result = await response.json() as FeishuReply;
    if (!response.ok || result.code !== 0) throw new Error(`Feishu HTTP ${response.status}, code ${result.code ?? 'unknown'}`);
    return result;
  }

  async function token(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    refreshing ??= post('/auth/v3/tenant_access_token/internal', { app_id: appId, app_secret: appSecret }).then(result => {
      if (!result.tenant_access_token) throw new Error('Feishu did not return a tenant token');
      cached = { token: result.tenant_access_token, expiresAt: Date.now() + Math.max(0, (result.expire ?? 0) - 60) * 1000 };
      return cached.token;
    }).finally(() => { refreshing = undefined; });
    return refreshing;
  }

  async function enqueue(event: Notification, executor: Database | DbTransaction = db): Promise<string> {
    const id = notificationId(event);
    await executor.insert(notifyOutbox).values({ id, eventType: event.eventType, payload: { text: event.text } }).onConflictDoNothing();
    return id;
  }

  async function sendPending(id: string): Promise<boolean> {
    if (!appId || !appSecret || !chatId) return false;
    return db.transaction(async tx => {
      const [row] = await tx.select().from(notifyOutbox)
        .where(and(eq(notifyOutbox.id, id), inArray(notifyOutbox.status, ['pending', 'failed']), lte(notifyOutbox.nextRetryAt, new Date())))
        .for('update', { skipLocked: true });
      if (!row) return false;
      const attempts = row.attempts + 1;
      try {
        const result = await post('/im/v1/messages?receive_id_type=chat_id', {
          receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: row.payload.text }), uuid: row.id,
        }, await token());
        await tx.update(notifyOutbox).set({ status: 'sent', attempts, messageId: result.data?.message_id, nextRetryAt: null }).where(eq(notifyOutbox.id, id));
        return true;
      } catch (error) {
        console.error('Feishu notification failed', id, error);
        cached = undefined;
        await tx.update(notifyOutbox).set({ status: 'failed', attempts,
          nextRetryAt: new Date(Date.now() + Math.min(60_000 * 2 ** Math.min(attempts - 1, 10), 3_600_000)) }).where(eq(notifyOutbox.id, id));
        return false;
      }
    });
  }

  return { enqueue, sendPending, async notify(event: Notification) { return sendPending(await enqueue(event)); } };
}
