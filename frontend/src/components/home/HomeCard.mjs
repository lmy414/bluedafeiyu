import {workPreviewAttributes} from '../../../public/components/work-preview.js';
import {workImageAlt} from '../../../public/components/image-alt.js';
import {workImageURL} from '../../../public/components/work-image.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const kinds={meme:'梗图',illustration:'插画',setting:'设定图',comic:'漫画',standing:'立绘',other:'其他'};
export function renderHomeCard(work,{eager=false,priority=false}={}) {
  const href='/works/'+esc(work.slug)+'.html',preview=workPreviewAttributes(work.slug);
  const [width,height]=work.p||[work.w||480,work.h||480];
  const roles=(work.roles||[]).map(role=>`<a data-character-id="${esc(role.id)}" href="/characters/${esc(role.id)}.html">${esc(role.name)}</a>`).join(' / ');
  const types=work.k.map(id=>`<span data-i18n="v2.type.${esc(id)}">${esc(kinds[id]||id)}</span>`).join(' · ');
  return `<article class="card work-card" data-slug="${esc(work.slug)}"><a class="card-media work-art" href="${href}" ${preview} aria-label="预览 ${esc(work.n)}"><img src="${esc(workImageURL(work.i))}" width="${width}" height="${height}" alt="${esc(workImageAlt(work))}" loading="${eager?'eager':'lazy'}" decoding="async"${priority?' fetchpriority="high"':''}></a><a class="card-title work-title" href="${href}" ${preview}>${esc(work.n)}</a><div class="card-meta">${roles} · ${types}</div></article>`;
}
