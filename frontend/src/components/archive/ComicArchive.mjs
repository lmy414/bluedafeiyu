import {renderArchiveTabs} from './ArchiveTabs.mjs';
import {comicPageURL} from './ComicSeries.mjs';

export function createComicArchive(ctx) {
  const {topics, esc, tr, icon, pageHead, write} = ctx;
  const series = topics.filter(topic => topic.reader);
  const card = topic => {
    const cover = topic.cover
      ? `<img src="${esc(topic.cover.i)}" width="${topic.cover.w}" height="${topic.cover.h}" alt="" loading="lazy">`
      : `<span>${tr('comic.coverUnavailable','封面暂未收录','Cover not yet available','表紙は未収録です')}</span>`;
    const author = topic.author?.name ? `<p class="comic-card-author">${tr('comic.by','作者','Creator','作者')} · <b>${esc(topic.author.name)}</b></p>` : '';
    return `<article class="comic-card" data-comic-series="${esc(topic.id)}"><a href="${comicPageURL(topic.id)}"><div class="comic-card-cover">${cover}</div><div class="comic-card-copy"><h2>${esc(topic.name)}</h2>${author}<p class="comic-card-summary">${esc(topic.summary)}</p><p class="comic-card-pages">${tr('comic.available','已收录','Available','収録済み')} ${topic.reader.pages.length} / ${topic.reader.totalPages} ${tr('comic.pageUnit','页','pages','ページ')}</p><span class="comic-card-link">${tr('comic.open','阅读漫画','Read comic','漫画を読む')}${icon('arrow',16)}</span></div></a></article>`;
  };
  const content = series.length
    ? `<div class="comic-catalog">${series.map(card).join('')}</div>`
    : `<div class="empty-state"><h2>${tr('comic.empty','暂时还没有连载漫画','No comic series yet','連載漫画はまだありません')}</h2><p>${tr('comic.emptyHint','有新连载时会在这里展示。','New series will appear here.','新しい連載はここに表示されます。')}</p></div>`;
  write('/serials.html','连载漫画','browse',`${pageHead(tr('comic.archiveLabel','漫画专区 / COMIC SERIES','COMIC SERIES','漫画の連載 / COMIC SERIES'),tr('comic.archiveTitle','连载漫画','Comic series','連載漫画'),tr('comic.archiveLead','从封面进入连载，按原稿页码阅读故事。','Open a cover and read the story in its original page order.','表紙から連載に入り、原稿のページ順に読み進めます。'))}${renderArchiveTabs('serials',ctx)}${content}`);
}
