// 每小时从后台触发一次 GA4 同步；令牌只从受限环境文件读取。
import { pathToFileURL } from 'node:url';

export async function main(env = process.env, fetchImpl = fetch) {
  const token = env.ADMIN_WORKER_TOKEN;
  if (!token) throw new Error('缺少 ADMIN_WORKER_TOKEN');
  const base = new URL(env.ADMIN_API_URL || 'http://127.0.0.1:3100');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) throw new Error('后台地址必须是 HTTPS 或本机回环地址');
  const response = await fetchImpl(new URL('/cms-api/analytics/sync', base), {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(180_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GA4 同步失败（HTTP ${response.status}）`);
  console.log(JSON.stringify({ available: data.available, syncedAt: data.syncedAt, totals: data.totals }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
