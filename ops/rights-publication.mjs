import { isDeepStrictEqual } from 'node:util';
export { rightsIssueSnapshot, rightsIssueHash } from '../admin/src/lib/rights-contract.mjs';
const SITE = 'https://xn--pssy23gqgbz2d718b.com';
const REPO = 'lmy414/ai-girl-stickers';

export async function rightsComments(request, issue) {
  const comments = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await request(`/repos/${REPO}/issues/${issue}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
  throw new Error('Issue 评论过多，需人工复核');
}
export async function verifyRightsPublication(payload, fetchImpl = fetch) {
  const expected = payload.expected;
  const response = await fetchImpl(`${SITE}/site-data.json`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('公开清单读取失败');
  const works = (await response.json()).works;
  if (!Array.isArray(works)) throw new Error('公开清单格式错误');
  const actual = works.find(w => w.id === expected.workId);
  if (expected.status === 'removed') {
    if (actual) throw new Error('下架作品仍在公开清单中');
  } else {
    if (!actual || actual.slug !== expected.slug || !isDeepStrictEqual(actual.origin, expected.origin) ||
      !isDeepStrictEqual(actual.license || {}, expected.license) || actual.i18n?.sourceHash !== expected.sourceHash)
      throw new Error('公开内容尚未匹配申请更正');
  }
  const section = expected.kind === 'owner-picks' ? 'owner-picks' : expected.kind === 'blue-fish' ? 'blue-fish' : 'works';
  for (const prefix of ['', '/zh-hant', '/en', '/ja']) {
    const page = await fetchImpl(`${SITE}${prefix}/${section}/${expected.slug}.html`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (page.status !== (expected.status === 'removed' ? 404 : 200)) throw new Error(`作品页面 ${prefix || 'zh'} 验证失败：${page.status}`);
    if (expected.status === 'published') {
      const html = (await page.text()).replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      if (expected.origin?.author && !html.includes(expected.origin.author)) throw new Error('公开页面缺少作者署名');
      const locale = prefix === '/en' ? 'en' : prefix === '/ja' ? 'ja' : null;
      if (locale && actual.i18n[locale].licenseNote && !html.includes(actual.i18n[locale].licenseNote)) throw new Error('公开页面授权译文尚未更新');
    }
  }
  return true;
}
export async function acknowledgeRightsReply(payload, replyUrl, env = process.env, fetchImpl = fetch) {
  if (!env.ADMIN_WORKER_TOKEN) throw new Error('申请完成回写缺少 worker 令牌');
  const response = await fetchImpl('http://127.0.0.1:3100/cms-api/request-agent', { method: 'POST',
    headers: { Authorization: `Bearer ${env.ADMIN_WORKER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ack', id: payload.requestId, expected: payload.expected, replyUrl }), signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !(await response.json()).ok) throw new Error('申请完成回写失败');
}
export async function reportRightsConflict(payload, reason, env = process.env, fetchImpl = fetch) {
  if (!env.ADMIN_WORKER_TOKEN) throw new Error('申请失败回写缺少 worker 令牌');
  const response = await fetchImpl('http://127.0.0.1:3100/cms-api/request-agent', { method: 'POST',
    headers: { Authorization: `Bearer ${env.ADMIN_WORKER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reply-failed', id: payload.requestId, expected: payload.expected, reason }), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('申请失败回写失败');
}
