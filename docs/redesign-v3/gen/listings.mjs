// 列表类页面：图库、GIF、类型、角色、角色×类型、主题合集（含分页），以及角色目录、合集目录、专题导览。
// 列表只用主图库 gallery（不含连载页）。URL 与分页页数以线上为准：连载页移出后变空的末尾分页仍然保留，显示“已经到底”。
import {existsSync} from 'node:fs';
import path from 'node:path';
import {BUILT, KIND, KIND_SEO, PAGE_SIZE, gallery, types, characters, characterById, topics, serials, shortComics, guides, creators, stats} from './data.mjs';
import {esc, abs, head, shell, crumbs, grid, faq, sectionHead, more, pageURL, pageCount, pager, avatar, icon} from './layout.mjs';
import {seriesURL, seriesCard, topicCards} from './pages.mjs';

const typeIds = types.map(t => t.id);
const kindsOf = list => typeIds.filter(k => list.some(w => w.kinds.includes(k)));
const thumbs = (list, n = 4) => `<div class="mosaic">${list.slice(0, n).map(w => `<img src="${esc(abs(w.i))}" alt="" loading="lazy">`).join('')}</div>`;
const livePages = base => { let n = 1; while (existsSync(path.join(BUILT, pageURL(base, n + 1).slice(1)))) n++; return n; };
const liveHas = url => existsSync(path.join(BUILT, url.slice(1)));

export const collections = [];
const add = c => { const own = pageCount(c.list); collections.push({count:c.list.length, pages:Math.max(own, livePages(c.base)), ownPages:own, ...c}); };
add({kind:'browse', feed:'browse', base:'/browse.html', list:gallery, crumbs:[['图库']], current:'gallery', icon:'image'});
add({kind:'gif', feed:'gif', base:'/gifs.html', list:gallery.filter(w => w.gif), crumbs:[['图库', '/browse.html'], ['GIF 动图']], current:'gallery', icon:'sparkle'});
for (const t of types) add({kind:'type', type:t.id, feed:'type:' + t.id, base:`/categories/${t.id}.html`, list:gallery.filter(w => w.kinds.includes(t.id)), crumbs:[['图库', '/browse.html'], [KIND[t.id]]], current:t.id === 'comic' ? 'comics' : 'gallery', note:t.description, icon:t.id === 'comic' ? 'book' : 'image'});
for (const c of characters) {
  add({kind:'character', character:c, feed:'char:' + c.id, base:`/characters/${c.id}.html`, list:c.list, crumbs:[['角色', '/characters.html'], [c.name]], current:'characters'});
  for (const k of typeIds.filter(k => liveHas(`/characters/${c.id}/${k}.html`) || c.list.some(w => w.kinds.includes(k))))
    add({kind:'character-type', character:c, type:k, feed:`char:${c.id}:${k}`, base:`/characters/${c.id}/${k}.html`, list:c.list.filter(w => w.kinds.includes(k)), crumbs:[['角色', '/characters.html'], [c.name, `/characters/${c.id}.html`], [KIND[k]]], current:'characters'});
}
for (const t of topics) add({kind:'topic', topic:t, feed:'topic:' + t.id, base:`/topics/${t.id}.html`, list:t.list, crumbs:[['合集', '/topics.html'], [t.name]], current:'topics'});

// 筛选：链接 chip 是可抓取的真实页面；“排序 / 多选角色 / 只看 GIF”由脚本在当前页内重排并无限加载，无脚本时用分页。
function filters(ctx, c) {
  const chip = (href, label, on, extra = '', cls = '') => `<a class="chip${cls}" href="${ctx.href(href)}"${on ? ' aria-current="true"' : ''}>${extra}${label}</a>`;
  const tools = `<div class="tools" data-list-tools hidden><button class="btn sm ghost" type="button" data-open-filter>${icon('user', 14)}<span>多选角色</span><span class="badge" data-filter-count hidden></span></button><label class="select">${icon('shuffle', 14)}<select data-sort aria-label="排序"><option value="latest">最新收录</option><option value="oldest">最早收录</option><option value="random">随机看看</option></select></label>${c.kind === 'gif' ? '' : `<label class="switch"><input type="checkbox" data-gif-only><span>只看 GIF</span></label>`}</div>`;
  // 吸顶条只保留一行（类型 + 排序工具），下滑时不遮挡；角色入口是一行可横向滚动的头像条，不吸顶。
  if (c.character) {
    const ch = c.character;
    return `<div class="toolbar"><nav class="chips" aria-label="按类型">${chip(`/characters/${ch.id}.html`, `全部<small>${ch.count}</small>`, !c.type)}${typeIds.filter(k => liveHas(`/characters/${ch.id}/${k}.html`)).map(k => chip(`/characters/${ch.id}/${k}.html`, `${KIND[k]}<small>${ch.list.filter(w => w.kinds.includes(k)).length}</small>`, c.type === k)).join('')}</nav>${tools}</div>`;
  }
  if (c.kind === 'topic') return `<div class="toolbar"><span class="note">${c.count} 件 · 按合集编排顺序</span>${tools}</div>`;
  const roleHref = ch => c.type && liveHas(`/characters/${ch.id}/${c.type}.html`) ? `/characters/${ch.id}/${c.type}.html` : `/characters/${ch.id}.html`;
  return `<nav class="role-strip" aria-label="按角色" data-rail>${characters.filter(ch => !c.type || ch.list.some(w => w.kinds.includes(c.type))).map(ch => `<a class="r-${ch.id}" href="${ctx.href(roleHref(ch))}"><img src="${esc(abs(ch.cover?.i))}" alt="" width="28" height="28" loading="lazy">${esc(ch.name)}<small>${c.type ? ch.list.filter(w => w.kinds.includes(c.type)).length : ch.count}</small></a>`).join('')}</nav>
<div class="toolbar"><nav class="chips" aria-label="按类型">${chip('/browse.html', `全部<small>${stats.gallery}</small>`, c.kind === 'browse')}${typeIds.map(k => chip(`/categories/${k}.html`, `${KIND[k]}<small>${gallery.filter(w => w.kinds.includes(k)).length}</small>`, c.type === k)).join('')}${chip('/gifs.html', `GIF<small>${stats.gifs}</small>`, c.kind === 'gif')}</nav>${tools}</div>`;
}

const roleSerials = (ctx, ch) => ch.serials.length ? `<section class="section" aria-labelledby="h-serial">${sectionHead('h-serial', `${esc(ch.name)}出场的连载`, '<p class="note">连载按页阅读，不进入图库</p>', 'book')}<div class="shelf">${ch.serials.map(s => seriesCard(ctx, s)).join('')}</div></section>` : '';

function band(ctx, c, n) {
  const first = n === 1, page = first ? '' : `<span class="page-no">第 ${n} 页 / 共 ${c.pages} 页</span>`;
  if (c.kind === 'character' && first) {
    const ch = c.character;
    return `<header class="char-hero r-${ch.id}"><div class="char-cover"><img src="${esc(abs(ch.cover?.l || ch.cover?.i))}" alt="${esc(ch.name)}代表作品：${esc(ch.cover?.n)}" loading="eager"></div><div class="char-copy"><p class="eyebrow">${icon('user', 14)}角色档案${ch.aliases.length ? ' · 也叫 ' + esc(ch.aliases.join(' / ')) : ''}</p><h1>${esc(ctx.h1())}</h1>
<p class="lede">${esc(ch.intro || ctx.lede() || `这里整理已收录的${ch.name}二创作品，可按类型找图并下载原图；不同作者的设计与来源，以各作品详情为准。`)}</p>
<dl class="band-stats"><div><dt>作品</dt><dd>${ch.count}</dd></div><div><dt>类型</dt><dd>${kindsOf(ch.list).length}</dd></div>${ch.serials.length ? `<div><dt>连载</dt><dd>${ch.serials.length}</dd></div>` : ''}<div><dt>最近收录</dt><dd>${esc(ch.list[0]?.dt.slice(5) || '—')}</dd></div></dl>
<ul class="kind-links">${kindsOf(ch.list).map(k => `<li><a href="${ctx.href(`/characters/${ch.id}/${k}.html`)}">${esc(ch.name)}${KIND_SEO[k]}<b>${ch.list.filter(w => w.kinds.includes(k)).length}</b></a></li>`).join('')}</ul></div></header>`;
  }
  if (c.kind === 'topic' && first) {
    const t = c.topic, a = t.author, lics = new Set(t.list.map(w => w.lk));
    return `<header class="topic-hero">${thumbs(t.list)}<div><p class="eyebrow">${icon('layers', 14)}主题合集</p><h1>${esc(ctx.h1())}</h1><p class="lede">${esc(t.summary)}</p>
${a ? `<p class="by">${avatar(t)}<span>整理 / 作者 <b>${esc(a.name)}</b></span>${(a.channels || []).map(x => `<a class="btn ghost sm" href="${esc(x.url)}" rel="noopener" target="_blank">${esc(x.platform)}${icon('external', 13)}</a>`).join('')}</p>` : ''}
<div class="row"><span class="note">${c.count} 件作品 · 更新于 ${esc((t.updatedAt || '').slice(0, 10))}${lics.size === 1 && t.list[0]?.lk !== 'unknown' ? ` · 全部为 <span class="tag lic">${esc(t.list[0].ls)}</span>` : ''}</span><button class="btn" type="button" data-download-topic="${esc(t.id)}">${icon('download', 16)}打包下载</button></div></div></header>`;
  }
  const colour = c.character ? ` r-${c.character.id}` : c.type === 'comic' ? ' c-coral' : c.kind === 'gif' ? ' c-violet' : ' c-blue';
  return `<header class="page-band${colour}"><div><p class="eyebrow">${icon(c.icon || 'image', 14)}${c.character ? esc(c.character.name) + ' · ' : ''}${c.type ? KIND_SEO[c.type] : c.kind === 'gif' ? 'GIF' : 'GALLERY'}</p><h1>${esc(ctx.h1())}</h1>${page}<p class="lede">${esc(ctx.lede() || '')}</p>${c.note && first ? `<p class="note">收录标准：${esc(c.note)}</p>` : ''}</div>
<dl class="band-stats"><div><dt>作品</dt><dd>${c.count}</dd></div><div><dt>分页</dt><dd>${c.ownPages}</dd></div><div><dt>最近收录</dt><dd>${esc(c.list[0]?.dt.slice(5) || '—')}</dd></div></dl></header>`;
}

const charFaq = ch => [[`怎样找到${ch.name}的表情包？`, `进入${ch.name}表情包与梗图，或在本页按类型筛选。`],
  ['下载后可以转载或商用吗？', '收录和下载不等于获得转载、改编或商业使用许可。请进入作品详情核对原作者、来源和授权备注；授权状态不明时，先联系权利人确认。']];

export function listingPage(ctx, c, n) {
  const visible = c.list.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE);
  const ch = c.character, first = n === 1;
  const trail = first ? c.crumbs : [...c.crumbs.slice(0, -1), [c.crumbs.at(-1)[0], c.base], [`第 ${n} 页`]];
  const sameLicense = c.kind === 'topic' && new Set(c.list.map(w => w.lk)).size === 1;
  const comicHub = c.kind === 'type' && c.type === 'comic' && first ? `<section class="section" aria-labelledby="h-serials">${sectionHead('h-serials', '长篇连载', '<p class="note">按原稿页码逐页阅读，缺页保留页码；连载页不进入图库</p>', 'book')}<div class="shelf">${serials.map(s => seriesCard(ctx, s)).join('')}<a class="series-card invite" href="${ctx.href('/submit.html')}"><div><p class="eyebrow">${icon('upload', 14)}投稿</p><h3>投稿你的连载</h3><p class="summary">按页上传并填写原稿页码，后续更新只需补页；缺页不会打乱已有网址。</p></div></a></div></section>
<div class="section-head"><h2 id="h-shorts">${icon('image', 20)}短篇多格漫画</h2><p class="note">${stats.shortComics} 件 · 至少两格，不要求连续剧情</p></div>` : '';
  const end = !visible.length ? `<div class="empty-end">${icon('sparkle', 28)}<b>已经到底了</b><p>这一栏共 ${c.count} 件作品${serials.length ? '；连载漫画按页收录，已移到漫画频道阅读' : ''}。</p><div class="row"><a class="btn primary" href="${ctx.href(c.base)}">回到第 1 页</a>${ch?.serials.length || c.type === 'comic' ? `<a class="btn" href="${ctx.href(seriesURL(serials[0]))}">${icon('book', 16)}阅读连载</a>` : ''}</div></div>` : '';
  const extras = !first ? '' : c.kind === 'character' ? `${roleSerials(ctx, ch)}
${topics.some(t => t.list.some(w => (w.cids || []).includes(ch.id))) ? `<section class="section" aria-labelledby="h-topics">${sectionHead('h-topics', '相关合集', '', 'layers')}${topicCards(ctx, topics.filter(t => t.list.some(w => (w.cids || []).includes(ch.id))))}</section>` : ''}
<section class="section prose" aria-labelledby="h-scope">${sectionHead('h-scope', `${esc(ch.name)}的收录范围`)}<p>这份档案目前收录 ${ch.count} 件${esc(ch.name)}作品${ch.aliases.length ? `，现有角色记录中的别名是${esc(ch.aliases.join('、'))}` : ''}。每件作品只归入一个类型。连载漫画按页收录，不计入角色图库，请从上方连载入口阅读。</p>${faq(charFaq(ch))}</section>`
    : c.kind === 'character-type' && !c.count && ch.serials.length ? roleSerials(ctx, ch)
    : c.kind === 'topic' ? `<section class="section" aria-labelledby="h-more">${sectionHead('h-more', '再逛一个合集', more(ctx, '/topics.html', '全部合集'), 'layers')}${topicCards(ctx, topics.filter(t => t !== c.topic))}</section>` : '';
  const body = `${crumbs(ctx, trail)}
${band(ctx, c, n)}
${comicHub}
${filters(ctx, c)}
${visible.length ? grid(ctx, visible, {showKind:!c.type, showLicense:!sameLicense, feed:c.feed}, (n - 1) * PAGE_SIZE) : end}
<div class="feed-status" data-feed-status hidden></div>
${pager(ctx, c.base, n, c.pages)}
${extras}`;
  return head(ctx) + shell(ctx, {current:c.current, body});
}

// 角色目录。/category.html 是旧入口，同样保留。
export function charactersDirectory(ctx) {
  const card = c => `<article class="char-card r-${c.id}"><a href="${ctx.href(`/characters/${c.id}.html`)}"><div class="cover">${(c.portrait || c.cover) ? `<img src="${esc(abs((c.portrait || c.cover).i))}" alt="" loading="lazy">` : ''}<span class="count">${c.count}</span></div><h2>${esc(c.name)}</h2><p class="alias">${c.aliases.length ? '也叫 ' + esc(c.aliases.join('、')) : '&nbsp;'}</p></a><p class="kinds">${typeIds.filter(k => liveHas(`/characters/${c.id}/${k}.html`)).map(k => `<a href="${ctx.href(`/characters/${c.id}/${k}.html`)}">${KIND[k]}</a>`).join('')}</p></article>`;
  const body = `${crumbs(ctx, [['角色']])}
<header class="page-band c-blue"><div><p class="eyebrow">${icon('user', 14)}CHARACTERS</p><h1>${esc(ctx.h1())}</h1><p class="lede">${esc(ctx.lede() || `浏览 ${characters.length} 位有作品的 AI 娘角色。`)}</p></div><dl class="band-stats"><div><dt>角色</dt><dd>${characters.length}</dd></div><div><dt>作品</dt><dd>${stats.gallery}</dd></div></dl></header>
<div class="char-grid">${characters.map(card).join('')}</div>
<section class="section prose" aria-labelledby="h-notes">${sectionHead('h-notes', '关于这些角色')}<p>角色名和别名来自本站角色记录。AI 娘是社区围绕各家 AI 产品创作的拟人化形象，没有统一的官方设定；不同作者的设计以各作品原始来源为准。多角色同框的作品会同时出现在每位角色的档案里。</p></section>`;
  return head(ctx) + shell(ctx, {current:'characters', body});
}

const guideURL = g => '/topics/' + g.id + '.html';
const guideCards = (ctx, list) => `<div class="guide-grid">${list.map(g => { const ch = characterById.get(g.character), pics = (g.type ? ch.list.filter(w => w.kinds.includes(g.type)) : ch.list).slice(0, 3);
  return `<a class="guide-card r-${ch.id}" href="${ctx.href(guideURL(g))}"><div class="fan">${pics.map(w => `<img src="${esc(abs(w.i))}" alt="" loading="lazy">`).join('')}</div><b>${esc(g.name[0])}</b><small>${esc(g.summary[0].slice(0, 52))}…</small></a>`; }).join('')}</div>`;

// 合集目录。/collections.html 是旧入口，同样保留。
export function topicsDirectory(ctx) {
  const body = `${crumbs(ctx, [['合集']])}
<header class="page-band c-teal"><div><p class="eyebrow">${icon('layers', 14)}COLLECTIONS</p><h1>${esc(ctx.h1())}</h1><p class="lede">${esc(ctx.lede() || '人工编排的主题合集保留投稿者与作者的署名。')}</p>
<nav class="anchors" aria-label="本页目录"><a href="#h-topics">主题合集 ${topics.length}</a><a href="#h-serials">连载 ${serials.length}</a><a href="#h-guides">专题导览 ${guides.length}</a><a href="#h-creators">作者作品集</a></nav></div></header>
<section class="section" aria-labelledby="h-topics">${sectionHead('h-topics', '主题合集', '', 'layers')}${topicCards(ctx, topics)}</section>
<section class="section" aria-labelledby="h-serials">${sectionHead('h-serials', '连载漫画', more(ctx, '/categories/comic.html', '全部漫画'), 'book')}<div class="shelf">${serials.map(s => seriesCard(ctx, s)).join('')}</div></section>
<section class="section" aria-labelledby="h-guides">${sectionHead('h-guides', '专题导览', '', 'sparkle')}${guideCards(ctx, guides)}</section>
<section class="section" aria-labelledby="h-creators">${sectionHead('h-creators', '作者作品集', more(ctx, '/creators.html', `全部 ${creators.length} 位创作者`), 'pen')}<div class="people">${creators.filter(c => c.images.length).map(c => `<a class="person" href="${ctx.href(c.href)}">${avatar(c)}<span><b>${esc(c.name)}</b><small>${c.images.length} 张图片${c.videos.length ? ` · ${c.videos.length} 个视频` : ''}</small></span>${icon('arrow', 15)}</a>`).join('')}</div></section>`;
  return head(ctx) + shell(ctx, {current:'topics', body});
}

export function guidePage(ctx, g) {
  const ch = characterById.get(g.character), list = (g.type ? ch.list.filter(w => w.kinds.includes(g.type)) : ch.list).slice(0, 18);
  const body = `${crumbs(ctx, [['合集', '/topics.html'], [g.name[0]]])}
<header class="page-band r-${ch.id}"><div><p class="eyebrow">${icon('sparkle', 14)}专题导览</p><h1>${esc(ctx.h1())}</h1><p class="lede">${esc(g.summary[0])}</p></div><dl class="band-stats"><div><dt>${esc(ch.name)}</dt><dd>${ch.count}</dd></div></dl></header>
<section class="section" aria-labelledby="h-entry">${sectionHead('h-entry', '从角色与类型开始找图')}<ul class="kind-links big"><li><a class="r-${ch.id}" href="${ctx.href(`/characters/${ch.id}.html`)}"><i class="dot"></i>${esc(ch.name)}全部作品<b>${ch.count}</b></a></li>${kindsOf(ch.list).map(k => `<li><a href="${ctx.href(`/characters/${ch.id}/${k}.html`)}">${esc(ch.name)}${KIND_SEO[k]}<b>${ch.list.filter(w => w.kinds.includes(k)).length}</b></a></li>`).join('')}</ul></section>
<section class="section" aria-labelledby="h-latest">${sectionHead('h-latest', '最近收录的相关作品', more(ctx, g.type ? `/characters/${ch.id}/${g.type}.html` : `/characters/${ch.id}.html`, '查看全部'))}${grid(ctx, list)}</section>
${roleSerials(ctx, ch)}
<section class="section prose" aria-labelledby="h-license">${sectionHead('h-license', '下载前查看来源与授权')}<p>每件作品的详情页都写明作者、原始来源和授权状态。收录和下载不等于授予转载或商用许可；授权状态不明时，请先联系权利人。<a href="${ctx.href('/about.html#licensing')}">如何取得使用许可</a></p></section>
<section class="section" aria-labelledby="h-other">${sectionHead('h-other', '继续阅读专题导览')}${guideCards(ctx, guides.filter(x => x !== g))}</section>`;
  return head(ctx) + shell(ctx, {current:'topics', body});
}
export {guideURL};
