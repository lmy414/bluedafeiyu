import {DOWNLOAD_HIGHLIGHT_COUNT, renderDownloadPick} from '../../../public/components/home-downloads.js';
// Real download rankings are filled lazily from the public statistics snapshot.
// The static fallback always supplies a complete, explicitly editorial row.
export function homeDownloadSection(ctx) {
  const { editorial, bySlug, galleryWorks, tr, card } = ctx;
  const selection = editorial.downloadHighlights;
  const eligible = new Set(galleryWorks.map(work => work.id));
  const candidates = [...(selection?.slugs || []), ...(editorial.featuredSlugs || []), ...galleryWorks.map(work => work.slug)];
  const works = [...new Set(candidates)].map(slug => bySlug.get(slug)).filter(work => work && eligible.has(work.id)).slice(0, DOWNLOAD_HIGHLIGHT_COUNT);
  if (!works.length) return '';
  tr('popularDownloads','热门下载','Popular downloads','人気のダウンロード');
  tr('popularDownloadsBasis','按累计下载点击量排序；下载量为按钮点击次数。','Ordered by total download-button clicks.','ダウンロードボタンの累計クリック数順です。');
  const label = tr('popularDownloadOriginal','下载原图','Download original','元画像をダウンロード');
  return `<section class="section home-downloads" id="popular-downloads" data-home-downloads aria-labelledby="popular-downloads-title">
    <div class="section-head"><div><h2 id="popular-downloads-title"><span class="marker-highlight" data-home-download-title>${tr('downloadFallbackTitle','精选作品','Selected works','おすすめ作品')}</span></h2><p data-home-download-note>${tr('downloadFallbackNote','下载统计暂不可用时，展示这组精选作品。','Selected works are shown when download statistics are unavailable.','ダウンロード統計を取得できない場合は、おすすめ作品を表示します。')}</p></div></div>
    <div class="home-downloads-list">${works.map(work => renderDownloadPick(work,{card,label})).join('')}</div>
  </section>`;
}
