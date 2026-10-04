export function createCharacterCards(ctx) {
  const { bySlug, editorial, esc, old, icon, card } = ctx;
const roleCover = c => bySlug.get(editorial.characterCovers[c.id]) || c.list.find(w=>w.k.includes('setting')) || c.list.find(w=>w.k.includes('illustration')) || c.list[0];
const roleCard = c => { const w=roleCover(c); return `<a href="/characters/${c.id}.html" class="role-card" style="--role:${w.col};--role-soft:${w.cs}"><div class="role-art"><img src="${esc(w.i)}" width="${w.w}" height="${w.h}" alt="${esc(c.name)}" loading="lazy"></div><div class="role-body"><h3>${esc(c.name)}</h3><p>${esc(c.aliases.join(' / ') || c.name)}</p><span>${c.list.length} ${old('v2.work','作品')}${icon('arrow',16)}</span></div></a>`; };

  return { roleCover, roleCard };
}
