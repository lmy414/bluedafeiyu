import {workImageAlt} from './image-alt.js';
import {renderWorkActions} from './work-actions.js';
import {workImageURL} from './work-image.js';
import {loadPreviewMetadata,renderPreviewMetadata} from './preview-metadata.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const icon = name => {
  const paths = {image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',back:'<path d="M19 12H5m5-5-5 5 5 5"/>'};
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

// Keep real detail URLs for no-JS browsing, link menus and search engines.
export const workPreviewAttributes = slug => `data-preview="${esc(slug)}" aria-haspopup="dialog" aria-controls="preview-dialog"`;

export function installWorkPreview({load, localize = w => w, translate:tx, url, names, toast, loadMetadata=loadPreviewMetadata, document:doc = globalThis.document, components = globalThis.SiteComponents}) {
  const dialog = doc.querySelector('#preview-dialog');
  const body = doc.querySelector('#preview-body');
  const closeButton = dialog?.querySelector('[data-preview-close]');
  if (!dialog || !body || !closeButton || !dialog.showModal) return;
  let slugs = [], index = 0, focus, mode = 'work', request = 0, locked = false;
  const listScope = '.work-grid,[data-feed-grid],[data-creator-rail],.home-downloads-list';

  const listFor = (opener, slug) => {
    const scope = opener?.closest(listScope);
    const items = scope ? [...scope.querySelectorAll('[data-preview]')]
      .filter(node => !node.closest('[hidden]')).map(node => node.dataset.preview) : [];
    const list = [...new Set(items)];
    return list.includes(slug) ? list : [slug];
  };
  const returnContext = (node, slug) => {
    if (node === doc.body || dialog.contains(node)) node = null;
    const roots = [];
    for (let root = node?.closest(listScope) || node?.parentElement; root && root !== doc.body && root.tagName !== 'MAIN'; root = root.parentElement) roots.push(root);
    return {node, slug, title:!!node?.matches('.work-title'), roots};
  };
  const available = node => node?.isConnected && !node.closest('[hidden],[inert]') && !node.disabled && (!node.getClientRects || node.getClientRects().length > 0);
  const restore = () => {
    if (dialog.open || !locked) return;
    locked = false;
    request++;
    components.scrollLock(false);
    const root = focus?.roots.find(available);
    const links = root ? [...root.querySelectorAll('[data-preview],[data-image-open]')].filter(available) : [];
    const matches = links.filter(node => (node.dataset.preview || node.dataset.imageOpen) === focus?.slug);
    const target = available(focus?.node) ? focus.node : matches.find(node => node.matches('.work-title') === focus?.title) || matches[0] || links[0] || root || doc.querySelector('main');
    if (available(target)) {
      if (!target.matches('a[href],button,input,select,textarea,[tabindex]')) {
        target.setAttribute('tabindex','-1');
        target.addEventListener('blur',()=>{if(target.getAttribute('tabindex')==='-1')target.removeAttribute('tabindex');},{once:true});
      }
      target.focus({preventScroll:true});
    }
    focus = undefined;
  };
  function close() {
    request++;
    dialog.close();
    restore();
  }
  async function open(slug, nextMode = 'work', opener, navigationStep) {
    const currentRequest = ++request;
    const nextSlugs = opener ? listFor(opener, slug) : slugs;
    const returnFocus = returnContext(opener || doc.activeElement, slug);
    try {
      const data = await load();
      if (currentRequest !== request) return;
      const original = data.works.find(w => w.slug === slug);
      if (!original) throw Error('Work unavailable');
      const localized = localize(original);
      const w = {...localized, l: workImageURL(localized.l)};
      const [width,height] = w.v || [w.w||480,w.h||480];
      slugs = nextSlugs.includes(slug) ? nextSlugs : [slug];
      index = slugs.indexOf(slug);
      mode = nextMode;
      dialog.dataset.previewMode = mode;
      if (!dialog.open) {
        focus = returnFocus;
        dialog.showModal();
        components.scrollLock(true);
        locked = true;
      }
      const heading = `<header class="preview-heading">${icon('image')}<span>${esc(tx('d.previewTitle','作品预览'))}</span><a class="button small preview-detail-link" href="${esc(url('/works/'+w.slug+'.html'))}">${esc(tx('d.fullDetail','查看详情'))}${icon('arrow')}</a></header>`;
      const actions = renderWorkActions(w, {preview:true,translate:tx,url});
      if (mode === 'image') {
        dialog.removeAttribute('aria-labelledby');
        body.innerHTML = `${heading}${actions}<div class="preview-zoom"><img src="${esc(w.l)}" alt="${esc(workImageAlt(w))}" width="${width}" height="${height}"></div>`;
      } else {
        dialog.setAttribute('aria-labelledby','preview-work-title');
        body.innerHTML = `${heading}${actions}
          <div class="preview-content">
            <div class="preview-art"><figure class="preview-photo"><img src="${esc(w.l)}" alt="${esc(workImageAlt(w))}" width="${width}" height="${height}"></figure></div>
            <div class="preview-info">
              <div class="preview-topline">${w.roles.map(role=>`<a class="preview-role" data-character-id="${esc(role.id)}" href="${esc(url('/characters/'+role.id+'.html'))}">${components.roleDot(role.color)}${esc(role.name)}${icon('arrow')}</a>`).join('')}<span class="preview-kind">${w.k.map(id=>esc(tx('v2.type.'+id,id))).join(' · ')}</span></div>
              <h2 id="preview-work-title">${esc(w.n)}</h2>
              <div class="preview-note"><span class="eyebrow">${esc(tx('d.fishComment','大肥鱼说'))}</span><p>${esc(w.cm||w.d)}</p></div>
              ${w.tg.length?`<div class="tags preview-tags">${w.tg.map((t,i)=>`<a class="tag" href="${esc(url('/search.html?q='+encodeURIComponent(w.sourceTags?.[i]||t)))}"><span aria-hidden="true">#</span>${esc(names(t))}</a>`).join('')}</div>`:''}
              <dl class="preview-facts"><div><dt>${esc(tx('d.previewFormat','原图格式'))}</dt><dd>${esc(w.f||'—')}</dd></div><div><dt>${esc(tx('d.previewSize','文件大小'))}</dt><dd>${esc(w.s||'—')}</dd></div><div class="preview-permission"><dt>${esc(tx('d.previewPermission','使用许可'))}</dt><dd>${esc(tx('license.'+w.lk,w.lt))}</dd></div></dl>
            </div>
          </div>
          <nav class="preview-nav" aria-label="${esc(tx('d.previewNavigation','作品切换'))}"><button type="button" class="preview-step" data-preview-step="-1" ${index===0?'disabled':''}>${icon('back')}${esc(tx('d.prevWork','上一张'))}</button><span class="preview-position"><b>${String(index+1).padStart(2,'0')}</b><span>/</span>${String(slugs.length).padStart(2,'0')}</span><button type="button" class="preview-step" data-preview-step="1" ${index===slugs.length-1?'disabled':''}>${esc(tx('d.nextWork','下一张'))}${icon('arrow')}</button></nav>`;
        doc.dispatchEvent(new doc.defaultView.CustomEvent('work:show',{detail:{id:w.id,viewType:'preview'}}));
        const info = body.querySelector('.preview-info');
        Promise.all([loadMetadata(w.id),doc.defaultView.WorkStats?.ready]).then(([metadata,statistics]) => {
          if (currentRequest !== request || !dialog.open || !info.isConnected) return;
          const lang = doc.defaultView.SiteLang?.current || 'zh';
          info.insertAdjacentHTML('beforeend',renderPreviewMetadata(metadata,statistics,{translate:tx,names,url,language:lang}));
        }).catch(() => {
          if (currentRequest !== request || !dialog.open || !info.isConnected) return;
          const message = doc.createElement('p');
          message.className = 'preview-complete-details';
          message.textContent = tx('d.previewMetadata.loadFailed','完整信息暂不可用，可打开作品详情。');
          info.append(message);
        });
      }
      doc.dispatchEvent(new doc.defaultView.Event('preview:render'));
      dialog.scrollTop = 0;
      // The requested step can become disabled at a boundary; keep focus in navigation.
      const stepControl = navigationStep && (body.querySelector(`[data-preview-step="${navigationStep}"]:not([disabled])`) || body.querySelector('[data-preview-step]:not([disabled])'));
      (stepControl || closeButton).focus({preventScroll:true});
    } catch {
      if (currentRequest === request) toast(tx('d.loadFail','数据加载失败，请刷新页面。'));
    }
  }
  const step = offset => {
    const slug = slugs[index+offset];
    if (slug) return open(slug, 'work', undefined, offset);
  };
  doc.addEventListener('click', event => {
    if (event.defaultPrevented || (event.button ?? 0) !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const opener = event.target.closest('[data-preview],[data-image-open]');
    if (opener) {
      event.preventDefault();
      open(opener.dataset.preview || opener.dataset.imageOpen, opener.hasAttribute('data-image-open') ? 'image' : 'work', opener);
      return;
    }
    const button = event.target.closest('[data-preview-step]');
    if (button && !button.disabled) step(Number(button.dataset.previewStep));
  });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', restore);
  dialog.addEventListener('cancel', event => {event.preventDefault();close();});
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close();
  });
  // OpenCC can finish after the dialog has rendered. Convert the currently
  // visible content in place: do not reload an image, reset focus/scroll, or
  // emit another view. A pending open/step uses the ready converter itself.
  doc.addEventListener('site:langchange', event => {
    if (event.detail?.lang !== 'zh-Hant' || !dialog.open) return;
    const refresh = node => {
      if (node.nodeType === 3) { node.textContent = names(node.textContent); return; }
      if (node.nodeType !== 1) return;
      if (node.classList.contains('author-name')) return;
      for (const attr of ['alt','aria-label','title']) {
        if (node.hasAttribute(attr)) node.setAttribute(attr, names(node.getAttribute(attr)));
      }
      for (const child of node.childNodes) refresh(child);
    };
    refresh(body);
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
