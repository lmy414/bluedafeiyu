import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Keep failed sends on disk. A stable Feishu UUID covers an uncertain HTTP response.
export async function deliverNotification(dir, key, text, send) {
  const uuid = crypto.createHash('sha256').update(key).digest('hex').slice(0, 40);
  if (!dir) return send(text, uuid);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, `${uuid}.json`);
  let item;
  try { item = JSON.parse(await fs.readFile(target, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    item = { uuid, text, createdAt: new Date().toISOString() };
    await atomicWrite(target, item);
  }
  if (item.messageId) return { ok: true, messageId: item.messageId, duplicate: true };
  const result = await send(item.text, uuid);
  if (result?.ok) await atomicWrite(target, { ...item, messageId: result.messageId, sentAt: new Date().toISOString() });
  return result;
}
async function atomicWrite(target, value) {
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temp, target);
}
export async function flushNotifications(dir, send) {
  if (!dir) return;
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  for (const file of (await fs.readdir(dir)).filter(v => /^[a-f0-9]{40}\.json$/.test(v))) {
    const target = path.join(dir, file), item = JSON.parse(await fs.readFile(target, 'utf8'));
    if (item.messageId) continue;
    const result = await send(item.text, item.uuid);
    if (!result?.ok) break;
    await atomicWrite(target, { ...item, messageId: result.messageId, sentAt: new Date().toISOString() });
  }
}
