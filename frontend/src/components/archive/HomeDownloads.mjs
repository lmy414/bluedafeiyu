// Weekly picks come from the SEO report recorded in issue #15, not lifetime counters.
export function homeDownloadSection(ctx) {
  const { editorial, bySlug, tr, card, icon, esc } = ctx;
  const selection = editorial.downloadHighlights;
  const works = (selection?.slugs || []).map(slug => bySlug.get(slug)).filter(Boolean);
  if (!works.length) return '';
  return `<section class="section home-downloads" id="popular-downloads" aria-labelledby="popular-downloads-title">
    <div class="section-head"><div><h2 id="popular-downloads-title"><span class="marker-highlight">${tr('popularDownloads','热门下载','Popular downloads','人気のダウンロード')}</span></h2><p>${tr('popularDownloadsPeriod','下载热门作品选自这一期周报：','Download highlights from this weekly report:','この週のレポートで人気だった作品：')} <time>${esc(selection.startDate)}</time> — <time>${esc(selection.endDate)}</time></p></div></div>
    <div class="home-downloads-list">${works.map(work => `<div class="home-download-pick">${card(work)}<div class="home-download-action"><a class="button primary" data-download-work="${esc(work.id)}" href="${esc(work.o)}" target="_blank" rel="noopener">${icon('download',17)}${tr('popularDownloadOriginal','下载原图','Download original','元画像をダウンロード')}</a></div></div>`).join('')}</div>
  </section>`;
}
