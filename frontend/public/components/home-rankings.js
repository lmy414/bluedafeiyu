import {renderWorkCard} from './work-card.js';
import {orderWorks} from './work-order.js';

export const HOME_RANKING_COUNT = 12;

// Localization changes copy and link labels, keeping focus, loaded images and
// component-owned masonry geometry on the existing card nodes.
function updateCardCopy(current, next) {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) return;
  if (current.nodeType === 3) {
    if (current.data !== next.data) current.data = next.data;
    return;
  }
  if (current.nodeType !== 1 || current.matches('[data-work-stats],[data-save]')) return;
  for (const name of ['aria-label','title','alt','href']) {
    if (next.hasAttribute(name) && current.getAttribute(name) !== next.getAttribute(name)) current.setAttribute(name,next.getAttribute(name));
  }
  const children = [...current.childNodes], translated = [...next.childNodes];
  if (children.length === translated.length) children.forEach((child,index)=>updateCardCopy(child,translated[index]));
}

export function selectHomeRanking(works, snapshot, mode) {
  if (snapshot?.available !== true || !snapshot.works || !['popular','downloads'].includes(mode)) return [];
  const field = mode === 'downloads' ? 'downloads' : 'views';
  const measured = works.filter(work => Number.isSafeInteger(snapshot.works[work.id]?.[field]) && snapshot.works[work.id][field] >= 0);
  if (!measured.some(work => snapshot.works[work.id][field] > 0)) return [];
  return orderWorks(measured, {sort:mode, metric:id => snapshot.works[id][field]}).slice(0, HOME_RANKING_COUNT);
}

export function installHomeRankings() {
  const sections = [...document.querySelectorAll('[data-home-ranking]')];
  if (!sections.length) return;
  const ranked = new Map();
  let snapshot;
  const tx = (key, fallback, vars) => window.SiteLang?.fmt(key, fallback, vars) || fallback.replace(/\{(\w+)\}/g,(_,name)=>vars?.[name] ?? '');
  const paint = event => {
    for (const section of sections) {
      const mode = section.dataset.homeRanking, works = ranked.get(mode);
      if (!works?.length) continue;
      const grid = section.querySelector('.work-grid'), active = document.activeElement;
      const card = grid.contains(active) ? active.closest('.work-card') : null;
      const controls = 'a[href],button,input,select,textarea,[tabindex]';
      const position = card ? [...card.querySelectorAll(controls)].indexOf(active) : -1;
      const markup = works.map(work => renderWorkCard(window.SiteLang?.localWork(work) || work, {
        url:href => window.SiteLang?.url(href) || href, translate:tx,
        names:value => window.SiteLang?.contentText(value) || value
      })).join('');
      const cards = [...grid.querySelectorAll('.work-card')];
      if (event?.type === 'site:langchange' && cards.length === works.length && cards.every((card,index)=>card.dataset.slug===works[index].slug)) {
        const template = document.createElement('div');template.innerHTML = markup;
        cards.forEach((card,index)=>updateCardCopy(card,template.children[index]));
      } else grid.innerHTML = markup;
      // Restore only the control removed by this synchronous repaint, using its
      // stable work and position. Focus moved outside the grid stays untouched.
      if (position >= 0 && !active.isConnected && document.activeElement === document.body) {
        const replacement = [...grid.querySelectorAll('.work-card')].find(node=>node.dataset.slug===card.dataset.slug);
        const target = replacement?.querySelectorAll(controls)[position] || grid.querySelector('.work-art');
        if (target && !target.disabled && (!target.getClientRects || target.getClientRects().length)) target.focus({preventScroll:true});
      }
      const note = section.querySelector('[data-home-ranking-note]');
      note.textContent = tx('d.homeRanking.'+(mode==='popular'?'viewsBasis':'downloadsBasis'), mode==='popular'?'按累计浏览次数排序。':'按累计下载按钮点击次数排序。');
      const date = new Date(snapshot.syncedAt);
      if (!Number.isNaN(date.getTime())) {
        const time = document.createElement('time');
        time.dateTime = date.toISOString();
        time.textContent = tx('stats.updated','统计更新：{date}；下载为按钮点击次数',{date:date.toLocaleString(document.documentElement.lang || 'zh-CN',{timeZone:'Asia/Shanghai'})});
        note.append(' ',time);
      }
      if (snapshot.stale) note.append(' · '+tx('stats.stale','统计更新延迟'));
      if (snapshot.limited) note.append(' · '+tx('stats.limited','部分统计受 GA4 汇总限制'));
      section.dataset.ranking = mode;
    }
    window.WorkStats?.paint();
  };
  let loading;
  const refresh = () => loading || (loading = (async () => {
    try {
      snapshot = await window.WorkStats?.ready;
      if (snapshot?.available !== true) return;
      const response = await fetch('/archive-downloads.json?v=1');
      if (!response.ok) return;
      const data = await response.json();
      for (const section of sections) ranked.set(section.dataset.homeRanking, selectHomeRanking(data.works, snapshot, section.dataset.homeRanking));
      paint();
    } catch { /* Keep the explicit recent-work fallback and its real links. */ }
  })());
  document.addEventListener('site:langchange',paint);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {observer.disconnect();refresh();}
    },{rootMargin:'200px'});
    sections.forEach(section => observer.observe(section));
  } else refresh();
}
