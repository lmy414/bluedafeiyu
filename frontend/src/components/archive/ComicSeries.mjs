export const comicPageURL = (id, number = 0) => '/topics/' + id + (number ? '/page/' + number : '') + '.html';

// Endpoints can render before lazy detail pages. Export this component's entire
// dictionary explicitly so every label is available before any page is rendered.
const copy = {
  author:['作者署名','Creator credit','作者クレジット'],
  beginning:['连载封面','Series cover','連載の表紙'],
  collections:['合集','Collections','コレクション'],
  contents:['页码目录','Page contents','ページ目次'],
  cover:['封面与目录','Cover & contents','表紙と目次'],
  coverImage:['封面','Cover','表紙'],
  details:['查看详情与原图','Details & original','詳細と元画像'],
  download:['打包下载已收录页','Download available pages','収録ページをZIPでダウンロード'],
  end:['本次投稿到此','End of this submission','今回の投稿はここまで'],
  keepNumbers:['保留原稿页码，缺页不会重新编号。','Original page numbers are preserved.','欠番を詰めず、原稿のページ番号を保持しています。'],
  missingBody:['本页暂未收录，可继续翻页。','This original page is not yet available. You can continue to the next page.','この原稿ページは未収録です。次のページに進めます。'],
  missingIntro:['以下原稿页暂未收录：','Original pages not yet available:','未収録の原稿ページ：'],
  next:['下一页','Next','次へ'],
  originalNumber:['原稿页码','Original page number','原稿ページ'],
  page:['原稿第','Original page','原稿'],
  pages:['页正文','pages','ページ'],
  pageSuffix:['页','','ページ'],
  previous:['上一页','Previous','前へ'],
  read:['按页阅读连载','Read the series','連載を読む'],
  serial:['连载漫画','COMIC SERIES','連載漫画'],
  unavailable:['暂未收录','Not yet available','未収録'],
  unavailableShort:['缺页','Missing','未収録']
};
export const comicTranslations = Object.fromEntries(['en','ja'].map((language,i)=>[language,Object.fromEntries(Object.entries(copy).map(([key,values])=>['d.comic.'+key,values[i+1]]))]));
const label = (ctx,key) => ctx.tr('comic.'+key,...copy[key]);

export function comicWorkNavigation(ctx, topic, work) {
  const page = topic.reader.pages.find(page => page.workId === work.id);
  if (!page && work.id !== topic.coverWorkId) return '';
  const number = page?.number || 0;
  return `<section class="section comic-work-navigation" data-comic-topic="${ctx.esc(topic.id)}"><h2>${ctx.esc(topic.name)}</h2><p>${ctx.tr('comic.originalNumber','原稿页码','Original page number','原稿ページ')} ${number || ctx.tr('comic.coverImage','封面','Cover','表紙')} / ${topic.reader.totalPages}</p><div class="detail-actions">${ctx.button(comicPageURL(topic.id,number),ctx.tr('comic.read','按页阅读连载','Read the series','連載を読む'),'primary')}${ctx.button(comicPageURL(topic.id),ctx.tr('comic.contents','页码目录','Page contents','ページ目次'))}</div></section>`;
}

export function createComicSeries(ctx, topic) {
  const {esc:e, tr, icon, button, breadcrumbs, write} = ctx;
  const t = key => label(ctx,key);
  const reader = topic.reader;
  const byId = new Map(topic.list.map(work => [work.id, work]));
  const pages = new Map(reader.pages.map(page => [page.number, byId.get(page.workId)]));
  const missing = Array.from({length:reader.totalPages}, (_, i) => i + 1).filter(number => !pages.has(number));
  const pageLabel = number => `${t('page','原稿第','Original page','原稿')} ${number} ${t('pageSuffix','页','','ページ')}`;
  const coverLabel = () => t('cover','封面与目录','Cover & contents','表紙と目次');
  const contents = number => `<nav class="comic-pages" aria-label="${e(topic.name)}"><a href="${comicPageURL(topic.id)}" ${!number?'aria-current="page"':''}>${coverLabel()}</a>${Array.from({length:reader.totalPages}, (_, i) => i + 1).map(n => `<a href="${comicPageURL(topic.id,n)}" ${n===number?'aria-current="page"':''} ${pages.has(n)?'':'class="comic-missing-link"'}>${n}${pages.has(n)?'':`<small>${t('unavailableShort','缺页','Missing','未収録')}</small>`}</a>`).join('')}</nav>`;
  const navigation = number => `<nav class="comic-navigation" aria-label="${e(topic.name)}"><div>${number ? button(comicPageURL(topic.id,number-1),icon('back',16)+t('previous','上一页','Previous','前へ')) : `<span class="comic-boundary">${t('beginning','连载封面','Series cover','連載の表紙')}</span>`}</div><p>${number?pageLabel(number):coverLabel()} <span>/ ${reader.totalPages}</span></p><div>${number<reader.totalPages?button(comicPageURL(topic.id,number+1),t('next','下一页','Next','次へ')+icon('arrow',16),'primary'):`<span class="comic-boundary">${t('end','本次投稿到此','End of this submission','今回の投稿はここまで')}</span>`}</div></nav>`;
  const author = `<div class="author-line topic-author">${topic.avatar?`<img class="author-avatar" src="${e(topic.avatar)}" alt="" width="56" height="56">`:''}<div><span class="eyebrow">${t('author','作者署名','Creator credit','作者クレジット')}</span><b>${e(topic.author.name)}</b></div><a class="button small" href="${e(topic.author.url)}" target="_blank" rel="noopener noreferrer">Bilibili ${icon('external',14)}</a></div>`;
  const availability = missing.length ? `<p class="comic-availability">${t('missingIntro','以下原稿页暂未收录：','Original pages not yet available:','未収録の原稿ページ：')} <b>${missing.join('、')}</b>。${t('keepNumbers','保留原稿页码，缺页不会重新编号。','Original page numbers are preserved.','欠番を詰めず、原稿のページ番号を保持しています。')}</p>` : '';

  for (let number = 0; number <= reader.totalPages; number++) {
    const work = number ? pages.get(number) : topic.cover;
    const heading = `${breadcrumbs([[t('collections','合集','Collections','コレクション'),'/topics.html'],...(number?[[e(topic.name),comicPageURL(topic.id)]]:[]),[number?pageLabel(number):e(topic.name)]])}<header class="comic-heading topic-hero"><div><p class="eyebrow">${t('serial','连载漫画','COMIC SERIES','連載漫画')}</p><h1>${e(topic.name)}</h1>${!number?`<p class="lede">${e(topic.summary)}</p>`:''}${author}<p class="comic-credits">${e(reader.credits)}</p></div></header>`;
    const image = work ? `<figure class="comic-sheet" data-comic-work="${e(work.id)}"><img src="${e(work.l)}" alt="${e(work.n)}" width="${work.w}" height="${work.h}" fetchpriority="high"><figcaption>${number?pageLabel(number):t('coverImage','封面','Cover','表紙')} · ${button('/works/'+work.slug+'.html',t('details','查看详情与原图','Details & original','詳細と元画像'),'small')}</figcaption></figure>` : `<section class="comic-unavailable"><h2>${pageLabel(number)} · ${t('unavailable','暂未收录','Not yet available','未収録')}</h2><p>${t('missingBody','本页暂未收录，可继续翻页。','This original page is not yet available. You can continue to the next page.','この原稿ページは未収録です。次のページに進めます。')}</p></section>`;
    const download = !number ? `<div class="detail-actions"><button class="button" type="button" data-download-topic="${e(topic.id)}">${icon('download',16)}${t('download','打包下载已收录页','Download available pages','収録ページをZIPでダウンロード')}</button></div>` : '';
    const content = `${heading}${download}<section class="comic-reader" data-comic-reader="${e(topic.id)}" data-comic-page="${number}">${!number?availability:''}${navigation(number)}${image}${navigation(number)}<details class="comic-contents" ${!number?'open':''}><summary>${t('contents','页码目录','Page contents','ページ目次')}</summary>${contents(number)}</details></section>`;
    write(comicPageURL(topic.id,number),topic.name,'topics',content,{comic:{topicId:topic.id,number},desc:topic.summary,dependencies:[topic,number,work]});
  }
}
