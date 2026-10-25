import {isGifWork} from '../../../public/archive/work-format.js';
export function createBrowsePages(ctx) {
  const { works, types, tr, old, browsePage, write } = ctx;
write('/browse.html','全部图片','browse',browsePage(works,'/browse.html',tr('allWorks','全部图片','All images','画像一覧')),{attrs:'data-list-page'});
write('/gifs.html','GIF 动图','browse',browsePage(works.filter(isGifWork),'/gifs.html',tr('gifTitle','GIF 动图','GIFs','GIFアニメ'),'','',1,tr('gifLead','按原图 GIF 格式自动归集，保留原有作品类型；可继续按角色和类型筛选，下载原图查看完整动画。','Automatically collected from GIF originals while preserving each work’s type. Filter by character and type, and download originals for the full animation.','GIF形式の元画像を自動でまとめています。作品の種類はそのまま、キャラクターや種類で絞り込み、元画像をダウンロードしてアニメーションを楽しめます。')),{attrs:'data-list-page'});
for(const t of types) write('/categories/'+t.id+'.html',t.name,'browse',browsePage(works.filter(w=>w.k.includes(t.id)),'/categories/'+t.id+'.html',old('v2.type.'+t.id,t.name),t.id),{attrs:`data-list-page data-type="${t.id}"`});

}
