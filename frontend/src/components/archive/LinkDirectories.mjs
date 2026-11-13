import {friendLinks} from '../../lib/friend-links.mjs';

const projectViews = [
  {source:'ai-girl-stickers',kind:'owner'},
  {source:'bluedafeiyu',kind:'owner'},
  {source:'ai-girl-stickers',id:'ai-girl-gallery',kind:'meme',name:['AI 娘表情包图库','AI girl meme gallery','AI娘のスタンプギャラリー'],description:['梗图与表情包素材仓，支持打包下载与投稿。','A meme and sticker archive with batch downloads and submissions.','まとめてダウンロードや投稿ができるミーム・スタンプのアーカイブ。']},
  {source:'ai-chan-sheets',kind:'setting',description:['角色三视图、表情、服装与道具素材。','Character views, expressions, outfits and props.','キャラクターの三面図、表情、衣装、小物の資料。']},
  {source:'blue-fish-archive',kind:'other',description:['EDMOK 的蓝色大肥鱼公开档案。','EDMOK’s public Blue Fish archive.','EDMOKによる公開の藍色大肥魚アーカイブ。']},
  {source:'cc-coco',kind:'other',description:['Claude Code 的桌宠 mod。','A desktop companion mod for Claude Code.','Claude Code向けデスクトップマスコットmod。']}
];
export const communityProjects = projectViews.map(view => {
  const row=friendLinks.find(row=>row.id===view.source);
  if(!row)throw Error('Missing community project: '+view.source);
  return {...row,id:view.id||row.id,kind:view.kind,name:view.name||[row.name,row.i18n.en.name,row.i18n.ja.name],description:view.description||[row.description,row.i18n.en.description,row.i18n.ja.description]};
});
export const projectFilters = [
  ['all','全部','All','すべて'],['owner','站长项目','Maintainer projects','管理人のプロジェクト'],
  ['meme','梗图','Memes','ミーム'],['setting','设定图','Design sheets','設定資料'],['other','其他','Other','その他']
];
const svg = (paths,size=22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const info = svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',20);

export function renderCommunityProjects(ctx) {
  const {esc:e,tr,icon,pageHead}=ctx;
  const visit=tr('friendsVisit','去逛逛','Visit','訪問する');
  return `<div class="link-directory" data-project-catalog>${pageHead('COMMUNITY PROJECTS',tr('links.projects.heading','一起做出来的东西。','Things we build together.','みんなで作ったもの。'),tr('links.projects.lead','图片档案、开源工具与角色创作项目。','Image archives, open-source tools and character projects.','画像アーカイブ、オープンソースのツール、キャラクター制作のプロジェクト。'))}<nav class="link-directory-section"><a href="/community-projects.html" aria-current="page">${tr('communityProjectsTitle','社区项目','Community projects','コミュニティのプロジェクト')}</a></nav><div class="project-directory-filters" role="group" aria-label="项目筛选" data-i18n-attr="aria-label:d.links.projects.filters"><div>${projectFilters.map(([id,...copy])=>`<button type="button" class="project-directory-chip${id==='all'?' is-active':''}" data-project-filter="${id}" aria-pressed="${id==='all'}">${tr('links.projects.filter.'+id,...copy)}</button>`).join('')}</div><p aria-live="polite"><span data-project-count>${communityProjects.length}</span> ${tr('links.projects.unit','个项目','projects','件のプロジェクト')}</p></div><section class="project-directory-list" data-friend-section="project">${communityProjects.map((row,index)=>`<article class="project-directory-row${index===communityProjects.length-1?' is-last':''}" data-project-kind="${row.kind}"><div class="project-directory-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</div><div class="project-directory-copy"><h2><a href="${e(row.url)}" target="_blank" rel="noopener noreferrer">${tr('links.project.'+row.id+'.name',...row.name)}</a></h2><p>${tr('links.project.'+row.id+'.description',...row.description)}</p><span>${e(row.url.replace(/^https?:\/\//,''))}</span></div><a class="project-directory-visit" href="${e(row.url)}" target="_blank" rel="noopener noreferrer">${visit}${icon('external',16)}</a></article>`).join('')}<p class="link-directory-empty" data-project-empty hidden>${tr('links.projects.empty','这个分类暂时还没有项目，先看看其他的。','There are no projects in this category yet. Try another category.','このカテゴリーにはまだプロジェクトがありません。ほかのカテゴリーをご覧ください。')}</p></section><aside class="link-directory-note">${info}<p>${tr('links.projects.note','外部项目由各自作者维护，访问时会前往对应站点或仓库。','External projects are maintained by their creators. Links open the corresponding site or repository.','外部プロジェクトはそれぞれの作者が管理しています。リンク先のサイトやリポジトリに移動します。')}</p></aside></div>`;
}

// The card variant is shared by the separately released friend-links page.
export function renderFriendDirectory(ctx) {
  const {esc:e,tr,icon,pageHead}=ctx;
  const mark = row => row.id==='deepseekchan' ? svg('<rect x="4" y="8" width="16" height="13" rx="2"/><path d="M4 12h16M12 8v13M7 8C2 3 8 1 12 8c4-7 10-5 5 0"/>') : row.id==='xiaoquan-universe' ? svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>') : icon(row.id==='water2h2o'?'book':new URL(row.url).hostname==='github.com'?'github':'link',22);
  return `<div class="link-directory is-friends">${pageHead('FRIEND LINKS',tr('links.friends.heading','朋友们的角落。','A corner for our friends.','友だちのためのコーナー。'),tr('links.friends.lead','收录朋友们的网站与项目，一起把 AI 娘的角落做得更好玩。','Explore our friends’ sites and projects, making this corner for AI girls more fun together.','友だちのサイトやプロジェクトと一緒に、AI娘のコーナーをもっと楽しく。'))}<section class="link-directory-grid" data-friend-section="website">${friendLinks.filter(row=>row.category==='website').map(row=>`<a class="friend-wall-card link-directory-card" href="${e(row.url)}" target="_blank" rel="noopener noreferrer"><span class="link-directory-mark">${mark(row)}</span><span class="link-directory-domain">${e(new URL(row.url).hostname)}</span><h2>${tr('friend.'+row.id+'.name',row.name,row.i18n.en.name,row.i18n.ja.name)}</h2><p>${tr('friend.'+row.id+'.description',row.description,row.i18n.en.description,row.i18n.ja.description)}</p><span class="link-directory-visit">${tr('friendsVisit','去逛逛','Visit','訪問する')}${icon('external',13)}</span></a>`).join('')}</section><aside class="link-directory-note">${info}<p>${tr('links.friends.note','友链按收录顺序排列，访问时会前往对应站点；想交换友链，欢迎通过投稿页联系。','Links follow their archive order and open external sites. To exchange links, contact us through the submission page.','リンクは収録順に並び、外部サイトに移動します。相互リンクをご希望の方は投稿ページからご連絡ください。')}</p></aside></div>`;
}
