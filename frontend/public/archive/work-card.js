import {renderSaveButton} from './saved-items.js';
// One renderer for Astro's static HTML and cards appended in the browser.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const kindNames = {meme:'梗图',illustration:'插画',setting:'设定图',comic:'漫画',standing:'立绘',other:'其他'};
export function renderWorkCard(work, {url = value => value, translate = (_key,value) => value, names = value => value, eager = false} = {}) {
  const href = esc(url('/works/' + work.slug + '.html'));
  const roles = work.roles || [{id: work.cid, name: work.c, color: work.col}];
  const roleLinks = roles.map(role => `<a data-character-id="${esc(role.id)}" href="${esc(url('/characters/' + role.id + '.html'))}"><i class="role-dot" style="--role:${esc(role.color)}"></i>${esc(names(role.name))}</a>`).join('');
  const kinds = work.k.map(id => `<span data-i18n="v2.type.${esc(id)}">${esc(translate('v2.type.' + id, kindNames[id] || id))}</span>`).join(' · ');
  const long=(work.h||0)/(work.w||1)>2.8;
  const owners=(work.owners||[]).map(c=>`<a href="${esc(url(c.href))}">${esc(c.name)}</a>`).join(' / ');
  const preview = esc(translate('d.quickView','预览') + ' ' + names(work.n));
  return `<article class="work-card art-card" data-slug="${esc(work.slug)}">
    <a class="work-art art-media${long?' is-long':''}" href="${href}" style="--ratio:${work.w||480}/${work.h||480}"><img src="${esc(work.i)}" alt="${esc(names(work.d || work.n))}" width="${work.w || 480}" height="${work.h || 480}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">${work.lk ? `<span class="art-license" data-i18n="v2.licenseShort.${esc(work.lk)}" data-i18n-attr="title:license.${esc(work.lk)}" title="${esc(translate('license.' + work.lk,work.lt || ''))}">${esc(translate('v2.licenseShort.' + work.lk,work.ls || work.lt || ''))}</span>` : ''}<span class="type-label art-kind">${kinds}</span>${long?`<span class="long-image-note" data-i18n="d.longImage">${esc(translate('d.longImage','长图 · 点击看全'))}</span>`:''}<span class="art-open"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg><span data-i18n="d.viewLarge">${esc(translate('d.viewLarge','看大图'))}</span></span></a>
    <button class="quick-view card-preview" type="button" data-preview="${esc(work.slug)}" aria-label="${preview}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg></button>
    ${renderSaveButton('works',work.slug,{translate,className:'card-save'})}
    <div class="work-text art-copy"><a class="work-title art-title" href="${href}">${esc(names(work.n))}</a>${owners?`<div class="art-owner">${owners}</div>`:''}<div class="card-meta art-meta"><div class="card-roles">${roleLinks}</div><time title="${esc(work.dt)}">${esc(work.dt?.slice(5))}</time></div><p class="image-stats" data-work-stats="${esc(work.id)}"></p></div>
  </article>`;
}
