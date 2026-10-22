import { normalizeCreator } from '../admin/src/lib/bilibili.mjs';
export async function forwardCreatorRegistration(input, cfg, fetchImpl = fetch) {
  const data = normalizeCreator(input);
  const response = await fetchImpl('http://127.0.0.1:3100/cms-api/video-registrations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.adminToken },
    body: JSON.stringify({ ...data, confirm: true }), signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  if (!response.ok) throw Object.assign(new Error('作者登记暂不可用，请稍后重试'), { status: 503 });
  // Deliberately return a fixed receipt: no internal IDs, previous intro or queue details.
  return { ok: true, status: 'queued' };
}
