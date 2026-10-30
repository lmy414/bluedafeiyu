import {renderShareButton} from '../../../public/components/share-card-model.js';
export function createCharacterCards(ctx) {
  const { editorial, esc, old, icon, card } = ctx;
const roleCover = c => c.list.find(w=>w.slug===editorial.characterCovers[c.id]) || c.list.find(w=>w.k.includes('setting')) || c.list.find(w=>w.k.includes('illustration')) || c.list[0] || {i:'/avatar.png',w:96,h:96,col:'var(--blue)',cs:'var(--blue-pale)',n:c.name,placeholder:true};
const roleCard = c => { const w=roleCover(c); return `<article class="role-share-card"><a href="/characters/${c.id}.html" class="role-card" style="--role:${w.col};--role-soft:${w.cs}"><div class="role-art"><img src="${esc(w.i)}" width="${w.w}" height="${w.h}" alt="${esc(c.name)}" loading="lazy"></div><div class="role-body"><h3>${esc(c.name)}</h3><p>${esc(c.aliases.join(' / ') || c.name)}</p><span>${c.list.length} ${old('v2.work','作品')}${icon('arrow',16)}</span></div></a>${renderShareButton('/characters/'+c.id+'.html',{compact:true})}</article>`; };

  return { roleCover, roleCard };
}
