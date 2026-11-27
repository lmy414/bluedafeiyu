import { and, asc, inArray, lte } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import { notifyOutbox } from '../db/schema.js';
import { createFeishu } from '../services/feishu.js';
import { runCli } from './runtime.js';

export async function flushFeishuOutbox(db: Database, feishu: Pick<ReturnType<typeof createFeishu>, 'sendPending'>, limit = 50) {
  const rows = await db.select({ id: notifyOutbox.id }).from(notifyOutbox)
    .where(and(inArray(notifyOutbox.status, ['pending', 'failed']), lte(notifyOutbox.nextRetryAt, new Date())))
    .orderBy(asc(notifyOutbox.nextRetryAt), asc(notifyOutbox.createdAt)).limit(limit);
  let sent = 0;
  for (const row of rows) if (await feishu.sendPending(row.id)) sent++;
  return { scanned: rows.length, sent, pending: rows.length - sent };
}

runCli(import.meta.url, async () => {
  const config = loadConfig();
  const connection = createDb(config.DATABASE_URL);
  try { return await flushFeishuOutbox(connection.db, createFeishu(connection.db, config)); }
  finally { await connection.close(); }
});
