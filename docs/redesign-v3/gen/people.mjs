// 创作者目录与作者页、活动目录。作者页把图片与视频按时间合并成一个列表，与线上 CreatorViews 相同。
import {creators, events} from './data.mjs';
import {esc, abs, head, shell, crumbs, crumbsLd, itemList, grid, card, workURL, sectionHead, more, avatar} from './layout.mjs';
import {videoCard, seriesURL} from './pages.mjs';

const BRAND = ' — 蓝色大肥鱼';
const units = c => [c.images.length && `${c.images.length} 张图片`, c.videos.length && `${c.videos.length} 个视频`].filter(Boolean).join(' · ');
const platformOf = c => (c.channels || [{platform:'Bilibili', url:c.homepage}]);
const intro = c => c.intro && c.intro.length > 8 ? c.intro : '';

export function creatorsDirectory(ctx) {
  const body = `${crumbs(ctx, [['创作者']])}
<header class="page-head"><h1>${esc(ctx.h1())}</h1><p class="lede">按作者浏览收录的图片与视频，共 ${creators.length} 位。每位作者都有单独的作品集页面，保留个人主页链接和署名。</p></header>
<div class="creator-list">${creators.map(c => `<article class="creator-row"><header><a href="${ctx.href(c.href)}">${avatar(c)}</a><div><h2><a href="${ctx.href(c.href)}">${esc(c.name)}</a></h2><p class="note">${units(c)}${c.latest ? ' · 最近 ' + c.latest.slice(0, 10) : ''}</p></div><a class="more" href="${ctx.href(c.href)}">全部作品 →</a></header>
${intro(c) ? `<p class="bio">${esc(intro(c))}</p>` : ''}<div class="strip-rail">${c.media.slice(0, 8).map(m => m.kind === 'image'
    ? `<a href="${ctx.href(workURL(m.item))}"><img src="${esc(abs(m.item.i))}" alt="${esc(m.item.n)}" loading="lazy"></a>`
    : `<a class="is-video" href="${esc(m.item.url)}" rel="noopener" target="_blank"><img src="${esc(m.item.cover)}@320w_180h.webp" alt="${esc(m.item.title)}" loading="lazy" referrerpolicy="no-referrer"></a>`).join('')}</div></article>`).join('')}</div>`;
  return head(ctx, {title:'AI 娘二创创作者' + BRAND, desc:`按作者浏览 ${creators.length} 位 AI 娘二创作者收录的图片与视频，查看个人主页、最近作品和署名信息。`,
    graph:[{'@type':'CollectionPage', name:'创作者', url:abs('/creators.html'), mainEntity:itemList(creators.map(c => c.href), '创作者')}, crumbsLd([['创作者']], '/creators.html')]}) + shell(ctx, {current:'creators', body});
}

export function creatorPage(ctx, c) {
  const images = c.media.filter(m => m.kind === 'image').map(m => m.item), vids = c.media.filter(m => m.kind === 'video').map(m => m.item);
  const serial = c.topics.find(t => t.reader), others = creators.filter(o => o !== c).slice(0, 4);
  const desc = `${c.name}的 AI 娘二创作品集：收录 ${units(c)}${intro(c) ? '。' + intro(c).slice(0, 60) : '，保留作者主页链接、署名与来源'}。`;
  const body = `${crumbs(ctx, [['创作者', '/creators.html'], [c.name]])}
<header class="author-head">${avatar(c, true)}<div><p class="eyebrow">创作者作品集 · ${c.uid ? 'Bilibili UID ' + esc(c.uid) : esc(platformOf(c)[0].platform)}</p><h1>${esc(c.name)}</h1>${intro(c) ? `<p class="lede">${esc(intro(c))}</p>` : ''}
<div class="row">${platformOf(c).map((p, i) => `<a class="btn${i ? '' : ' primary'}" href="${esc(p.url)}" rel="noopener" target="_blank">${esc(p.platform)} 主页</a>`).join('')}<button class="btn" type="button" data-save="creator:${esc(c.id)}" aria-pressed="false">收藏</button><span class="note">${units(c)}${c.latest ? ' · 最近 ' + c.latest.slice(0, 10) : ''}</span></div></div></header>
${images.length && vids.length ? `<nav class="anchors" aria-label="本页目录"><a href="#h-img">图片 ${images.length}</a><a href="#h-vid">视频 ${vids.length}</a></nav>` : ''}
${serial ? `<aside class="banner"><b>连载：${esc(serial.name)}</b><p>已收录 ${serial.published.length}/${serial.reader.totalPages} 页，在漫画频道按页阅读。</p><a class="btn primary" href="${ctx.href(seriesURL(serial))}">封面与目录</a></aside>` : ''}
${images.length ? `<section class="section" aria-labelledby="h-img">${sectionHead('h-img', '图片作品')}<div class="masonry">${images.filter(w => !serial?.workIds.includes(w.id)).map((w, i) => card(ctx, w, i)).join('')}</div></section>` : ''}
${vids.length ? `<section class="section" aria-labelledby="h-vid">${sectionHead('h-vid', '视频作品')}<div class="vgrid">${vids.map(v => videoCard(ctx, v)).join('')}</div></section>` : ''}
<section class="section" aria-labelledby="h-more">${sectionHead('h-more', '再认识一位创作者', more(ctx, '/creators.html', '全部创作者'))}<div class="people">${others.map(o => `<a class="person" href="${ctx.href(o.href)}">${avatar(o)}<span><b>${esc(o.name)}</b><small>${units(o)}</small></span></a>`).join('')}</div></section>`;
  return head(ctx, {title:`${c.name} · 创作者作品集` + BRAND, desc, image:c.avatar || images[0]?.l,
    graph:[{'@type':'ProfilePage', name:c.name + ' · 创作者作品集', url:abs(c.href), mainEntity:{'@type':'Person', name:c.name, ...(intro(c) ? {description:intro(c)} : {}), ...(c.avatar ? {image:abs(c.avatar)} : {}), sameAs:platformOf(c).map(p => p.url)},
      hasPart:itemList([...images.slice(0, 24).map(workURL), ...vids.slice(0, 24).map(v => v.url)], c.name + '的作品')}, crumbsLd([['创作者', '/creators.html'], [c.name]], c.href)]}) + shell(ctx, {current:'creators', body});
}

// 活动：/events.html 总览，/events/current.html 当期，/events/archive.html 往期。单期页面由 docs.mjs 转写。
const PAGES = {
  '/events.html': ['活动与共创', '查看当期活动与历届活动回顾，从每一期活动入口浏览作品、规则与评选记录。', null],
  '/events/current.html': ['当期活动', '查看蓝色大肥鱼正在开展的活动、活动时间与参与入口；没有进行中的活动时，可以浏览往期回顾。', 'current'],
  '/events/archive.html': ['往期活动回顾', '历届活动的归档入口，按时间浏览每一期活动的作品展览、规则与评选记录。', 'archived'],
};
const eventCard = (ctx, e) => `<article class="event-card"><a href="${ctx.href(e.href)}"><img src="${esc(abs(e.cover.src))}" alt="${esc(e.coverAlt[0])}" width="${e.cover.width}" height="${e.cover.height}" loading="lazy"></a><div><p class="eyebrow"><span class="tag soft">${esc(e.statusLabel[0])}</span></p><h3><a href="${ctx.href(e.href)}">${esc(e.title[0])}</a></h3><p>${esc(e.summary[0])}</p><p class="note">截止 ${e.deadline.slice(0, 10)}</p><div class="row"><a class="btn primary" href="${ctx.href(e.href)}">活动回顾</a>${e.exhibition ? `<a class="btn" href="${esc(e.exhibition)}" rel="noopener" target="_blank">作品展览</a>` : ''}</div></div></article>`;
export const eventDirectories = Object.keys(PAGES);
export function eventsPage(ctx, url) {
  const [name, desc, status] = PAGES[url], list = status ? events.filter(e => e.status === status) : events;
  const tabs = Object.entries(PAGES).map(([u, [n]]) => `<a class="chip" href="${ctx.href(u)}"${u === url ? ' aria-current="true"' : ''}>${n}</a>`).join('');
  const body = `${crumbs(ctx, url === '/events.html' ? [['活动']] : [['活动', '/events.html'], [name]])}
<header class="page-head"><h1>${esc(ctx.h1() || name)}</h1><p class="lede">${desc}</p><nav class="anchors" aria-label="活动分类">${tabs}</nav></header>
${list.length ? `<div class="event-list">${list.map(e => eventCard(ctx, e)).join('')}</div>` : `<p class="empty">目前没有进行中的活动。新活动会在社群和首页公布。<a href="${ctx.href('/events/archive.html')}">看看往期活动</a></p>`}
<section class="section prose" aria-labelledby="h-join">${sectionHead('h-join', '怎样参加')}<p>活动在社群公布，投稿通过站内投稿或 GitHub 提交。每期活动都有单独的回顾页，保留作品展览、规则与评选记录。<a href="${ctx.href('/community.html')}">加入社群</a></p></section>`;
  return head(ctx, {title:name + BRAND, desc, image:list[0]?.cover.src,
    graph:[{'@type':'CollectionPage', name, url:abs(url), mainEntity:itemList(list.map(e => e.href), name)}, crumbsLd(url === '/events.html' ? [['活动']] : [['活动', '/events.html'], [name]], url)]}) + shell(ctx, {current:'events', body});
}
