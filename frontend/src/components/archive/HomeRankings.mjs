import {HOME_RANKING_COUNT} from '../../../public/components/home-rankings.js';

// Public metrics are loaded in the browser. The static fallback never claims a ranking.
export function homeRankingSections(ctx) {
  const {galleryWorks, tr, grid, icon} = ctx;
  const fallback = galleryWorks.slice(0, HOME_RANKING_COUNT);
  const labels = {
    popular: tr('homeRanking.views','热门浏览','Most viewed','閲覧数の多い作品'),
    downloads: tr('popularDownloads','热门下载','Popular downloads','人気のダウンロード')
  };
  const unavailable = tr('homeRanking.unavailable','统计暂不可用，暂按最近收录展示。','Statistics are unavailable; showing recent works.','統計を取得できないため、最近の作品を表示しています。');
  tr('homeRanking.viewsBasis','按累计浏览次数排序。','Ordered by total views.','累計閲覧数順です。');
  tr('homeRanking.downloadsBasis','按累计下载按钮点击次数排序。','Ordered by total download-button clicks.','ダウンロードボタンの累計クリック数順です。');
  return ['popular','downloads'].map(mode => `<section class="section home-${mode}" id="popular-${mode === 'popular' ? 'views' : 'downloads'}" data-home-ranking="${mode}" aria-labelledby="home-${mode}-title">
    <div class="section-head"><div><h2 id="home-${mode}-title">${labels[mode]}</h2><p data-home-ranking-note>${unavailable}</p></div><a class="text-link" href="/browse.html">${tr('design.latestAll','全部图片','Browse all pictures','すべての画像')}${icon('arrow',14)}</a></div>
    ${grid(fallback,'',false,{layout:'justified'})}
  </section>`).join('');
}
