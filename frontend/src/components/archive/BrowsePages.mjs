export function createBrowsePages(ctx) {
  const { works, types, tr, old, browsePage, write } = ctx;
write('/browse.html','全部作品','browse',browsePage(works,'/browse.html',tr('allWorks','全部作品','All works','作品一覧')),{attrs:'data-list-page'});
for(const t of types) write('/categories/'+t.id+'.html',t.name,'browse',browsePage(works.filter(w=>w.k.includes(t.id)),'/categories/'+t.id+'.html',old('v2.type.'+t.id,t.name),t.id),{attrs:`data-list-page data-type="${t.id}"`});

}
