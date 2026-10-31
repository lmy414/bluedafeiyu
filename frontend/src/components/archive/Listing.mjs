import {renderArchiveTabs} from './ArchiveTabs.mjs';
export function createListing(ctx) {
  const { works, chars, types, esc, tr, old, icon, grid, pageHead } = ctx;
  // `character` turns the bar into the role-library variant: the role and type
  // selects stay as hidden state (the page fixes the role, type tabs drive the
  // type), and search, creation method, sort and direction share one row.
  function filters(initialChar = '', initialType = '', initialSort = 'latest', list = works, character = null) {
    const counts = new Map();
    for (const work of list) for (const id of work.cids || [work.cid]) counts.set(id, (counts.get(id) || 0) + 1);
    const roles = chars.filter(c => counts.has(c.id));
    const relevance = initialSort==='relevance' ? `<option value="relevance">${tr('relevance','最相关','Most relevant','関連度順')}</option>` : '';
    const hidden = character ? ' hidden' : '';
    const roleSelect = `<select name="character" multiple aria-label="角色筛选" data-i18n-attr="aria-label:d.roleFilter"${character?'':' aria-describedby="character-filter-help"'}${hidden}><option value="" ${!initialChar?'selected':''} data-i18n="d.allRoles">全部角色</option>${roles.map(c=>`<option value="${c.id}" ${c.id===initialChar?'selected':''}>${esc(c.name)} (${counts.get(c.id)})</option>`).join('')}</select>`;
    const typeSelect = `<select name="type" aria-label="类型筛选" data-i18n-attr="aria-label:d.typeFilter"${hidden}><option value="" data-i18n="d.allTypes">全部类型</option>${types.map(t=>`<option value="${t.id}" ${t.id===initialType?'selected':''} data-i18n="v2.type.${t.id}">${esc(t.name)}</option>`).join('')}</select>`;
    const creationSelect = `<select name="creation" aria-label="创作方式筛选" data-i18n-attr="aria-label:d.creationFilter" aria-describedby="creation-filter-help"><option value="">${tr('allCreation','全部创作','All works','すべての作品')}</option><option value="non-ai">${tr('nonAiFilter','非AI创作','Non-AI works','非AI作品')}</option></select>`;
    const sortSelect = `<select name="sort" aria-label="排序" data-i18n-attr="aria-label:d.sortFilter">${relevance}${initialSort==='curated'?`<option value="curated" selected data-i18n="d.curated">精选顺序</option>`:''}<option value="latest" ${initialSort==='latest'?'selected':''}>${tr('sortTime','时间','Time','日時')}</option><option value="popular" disabled>${tr('sortClicks','点击量','Views','閲覧数')}</option><option value="downloads" disabled>${tr('sortDownloads','下载量','Downloads','ダウンロード数')}</option><option value="random">${tr('sortRandom','随机','Random','ランダム')}</option></select>`;
    const directionSelect = `<select name="direction" aria-label="顺序" data-i18n-attr="aria-label:d.sortDirection"><option value="desc" ${initialSort==='curated'?'':'selected'}>${tr('sortDesc','倒序','Descending','降順')}</option><option value="asc" ${initialSort==='curated'?'selected':''}>${tr('sortAsc','正序','Ascending','昇順')}</option></select>`;
    const reset = `<button class="text-button" type="button" data-reset>${tr('clear','清除条件','Reset filters','条件をクリア')}</button>`;
    const creationHelp = tr('creationHelp','非 AI 创作仅收录手绘等非 AI 生成的相关二创，依据作者或投稿者说明标注；未标注不代表使用了 AI。','Non-AI works include hand-drawn and other non-AI-generated fan creations, based on the creator’s or submitter’s statement. Untagged works may also be non-AI.','非AI作品は、作者・投稿者の申告に基づく手描きなどのAI生成ではない二次創作です。タグがない作品も非AIの場合があります。');
    if (character) {
      tr('characterPage.search','搜索作品、作者或标签','Search works, creators or tags','作品・作者・タグを検索');
      return `<form class="filter-bar character-filter" id="filter-form">${roleSelect}${typeSelect}${character.tabs}<div class="character-filter-row"><input id="search-q" name="q" type="search" autocomplete="off" aria-label="搜索作品、作者或标签" placeholder="搜索作品、作者或标签" data-i18n-attr="aria-label:d.characterPage.search,placeholder:d.characterPage.search">${creationSelect}${sortSelect}${directionSelect}${reset}</div><p class="character-visually-hidden" id="creation-filter-help">${creationHelp}</p></form>`;
    }
    return `<form class="filter-bar" id="filter-form"><div class="filter-fields"><label>${tr('roleFilter','角色（多选）','Characters','キャラクター（複数可）')}${roleSelect}</label><label>${tr('typeFilter','类型','Type','種類')}${typeSelect}</label><label>${tr('creationFilter','创作方式','Creation method','制作方法')}${creationSelect}</label><label>${tr('sortFilter','排序','Sort','並び順')}${sortSelect}</label><label>${tr('sortDirection','顺序','Direction','順序')}${directionSelect}</label></div>${reset}<p class="filter-help" id="character-filter-help">${tr('roleMatchAll','可多选：同时包含全部所选角色（AND）','Select multiple: match all selected characters (AND)','複数選択：選んだキャラクターすべてを含む作品（AND）')}</p><p class="source-note creation-method-note" id="creation-filter-help">${creationHelp}</p></form>`;
  }
  function browsePage(list, base, title, type = '', char = '', n = 1, intro = '') {
    const galleryTabs=['/browse.html','/gifs.html'].includes(base)?renderArchiveTabs(base==='/gifs.html'?'gifs':'browse',ctx):'';
    const page = Math.min(n, Math.max(1, Math.ceil(list.length / 24)));
    const sliced = list.slice((page - 1) * 24, page * 24);
    return `${pageHead(tr('archiveLabel','作品档案 / ARCHIVE','ARCHIVE / WORKS','作品アーカイブ / ARCHIVE'),title,intro || tr('browseLead','按角色与类型找图，或让随机顺序带你逛逛。','Filter by character and type, or explore in random order.','キャラクターや種類で絞り込むか、ランダムに楽しめます。'))}${galleryTabs}${filters(char,type,base.startsWith('/topics/')?'curated':'latest',list)}<div class="results-line"><p id="result-count" aria-live="polite">${list.length} ${old('v2.work','作品')}</p><small data-stats-note>${tr('statsSnapshot','下载量指按钮点击次数','Downloads count button clicks','ダウンロード数はボタンのクリック数')}</small></div><div id="results" data-list="${esc(JSON.stringify(list.map(w=>w.slug)))}">${grid(sliced,'',true)}</div><div class="load-more-wrap"><button class="button" type="button" data-load-more hidden>${tr('loadMore','再看一些','Load more','もっと見る')}</button></div><div class="related-note">${icon('book',23)}<p>${tr('tryTopics','想一次看完同一组作品？去合集里逛逛。','Want a themed selection? Explore the collections.','テーマに沿って楽しむなら、コレクションへ。')}</p><a class="text-link" href="/topics.html">${old('v2.nav.collections','合集')}${icon('arrow',16)}</a></div>`;
  }
  return { filters, browsePage };
}
