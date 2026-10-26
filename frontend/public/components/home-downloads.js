import {renderWorkCard} from './work-card.js';
import {orderWorks} from './work-order.js';

export const DOWNLOAD_HIGHLIGHT_COUNT = 4;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

export function selectDownloadHighlights(works, snapshot) {
  if (snapshot?.available !== true || !snapshot.works) return [];
  const measured = works.filter(work => Number.isFinite(snapshot.works[work.id]?.downloads));
  if (!measured.some(work => snapshot.works[work.id].downloads > 0)) return [];
  return orderWorks(measured, {sort:'downloads', metric:id => snapshot.works[id].downloads}).slice(0, DOWNLOAD_HIGHLIGHT_COUNT);
}

export function renderDownloadPick(work, {card = renderWorkCard, label = '下载原图'} = {}) {
  return `<div class="home-download-pick">${card(work)}<div class="home-download-action"><a class="button primary" data-download-work="${esc(work.id)}" href="${esc(work.o)}" target="_blank" rel="noopener"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>${label}</a></div></div>`;
}

export function installHomeDownloads() {
  const section = document.querySelector('[data-home-downloads]');
  if (!section) return;
  let ranked, snapshot;
  const tx = (key, fallback, vars) => window.SiteLang?.fmt(key, fallback, vars) || fallback.replace(/\{(\w+)\}/g,(_,name)=>vars?.[name] ?? '');
  const paint = () => {
    if (!ranked) return;
    const card = work => renderWorkCard(window.SiteLang?.localWork(work) || work, {
      url:href => window.SiteLang?.url(href) || href,
      translate:tx, names:value => window.SiteLang?.contentText(value) || value
    });
    section.querySelector('.home-downloads-list').innerHTML = ranked.map(work => renderDownloadPick(work, {card, label:esc(tx('d.popularDownloadOriginal','下载原图'))})).join('');
    const title = section.querySelector('[data-home-download-title]');
    title.dataset.i18n = 'd.popularDownloads';
    title.textContent = tx('d.popularDownloads','热门下载');
    const note = section.querySelector('[data-home-download-note]');
    note.textContent = tx('d.popularDownloadsBasis','按累计下载点击量排序；下载量为按钮点击次数。');
    const date = new Date(snapshot.syncedAt);
    if (!Number.isNaN(date.getTime())) {
      const time = document.createElement('time');
      time.dateTime = date.toISOString();
      time.textContent = tx('stats.updated','统计更新：{date}；下载为按钮点击次数',{date:date.toLocaleString(document.documentElement.lang || 'zh-CN',{timeZone:'Asia/Shanghai'})});
      note.append(' ',time);
    }
    if (snapshot.stale) note.append(' · '+tx('stats.stale','统计更新延迟'));
    if (snapshot.limited) note.append(' · '+tx('stats.limited','部分统计受 GA4 汇总限制'));
    section.dataset.ranking = 'downloads';
    window.WorkStats?.paint();
  };
  async function refresh() {
    try {
      snapshot = await window.WorkStats?.ready;
      if (snapshot?.available !== true) return;
      const response = await fetch('/archive-downloads.json?v=1');
      if (!response.ok) return;
      const data = await response.json();
      const picks = selectDownloadHighlights(data.works, snapshot);
      if (picks.length < Math.min(DOWNLOAD_HIGHLIGHT_COUNT, data.works.length)) return;
      ranked = picks; paint();
    } catch { /* The complete, labeled editorial row remains usable. */ }
  }
  document.addEventListener('site:langchange',paint);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); refresh(); }
    },{rootMargin:'200px'});
    observer.observe(section);
  } else refresh();
}
