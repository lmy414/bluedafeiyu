import { showComments } from './giscus';
import { reportWorkView, restoreCounts } from './work-metrics';

export function initializeReader(reader: HTMLElement) {
  const fit = reader.querySelector<HTMLButtonElement>('[data-reader-fit]')!;
  const label = fit.querySelector('span')!;
  const select = reader.querySelector<HTMLSelectElement>('[data-reader-jump]')!;
  const side = reader.querySelector<HTMLDetailsElement>('[data-reader-side]')!;
  const comments = side.querySelector<HTMLElement>('[data-giscus-panel]');
  const key = 'dafeiyu-reader-fit';
  const changeFit = (width: boolean) => {
    reader.dataset.fit = width ? 'width' : 'screen';
    label.textContent = (width ? fit.dataset.width : fit.dataset.screen) ?? '';
    fit.setAttribute('aria-pressed', String(width));
  };
  try { changeFit(localStorage.getItem(key) === 'width'); } catch { /* Fit screen is the default. */ }
  fit.addEventListener('click', () => {
    changeFit(reader.dataset.fit !== 'width');
    try { localStorage.setItem(key, reader.dataset.fit ?? 'screen'); } catch { /* This page still updates. */ }
  });
  select.addEventListener('change', () => { if (select.value) location.assign(select.value); });
  const openComments = () => { if (side.open && comments) showComments(comments); };
  side.addEventListener('toggle', openComments);
  if (new URLSearchParams(location.search).has('giscus') || location.hash === '#reader-comments') side.open = true;
  openComments();
  restoreCounts(reader);
  if (reader.dataset.workSlug) reportWorkView(reader.dataset.workSlug, reader.dataset.workId, 'detail');
}
