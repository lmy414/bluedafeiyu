import {videoCoverAttributes} from './video-cover.mjs';
import {renderPagedFeed} from './PagedFeed.mjs';
import { videoArchive } from '../../lib/video-archive.mjs';
import { videoCopy } from '../../lib/video-copy.mjs';

const dateParts = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'});
const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function renderVideoArchive(ctx, archive) {
  const {esc, tr, icon, pageHead} = ctx;
  const byUid = new Map(archive.creators.map(creator => [creator.uid, creator]));
  const months = new Map();
  for (const video of [...archive.videos].sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt))) {
    const date = dateParts.format(new Date(video.publishedAt));
    const month = date.slice(0,7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push({video, date});
  }
  const count = total => `${total} ${tr('videoArchive.unit','条','videos','本')}`;
  const card = ({video:v, date}) => `<article class="video-archive-card" data-video-bvid="${esc(v.bvid)}" data-published="${esc(v.publishedAt)}"><a class="video-archive-cover" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer"><img ${videoCoverAttributes(v.cover,esc,'(max-width:560px) 92vw, (max-width:900px) 44vw, (max-width:1240px) 28vw, 22vw')} width="480" height="270" alt="${esc(v.title)}" data-video-cover-alt loading="lazy"></a><div class="video-archive-ident"><a class="video-archive-platform" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${tr('videoArchive.platform','B站','Bilibili','Bilibili')} ${icon('external',12)}</a><a class="video-archive-author" href="/creators/bilibili-${esc(v.uid)}.html"><span data-creator-name>${esc(byUid.get(v.uid)?.name || '')}</span></a><time datetime="${esc(v.publishedAt)}">${date}</time></div><h3 class="video-archive-title"><a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" data-video-title>${esc(v.title)}</a></h3></article>`;
  const sections = [...months].map(([month, list]) => {
    const [year, number] = month.split('-');
    const n = Number(number);
    return `<section class="video-archive-month" data-video-month="${month}" aria-labelledby="video-month-${month}"><div class="video-archive-month-head"><h2 id="video-month-${month}">${tr('videoArchive.month.'+month,`${year} 年 ${n} 月`,`${monthNames[n-1]} ${year}`,`${year}年${n}月`)}</h2><span>${count(list.length)}</span></div><div class="video-archive-grid">${list.map(card).join('')}</div></section>`;
  }).join('');
  return `<div class="video-archive">${pageHead('VIDEO ARCHIVE',tr('videoArchive.heading','把喜欢的角色，放进时间里。','Bring your favorite characters to life.','好きなキャラクターが、動き出す。'),tr('videoArchive.lead','点击封面或标题，前往 Bilibili 观看完整作品。','Open a cover or title to watch the full video on Bilibili.','サムネイルやタイトルから Bilibili で作品全編を視聴できます。'))}<aside class="video-archive-banner"><div><h2>${tr('design.registerQuestion','你也在创作 AI 娘视频？','Creating AI girl videos?','AI娘の動画を制作していますか？')}</h2><p>${tr('videoArchive.registerLead','登记自己的 Bilibili 主页，通过审核的公开作品会收录到这里。','Register your Bilibili profile to have approved public videos included here.','ご自身の Bilibili プロフィールを登録すると、審査を通過した公開作品がここに掲載されます。')}</p></div><a class="video-archive-register" href="/submit.html?media=video#creator-registration">${tr('videoArchive.register','视频作者登记','Register as a video creator','動画クリエイター登録')}${icon('external',16)}</a></aside><div class="video-archive-toolbar"><h2>${tr('videoArchive.title','视频作品','Videos','動画')} · ${count(archive.videos.length)} · ${tr('videoArchive.watch','点击前往 B 站','Watch on Bilibili','Bilibili で視聴')}</h2><span class="video-archive-sort">${tr('videoLatest','最新发布','Newest first','新しい順')}${icon('chevron',14)}</span></div>${sections || `<p>${tr('videoEmpty',...videoCopy.videoEmpty)}</p>`}<div class="video-archive-more"><p>${tr('videoArchive.discover','继续发现更多作品','Discover more works','もっと作品を探す')}</p><a href="/creators.html">${tr('videoArchive.more','再看一些','Explore more','もっと見る')}${icon('external',16)}</a></div></div>`;
}

export function createVideoPages(ctx) {
  const { esc, tr, write, pageHead } = ctx;
  const label = key => tr(key, ...videoCopy[key]);
  const byUid = new Map(videoArchive.creators.map(c => [c.uid, c]));
  const avatar=c=>c?.avatar?`<img class="creator-avatar" src="${esc(c.avatar)}" alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer">`:'';
  const card = v => `<article class="video-card" data-video-bvid="${esc(v.bvid)}" data-published="${esc(v.publishedAt)}"><a class="video-cover" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer"><img ${videoCoverAttributes(v.cover,esc)} width="480" height="270" alt="${esc(v.title)}" data-video-cover-alt loading="lazy"><span class="video-media-label">${ctx.icon('video',12)}${tr('videoBadge','视频','Video','動画')}</span><span class="platform-stamp">Bilibili ${ctx.icon('external',12)}</span><span class="video-hover">${label('videoPlay')} ${ctx.icon('external',18)}</span></a><div class="video-copy"><a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer"><h2 class="video-title" data-video-title>${esc(v.title)}</h2></a><p class="video-description" data-video-description hidden>${esc(v.description)}</p><p class="video-meta"><a class="video-author" href="/creators/bilibili-${esc(v.uid)}.html">${avatar(byUid.get(v.uid))}<span data-creator-name>${esc(byUid.get(v.uid)?.name)}</span></a></p><time class="video-published" datetime="${esc(v.publishedAt)}">${esc(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v.publishedAt)))}</time></div></article>`;
  const cards = list => renderPagedFeed(list.map(card),{label:tr('feedLoadMore','加载更多','Load more','もっと見る')});
  write('/videos.html', videoCopy.videoTitle[0], 'videos', renderVideoArchive(ctx, videoArchive), {desc:videoCopy.videoLead[0], attrs:'data-video-archive'});
  for (const creator of videoArchive.creators) {
    const list = videoArchive.videos.filter(v => v.uid === creator.uid);
    write(`/creators/bilibili-${creator.uid}.html`, creator.name + ' · ' + videoCopy.creatorProfile[0], 'videos', `${pageHead(label('creatorProfile'), `<span class="creator-profile-identity">${avatar(creator)}<span data-creator-name>${esc(creator.name)}</span></span>`)}<p data-creator-intro="${esc(creator.uid)}">${esc(creator.intro)}</p><p><a class="button" href="${esc(creator.homepage)}" target="_blank" rel="noopener noreferrer">${label('creatorVisit')}</a></p>${cards(list)}`, { attrs: `data-creator-uid="${creator.uid}"`, desc: creator.name + ' · ' + creator.intro });
  }
  return {videoCards:cards,videoCard:card};
}
