// One renderer for Astro's static HTML and cards appended in the browser.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const kindNames = {meme:'梗图',illustration:'插画',setting:'设定图',comic:'漫画'};
export function renderWorkCard(work, {url = value => value, translate = (_key,value) => value, eager = false} = {}) {
  const href = esc(url('/works/' + work.slug + '.html'));
  const roleHref = esc(url('/characters/' + work.cid + '.html'));
  const kinds = work.k.map(id => `<span data-i18n="v2.type.${esc(id)}">${esc(translate('v2.type.' + id, kindNames[id] || id))}</span>`).join(' · ');
  const preview = esc(translate('d.quickView','预览') + ' ' + work.n);
  return `<article class="work-card" data-slug="${esc(work.slug)}">
    <a class="work-art" href="${href}"><img src="${esc(work.i)}" alt="${esc(work.d || work.n)}" width="${work.w || 480}" height="${work.h || 480}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"><span class="type-label">${kinds}</span></a>
    <button class="quick-view" type="button" data-preview="${esc(work.slug)}" aria-label="${preview}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg></button>
    <div class="work-text"><a class="work-title" href="${href}">${esc(work.n)}</a><div class="card-meta"><a href="${roleHref}"><i class="role-dot" style="--role:${esc(work.col)}"></i>${esc(work.c)}</a><time>${esc(work.dt)}</time></div></div>
  </article>`;
}
