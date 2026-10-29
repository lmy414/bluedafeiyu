// 连载：封面与目录 /topics/<id>.html、单页阅读 /topics/<id>/page/<n>.html，URL 与线上相同。
// 页码规则沿用线上：封面不占页码；缺页保留原稿页码、显示提示；单页阅读无脚本也能翻页。
// 连续阅读是封面页内的一个模式（脚本展开全部已收录页），不新增 URL。
import {creators} from './data.mjs';
import {esc, abs, head, shell, crumbs, workURL, sectionHead, icon, avatar} from './layout.mjs';
import {seriesURL} from './pages.mjs';

const pageName = n => `原稿第 ${n} 页`;
const STATE = {ongoing:'连载中', completed:'已完结', hiatus:'休载'};
const HUB = '/categories/comic.html';
const creatorPage = s => creators.find(c => c.topics?.includes(s))?.href || '/creators.html';

// 目录：按章节分组；没有 chapters 字段时按 10 页分组。缺页显示虚线格，仍然可以点进去看到缺页说明。
const contents = (ctx, s, current = -1) => s.chapters.map(c => `<section class="chapter"><h3>${esc(c.title)}</h3><ol class="pages">${s.numbers.filter(n => n >= c.from && n <= c.to).map(n => {
  const w = s.byNumber.get(n);
  return `<li><a href="${ctx.href(seriesURL(s, n))}"${n === current ? ' aria-current="page"' : ''}${w ? '' : ' class="missing"'}>${w ? `<img src="${esc(abs(w.i))}" alt="" loading="lazy">` : '<span>缺页</span>'}<b>${n}</b></a></li>`;
}).join('')}</ol></section>`).join('');

export function seriesLanding(ctx, s) {
  const first = s.published[0];
  const strip = s.numbers.map(n => { const w = s.byNumber.get(n); return w
    ? `<figure class="sheet" id="p${n}" data-page="${n}"><img data-src="${esc(abs(w.l || w.i))}" alt="${esc(w.n)}"${w.w ? ` width="${w.w}" height="${w.h}"` : ''}><figcaption><a href="${ctx.href(seriesURL(s, n))}">${pageName(n)}</a></figcaption></figure>`
    : `<section class="sheet missing" id="p${n}" data-page="${n}"><b>${pageName(n)} · 暂未收录</b></section>`; }).join('');
  const body = `${crumbs(ctx, [['漫画', HUB], [s.name]])}
<header class="series-hero"><div class="cover-wrap"><img class="cover" src="${esc(abs(s.cover?.l || s.cover?.i))}" alt="${esc(s.name)} 封面" fetchpriority="high"></div>
<div><p class="eyebrow">${icon('book', 14)}连载漫画 <span class="tag soft">${STATE[s.state]}</span></p><h1>${esc(ctx.h1() || s.name)}</h1><p class="lede">${esc(s.summary)}</p>
<p class="by">${avatar({...s.author, avatar:s.avatar})}<span>作者 <a href="${ctx.href(creatorPage(s))}"><b>${esc(s.author.name)}</b></a></span><a class="btn ghost sm" href="${esc(s.author.url)}" rel="noopener" target="_blank">Bilibili${icon('external', 13)}</a></p>
<dl class="band-stats"><div><dt>原稿</dt><dd>${s.reader.totalPages} 页</dd></div><div><dt>已收录</dt><dd>${s.published.length} 页</dd></div><div><dt>更新至</dt><dd>第 ${s.latest} 页</dd></div><div><dt>更新于</dt><dd>${s.updatedAt.slice(5, 10)}</dd></div></dl>
<p class="note">${esc(s.reader.credits)}</p>
<div class="row"><a class="btn primary lg" href="${ctx.href(seriesURL(s, first))}">${icon('book', 18)}从第 ${first} 页开始</a><a class="btn primary lg" href="${ctx.href(seriesURL(s))}" data-continue="${s.id}" hidden>继续阅读</a><button class="btn lg" type="button" data-strip-open>${icon('layers', 18)}连续阅读</button><button class="btn ghost" type="button" data-download-topic="${s.id}">${icon('download', 16)}打包下载已收录页</button></div></div></header>
<section class="section" aria-labelledby="h-toc">${sectionHead('h-toc', '目录', `<p class="note">${s.missing.length ? `缺页：${s.missing.join('、')}。保留原稿页码，缺页不会重新编号。` : '全部页面已收录。'}</p>`)}${contents(ctx, s)}
<p class="work-links"><span>${icon('image', 14)}每页的作品详情与原图：</span>${s.cover ? `<a href="${ctx.href(workURL(s.cover))}">封面</a>` : ''}${s.published.map(n => `<a href="${ctx.href(workURL(s.byNumber.get(n)))}">${n}</a>`).join('')}</p></section>
<section class="strip-reader" data-strip data-reader="${s.id}" hidden aria-label="连续阅读"><div class="reader-bar"><b>${esc(s.name)} · 连续阅读</b><span class="note" data-strip-pos></span><button class="btn" type="button" data-strip-close>${icon('close', 15)}收起</button></div>${strip}</section>
<section class="section prose" aria-labelledby="h-about">${sectionHead('h-about', '关于这部连载')}
<p>《${esc(s.name)}》由 ${esc(s.author.name)} 编写，${esc(s.reader.credits.replace(/^编：[^·]+·\s*/, ''))}。${esc(s.summary)}</p>
<p>本站按原稿页码逐页收录，每页都有单独的作品详情，保留作者署名、来源与授权说明。收录和下载不等于授予转载或商用许可，请以作者说明为准。</p></section>`;
  return head(ctx) + shell(ctx, {current:'comics', body});
}

export function readerPage(ctx, s, n) {
  const w = s.byNumber.get(n), prev = n > 1 ? n - 1 : 0, next = n < s.reader.totalPages ? n + 1 : 0;
  const link = (to, rel, text) => to || rel === 'prev' ? `<a class="btn${rel === 'next' ? ' primary' : ''}" rel="${rel}" href="${ctx.href(seriesURL(s, to))}">${rel === 'prev' ? icon('back', 16) : ''}${text}${rel === 'next' ? icon('arrow', 16) : ''}</a>` : `<span class="btn" aria-disabled="true">${text}</span>`;
  const sheet = w ? `<figure class="sheet"><img src="${esc(abs(w.l || w.i))}" alt="${esc(w.n)}"${w.w ? ` width="${w.w}" height="${w.h}"` : ''} fetchpriority="high">
  ${prev ? `<a class="zone prev" href="${ctx.href(seriesURL(s, prev))}" aria-label="上一页"></a>` : ''}${next ? `<a class="zone next" href="${ctx.href(seriesURL(s, next))}" aria-label="下一页"></a>` : ''}</figure>`
    : `<section class="sheet missing"><b>${pageName(n)} · 暂未收录</b><p>保留原稿页码，本页补上后会出现在这里。可以继续翻页。</p></section>`;
  const end = n === s.latest ? `<aside class="reader-end">${icon('sparkle', 26)}<b>已读到最新收录页</b><p>连载更新后从这里继续。${s.reader.totalPages > n ? `原稿后续 ${s.reader.totalPages - n} 页尚未收录。` : ''}</p><div class="row"><a class="btn" href="${ctx.href(creatorPage(s))}">作者 ${esc(s.author.name)} 的主页</a><a class="btn" href="${ctx.href(HUB)}">看其他漫画</a></div></aside>` : '';
  const body = `${crumbs(ctx, [['漫画', HUB], [s.name, seriesURL(s)], [pageName(n)]])}
<div class="reader" data-reader="${s.id}" data-page="${n}" data-total="${s.reader.totalPages}">
<header class="reader-bar"><div><h1><a href="${ctx.href(seriesURL(s))}">${esc(ctx.h1() || s.name)}</a></h1><p class="note">${pageName(n)} / ${s.reader.totalPages}</p></div>
<div class="row"><a class="btn ghost" href="${ctx.href(seriesURL(s))}#h-toc">${icon('grid', 15)}目录</a>${w ? `<a class="btn ghost" href="${ctx.href(workURL(w))}">${icon('image', 15)}详情与原图</a>` : ''}</div></header>
${sheet}
<nav class="reader-nav" aria-label="翻页">${link(prev, 'prev', prev ? '上一页' : '封面与目录')}<ol class="ticks" aria-hidden="true">${s.numbers.map(m => `<li class="${m === n ? 'on' : ''}${s.byNumber.has(m) ? '' : ' gap'}"></li>`).join('')}</ol>${link(next, 'next', next ? '下一页' : '本次投稿到此')}</nav>
<p class="note center hint-keys">键盘 ← → 翻页 · 点图片左右两侧也可以翻页 · 手机上左右滑动</p>
${w ? `<details class="page-text"><summary>本页文字说明</summary><p>${esc(w.d)}</p></details>` : ''}
${end}</div>`;
  const nextImg = next && s.byNumber.get(next) ? `<link rel="prefetch" href="${esc(abs(s.byNumber.get(next).l))}" as="image">\n` : '';
  return head(ctx, {extra:nextImg}) + shell(ctx, {current:'comics', body});
}
