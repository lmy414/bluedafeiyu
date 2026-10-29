// 页面外壳：<head>（SEO 部分取自线上同一页面）、频道注册表、顶栏/页脚、面包屑、分页、作品卡、图标。
import {SITE, KIND, LICENSED, PAGE_SIZE, stats, friendLinks, QQ} from './data.mjs';
import {live} from './live.mjs';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const abs = p => /^https?:/.test(p || '') ? p : SITE + (p || '/');
const BRAND = '蓝色大肥鱼';

// 线条图标，24 网格，stroke=currentColor。
const PATHS = {
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  book:'<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v16H5.5A1.5 1.5 0 0 0 4 20.5zM4 20.5A1.5 1.5 0 0 0 5.5 22H20v-3"/><path d="M8 7h8M8 11h6"/>',
  video:'<rect x="2.5" y="5" width="15" height="14" rx="2.5"/><path d="m17.5 10 4-2.5v9l-4-2.5"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  pen:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  flag:'<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
  chat:'<path d="M4 5h16v11H9l-5 4z"/>',
  upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  heart:'<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  share:'<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6m-7.6 7 7.6 4.6"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  zoom:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5M11 8v6M8 11h6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  moon:'<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10z"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', back:'<path d="M19 12H5m5-5-5 5 5 5"/>', close:'<path d="M6 6l12 12M18 6 6 18"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  home:'<path d="m3 11 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  sparkle:'<path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6"/>',
  shuffle:'<path d="M3 7h4l10 10h4M3 17h4l3-3m4-4 3-3h4m-3-3 3 3-3 3m0 4 3 3-3 3"/>',
  external:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
// 每页内联一次图标表（shell 里的 sprite），其余位置用 <use> 引用，避免每张卡重复整段路径。
export const icon = (name, size = 18) => `<svg class="i" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const sprite = `<svg width="0" height="0" class="sprite" aria-hidden="true">${Object.entries(PATHS).map(([n, d]) => `<symbol id="i-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</symbol>`).join('')}</svg>`;

// 生态频道注册表：新增业务只加一条记录，顶栏、“生态”菜单、首页频道区和页脚同时更新。
// kind: section = 本站栏目；subsite = 子域名站点；data = 开放数据。nav = 是否进主导航。
export const CHANNELS = [
  {id:'gallery', name:'图库', href:'/browse.html', icon:'image', group:'内容', kind:'section', nav:true, count:stats.gallery, desc:'表情包、梗图、插画、立绘与设定图'},
  {id:'comics', name:'漫画', href:'/categories/comic.html', icon:'book', group:'内容', kind:'section', nav:true, count:stats.comics, desc:'长篇连载与短篇多格漫画'},
  {id:'videos', name:'视频', href:'/videos.html', icon:'video', group:'内容', kind:'section', nav:true, count:stats.videos, desc:'经审核的 AI 娘二创视频（Bilibili）'},
  {id:'characters', name:'角色', href:'/characters.html', icon:'user', group:'内容', kind:'section', nav:true, count:stats.characters, desc:'按 AI 娘角色和别名找图'},
  {id:'topics', name:'合集', href:'/topics.html', icon:'layers', group:'内容', kind:'section', nav:true, count:stats.topics, desc:'人工编排的主题合集与专题导览'},
  {id:'creators', name:'创作者', href:'/creators.html', icon:'pen', group:'内容', kind:'section', nav:true, count:stats.creators, desc:'按作者浏览作品与视频'},
  {id:'events', name:'活动', href:'/events.html', icon:'flag', group:'社区', kind:'section', nav:true, desc:'征集、评选与往期回顾'},
  {id:'community', name:'社群', href:'/community.html', icon:'chat', group:'社区', kind:'section', desc:'QQ 群、投稿与反馈'},
  {id:'submit', name:'投稿', href:'/submit.html', icon:'upload', group:'社区', kind:'section', desc:'提交作品、署名与授权'},
  {id:'weekly', name:'AI 娘周刊', href:'https://weekly.xn--pssy23gqgbz2d718b.com/', icon:'book', group:'生态', kind:'subsite', desc:'每周 AI 娘二创与动态汇总'},
  {id:'projects', name:'友情链接', href:'/projects.html', icon:'link', group:'生态', kind:'section', desc:'相关项目与网站'},
  {id:'open-api', name:'开放数据', href:'/open-api/v1/index.json', icon:'grid', group:'开放', kind:'data', desc:'作品、角色、合集的 JSON 接口'},
  {id:'llms', name:'llms.txt', href:'/llms.txt', icon:'grid', group:'开放', kind:'data', desc:'给 AI 检索用的 Markdown 目录'},
  {id:'about', name:'关于与授权', href:'/about.html', icon:'globe', group:'关于', kind:'section', desc:'名字由来、来源与图片许可'},
  {id:'changelog', name:'更新日志', href:'/changelog.html', icon:'sparkle', group:'关于', kind:'section', desc:'站点改动记录'},
];
const GROUPS = ['内容', '社区', '生态', '开放', '关于'];

// 每个页面一个上下文：已生成的页面用相对路径互链，其余链接指向线上同一路径，演示可直接用 file:// 打开。
export function context(urlPath, generated) {
  const file = urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath;
  const up = '../'.repeat(file.split('/').length - 2);
  const href = to => {
    if (/^https?:|^mailto:/.test(to)) return to;
    const [p, hash = ''] = to.split('#');
    if (!p) return '#' + hash;
    const [pathOnly, query = ''] = p.split('?');
    const target = pathOnly.endsWith('/') ? pathOnly + 'index.html' : pathOnly;
    return generated.has(target) ? (up || './') + target.slice(1) + (query && '?' + query) + (hash && '#' + hash) : SITE + to;
  };
  return {urlPath, file, href, asset: name => up + 'assets/' + name, h1: () => live(urlPath).h1, lede: () => live(urlPath).lede};
}

const localized = (p, lang) => lang ? '/' + lang + (p === '/' ? '/' : p) : p;
export const LANGS = [['zh-CN', '', '简体中文'], ['zh-Hant', 'zh-hant', '繁體中文'], ['en', 'en', 'English'], ['ja', 'ja', '日本語']];

// SEO 元素一律取自线上同一 URL 的构建产物，调用方传入的 title/desc/graph 只在本地注释用途，不输出。
export function head(ctx, {extra = '', scripts = []} = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${live(ctx.urlPath).head}
<meta name="theme-color" content="#f3f7fb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1822" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${SITE}/favicon.png">
<link rel="stylesheet" href="${ctx.asset('site.css')}">
<link rel="stylesheet" href="${ctx.asset('roles.css')}">
${extra}<script>window.DEMO_ROOT=${JSON.stringify(ctx.asset(''))};</script>
${[...scripts, 'site.js'].map(s => `<script src="${ctx.asset(s)}" defer></script>`).join('\n')}
</head>`;
}

const friendWall = ctx => `<div class="friend-strip"><p class="menu-group">${icon('link', 14)}友情链接</p><div>${friendLinks.map(f => `<a href="${esc(f.url)}" rel="noopener" target="_blank" title="${esc(f.description)}">${esc(f.name)}</a>`).join('')}<a class="more" href="${ctx.href('/projects.html')}">友情链接墙 →</a></div></div>`;

export function shell(ctx, {current = '', body, wide = false}) {
  const nav = CHANNELS.filter(c => c.nav);
  const menu = GROUPS.filter(g => g !== '内容').map(g => `<div><p class="menu-group">${g}</p>${CHANNELS.filter(c => c.group === g).map(c => `<a href="${ctx.href(c.href)}"${c.kind === 'subsite' ? ' rel="noopener"' : ''}>${icon(c.icon, 16)}<span><b>${esc(c.name)}</b><small>${esc(c.desc)}</small></span></a>`).join('')}</div>`).join('');
  const langs = LANGS.map(([code, dir, name]) => `<a href="${abs(localized(ctx.urlPath, dir))}" hreflang="${code}" lang="${code}"${dir ? '' : ' aria-current="true"'}>${name}</a>`).join('');
  return `<body>
${sprite}
<a class="skip" href="#main">跳到正文</a>
<p class="demo-flag">新版前端演示 · 静态生成，真实数据，URL 与线上一致 · 只有简体中文，切换语言会跳到线上</p>
<header class="topbar"><div class="wrap">
  <a class="brand" href="${ctx.href('/')}"><img src="${SITE}/avatar.png" alt="" width="34" height="34"><span><b>${BRAND}</b><small>AI 娘二创档案</small></span></a>
  <nav class="nav" aria-label="主导航">${nav.map(c => `<a href="${ctx.href(c.href)}"${c.id === current ? ' aria-current="page"' : ''}>${icon(c.icon, 16)}${c.name}</a>`).join('')}
    <details class="pop"><summary>${icon('grid', 16)}生态</summary><div class="menu">${menu}</div></details></nav>
  <form class="search" role="search" action="${ctx.href('/search.html')}">${icon('search')}<input type="search" name="q" placeholder="搜索作品、角色、台词、标签" aria-label="搜索作品"><kbd>/</kbd></form>
  <div class="actions">
    <button class="icon-btn" type="button" data-theme aria-label="切换明暗">${icon('moon')}</button>
    <details class="pop lang"><summary aria-label="语言">${icon('globe', 16)}<span>中文</span></summary><div class="menu">${langs}</div></details>
    <a class="icon-btn" href="${ctx.href('/saved.html')}" aria-label="我的收藏" title="我的收藏">${icon('heart')}<span class="badge" data-saved-count hidden></span></a>
    <button class="btn ghost hide-s" type="button" data-group>${icon('chat', 16)}加入交流群</button>
    <a class="btn primary" href="${ctx.href('/submit.html')}">${icon('upload', 16)}<span>投稿</span></a>
  </div>
</div></header>
<main id="main" class="wrap${wide ? ' wide' : ''}">
${body}
</main>
<aside class="invite wrap"><div><b>如果觉得好用，就把站点分享给其他人吧～</b><p>分享卡片会带上站点名、简介和二维码；也可以来 QQ 群聊图、投稿和反馈。</p></div><div class="row"><button class="btn primary" type="button" data-share>${icon('share', 16)}分享卡片</button><button class="btn" type="button" data-group>${icon('chat', 16)}加入交流群</button></div></aside>
<footer class="footer"><div class="wrap">
  <div class="footer-top">
    <div class="footer-brand"><a class="brand" href="${ctx.href('/')}"><img src="${SITE}/avatar.png" alt="" width="34" height="34"><span><b>${BRAND}</b><small>AI 娘二创开放档案</small></span></a><p>非官方同人整理项目。作品版权归原作者，收录与下载不等于授予商业使用权。</p><p class="langs">${langs}</p></div>
    ${GROUPS.map(g => `<nav aria-label="${g}"><p class="menu-group">${g}</p>${CHANNELS.filter(c => c.group === g).map(c => `<a href="${ctx.href(c.href)}">${esc(c.name)}</a>`).join('')}</nav>`).join('')}
  </div>
  ${friendWall(ctx)}
  <p class="site-index">站点索引：<a href="${ctx.href('/gallery.html')}">全部图片总览</a><a href="${ctx.href('/category.html')}">角色图鉴</a><a href="${ctx.href('/collections.html')}">合集与作者作品集</a><a href="${ctx.href('/gifs.html')}">GIF 动图</a><a href="${ctx.href('/events/archive.html')}">往期活动</a><a href="${SITE}/sitemap.xml">sitemap.xml</a><a href="${SITE}/llms.txt">llms.txt</a></p>
</div></footer>
<nav class="tabbar" aria-label="快捷导航">${[['home','首页','/','home'],['gallery','图库','/browse.html','image'],['comics','漫画','/categories/comic.html','book'],['videos','视频','/videos.html','video'],['saved','收藏','/saved.html','heart']].map(([id, n, h, ic]) => `<a href="${ctx.href(h)}"${id === current ? ' aria-current="page"' : ''}>${icon(ic, 20)}<span>${n}</span></a>`).join('')}</nav>
<dialog class="sheet-dialog" id="group-dialog" aria-labelledby="group-title"><div class="group-card"><button class="icon-btn close" type="button" data-close aria-label="关闭">${icon('close')}</button><img src="${abs(QQ.qr)}" alt="QQ 群二维码" width="220" height="220" loading="lazy"><div><p class="eyebrow">QQ 交流群</p><p class="dialog-title" id="group-title">${esc(QQ.name)}</p><p class="note">群号 <b>${QQ.number}</b>。新图、创作想法和站点反馈都可以在这里聊。</p><div class="row"><a class="btn primary" href="${QQ.join}" rel="noopener" target="_blank">${icon('external', 16)}点击加入</a><button class="btn" type="button" data-copy-text="${QQ.number}">${icon('copy', 16)}复制群号</button><a class="btn ghost" href="${ctx.href('/community.html')}">社群说明</a></div></div></div></dialog>
<div class="toast" role="status" aria-live="polite" hidden></div>
</body>
</html>
`;
}

export const crumbs = (ctx, items) => `<nav class="crumbs" aria-label="面包屑"><ol>${[['首页', '/'], ...items].map(([n, h], i, all) => `<li>${i < all.length - 1 && h ? `<a href="${ctx.href(h)}">${esc(n)}</a>` : `<span aria-current="page">${esc(n)}</span>`}</li>`).join('')}</ol></nav>`;
export const crumbsLd = () => null;
export const itemList = () => null;
export const workURL = w => '/works/' + w.slug + '.html';
export const sectionHead = (id, title, more = '', ic = '') => `<div class="section-head"><h2 id="${id}">${ic ? icon(ic, 20) : ''}${title}</h2>${more}</div>`;
export const more = (ctx, href, text) => `<a class="more" href="${ctx.href(href)}">${text}${icon('arrow', 15)}</a>`;

// 分页沿用线上 URL：<base>.html 是第 1 页，<base>/page/N.html 是第 N 页；/browse.html 的分页在 /page/N.html。
export const pageURL = (base, n) => n === 1 ? base : (base === '/browse.html' ? '/page/' : base.replace(/\.html$/, '/page/')) + n + '.html';
export const pageCount = list => Math.max(1, Math.ceil(list.length / PAGE_SIZE));
// 分页列出全部页码：任何一页都能一次点到同栏目的任意页，保证“三次点击内到达任意页面”（顶栏 → 栏目 → 第 N 页 / 作品）。
export function pager(ctx, base, n, total) {
  if (total < 2) return '';
  const items = Array.from({length: total}, (_, k) => k + 1).map(i => i === n ? `<span aria-current="page">${i}</span>` : `<a href="${ctx.href(pageURL(base, i))}">${i}</a>`).join('');
  return `<nav class="pager" aria-label="分页" data-pager><p class="note">按页码浏览 · 共 ${total} 页</p><div class="pager-row">${n > 1 ? `<a class="btn sm" rel="prev" href="${ctx.href(pageURL(base, n - 1))}">${icon('back', 14)}上一页</a>` : ''}<span class="pages-num">${items}</span>${n < total ? `<a class="btn sm" rel="next" href="${ctx.href(pageURL(base, n + 1))}">下一页${icon('arrow', 14)}</a>` : ''}</div></nav>`;
}
export const pagerLinks = () => '';

// 作品卡：唯一渲染器，同一份结构也由 site.js 在无限加载时生成（见 assets/site.js 的 cardHTML）。
// 尺寸缺失（线上 447 件）时 data-ratio="unknown"：加载前按 4:5 占位，加载后按原图比例展开，保持不对齐瀑布流。
export function card(ctx, w, i = 9, {showKind = true, showLicense = true, showDownloads = false, downloads = null} = {}) {
  const sized = w.w > 0 && w.h > 0;
  const lic = showLicense && LICENSED[w.lk] ? `<span class="tag lic">${LICENSED[w.lk]}</span>` : '';
  const gif = w.gif ? '<span class="tag">GIF</span>' : '';
  const dl = showDownloads ? `<span class="card-download" title="${downloads === null ? '下载统计暂不可用' : '下载为正式站按钮点击次数'}">${icon('download', 13)}${downloads === null ? '下载量待同步' : '下载 ' + Number(downloads).toLocaleString('zh-CN')}</span>` : '';
  return `<article class="card${sized && w.h / w.w > 2.2 ? ' long' : ''}" data-slug="${esc(w.slug)}"><a class="art" href="${ctx.href(workURL(w))}" data-preview="${esc(w.slug)}" aria-haspopup="dialog">
  <div class="media"${sized ? '' : ' data-ratio="unknown"'}><img src="${esc(abs(w.i))}" alt="${esc(w.n)}"${sized ? ` width="${w.w}" height="${w.h}"` : ''} loading="${i < 6 ? 'eager' : 'lazy'}" decoding="async">${dl}</div>
  <h3 class="t">${esc(w.n)}</h3></a>
  <p class="m"><span class="roles">${w.roles?.[0] ? `<span class="role-dot r-${esc(w.roles[0].id)}">${esc(w.roles[0].name)}</span>${w.roles.length > 1 ? `<small title="${esc(w.roles.slice(1).map(r => r.name).join('、'))}">+${w.roles.length - 1}</small>` : ''}` : ''}</span>${showKind ? `<span class="kind">${KIND[w.kind]}</span>` : ''}<time datetime="${esc(w.dt.replaceAll('.', '-'))}">${esc(w.dt.slice(5))}</time></p>
  ${lic || gif ? `<div class="badges">${gif}${lic}</div>` : ''}<button class="save-mini" type="button" data-save="${esc(w.slug)}" aria-pressed="false" aria-label="收藏">${icon('heart', 16)}</button></article>`;
}
// feed：无限加载的数据范围（见 site.js），例如 "browse"、"type:meme"、"char:deepseek"、"topic:maojing"。
export const grid = (ctx, list, opts = {}, offset = 0) => list.length
  ? `<div class="masonry"${opts.feed ? ` data-feed="${esc(opts.feed)}" data-offset="${offset + list.length}"` : ''}>${list.map((w, i) => card(ctx, w, offset ? 9 : i, opts)).join('')}</div>`
  : `<p class="empty">${opts.empty || '这里还没有作品。'}</p>`;
export const faq = items => `<div class="faq">${items.map(([q, a], i) => `<details${i ? '' : ' open'}><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}</div>`;
export const faqLd = () => null;
export const avatar = (c, large = false) => c.avatar ? `<img class="avatar${large ? ' lg' : ''}" src="${esc(abs(c.avatar))}" alt="" width="${large ? 96 : 40}" height="${large ? 96 : 40}" loading="lazy">` : `<span class="avatar${large ? ' lg' : ''}" aria-hidden="true">${esc(Array.from(c.name)[0] || '')}</span>`;
