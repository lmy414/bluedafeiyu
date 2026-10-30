import {FEED_PAGE_SIZE} from '../../../public/components/paged-feed.js';
import {initialMasonryScript} from '../layout/Masonry.mjs';

export function renderPagedFeed(cards, {kind = 'videos', label = '加载更多', gridClass = 'video-grid dense-video-grid', attrs = ''} = {}) {
  return `<section data-paged-feed="${kind}"><div class="${gridClass}" data-feed-grid ${attrs}>${cards.slice(0,FEED_PAGE_SIZE).join('')}</div>${gridClass.split(/\s+/).includes('work-grid')?initialMasonryScript():''}<template data-feed-rest>${cards.slice(FEED_PAGE_SIZE).join('')}</template><div class="load-more-wrap" ${cards.length<=FEED_PAGE_SIZE?'hidden':''}><button class="button" type="button" data-feed-more>${label}</button></div><noscript data-feed-noscript><div class="${gridClass}">${cards.slice(FEED_PAGE_SIZE).join('')}</div></noscript></section>`;
}
