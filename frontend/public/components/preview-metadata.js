const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const cache = new Map();

export function loadPreviewMetadata(id) {
  if (!cache.has(id)) {
    const request = fetch('/open-api/v1/works/'+encodeURIComponent(id)+'.json').then(response => {
      if (!response.ok) throw Error('Metadata unavailable');
      return response.json();
    }).then(data => {
      if (data.work?.id !== id) throw Error('Work identity mismatch');
      return data.work;
    }).catch(error => {cache.delete(id);throw error;});
    cache.set(id,request);
  }
  return cache.get(id);
}

export function renderPreviewMetadata(work, snapshot, {translate:tx, names=value=>value, url=value=>value, language='zh'} = {}) {
  const localized = work.i18n?.[language] || {};
  const t = (key, fallback) => tx('d.previewMetadata.'+key,fallback);
  const date = value => value ? String(value).replace('T',' ').replace(/\.\d+Z$/,' UTC').replace(/Z$/,' UTC') : '—';
  const safeURL = value => {
    try {
      const parsed = new URL(value,'https://xn--pssy23gqgbz2d718b.com');
      if (!['https:','http:'].includes(parsed.protocol)) return '';
      return parsed.origin === 'https://xn--pssy23gqgbz2d718b.com' ? url(parsed.pathname+parsed.search+parsed.hash) : parsed.href;
    } catch {return '';}
  };
  const row = (key, label, value, href, author=false) => {
    const target = href && safeURL(href);
    const content = author ? `<span class="author-name">${escape(value)}</span>` : escape(names(value));
    return `<div data-preview-field="${key}"><dt>${escape(label)}</dt><dd>${target?`<a href="${escape(target)}">${content}</a>`:content}</dd></div>`;
  };
  const unknown = t('unknown','未标注');
  const metric = snapshot?.available === true ? snapshot.works?.[work.id] : null;
  const unavailable = t('unavailable','统计不可用');
  const count = key => Number.isSafeInteger(metric?.[key]) && metric[key]>=0 ? metric[key].toLocaleString() : unavailable;
  const description = localized.description || work.description;
  const fields = [
    row('id',t('id','作品 ID'),work.id),
    row('created',t('created','收录时间'),date(work.createdAt)),
    row('updated',t('updated','更新日期'),date(work.updatedAt)),
    row('author',t('author','原作者'),work.author?.name || t('unknownAuthor','原作者未标注'),null,!!work.author?.name),
    row('credit',t('credit','投稿署名'),work.attribution?.name || unknown,work.attribution?.url,!!work.attribution?.name),
    row('source',t('source','原始来源'),work.source?.url?t('viewSource','查看来源'):unknown,work.source?.url),
    row('dimensions',t('dimensions','原图尺寸'),work.image?.width && work.image?.height ? `${work.image.width} × ${work.image.height}` : '—'),
    row('rights',t('rights','版权说明'),work.license?.copyrightNotice || unknown),
    ...(localized.licenseNote || work.license?.note ? [row('license',t('license','授权备注'),localized.licenseNote || work.license.note,work.license?.url)] : []),
    row('views',t('views','浏览次数'),count('views')),
    row('downloads',t('downloads','下载点击'),count('downloads'))
  ];
  const updated = new Date(snapshot?.syncedAt);
  const note = metric && !Number.isNaN(updated.getTime()) ? tx('stats.updated','统计更新：{date}；下载为按钮点击次数',{date:date(snapshot.syncedAt)})+(snapshot.stale?' · '+tx('stats.stale','统计更新延迟'):'')+(snapshot.limited?' · '+tx('stats.limited','部分统计受 GA4 汇总限制'):'') : unavailable;
  return `<section class="preview-complete-details" data-complete-preview="${escape(work.id)}" aria-label="${escape(t('title','完整作品信息'))}"><h3>${escape(t('title','完整作品信息'))}</h3>${description?`<p class="preview-complete-description">${escape(names(description))}</p>`:''}<dl>${fields.join('')}</dl><p class="preview-stats-source">${escape(note)}</p></section>`;
}
