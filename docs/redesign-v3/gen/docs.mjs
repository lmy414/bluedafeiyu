// 文档类页面：关于、投稿、社群、友链、更新日志、单期活动。正文直接从线上构建产物转写，
// 只保留语义标签（标题、段落、列表、表格、details、图片、链接），去掉旧样式类、表单和脚本，保证文案与线上一致。
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseHTML} from '../../../frontend/node_modules/linkedom/esm/index.js';
import {BUILT, SITE, QQ, events, friendLinks, gallery, characters, types} from './data.mjs';
import {esc, abs, head, shell, crumbs, crumbsLd, faqLd, sectionHead, icon} from './layout.mjs';

const BRAND = ' — 蓝色大肥鱼';
const KEEP = new Set(['H2','H3','H4','P','UL','OL','LI','A','STRONG','B','EM','CODE','PRE','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','DL','DT','DD','DETAILS','SUMMARY','IMG','FIGURE','FIGCAPTION','HR','BR','TIME','SECTION','SMALL','KBD','MARK']);
const DROP = new Set(['SCRIPT','STYLE','TEMPLATE','DIALOG','FORM','BUTTON','SVG','INPUT','SELECT','TEXTAREA','LABEL','NOSCRIPT','IFRAME','CANVAS','NAV','FOOTER','I']);
const RENAME = {H1:'H2', ARTICLE:'SECTION'};

function clean(ctx, el, toc = []) {
  if (el.nodeType === 3) return esc(el.textContent);
  if (el.nodeType !== 1) return '';
  const tag = el.tagName;
  const cls = el.getAttribute('class') || '';
  if (DROP.has(tag) || el.hasAttribute('hidden') || /share-site-invite|comment|giscus|page-head|sr\b|error-number/.test(cls)) return '';
  // 旧版式里的装饰文字（全大写英文眉标、01/02 步骤序号）不转写；QQ 群号等长数字保留。
  // 链接和 dd 里的内容一律保留：署名可能就是“ADK”“UPMC999”这类大写名字。
  if (!el.children.length && tag !== 'A' && !el.closest('dd, a') && /^(\d{1,2}|[A-Z][A-Z0-9 ·&'-]+)$/.test(el.textContent.trim())) return '';
  const inner = [...el.childNodes].map(n => clean(ctx, n, toc)).join('');
  const name = RENAME[tag] || tag;
  // <dl> 里用 <div> 包住的 dt/dd 行保留下来，样式按“一行一项”排版。
  if (tag === 'DIV' && el.parentElement?.tagName === 'DL') return `<div>${inner}</div>`;
  if (!KEEP.has(name)) return inner;
  if (['P', 'SECTION', 'LI', 'SUMMARY', 'H2', 'H3'].includes(name) && !inner.replace(/<[^>]+>|\s|&nbsp;/g, '') && !/<img/.test(inner)) return '';
  const attrs = [];
  let id = el.getAttribute('id'); if (id && /^(share-card|topic-download|group-dialog)/.test(id)) id = '';
  // 二级标题进入页内目录；没有 id 的按顺序补一个，目录链接才有落点。
  if (name === 'H2') { id ||= 's' + (toc.length + 1); toc.push([id, el.textContent.trim()]); }
  if (id) attrs.push(`id="${esc(id)}"`);
  if (name === 'A') {
    const h = el.getAttribute('href') || '';
    if (!h) return inner;
    const internal = h.startsWith('/') || h.startsWith(SITE);
    attrs.push(`href="${esc(internal ? ctx.href(h.replace(SITE, '') || '/') : h)}"`);
    if (!internal && !h.startsWith('#') && !h.startsWith('mailto:')) attrs.push('rel="noopener" target="_blank"');
  }
  if (name === 'IMG') {
    const src = el.getAttribute('src'); if (!src) return '';
    attrs.push(`src="${esc(abs(src))}"`, `alt="${esc(el.getAttribute('alt') || '')}"`, 'loading="lazy"');
    for (const a of ['width', 'height']) if (+el.getAttribute(a) > 0) attrs.push(`${a}="${+el.getAttribute(a)}"`);
    return `<img ${attrs.join(' ')}>`;
  }
  if (name === 'TIME' && el.getAttribute('datetime')) attrs.push(`datetime="${esc(el.getAttribute('datetime'))}"`);
  if ((name === 'TD' || name === 'TH') && el.getAttribute('colspan')) attrs.push(`colspan="${+el.getAttribute('colspan')}"`);
  if (name === 'BR' || name === 'HR') return `<${name.toLowerCase()}>`;
  return `<${name.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${name.toLowerCase()}>`;
}

// 供其他页面转写线上片段（例如作品页的“来源作者 / 图片署名 / 来源 / 授权”信息，含作者站外主页链接）。
export const transplant = (ctx, el) => el ? clean(ctx, el) : '';

function source(file, selector) {
  const {document} = parseHTML(readFileSync(path.join(BUILT, file), 'utf8'));
  const main = document.querySelector('main');
  return {document, main, lede: main.querySelector('header.page-head .lede')?.textContent.trim() || '', nodes: selector ? [...main.querySelectorAll(selector)] : [main]};
}

const DOC_NAV = [['/about.html', '关于与授权'], ['/community.html', '社群'], ['/events.html', '活动'], ['/projects.html', '友情链接'], ['/changelog.html', '更新日志']];
const docNav = (ctx, url) => `<nav class="anchors" aria-label="站点说明">${DOC_NAV.map(([h, n]) => `<a href="${ctx.href(h)}"${h === url ? ' aria-current="true"' : ''}>${n}</a>`).join('')}</nav>`;

// title / description 沿用线上 SEO.mjs；H1 改成带关键词的说明句，不再用口号。
const DOCS = {
  '/about.html': {file:'about.html', select:'.document-reader', h1:'蓝色大肥鱼是什么？', trail:[['关于与授权']], faq:true, md:true,
    title:'蓝色大肥鱼是什么？DeepSeek娘（大肥鱼）昵称由来与本站介绍', desc:'蓝色大肥鱼（大肥鱼、鲸鱼娘）是 DeepSeek娘的社区昵称。了解名字由来、本站收录的 AI 娘作品、浏览与下载方法、版权规则和投稿常见问题。'},
  '/community.html': {file:'community.html', select:'.document-reader', h1:'AAAA肥鱼批发市场：QQ 交流群与社群入口', trail:[['社群']], current:'community',
    title:'AAAA肥鱼批发市场社群与公开交流入口' + BRAND, desc:'查看AAAA肥鱼批发市场 QQ 交流群、站长公开账号和二创交流入口，分享作品、参加活动或反馈归档问题。'},
};
for (const e of events) DOCS[e.href] = {file:e.href.slice(1), select:'main > article', h1:e.title[0] + ' · 活动回顾', trail:[['活动', '/events.html'], ['往期活动回顾', '/events/archive.html'], [e.title[0]]],
  title:e.title[0] + ' · 活动回顾' + BRAND, desc:e.summary[0] + ' ' + e.statusLabel[0] + '。', current:'events', image:e.cover.src};
export const docURLs = Object.keys(DOCS);

// 长文档：正文 + 吸顶的页内目录（手机上折叠在正文上方）。
const docLayout = (toc, html) => `<div class="doc-layout"><article class="doc prose">${html}</article>${toc.length > 2 ? `<aside class="toc" aria-label="本页目录"><details open><summary>本页目录</summary><ol>${toc.map(([id, t]) => `<li><a href="#${esc(id)}">${esc(t)}</a></li>`).join('')}</ol></details></aside>` : ''}</div>`;

// 社群是参与入口，不使用长文模板。文案、规则和外链仍从正式构建产物读取。
function communityBody(ctx, src) {
  const root = src.nodes[0];
  const need = (el, selector) => {
    const found = el?.querySelector(selector);
    if (!found) throw new Error(`社群页面缺少内容：${selector}`);
    return found;
  };
  const hero = need(root, '.live-community-hero');
  const heroTitle = need(hero, 'h2');
  const intro = need(hero, 'h2 + p');
  const notice = need(hero, '.live-group-notice');
  const join = need(hero, '.live-hero-actions a');
  const guide = need(hero, '.live-hero-actions a + a');
  const qr = need(hero, 'figure img');
  const qrCaption = need(hero, 'figcaption');
  const number = need(hero, '.live-group-number').textContent.trim();
  if (number !== QQ.number || join.getAttribute('href') !== QQ.join || qr.getAttribute('src') !== QQ.qr) {
    throw new Error('社群页面与 QQ 资料不一致，请先核对群号、链接和二维码');
  }
  const entries = [...root.querySelectorAll('.live-info-grid .live-info-card')];
  if (entries.length !== 3) throw new Error('社群参与入口数量发生变化，请先核对页面');
  const activity = need(root, '.community-activity');
  const panels = [...root.querySelectorAll('.live-two-column > section')];
  if (panels.length !== 2) throw new Error('社群规则或联系方式发生变化，请先核对页面');
  const title = el => need(el, 'h2').textContent.trim();
  const card = (el, id, ic, tone) => `<article class="community-entry ${tone}">
    <span class="community-icon">${icon(ic, 20)}</span><h3 id="${id}">${esc(title(el))}</h3>
    ${clean(ctx, need(el, 'p'))}${el.querySelector('code') ? clean(ctx, el.querySelector('code')) : ''}
    ${clean(ctx, need(el, 'a'))}</article>`;
  const socials = [...panels[1].querySelectorAll('a')];
  if (!socials.length) throw new Error('社群页面缺少站长公开账号');
  return `<div class="community-page">
<section class="community-join" aria-labelledby="s1">
  <div class="community-join-copy">
    <p class="community-kicker">${icon('chat', 16)}QQ 交流群</p>
    <h2 id="s1">${esc(heroTitle.textContent.trim())}</h2>
    ${clean(ctx, intro)}
    <div class="community-group"><div><span>群号</span><strong>${esc(number)}</strong></div><button class="community-copy" type="button" data-copy-text="${esc(number)}">${icon('copy', 16)}复制群号</button></div>
    <div class="community-actions"><a class="btn primary" href="${esc(join.getAttribute('href'))}" target="_blank" rel="noopener">${esc(join.textContent.trim())}${icon('external', 15)}</a><a class="btn" href="${ctx.href(guide.getAttribute('href'))}">${esc(guide.textContent.trim())}</a></div>
    <div class="community-notice">${icon('sparkle', 16)}${clean(ctx, notice)}</div>
  </div>
  <figure class="community-qr"><div class="community-qr-image"><img src="${esc(ctx.asset('qq-group.png?v=' + number))}" alt="${esc(qr.getAttribute('alt') || '')}" width="210" height="210" loading="eager"></div><figcaption><b>扫码进群</b><span>${esc(qrCaption.textContent.trim())}</span></figcaption></figure>
</section>
<section class="community-section" aria-labelledby="s2"><div class="community-section-head"><div><p class="community-section-label">参与方式</p><h2 id="s2">${esc(need(root, '.community-section-title').textContent.trim())}</h2></div></div>
  <div class="community-grid">${card(entries[0], 's3', 'upload', 'c-blue')}${card(entries[1], 's4', 'video', 'c-violet')}${card(entries[2], 's5', 'chat', 'c-teal')}${card(activity, 's6', 'flag', 'c-coral')}</div>
</section>
<div class="community-details"><section class="community-panel" aria-labelledby="s7"><p class="community-section-label">交流须知</p><h2 id="s7">${esc(title(panels[0]))}</h2>${clean(ctx, need(panels[0], 'ul'))}</section>
<section class="community-panel" aria-labelledby="s8"><p class="community-section-label">更多联系</p><h2 id="s8">${esc(title(panels[1]))}</h2><div class="community-social">${socials.map(a => clean(ctx, a)).join('')}</div></section></div>
</div>`;
}

export function docPage(ctx, url) {
  const d = DOCS[url], src = source(d.file, d.select), toc = [];
  const html = url === '/community.html' ? '' : src.nodes.map(n => clean(ctx, n, toc)).join('');
  // FAQ：关于页的 details 问答同时输出 FAQPage 结构化数据（与线上相同）。
  const qa = d.faq ? [...parseHTML(`<div>${html}</div>`).document.querySelectorAll('details')].map(x => [x.querySelector('summary')?.textContent.trim(), x.textContent.replace(x.querySelector('summary')?.textContent || '', '').trim()]).filter(([q, a]) => q && a) : [];
  const isCommunity = url === '/community.html';
  const body = `${isCommunity ? '<div class="community-frame">' : ''}${crumbs(ctx, d.trail)}
<header class="page-head${isCommunity ? ' community-head' : ''}"><h1>${esc(ctx.h1() || d.h1)}</h1>${src.lede ? `<p class="lede">${esc(src.lede)}</p>` : ''}${url.startsWith('/events/') || url === '/submit.html' ? '' : docNav(ctx, url)}</header>
${isCommunity ? communityBody(ctx, src) : docLayout(toc, html)}${isCommunity ? '</div>' : ''}`;
  return head(ctx, {title:d.title, desc:d.desc, robots:d.robots, md:d.md, image:d.image, type:url.startsWith('/events/') ? 'article' : 'website',
    graph:[{'@type':url === '/about.html' ? 'AboutPage' : 'WebPage', name:d.h1, url:abs(url), description:d.desc}, crumbsLd(d.trail, url), ...(qa.length ? [faqLd(qa.map(([q, a]) => [q, esc(a)]))] : [])]}) + shell(ctx, {current:d.current || 'about', body});
}

// 友链：数据来自 data/friend-links.json，按项目 / 网站分组。
export function projectsPage(ctx) {
  // 友情链接墙：与线上相同按“全部 / 项目类 / 网站类”切换（锚点 + 脚本过滤），每张卡显示标记、域名、名称、说明和“去逛逛”。
  const groups = [['project', '项目类'], ['website', '网站类']];
  const cardOf = (f, i) => `<a class="friend-card m${i % 6}" href="${esc(f.url)}" rel="noopener" target="_blank" data-friend="${esc(f.category)}"><span class="mark" aria-hidden="true">${esc(Array.from(f.name)[0])}</span><span class="domain">${esc(new URL(f.url).host)}</span><b>${esc(f.name)}</b><span class="desc">${esc(f.description)}</span><span class="visit">去逛逛${icon('external', 14)}</span></a>`;
  const body = `${crumbs(ctx, [['友情链接']])}
<header class="page-band c-teal"><div><p class="eyebrow">${icon('link', 14)}FRIEND LINKS</p><h1>${esc(ctx.h1())}</h1><p class="lede">${esc(ctx.lede() || '按项目类、网站类浏览蓝色大肥鱼的友情链接，发现相关项目、图片来源与创作网站。')}</p>${docNav(ctx, '/projects.html')}</div><dl class="band-stats"><div><dt>友链</dt><dd>${friendLinks.length}</dd></div></dl></header>
<nav class="row chips friend-tabs" aria-label="友情链接分类"><a class="chip" href="#all" data-friend-filter="all" aria-current="true">全部<small>${friendLinks.length}</small></a>${groups.map(([id, n]) => `<a class="chip" href="#${id}" data-friend-filter="${id}">${n}<small>${friendLinks.filter(f => f.category === id).length}</small></a>`).join('')}</nav>
${groups.map(([id, n]) => `<section class="section" id="${id}" data-friend-section="${id}" aria-labelledby="h-${id}">${sectionHead('h-' + id, n)}<div class="friend-wall">${friendLinks.filter(f => f.category === id).map(cardOf).join('')}</div></section>`).join('')}
<section class="section banner" aria-labelledby="h-apply"><h2 id="h-apply">${icon('link', 18)}申请友链</h2><p>与 AI 娘二创、开放档案或相关工具有关的项目和网站都可以申请。在社群联系站长，或在 GitHub 提交 issue。</p><div class="row"><button class="btn primary" type="button" data-group>${icon('chat', 16)}在 QQ 群联系站长</button><a class="btn" href="https://github.com/lmy414/bluedafeiyu/issues" rel="noopener" target="_blank">GitHub issue${icon('external', 14)}</a></div></section>`;
  return head(ctx, {title:'友情链接墙' + BRAND, desc:'按项目类、网站类浏览蓝色大肥鱼的友情链接，发现相关项目、图片来源与创作网站。',
    graph:[{'@type':'CollectionPage', name:'友情链接', url:abs('/projects.html'), mainEntity:{'@type':'ItemList', itemListElement:friendLinks.map((f, i) => ({'@type':'ListItem', position:i + 1, url:f.url, name:f.name}))}}, crumbsLd([['友链']], '/projects.html')]}) + shell(ctx, {current:'about', body});
}

// 更新日志：线上是时间线卡片，这里按“日期 + 标题 + 要点”重新排版，同一天的条目归在一起。
export function changelogPage(ctx) {
  const {main} = source('changelog.html');
  const entries = [...main.querySelectorAll('li.tl-item')].map(li => ({date:li.querySelector('.date-sticker')?.textContent.trim(), title:li.querySelector('h2')?.textContent.trim(),
    points:[...li.querySelectorAll('.entry-points > li')].map(p => clean(ctx, p).replace(/^<li>|<\/li>$/g, ''))})).filter(e => e.date && e.title);
  const days = [...new Set(entries.map(e => e.date))];
  const months = [...new Set(days.map(d => d.slice(0, 7)))];
  const body = `${crumbs(ctx, [['更新日志']])}
<header class="page-head"><h1>${esc(ctx.h1())}</h1><p class="lede">本站的变更记录，大事小事都记一笔。共 ${entries.length} 条，最近一次 ${days[0]}。</p>${docNav(ctx, '/changelog.html')}</header>
<div class="doc-layout"><div class="timeline">${days.map(d => `<section class="day" id="d${d.replaceAll('-', '')}"><h2><time datetime="${d}">${d}</time></h2>${entries.filter(e => e.date === d).map(e => `<article class="log-entry"><h3>${esc(e.title)}</h3><ul>${e.points.map(p => `<li>${p}</li>`).join('')}</ul></article>`).join('')}</section>`).join('')}</div>
<aside class="toc" aria-label="按月份"><details open><summary>按月份</summary><ol>${months.map(m => `<li><a href="#d${days.find(d => d.startsWith(m)).replaceAll('-', '')}">${m.replace('-', ' 年 ')} 月</a></li>`).join('')}</ol></details></aside></div>`;
  return head(ctx, {title:'蓝色大肥鱼更新日志：内容收录与站点变更', desc:'查阅蓝色大肥鱼正式站点的历史更新记录，了解作品收录、功能和维护变更。',
    graph:[{'@type':'WebPage', name:'更新日志', url:abs('/changelog.html'), dateModified:days[0]}, crumbsLd([['更新日志']], '/changelog.html')]}) + shell(ctx, {current:'about', body});
}

// 投稿：字段与线上 SubmissionForm / CreatorRegistration 一致。演示页不提交，按钮跳转线上表单。
export function submitPage(ctx) {
  const opt = (name, value, label) => `<label class="choice"><input type="checkbox" name="${name}" value="${value}"><span>${esc(label)}</span></label>`;
  const body = `${crumbs(ctx, [['投稿']])}
<header class="page-head"><h1>${esc(ctx.h1())}</h1><p class="lede">把你的 AI 娘二创交给我们归档。支持单张图片或 ZIP 图片集，也可以走 GitHub 表单；图片逐张审核，通过后批量发布。</p>
<nav class="anchors" aria-label="投稿方式"><a href="#image" aria-current="true">图片作品投稿</a><a href="#creator-registration">视频创作者登记</a><a href="#guide">投稿指南</a></nav></header>
<div class="submit-layout">
<form class="form card-panel" id="image" action="${SITE}/submit.html" method="get" aria-labelledby="h-image">
<h2 id="h-image">图片作品投稿</h2>
<div class="field"><label for="f-files">图片或 ZIP 压缩包 <b class="req">*</b></label><div class="drop"><input type="file" id="f-files" accept="image/*,.zip" disabled><span>拖入或选择文件</span><small>PNG / JPG / GIF / WebP / APNG，单张 ≤ 10 MiB；ZIP ≤ 32 MiB、最多 100 张</small></div></div>
<div class="field-row"><div class="field"><label for="f-name">图片 / 图集名称 <b class="req">*</b></label><input id="f-name" maxlength="120"></div>
<div class="field"><label for="f-type">作品类型 <b class="req">*</b></label><select id="f-type"><option value="">请选择作品类型</option>${types.map(t => `<option value="${t.id}">${esc(t.name)}：${esc(t.description)}</option>`).join('')}</select></div></div>
<div class="field"><label for="f-desc">一句话说明</label><input id="f-desc" maxlength="500" placeholder="知道来源或授权时可以写在这里"></div>
<fieldset class="field"><legend>角色 <b class="req">*</b> <small>可多选，勾选图片中出现的全部角色</small></legend><div class="choices">${characters.filter(c => c.inSubmissionForm).map(c => opt('characterIds', c.id, c.name)).join('')}</div></fieldset>
<div class="field-row"><div class="field"><label for="f-credit">是否署名 <b class="req">*</b></label><select id="f-credit"><option>不署名</option><option>署名</option></select></div>
<div class="field"><label for="f-credit-name">署名名字</label><input id="f-credit-name" maxlength="120"></div></div>
<label class="choice"><input type="checkbox"><span>非 AI 生成（可选）。审核收录后归入“非 AI 创作”分类。</span></label>
<fieldset class="confirm"><legend>提交前确认 <b class="req">*</b></legend>${['我确认自己有权提交本次全部图片，或已获原作者允许。', '同意维护者核实后收录，并在收到版权要求时修改信息或删除。', '知道本站是非官方同人整理项目，图片著作权始终归原作者。'].map(t => `<label class="choice"><input type="checkbox"><span>${t}</span></label>`).join('')}</fieldset>
<div class="row"><a class="btn primary" href="${SITE}/submit.html">去线上表单提交</a><span class="note">演示页不上传文件</span></div>
</form>
<aside class="submit-aside" id="guide"><section class="card-panel"><h2>投稿指南</h2><p>投稿先进入审核队列，审核通过后批量发布。维护者会核对作品类型，并补充标签、来源和授权信息。</p><p>ZIP 仅可包含图片，不支持加密或嵌套压缩包；包内图片共用本次填写的信息，每张独立审核并自动去重。</p>
<div class="row"><a class="btn" href="https://github.com/lmy414/ai-girl-stickers/issues/new?template=sticker-submission.yml" rel="noopener" target="_blank">GitHub 投稿表单</a><a class="btn ghost" href="${ctx.href('/about.html#license')}">授权说明</a><a class="btn ghost" href="${ctx.href('/community.html')}">在 QQ 群投稿</a></div></section>
<section class="card-panel"><h2>作品类型怎么选</h2><dl class="type-list">${types.map(t => `<dt>${esc(t.name)}</dt><dd>${esc(t.description)}</dd>`).join('')}</dl></section></aside>
<form class="form card-panel" id="creator-registration" action="${SITE}/submit.html" method="get" aria-labelledby="h-creator">
<h2 id="h-creator">视频创作者登记</h2><p class="note">当前仅开放 Bilibili。登记你自己的主页和一句话创作说明，下一次更新时同步公开视频；后台逐条审核，只收录 AI 娘二创视频。本站展示封面、简介和作者信息，点击前往 Bilibili 播放。</p>
<div class="field"><label for="c-home">Bilibili UID 或主页链接</label><input id="c-home" placeholder="https://space.bilibili.com/123456"></div>
<div class="field"><label for="c-intro">一句话创作说明</label><textarea id="c-intro" rows="3" maxlength="200" placeholder="用 200 字以内介绍你创作的内容，例如角色动画、同人手书或 AI 娘二创短片。"></textarea></div>
<div class="row"><a class="btn primary" href="${SITE}/submit.html#creator-registration">去线上登记</a><a class="btn ghost" href="${ctx.href('/videos.html')}">查看已收录的视频</a></div>
</form></div>`;
  return head(ctx, {title:'投稿 AI 娘二创作品：来源与授权填写指南' + BRAND, robots:'noindex,follow', md:true,
    desc:'了解 AI 娘图片投稿需要填写的角色、作品类型、原始来源、署名和授权信息。站内投稿和 GitHub 表单均会进入审核队列。',
    graph:[crumbsLd([['投稿']], '/submit.html')]}) + shell(ctx, {current:'submit', body});
}

// 搜索与收藏：noindex。数据来自 assets/search-data.js（构建时生成），在浏览器里检索，演示不需要服务器。
const TAGS = ['晚安', '摸摸头', '哈气', '加班', '鲸鱼', '女仆装', 'Q版', '早安'];
export function searchPage(ctx) {
  const body = `${crumbs(ctx, [['搜索']])}
<header class="page-head"><h1>${esc(ctx.h1())}</h1><p class="lede">用作品名、角色别名、图片说明或标签查找已收录的作品，并按角色与类型筛选。</p></header>
<form class="search-large" role="search" data-search-page><input type="search" name="q" placeholder="例如：鲸鱼、加班、Claude" aria-label="关键词"><select name="role" aria-label="角色"><option value="">全部角色</option>${characters.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button class="btn primary">搜索</button></form>
<p class="row tags">${TAGS.map(t => `<a href="?q=${encodeURIComponent(t)}">#${t}</a>`).join('')}</p>
<p class="note" data-search-status>输入关键词开始搜索。</p><div class="masonry" data-search-results></div>
<section class="section" data-search-empty aria-labelledby="h-roles"><div class="section-head"><h2 id="h-roles">按角色浏览</h2></div><ul class="kind-links">${characters.slice(0, 16).map(c => `<li><a class="r-${c.id}" href="${ctx.href(`/characters/${c.id}.html`)}"><i class="dot"></i>${esc(c.name)}<b>${c.count}</b></a></li>`).join('')}</ul></section>
<noscript><p>搜索需要启用 JavaScript。也可以从<a href="${ctx.href('/characters.html')}">角色</a>或<a href="${ctx.href('/browse.html')}">图库</a>开始浏览。</p></noscript>`;
  return head(ctx, {title:'搜索 AI 娘作品、角色与标签' + BRAND, desc:'用作品名、角色别名、图片说明或标签查找已收录的 AI 娘作品，并按角色与作品类型筛选。', robots:'noindex,follow', scripts:['works-data.js'],
    graph:[crumbsLd([['搜索']], '/search.html')]}) + shell(ctx, {current:'', body});
}
export function savedPage(ctx) {
  const body = `${crumbs(ctx, [['我的收藏']])}
<header class="page-head"><h1>${esc(ctx.h1())}</h1><p class="lede">收藏只保存在当前浏览器，不会发送到服务器。</p></header>
<p class="empty" data-saved-empty>还没有收藏。在作品详情或作者页点“收藏”，再回来看看。<a href="${ctx.href('/browse.html')}">去图库逛逛</a></p><div class="masonry" data-saved-results></div>`;
  return head(ctx, {title:'我的收藏' + BRAND, desc:'收藏只保存在当前浏览器，不会发送到服务器。在作品详情或作者页点收藏，再回到这里查看。', robots:'noindex,follow', scripts:['works-data.js'],
    graph:[crumbsLd([['我的收藏']], '/saved.html')]}) + shell(ctx, {current:'saved', body});
}
export function notFound(ctx) {
  const body = `<section class="not-found"><p class="eyebrow">404</p><h1>${esc(ctx.h1())}</h1><p class="lede">页面可能不存在，或者作品已下架。作品 ID 和网址不会改动，如果你是从旧链接进来的，请告诉我们。</p>
<div class="row"><a class="btn primary" href="${ctx.href('/browse.html')}">回到图库</a><a class="btn" href="${ctx.href('/characters.html')}">按角色找图</a><a class="btn" href="${ctx.href('/search.html')}">搜索</a></div>
<p class="note">或者看看最近收录的作品：</p><div class="thumbs">${gallery.slice(0, 8).map(w => `<a href="${ctx.href('/works/' + w.slug + '.html')}"><img src="${esc(abs(w.i))}" alt="${esc(w.n)}" loading="lazy"></a>`).join('')}</div></section>`;
  return head(ctx, {title:'页面不存在' + BRAND, desc:'这个页面不存在或作品已下架。返回作品档案，按角色与类型继续寻找图片。', robots:'noindex,follow'}) + shell(ctx, {current:'', body});
}
