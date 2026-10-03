// 前台、投稿服务和后台复用的纯数据规则；不依赖 Payload 或数据库。
// 投稿者署名与作品来源独立：只读写 submitter，绝不借用 origin.sourceUrl。
export const CREDIT_NAME_MAX = 120;
export const CREDIT_URL_MAX = 2048;

export function safeHomepage(value) {
  const text = String(value || '').trim();
  if (!text || text.length > CREDIT_URL_MAX || /\s/.test(text)) return '';
  try {
    const url = new URL(text);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

/** @param {Record<string, any>} fields */
export function submissionAttribution(fields = {}) {
  const mode = fields.credit;
  // 老投稿没有署名选项，保留旧行为；不把来源作者当作投稿者。
  if (mode === undefined || mode === null || mode === '') {
    if (fields.creditName || fields.creditUrl) throw new Error('请选择是否署名');
    return null;
  }
  if (mode === 'anonymous' || mode === '不署名') return { credit: 'anonymous', name: '', url: '', github: '' };
  if (mode !== 'named' && mode !== '署名') throw new Error('署名选项无效');
  const name = String(fields.creditName || '').trim();
  if (!name || name.length > CREDIT_NAME_MAX) throw new Error('署名名字必填且不超过 120 字');
  const rawUrl = String(fields.creditUrl || '').trim();
  const url = safeHomepage(rawUrl);
  if (rawUrl && !url) throw new Error('个人主页链接须为有效的 http(s) 链接');
  return { credit: 'named', name, url, github: '' };
}

/** @param {Record<string, any>} work */
export function workAttribution(work) {
  const who = work.submitter || {};
  if (who.credit === 'anonymous') return { name: '', url: '', explicit: true };
  if (who.credit === 'named') return { name: String(who.name || ''), url: safeHomepage(who.url), explicit: true };
  const name = work.origin?.author || who.name || '';
  // 老作品只有名字恰好是投稿者时才匹配投稿者主页，不把出处当成主页。
  return { name, url: name && name === who.name ? safeHomepage(who.url) : '', explicit: false };
}
