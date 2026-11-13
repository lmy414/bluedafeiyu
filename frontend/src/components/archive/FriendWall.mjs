import {friendLinks} from '../../lib/friend-links.mjs';
import {renderCommunityProjects} from './LinkDirectories.mjs';

export function createFriendWall(ctx) {
  const {esc, tr, pageHead, write, icon} = ctx;
  const categories = [['project','项目类','Projects','プロジェクト'],['website','网站类','Websites','ウェブサイト']];
  // Register translations before lazy page rendering and dictionary emission.
  const heading = tr('friendsTitle','友情链接','Friend links','リンク集');
  const title = tr('friendsWall','友情链接墙','Friend link wall','リンクウォール');
  const lead = tr('friendsLead','顺着一张卡片，发现更多有趣的项目与网站。','Follow a card to discover more interesting projects and websites.','カードをたどって、楽しいプロジェクトやサイトへ。');
  const all = tr('friendsAll','全部','All','すべて');
  const visit = tr('friendsVisit','去逛逛','Visit','訪問する');
  const empty = tr('friendsEmpty','这个分类还在等新朋友。','New friends are welcome in this category.','このカテゴリーの新しい仲間をお待ちしています。');
  const labels = new Map(categories.map(([id,...values])=>[id,tr('friendsCategory.'+id,...values)]));
  const cards = friendLinks.map(row=>({row,name:tr('friend.'+row.id+'.name',row.name,row.i18n.en.name,row.i18n.ja.name),description:tr('friend.'+row.id+'.description',row.description,row.i18n.en.description,row.i18n.ja.description)}));
  write('/projects.html','友情链接墙','projects',`${pageHead('FRIEND LINKS',title,lead)}<nav class="friend-wall-tabs" aria-label="友情链接分类" data-i18n-attr="aria-label:d.friendsTitle"><a href="#all" data-friend-filter="all" aria-current="true">${all}<small>${friendLinks.length}</small></a>${categories.map(([id])=>`<a href="#${id}" data-friend-filter="${id}">${labels.get(id)}<small>${friendLinks.filter(row=>row.category===id).length}</small></a>`).join('')}</nav>${categories.map(([id])=>`<section class="friend-wall-section" data-friend-section="${id}" aria-labelledby="friend-${id}"><h2 id="friend-${id}">${labels.get(id)}</h2><div class="friend-wall-grid">${cards.filter(({row})=>row.category===id).map(({row,name,description})=>`<a class="friend-wall-card" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer"><span class="friend-wall-mark" aria-hidden="true">${icon(id==='project'?'github':'link',25)}</span><span class="friend-wall-domain">${esc(new URL(row.url).hostname)}</span><h3>${name}</h3><p>${description}</p><span class="friend-wall-visit">${visit}${icon('external',16)}</span></a>`).join('')}</div>${friendLinks.some(row=>row.category===id)?'':`<p class="empty-state">${empty}</p>`}</section>`).join('')}`,{desc:'友情链接墙'});
}

export function createIndependentFriendPages(ctx) {
  const {esc, tr, pageHead, write, icon} = ctx;
  const visit = tr('friendsVisit','去逛逛','Visit','訪問する');
  write('/community-projects.html','社区项目','communityProjects',renderCommunityProjects(ctx),{attrs:'data-independent-section="project" data-link-directory-page'});
  tr('links.projects.filters','项目筛选','Project filters','プロジェクトの絞り込み');
  const sections = [
    {category:'website', path:'/friend-links.html', active:'friendWall', eyebrow:'FRIEND LINKS',
      title:tr('friendLinksTitle','友链墙','Friend links','リンク集'),
      lead:tr('friendLinksLead','从友链继续探索有趣的网站与创作者。','Discover more websites and creators through our friend links.','リンク先のウェブサイトやクリエイターを見つけましょう。'),
      heading:tr('friendsCategory.website','网站类','Websites','ウェブサイト')}
  ];
  for (const section of sections) {
    const cards = friendLinks.filter(row=>row.category===section.category).map(row=>`<a class="friend-wall-card" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer"><span class="friend-wall-mark" aria-hidden="true">${icon(section.category==='project'?'github':'link',25)}</span><span class="friend-wall-domain">${esc(new URL(row.url).hostname)}</span><h3>${tr('friend.'+row.id+'.name',row.name,row.i18n.en.name,row.i18n.ja.name)}</h3><p>${tr('friend.'+row.id+'.description',row.description,row.i18n.en.description,row.i18n.ja.description)}</p><span class="friend-wall-visit">${visit}${icon('external',16)}</span></a>`).join('');
    write(section.path, section.category==='project'?'社区项目':'友链墙', section.active,
      `${pageHead(section.eyebrow,section.title,section.lead)}<div class="document-layout"><div class="document-reader"><article class="synced-prose"><section class="friend-wall-section" data-friend-section="${section.category}" aria-labelledby="friend-${section.category}"><h2 id="friend-${section.category}">${section.heading}</h2><div class="friend-wall-grid">${cards}</div></section></article></div></div>`,
      {attrs:`data-independent-section="${section.category}"`});
  }
}
