import {renderWorkActions} from './work-actions.js';
import {workImageURL} from './work-image.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const icon = name => {
  const paths = {zoom:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5M11 8v6M8 11h6"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',back:'<path d="M19 12H5m5-5-5 5 5 5"/>'};
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

// Keep real detail URLs for no-JS browsing, link menus and search engines.
export const workPreviewAttributes = slug => `data-preview="${esc(slug)}" aria-haspopup="dialog" aria-controls="preview-dialog"`;

export function installWorkPreview({load, localize = w => w, translate:tx, url, names, toast, document:doc = globalThis.document, components = globalThis.SiteComponents}) {
  const dialog = doc.querySelector('#preview-dialog');
  const body = doc.querySelector('#preview-body');
  const closeButton = dialog?.querySelector('[data-preview-close]');
  if (!dialog || !body || !closeButton || !dialog.showModal) return;
  let slugs = [], index = 0, focus, mode = 'work', request = 0, locked = false, zoomFromWork = false;

  const listFor = (opener, slug) => {
    const scope = opener?.closest('.work-grid,[data-feed-grid],[data-creator-rail],.home-downloads-list,.home-works-grid');
    const items = scope ? [...scope.querySelectorAll('[data-preview]')]
      .filter(node => !node.closest('[hidden]')).map(node => node.dataset.preview) : [];
    const list = [...new Set(items)];
    return list.includes(slug) ? list : [slug];
  };
  const restore = () => {
    if (dialog.open || !locked) return;
    locked = false;
    request++;
    zoomFromWork = false;
    components.scrollLock(false);
    if (focus?.isConnected) focus.focus({preventScroll:true});
    focus = undefined;
  };
  function close() {
    request++;
    zoomFromWork = false;
    dialog.close();
    restore();
  }
  async function open(slug, nextMode = 'work', opener, trackView = true) {
    const currentRequest = ++request;
    const nextSlugs = opener ? listFor(opener, slug) : slugs;
    try {
      const data = await load();
      if (currentRequest !== request) return;
      const original = data.works.find(w => w.slug === slug);
      if (!original) throw Error('Work unavailable');
      const localized = localize(original);
      const w = {...localized, l: workImageURL(localized.l)};
      slugs = nextSlugs.includes(slug) ? nextSlugs : [slug];
      index = slugs.indexOf(slug);
      mode = nextMode;
      dialog.dataset.previewMode = mode;
      if (!dialog.open) {
        focus = opener || doc.activeElement;
        dialog.showModal();
        components.scrollLock(true);
        locked = true;
      }
      const heading = `<header class="preview-heading">${icon('image')}<span>${esc(tx('d.previewTitle','作品预览'))}</span>${mode === 'image' && zoomFromWork ? `<button class="button small preview-back" type="button" data-preview-back>${icon('back')}${esc(tx('d.previewBack','返回预览'))}</button>` : ''}<a class="button small preview-detail-link" href="${esc(url('/works/'+w.slug+'.html'))}">${esc(tx('d.fullDetail','查看详情'))}${icon('arrow')}</a></header>`;
      const actions = renderWorkActions(w, {preview:true,translate:tx,url});
      const source = /^https?:\/\//i.test(w.su || '') ? w.su : '';
      const sourceLink = source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(tx('d.originalSource','查看原始来源'))}${icon('arrow')}</a>` : esc(tx('d.previewSourceUnknown','来源未标注'));
      if (mode === 'image') {
        body.innerHTML = `${heading}${actions}<div class="preview-zoom"><img src="${esc(w.l)}" alt="${esc(w.d||w.n)}" width="${w.w}" height="${w.h}"></div>`;
      } else {
        body.innerHTML = `${heading}
          <div class="preview-content">
            <div class="preview-art"><figure class="preview-photo"><img src="${esc(w.l)}" alt="${esc(w.d||w.n)}" width="${w.w}" height="${w.h}"></figure><button type="button" class="preview-zoom-button icon-button" data-preview-zoom aria-label="${esc(tx('d.previewZoom','放大查看图片'))}">${icon('zoom')}</button></div>
            <div class="preview-sidebar"><div class="preview-info">
              <div class="preview-topline">${w.roles.map(role=>`<a class="preview-role" data-character-id="${esc(role.id)}" href="${esc(url('/characters/'+role.id+'.html'))}">${components.roleDot(role.color)}${esc(role.name)}${icon('arrow')}</a>`).join('')}<span class="preview-kind">${w.k.map(id=>esc(tx('v2.type.'+id,id))).join(' · ')}</span></div>
              <h2>${esc(w.n)}</h2>
              <div class="preview-note"><span class="eyebrow">${esc(tx('d.fishComment','大肥鱼说'))}</span><p>${esc(w.cm||w.d)}</p></div>
              ${w.tg.length?`<div class="tags preview-tags">${w.tg.slice(0,6).map((t,i)=>`<a class="tag" href="${esc(url('/search.html?q='+encodeURIComponent(w.sourceTags?.[i]||t)))}"><span aria-hidden="true">#</span>${esc(names(t))}</a>`).join('')}</div>`:''}
              <dl class="preview-facts"><div><dt>${esc(tx('work.field.originAuthor','来源作者'))}</dt><dd>${esc(w.sa||tx('d.previewAuthorUnknown','原作者未标注'))}</dd></div><div><dt>${esc(tx('v2.source','来源'))}</dt><dd>${sourceLink}</dd></div><div><dt>${esc(tx('d.previewFormat','原图格式'))}</dt><dd>${esc(w.f||'—')}</dd></div><div><dt>${esc(tx('d.previewSize','文件大小'))}</dt><dd>${esc(w.s||'—')}</dd></div><div class="preview-permission"><dt>${esc(tx('d.previewPermission','使用许可'))}</dt><dd>${esc(tx('license.'+w.lk,w.lt))}</dd></div><div><dt>${esc(tx('work.field.date','收录时间'))}</dt><dd>${esc(w.dt||'—')}</dd></div></dl>
            </div></div>
          </div>${actions}
          <nav class="preview-nav" aria-label="${esc(tx('d.previewNavigation','作品切换'))}"><button type="button" class="preview-step" data-preview-step="-1" ${index===0?'disabled':''}>${icon('back')}${esc(tx('d.prevWork','上一张'))}</button><span class="preview-position"><b>${String(index+1).padStart(2,'0')}</b><span>/</span>${String(slugs.length).padStart(2,'0')}</span><button type="button" class="preview-step" data-preview-step="1" ${index===slugs.length-1?'disabled':''}>${esc(tx('d.nextWork','下一张'))}${icon('arrow')}</button></nav>`;
        if (trackView) doc.dispatchEvent(new doc.defaultView.CustomEvent('work:show',{detail:{id:w.id,viewType:'preview'}}));
      }
      doc.dispatchEvent(new doc.defaultView.Event('preview:render'));
      dialog.scrollTop = 0;
      closeButton.focus({preventScroll:true});
    } catch {
      if (currentRequest === request) toast(tx('d.loadFail','数据加载失败，请刷新页面。'));
    }
  }
  const step = offset => {
    const slug = slugs[index+offset];
    if (slug) return open(slug);
  };
  doc.addEventListener('click', event => {
    if (event.defaultPrevented || (event.button ?? 0) !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const opener = event.target.closest('[data-preview],[data-image-open]');
    if (opener) {
      event.preventDefault();
      open(opener.dataset.preview || opener.dataset.imageOpen, opener.hasAttribute('data-image-open') ? 'image' : 'work', opener);
      return;
    }
    if (event.target.closest('[data-preview-zoom]')) { zoomFromWork = true; open(slugs[index], 'image'); return; }
    if (event.target.closest('[data-preview-back]')) { zoomFromWork = false; open(slugs[index], 'work', undefined, false); return; }
    const button = event.target.closest('[data-preview-step]');
    if (button && !button.disabled) step(Number(button.dataset.previewStep));
  });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', restore);
  dialog.addEventListener('cancel', event => {event.preventDefault();if (mode === 'image' && zoomFromWork) {zoomFromWork = false;open(slugs[index], 'work', undefined, false);} else close();});
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close();
  });
  doc.addEventListener('keydown', event => {
    if (!dialog.open || mode !== 'work' || doc.querySelector('#share-card-dialog')?.open || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    if (['ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();
      step(event.key === 'ArrowRight' ? 1 : -1);
    }
  });
  return {open,close};
}
