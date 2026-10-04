export function createCollectionCards(ctx) {
  const { topics, esc, old, icon, card, tr } = ctx;
const collectionCard = (t, {download=false} = {}) => `${download?'<article class="collection-card collection-card-download">':''}<a class="${download?'collection-link':'collection-card'}" href="/topics/${esc(t.id)}.html"><div class="collection-art">${t.list.slice(0,3).map(w=>`<img src="${esc(w.i)}" alt="" loading="lazy" width="${w.w}" height="${w.h}">`).join('')}</div><div class="collection-body"><span class="eyebrow">${esc(t.eyebrow || '主题合集')}</span><h3>${esc(t.name)}</h3><p>${esc(t.summary)}</p><div class="collection-foot"><span>${t.list.length} ${old('v2.work','作品')}</span>${icon('arrow',19)}</div></div></a>${download?`<button class="button small collection-download" type="button" data-download-topic="${esc(t.id)}">${icon('download',16)}${tr('zipDownload','打包下载原图','Download originals ZIP','元画像をZIPでダウンロード')}</button></article>`:''}`;

  return { collectionCard };
}
