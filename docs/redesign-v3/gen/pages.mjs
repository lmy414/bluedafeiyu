// 首页、作品详情、视频。正文全部静态输出，脚本只做增强（预览、无限下滑、筛选、复制、分享）。
import {SITE, KIND, QQ, gallery, characters, serials, serialOf, topics, videos, creators, downloadPicks, stats} from './data.mjs';
import {esc, abs, head, shell, crumbs, grid, card, faq, workURL, sectionHead, more, icon} from './layout.mjs';
import {live} from './live.mjs';
import {transplant} from './docs.mjs';

const duration = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export const seriesURL = (s, n = 0) => '/topics/' + s.id + (n ? '/page/' + n : '') + '.html';
const STATE = {ongoing:'连载中', completed:'已完结', hiatus:'休载'};
const thumb = (w, cls = '') => `<img${cls ? ` class="${cls}"` : ''} src="${esc(abs(w.i))}" alt="" loading="lazy" decoding="async">`;

const creatorHref = v => creators.find(c => c.uid === v.uid)?.href;
export const videoCard = (ctx, v) => `<article class="vcard" data-roles="${esc((v.characterIds || []).join(' '))}" data-date="${esc(v.publishedAt)}" data-dur="${v.duration}"><a href="${esc(v.url)}" rel="noopener" target="_blank"><div class="thumb"><img src="${esc(v.cover)}@480w_270h.webp" alt="" width="480" height="270" loading="lazy" referrerpolicy="no-referrer"><span class="dur">${duration(v.duration)}</span><span class="play">${icon('video', 22)}</span></div><h3>${esc(v.title)}</h3></a><p>${creatorHref(v) ? `<a href="${ctx.href(creatorHref(v))}">${esc(v.creator?.name || '')}</a>` : esc(v.creator?.name || '')}<time datetime="${v.publishedAt.slice(0, 10)}">${v.publishedAt.slice(0, 10)}</time></p></article>`;
export const seriesCard = (ctx, s) => `<article class="series-card"><a class="cover" href="${ctx.href(seriesURL(s))}"><img src="${esc(abs(s.cover?.i))}" alt="${esc(s.name)} 封面" loading="lazy"><span class="state">${STATE[s.state]}</span></a><div><p class="eyebrow">连载漫画 · 已收录 ${s.published.length}/${s.reader.totalPages} 页</p><h3><a href="${ctx.href(seriesURL(s))}">${esc(s.name)}</a></h3><p class="summary">${esc(s.summary)}</p><p class="meta">作者 ${esc(s.author.name)} · 更新至原稿第 ${s.latest} 页 · ${s.updatedAt.slice(0, 10)}</p><div class="row"><a class="btn primary" href="${ctx.href(seriesURL(s, s.published[0]))}">${icon('book', 16)}从第 ${s.published[0]} 页读</a><a class="btn" href="${ctx.href(seriesURL(s, s.latest))}">最新一页</a><a class="btn ghost" href="${ctx.href(seriesURL(s))}" data-continue="${s.id}" hidden>继续阅读</a></div></div></article>`;
export const topicCards = (ctx, list = topics) => `<div class="topics">${list.map(t => `<a class="topic" href="${ctx.href('/topics/' + t.id + '.html')}"><div class="mosaic">${t.list.slice(0, 4).map(w => thumb(w)).join('')}</div><div><h3>${esc(t.name)}</h3><p>${esc(t.summary)}</p><small>${t.list.length} 件作品${icon('arrow', 14)}</small></div></a>`).join('')}</div>`;
export const roleRail = ctx => `<div class="rail" data-rail>${characters.map(c => `<a class="role r-${c.id}" href="${ctx.href('/characters/' + c.id + '.html')}"><img src="${esc(abs(c.cover?.i))}" alt="" width="44" height="44" loading="lazy"><span><b>${esc(c.name)}</b><small>${c.count} 件</small></span></a>`).join('')}</div>`;

const HOME_FAQ = [
  ['蓝色大肥鱼与 DeepSeek娘是什么关系？', '本站角色记录将“蓝色大肥鱼”和“鲸鱼娘”列为 DeepSeek娘的别名。本网站是非官方同人整理项目；这里收录的是社区二创，各作品来源请查看详情。'],
  ['怎样下载原图并确认使用范围？', '打开作品详情，使用“下载原图”查看原始图片，同时核对来源、署名和授权备注。图片可下载不代表可以任意转载或商用。'],
];
const HOT = ['晚安', '摸摸头', '哈气', '加班', '女仆装', 'Q版'];

export function home(ctx, downloadStats = null) {
  const s = serials[0], latest = gallery.slice(0, 18), fan = gallery.filter(w => w.w && w.h).slice(0, 5);
  const downloads = w => {
    if (!downloadStats) return null;
    const value = Number(downloadStats.works[w.id]?.downloads ?? 0);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  };
  const popular = downloadStats ? [...gallery].sort((a, b) => (downloads(b) ?? 0) - (downloads(a) ?? 0)).slice(0, 6) : downloadPicks;
  const date = downloadStats ? new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(downloadStats.syncedAt)) : '';
  const note = downloadStats ? `正式站统计更新于 ${date}；下载为按钮点击次数${downloadStats.stale ? ' · 统计更新延迟' : ''}${downloadStats.limited ? ' · 部分统计受汇总限制' : ''}` : '统计暂不可用，热门下载暂展示推荐作品。';
  const homeCard = (w, i) => card(ctx, w, i, {showDownloads:true, downloads:downloads(w)});
  const entry = (href, ic, title, desc, count, art, cls = '') => `<a class="entry ${cls}" href="${ctx.href(href)}"><span class="entry-top"><span class="entry-icon">${icon(ic, 22)}</span><span class="entry-count">${count}</span></span><b>${title}</b><span class="entry-desc">${desc}</span>${art}<span class="entry-go">进入${icon('arrow', 16)}</span></a>`;
  const body = `
<section class="hero"><div class="hero-copy"><p class="eyebrow">AI GIRL ARCHIVE · 一起收好有趣的创作</p><h1>${esc(ctx.h1())}</h1>
<p class="lede">${esc(ctx.lede() || `收录 ${stats.works} 件 AI 娘表情包、梗图、插画与漫画，可按角色找图、下载原图并查看来源与授权。`)}</p>
<form class="hero-search" role="search" action="${ctx.href('/search.html')}">${icon('search', 20)}<input type="search" name="q" placeholder="搜索作品名、角色别名、台词或标签" aria-label="搜索作品"><button class="btn primary">搜索</button></form>
<p class="hot">${icon('sparkle', 14)}大家在搜：${HOT.map(t => `<a href="${ctx.href('/search.html')}?q=${encodeURIComponent(t)}">${t}</a>`).join('')}</p>
<div class="row"><a class="btn primary lg" href="${ctx.href('/browse.html')}">${icon('image', 18)}图片图库</a><button class="btn lg" type="button" data-group>${icon('chat', 18)}加入社群</button></div></div>
<div class="hero-art" aria-hidden="true">${fan.map((w, i) => `<img class="f${i}" src="${esc(abs(w.i))}" alt="" width="${w.w}" height="${w.h}" loading="${i < 3 ? 'eager' : 'lazy'}">`).join('')}
<dl class="edition"><div><dt>图片图库</dt><dd>${stats.gallery}</dd></div><div><dt>角色图鉴</dt><dd>${stats.characters}</dd></div><div><dt>主题合集</dt><dd>${topics.length}</dd></div><div><dt>视频</dt><dd>${stats.videos}</dd></div></dl></div></section>

<nav class="entries" aria-label="常用入口">
${entry('/browse.html', 'image', '图片图库', '表情包、梗图、插画、立绘和设定图，可下载原图', stats.gallery, `<span class="entry-art strip">${gallery.slice(0, 4).map(w => thumb(w)).join('')}</span>`, 'c-blue')}
${entry('/categories/comic.html', 'book', '漫画', `长篇连载 ${serials.length} 部 · 短篇 ${stats.shortComics} 件`, stats.comics, `<span class="entry-art cover">${thumb(s.cover)}</span>`, 'c-coral')}
${entry('/videos.html', 'video', '视频作品', '经审核的 AI 娘二创视频，点击去 Bilibili 播放', stats.videos, `<span class="entry-art video"><img src="${esc(videos[0].cover)}@480w_270h.webp" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`, 'c-violet')}
</nav>
<nav class="entries small" aria-label="更多入口">
${[['/characters.html', 'user', '角色图鉴', stats.characters], ['/topics.html', 'layers', '主题合集', topics.length], ['/creators.html', 'pen', '创作者', stats.creators], ['/gifs.html', 'sparkle', 'GIF 动图', stats.gifs], ['/submit.html', 'upload', '投稿作品', ''], ['/events.html', 'flag', '活动与共创', '']].map(([h, ic, t, n]) => `<a class="pill-entry" href="${ctx.href(h)}">${icon(ic, 20)}<b>${t}</b>${n !== '' ? `<small>${n}</small>` : ''}${icon('arrow', 15)}</a>`).join('')}
</nav>

<section class="section" aria-labelledby="h-role">${sectionHead('h-role', '按角色找图', more(ctx, '/characters.html', `全部 ${stats.characters} 位角色`), 'user')}${roleRail(ctx)}</section>
<section class="section" aria-labelledby="h-new">${sectionHead('h-new', '最新作品', more(ctx, '/browse.html', '全部图片'), 'image')}<p class="home-stats-note">${esc(note)}</p><div class="home-work-grid">${latest.map(homeCard).join('')}</div></section>
<section class="section" aria-labelledby="h-dl">${sectionHead('h-dl', '热门下载', more(ctx, '/browse.html', '去图库'), 'download')}<p class="home-stats-note">${esc(note)}</p><ol class="home-work-grid picks">${popular.map((w, i) => `<li>${downloadStats ? `<span class="rank">${i + 1}</span>` : ''}${homeCard(w, 9)}</li>`).join('')}</ol></section>
<section class="section" aria-labelledby="h-serial">${sectionHead('h-serial', '漫画连载', more(ctx, '/categories/comic.html', '全部漫画'), 'book')}<div class="shelf">${serials.map(x => seriesCard(ctx, x)).join('')}<div class="short-strip"><p class="eyebrow">最新短篇漫画</p><div>${gallery.filter(w => w.kind === 'comic').slice(0, 4).map(w => `<a href="${ctx.href(workURL(w))}" data-preview="${esc(w.slug)}">${thumb(w)}<span>${esc(w.n)}</span></a>`).join('')}</div></div></div></section>
<section class="section" aria-labelledby="h-topic">${sectionHead('h-topic', '主题合集', more(ctx, '/topics.html', '全部合集'), 'layers')}${topicCards(ctx)}</section>
<section class="section" aria-labelledby="h-video">${sectionHead('h-video', '最新视频', more(ctx, '/videos.html', `全部 ${stats.videos} 个视频`), 'video')}<div class="vgrid">${videos.slice(0, 4).map(v => videoCard(ctx, v)).join('')}</div></section>
<nav class="participate" aria-label="一起参与"><a href="${ctx.href('/events.html')}">${icon('flag', 26)}<b>活动与共创</b><small>征集、评选与往期回顾</small></a><button type="button" data-group>${icon('chat', 26)}<b>加入社群</b><small>QQ 群 ${QQ.number}</small></button><a href="${ctx.href('/submit.html')}">${icon('upload', 26)}<b>分享作品</b><small>站内投稿、GitHub 或 QQ 群</small></a></nav>
<section class="section prose" aria-labelledby="h-faq">${sectionHead('h-faq', '常见问题')}${faq(HOME_FAQ)}</section>`;
  return head(ctx) + shell(ctx, {current:'home', body});
}

// 作品详情：信息层级与线上一致（角色、类型、大肥鱼说、说明、来源与授权、操作、标签、相关作品、评论）。
export function work(ctx, w) {
  const s = serialOf(w), page = s?.reader.pages.find(p => p.workId === w.id)?.number || 0, role = w.roles?.[0];
  const sized = w.w > 0 && w.h > 0;
  const trail = s ? [['漫画', '/categories/comic.html'], [s.name, seriesURL(s)], [page ? `原稿第 ${page} 页` : '封面']] : [['图库', '/browse.html'], [KIND[w.kind], '/categories/' + w.kind + '.html'], [w.n]];
  const pool = s ? [] : gallery.filter(x => x.id !== w.id);
  const related = s ? [] : [...new Set([...pool.filter(x => x.kind === w.kind && (x.cids || []).includes(role?.id)), ...pool.filter(x => (x.cids || []).includes(role?.id)), ...pool.filter(x => x.kind === w.kind)])].slice(0, 18);
  // 来源与署名信息直接转写线上同一页的 dl.work-facts：来源作者、图片署名（作者站外主页链接）、原始来源、来源说明、
  // 授权状态与备注都与线上一致；再补一行原图格式/大小/尺寸。
  const liveFacts = transplant(ctx, live(workURL(w)).document.querySelector('dl.work-facts'));
  const fileRow = `<div><dt>原图</dt><dd>${esc([w.f, w.s, sized && `${w.w} × ${w.h}`].filter(Boolean).join(' · ') || '—')}</dd></div>`;
  const facts = liveFacts ? liveFacts.replace(/^<dl>/, '<dl class="facts">').replace(/<\/dl>$/, fileRow + '</dl>') : '';
  const nb = n => s?.byNumber.get(n);
  const body = `${crumbs(ctx, trail)}
<article class="work">
<div class="work-stage"><button class="stage-img" type="button" data-zoom="${esc(abs(w.l || w.i))}" aria-label="放大图片"><img src="${esc(abs(w.l || w.i))}" alt="${esc(w.d || w.n)}"${sized ? ` width="${w.w}" height="${w.h}"` : ''} fetchpriority="high"></button>
<p class="stage-cap"><span>${w.gif ? 'GIF 动图 · ' : ''}${sized ? `${w.w} × ${w.h}` : '原图'}</span><button class="text-btn" type="button" data-zoom="${esc(abs(w.l || w.i))}">${icon('zoom', 15)}放大查看</button></p></div>
<div class="work-info">
<p class="roles">${(w.roles || []).map(r => `<a class="role-chip r-${r.id}" href="${ctx.href('/characters/' + r.id + '.html')}"><i class="dot"></i>${esc(r.name)}${icon('arrow', 13)}</a>`).join('')}</p>
<h1>${esc(ctx.h1() || w.n)}</h1>
<p class="kinds">${(w.kinds || []).map(k => `<a class="tag soft" href="${ctx.href(role ? `/characters/${role.id}/${k}.html` : `/categories/${k}.html`)}">${KIND[k]}</a>`).join('')}${s ? `<a class="tag soft" href="${ctx.href(seriesURL(s))}">连载 · 原稿第 ${page || '封面'} 页</a>` : ''}</p>
${w.cm ? `<div class="fish"><img src="${SITE}/avatar.png" alt="" width="36" height="36"><div><p class="eyebrow">大肥鱼说</p><p>${esc(w.cm)}</p></div></div>` : ''}
<p class="desc">${esc(w.d)}</p>
<div class="actions-bar"><a class="btn primary" href="${esc(w.o || abs(w.l))}" target="_blank" rel="noopener" download>${icon('download', 16)}下载原图</a><button class="btn" type="button" data-save="${esc(w.slug)}" aria-pressed="false">${icon('heart', 16)}<span>收藏作品</span></button><button class="btn" type="button" data-copy-img="${esc(abs(w.l || w.i))}">${icon('copy', 16)}复制图片</button><button class="btn" type="button" data-copy-link="${esc(abs(workURL(w)))}">${icon('link', 16)}复制链接</button><button class="btn" type="button" data-share>${icon('share', 16)}分享卡片</button></div>
${facts}
<p class="license-note">${esc(w.rights?.copyrightNotice || '')}收录和下载不等于授予转载或商用许可。<a href="${ctx.href('/about.html#licensing')}">如何取得使用许可</a></p>
${s ? `<aside class="serial-box"><p class="eyebrow">${icon('book', 14)}连载漫画 · 原稿第 ${page || '封面'} 页 / ${s.reader.totalPages}</p><b>${esc(s.name)}</b><div class="row">${nb(page - 1) ? `<a class="btn" href="${ctx.href(workURL(nb(page - 1)))}">${icon('back', 15)}上一页</a>` : ''}<a class="btn primary" href="${ctx.href(seriesURL(s, page))}">在阅读器中打开</a>${nb(page + 1) ? `<a class="btn" href="${ctx.href(workURL(nb(page + 1)))}">下一页${icon('arrow', 15)}</a>` : ''}</div></aside>` : ''}
${w.tg?.length ? `<p class="tags">${w.tg.map(t => `<a href="${ctx.href('/search.html')}?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</p>` : ''}
</div></article>
${related.length ? `<section class="section" aria-labelledby="h-rel">${sectionHead('h-rel', '接着看这些', role ? more(ctx, '/characters/' + role.id + '.html', `${role.name}的全部作品`) : '')}${grid(ctx, related)}</section>` : ''}
<section class="section comments" aria-labelledby="h-cm">${sectionHead('h-cm', '评论')}<div id="comments-container"><button class="btn" type="button" data-comments="${esc(w.id)}">${icon('chat', 16)}加载评论（GitHub Discussions）</button><p class="note">评论由 giscus 提供，点击后才会连接 GitHub。</p></div></section>`;
  return head(ctx) + shell(ctx, {current:s ? 'comics' : 'gallery', body});
}

// 视频：与线上相同，一页列出全部视频。筛选按角色（数量固定、可以一行放下）和排序，不按作者分组；作者入口单独放在创作者页。
export function videoPage(ctx) {
  const roleCounts = characters.map(c => [c, videos.filter(v => (v.characterIds || []).includes(c.id)).length]).filter(([, n]) => n);
  const body = `${crumbs(ctx, [['视频']])}
<header class="page-band c-violet"><div><p class="eyebrow">${icon('video', 14)}VIDEOS · 当前仅开放 Bilibili</p><h1>${esc(ctx.h1())}</h1><p class="lede">${esc(ctx.lede() || '收录已通过审核的 AI 娘二创视频，保留作者署名、原视频链接与创作说明。')}</p></div>
<dl class="band-stats"><div><dt>视频</dt><dd>${stats.videos}</dd></div><div><dt>作者</dt><dd>${creators.filter(c => c.videos.length).length}</dd></div><div><dt>最近更新</dt><dd>${videos[0].publishedAt.slice(5, 10)}</dd></div></dl></header>
<div class="toolbar" data-video-tools><div class="row chips" role="group" aria-label="按角色"><button class="chip" type="button" data-vrole="" aria-pressed="true">全部<small>${stats.videos}</small></button>${roleCounts.map(([c, n]) => `<button class="chip r-${c.id}" type="button" data-vrole="${c.id}" aria-pressed="false"><i class="dot"></i>${esc(c.name)}<small>${n}</small></button>`).join('')}</div>
<div class="row tools"><label class="select">${icon('shuffle', 15)}<select data-vsort aria-label="排序"><option value="new">最新发布</option><option value="old">最早发布</option><option value="long">时长从长到短</option><option value="short">时长从短到长</option></select></label><a class="btn ghost" href="${ctx.href('/creators.html')}">${icon('pen', 15)}<span>按创作者浏览</span></a></div></div>
<p class="note" data-vcount>共 ${stats.videos} 个视频</p>
<div class="vgrid" data-videos>${videos.map(v => videoCard(ctx, v)).join('')}</div>
<section class="section prose" aria-labelledby="h-reg">${sectionHead('h-reg', '视频作者登记')}<p>Bilibili 作者可以在投稿页登记 UID 或主页链接。登记后系统会同步近期投稿，逐条审核作者归属、封面和预览帧，只收录 AI 娘二创。<a href="${ctx.href('/submit.html')}#creator-registration">去登记</a></p></section>`;
  return head(ctx) + shell(ctx, {current:'videos', body});
}
