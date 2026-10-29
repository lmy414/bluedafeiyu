import {renderSaveButton} from '../archive/saved-items.js';
import {renderShareButton} from './share-card-model.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const paths = {download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',link:'<path d="m9 15 6-6m-1-4 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-5 0m-2 3-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 5 0"/>'};
const icon = name => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;

// A real link is available before JavaScript on detail, preview and listing cards.
export function renderDownloadLink(work, {translate = (_key,text)=>text, label, className = 'button primary'} = {}) {
  if (!work.o) return '';
  let original;
  try { original = new URL(work.o,'https://xn--pssy23gqgbz2d718b.com'); } catch { return ''; }
  if (!['http:','https:'].includes(original.protocol)) return '';
  const text = label ?? `<span data-i18n="work.download">${escape(translate('work.download','下载原图'))}</span>`;
  return `<a class="${escape(className)}" data-download-work="${escape(work.id)}" href="${escape(original.href)}" target="_blank" rel="noopener">${icon('download')}${text}</a>`;
}

export function renderWorkActions(work, {preview = false, translate = (_key,text)=>text, url = value=>value} = {}) {
  const label = (key,text) => `<span data-i18n="${key}">${escape(translate(key,text))}</span>`;
  const href = '/works/' + work.slug + '.html';
  const copyImageLabel = escape(translate('v2.copyImg','复制图片'));
  const copyLinkLabel = escape(translate('d.share','复制链接'));
  return `<div class="${preview?'preview-toolbar':'work-action-bar'}" data-work-actions><div class="detail-actions">${renderSaveButton('works',work.slug,{translate,className:'button'})}${renderDownloadLink(work,{translate})}<button class="button" type="button" data-copy-img="${escape(work.l)}" data-copy-animated="${/^(GIF|APNG)$/i.test(work.f)}" aria-label="${copyImageLabel}" title="${copyImageLabel}" data-i18n-attr="aria-label:v2.copyImg,title:v2.copyImg">${icon('image')}${label('v2.copyImg','复制图片')}</button><button class="button" type="button" data-copy-link="${escape(url(href))}" aria-label="${copyLinkLabel}" title="${copyLinkLabel}" data-i18n-attr="aria-label:d.share,title:d.share">${icon('link')}${label('d.share','复制链接')}</button>${renderShareButton(href,{translate})}</div><p class="image-copy-status" data-image-copy-status role="status" aria-live="polite"></p></div>`;
}
