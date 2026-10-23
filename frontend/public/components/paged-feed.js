export const FEED_PAGE_SIZE = 24;

export function createFeedPager(items, pageSize = FEED_PAGE_SIZE) {
  let ordered = [...items], count = pageSize, filter = () => true;
  const filtered = () => ordered.filter(filter);
  return {
    get visible() {return filtered().slice(0,count);},
    get hasMore() {return filtered().length > count;},
    more() {count += pageSize;},
    reset({order = ordered, matches = filter} = {}) {ordered = [...order]; filter = matches; count = pageSize;}
  };
}

export function installPagedFeeds() {
  for (const feed of document.querySelectorAll('[data-paged-feed]')) {
    const grid = feed.querySelector('[data-feed-grid]');
    const template = feed.querySelector('template[data-feed-rest]');
    const more = feed.querySelector('[data-feed-more]');
    const items = [...grid.children, ...template.content.children];
    const pager = createFeedPager(items);
    template.remove();
    const paint = () => {
      grid.replaceChildren(...pager.visible);
      more.hidden = !pager.hasMore;
      more.parentElement.hidden = !pager.hasMore;
      window.dispatchEvent(new Event('resize'));
    };
    const select = () => {
      const type = new URLSearchParams(location.hash.slice(1)).get('type') || 'all';
      const sort = document.querySelector('[data-video-sort]')?.value || 'latest';
      const ordered = [...items];
      if (feed.dataset.pagedFeed === 'videos') {
        ordered.sort((a,b)=>sort === 'oldest' ? a.dataset.published.localeCompare(b.dataset.published) : b.dataset.published.localeCompare(a.dataset.published));
        if (sort === 'random') for(let i=ordered.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ordered[i],ordered[j]]=[ordered[j],ordered[i]];}
      }
      pager.reset({order:ordered,matches:card=>type==='image' ? card.matches('.work-card') : type==='video' ? card.matches('.video-card') : true});
      paint();
    };
    more.addEventListener('click', () => {
      const previous = grid.children.length;
      pager.more(); paint();
      if (more.hidden) grid.children[previous]?.querySelector('a,button')?.focus({preventScroll:true});
    });
    document.querySelector('[data-video-sort]')?.addEventListener('change',select);
    if (feed.dataset.pagedFeed === 'creator') window.addEventListener('hashchange',select);
    select();
  }
}
