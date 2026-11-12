import {workPreviewAttributes} from '../../../public/components/work-preview.js';
import {workImageAlt} from '../../../public/components/image-alt.js';
import {workImageURL} from '../../../public/components/work-image.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const kinds={meme:'梗图',illustration:'插画',setting:'设定图',comic:'漫画',standing:'立绘',other:'其他'};
export function renderHomeCard(work,{eager=false,priority=false,url=href=>href,translate=(_key,text)=>text,names=text=>text}={}) {
  const href=esc(url('/works/'+work.slug+'.html')),preview=workPreviewAttributes(work.slug);
  const [width,height]=work.p||[work.w||480,work.h||480];
  const roles=(work.roles||[]).map(role=>`<a data-character-id="${esc(role.id)}" href="${esc(url('/characters/'+role.id+'.html'))}">${esc(names(role.name))}</a>`).join(' / ');
  const types=work.k.map(id=>`<span data-i18n="v2.type.${esc(id)}">${esc(translate('v2.type.'+id,kinds[id]||id))}</span>`).join(' · ');
  return `<article class="card work-card" data-slug="${esc(work.slug)}"><a class="card-media work-art" href="${href}" ${preview} aria-label="${esc(translate('d.quickView','预览'))} ${esc(names(work.n))}"><img src="${esc(workImageURL(work.i))}" width="${width}" height="${height}" alt="${esc(workImageAlt(work,names))}" loading="${eager?'eager':'lazy'}" decoding="async"${priority?' fetchpriority="high"':''}></a><a class="card-title work-title" href="${href}" ${preview}>${esc(names(work.n))}</a><div class="card-meta">${roles} · ${types}</div></article>`;
}
