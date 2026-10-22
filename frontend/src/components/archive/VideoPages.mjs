import { videoArchive } from '../../lib/video-archive.mjs';
import { videoCopy } from '../../lib/video-copy.mjs';
export function createVideoPages(ctx) {
  const { esc, tr, write, pageHead } = ctx;
  const label = key => tr(key, ...videoCopy[key]);
  const byUid = new Map(videoArchive.creators.map(c => [c.uid, c]));
  const cards = list => `<div class="video-grid">${list.map(v => `<article class="video-card panel" data-video-bvid="${esc(v.bvid)}"><a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(v.cover)}" width="640" height="360" alt="" loading="lazy" referrerpolicy="no-referrer"><h2 data-video-title>${esc(v.title)}</h2></a><p class="video-description" data-video-description>${esc(v.description)}</p><p><a href="/creators/bilibili-${esc(v.uid)}.html">${esc(byUid.get(v.uid)?.name)}</a> · <time datetime="${esc(v.publishedAt)}">${esc(v.publishedAt.slice(0,10))}</time></p><a class="button small" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${label('videoPlay')}</a></article>`).join('')}</div>`;
  write('/videos.html', videoCopy.videoTitle[0], 'videos', `${pageHead('BILIBILI / FAN VIDEOS', label('videoTitle'), label('videoLead'))}<p><a class="button primary" href="/submit.html#creator-registration">${label('creatorTitle')}</a></p>${videoArchive.videos.length ? cards(videoArchive.videos) : `<div class="panel"><p>${label('videoEmpty')}</p></div>`}`, { desc: videoCopy.videoLead[0] });
  for (const creator of videoArchive.creators) {
    const list = videoArchive.videos.filter(v => v.uid === creator.uid);
    write(`/creators/bilibili-${creator.uid}.html`, creator.name + ' · ' + videoCopy.creatorProfile[0], 'videos', `${pageHead(label('creatorProfile'), esc(creator.name))}<p data-creator-intro="${esc(creator.uid)}">${esc(creator.intro)}</p><p><a class="button" href="${esc(creator.homepage)}" target="_blank" rel="noopener noreferrer">${label('creatorVisit')}</a></p>${cards(list)}`, { attrs: `data-creator-uid="${creator.uid}"`, desc: creator.name + ' · ' + creator.intro });
  }
}
