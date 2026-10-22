import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNotifier } from '../../server/notify.mjs';

export function changes(previous, status) {
  const events = [];
  for (const c of status.creators) {
    const old = previous.creators?.find(v => v.uid === c.uid);
    if (!old) events.push({ key: `creator:${c.uid}`, text: `📥 作者已登记：${c.name}\nhttps://space.bilibili.com/${c.uid}\n已进入 RSSHub 同步与 AI 审核队列。` });
    if (c.error && c.error !== old?.error) events.push({ key: `creator-error:${c.uid}:${c.lastSyncedAt}:${c.error}`, text: `⚠️ 作者同步暂缓：${c.name}\n${c.error}\n系统会自动重试，已有视频保留。` });
    if (!c.error && old?.error) events.push({ key: `creator-recovered:${c.uid}:${c.lastSyncedAt}`, text: `✅ 作者同步已恢复：${c.name}` });
  }
  const labels = { queued: '新视频进入审核', approved: 'AI 审核通过，等待自动发布', rejected: '未收录', manual: '证据不足，待复核', hidden: '已排队下架' };
  const oldVideos = new Map((previous.videos || []).map(v => [v.bvid, v]));
  for (const v of status.videos) {
    if (!labels[v.status] || oldVideos.get(v.bvid)?.status === v.status) continue;
    events.push({ key: `video:${v.bvid}:${v.status}`, text: `🎬 ${labels[v.status]}\n${v.title}\nhttps://www.bilibili.com/video/${v.bvid}/\n${v.reason || ''}` });
  }
  return events;
}

export async function cycle({ env = process.env, fetchImpl = fetch, notifier = createNotifier({ env }), sync = true } = {}) {
  const statePath = env.VIDEO_NOTIFY_STATE || '/srv/apps/dafeiyu-admin/run/video-notify-state.json';
  const api = async action => {
    const response = await fetchImpl('http://127.0.0.1:3100/cms-api/video-agent', { method: 'POST', headers: { Authorization: `Bearer ${env.ADMIN_WORKER_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(175000) });
    if (!response.ok) throw new Error(`Video ${action}: HTTP ${response.status}`);
    return response.json();
  };
  if (!notifier.enabled) throw new Error('飞书群通知未配置，保留状态待重试');
  await notifier.flush();
  if (sync) {
    // Sync one due author per minute; expired leases and retryAt are enforced in CMS.
    const result = await api('sync');
    console.log(JSON.stringify({ sync: result.stats }));
  }
  const status = await api('status');
  let previous = {};
  try { previous = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const event of changes(previous, status)) {
    const result = await notifier.event(event.key, event.text);
    if (!result?.ok) throw new Error('飞书通知待重试');
  }
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(`${statePath}.tmp`, JSON.stringify(status), { mode: 0o600 });
  await fs.rename(`${statePath}.tmp`, statePath);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cycle().catch(e => { console.error(e.message); process.exitCode = 1; });
