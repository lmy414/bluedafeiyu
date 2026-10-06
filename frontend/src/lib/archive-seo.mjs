import { imageMetadata } from './image-metadata.mjs';
import { workBySlug, ogCard, ORIGIN, SITE } from './v2.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { seoContext, seoTitle } from './seo.mjs';

export const pageURL = (base, n) => n === 1 ? base :
  (base === '/browse.html' ? '/page/' : base.replace(/\.html$/, '/page/')) + n + '.html';
const kindNames = { meme: '表情包与梗图', illustration: '二创插画', setting: '设定图', comic: '漫画', standing: '立绘', other: '其他作品' };

export function createSEO(ctx) {
  const { works, chars, topics, types, esc, grid, button, sectionHead, tr, out } = ctx;
  // Reviewed against the source previews; preserve archive names and distinguish actual scenes only.
  const titleScenes = JSON.parse(fs.readFileSync(path.join(process.env.SITE_SOURCE || path.resolve(process.cwd(), '..'), 'frontend/src/data/work-title-scenes.json'), 'utf8'));
  const workMap = new Map(works.map(w => ['/works/' + w.slug + '.html', w]));
  const collections = new Map();
  const add = (base, list, name, kind, extra = {}) => collections.set(base, { base, list, name, kind, ...extra });
  add('/browse.html', works, 'AI 娘表情包与二创作品', 'browse');
  for (const t of types) add('/categories/' + t.id + '.html', works.filter(w => w.k.includes(t.id)), 'AI 娘' + kindNames[t.id], 'type', { type: t.id });
  for (const c of chars) {
    const availableKinds = types.filter(t => c.list.some(w => w.k.includes(t.id))).map(t => kindNames[t.id]);
    add('/characters/' + c.id + '.html', c.list, c.name + availableKinds.slice(0, 3).join('、') + '档案', 'character', { character: c });
    for (const t of types) {
      const list = c.list.filter(w => w.k.includes(t.id));
      if (list.length) add('/characters/' + c.id + '/' + t.id + '.html', list, c.name + kindNames[t.id], 'character-type', { character: c, type: t.id });
    }
  }
  for (const t of topics) add('/topics/' + t.id + '.html', t.list, t.name + ' · AI 娘作品合集', 'topic', { topic: t });
  const main = {
    '/index.html': ['蓝色大肥鱼 — DeepSeek娘表情包与 AI 娘二创档案', `收录 ${works.length} 件 AI 娘表情包、插画、立绘设定与漫画。按角色、类型和日常场景找图，查看 DeepSeek娘等角色的作品来源、署名与授权信息。`],
    '/characters.html': ['AI 娘角色档案：DeepSeek娘、GPT娘与更多角色 — 蓝色大肥鱼', `浏览 ${chars.length} 位有作品的 AI 娘角色，查看名字、现有别名和代表作品，进入各角色的表情包、插画、设定图与漫画档案。`],
    '/topics.html': ['AI 娘主题合集与作者作品集 — 蓝色大肥鱼', '浏览猫鲸作者作品集与日常场景选题，按问候、工作、安慰和角色初见阅读作品。主题合集保留作品来源、署名与授权记录。'],
    '/search.html': ['搜索 AI 娘作品、角色与标签 — 蓝色大肥鱼', '用作品名、角色别名、图片说明或标签查找已收录的 AI 娘作品，并按角色与作品类型筛选。'],
    '/submit.html': ['投稿 AI 娘二创作品：来源与授权填写指南 — 蓝色大肥鱼', '了解 AI 娘图片投稿需要填写的角色、作品类型、原始来源、署名和授权信息。站内投稿和 GitHub 表单均会进入审核队列。'],
    '/community.html': [`${SITE.group.name}社群与公开交流入口 — 蓝色大肥鱼`, `查看${SITE.group.name} QQ 交流群、站长公开账号和二创交流入口，分享作品、参加活动或反馈归档问题。`],
    '/events/national-day-2026.html': ['2026 国庆前台设计征集：规则与投稿入口 — 蓝色大肥鱼', '查看蓝色大肥鱼 2026 国庆前台设计征集的参加方式、奖项、截止时间、活动仓库和投稿展览。'],
    '/about.html': ['关于蓝色大肥鱼：图片来源、版权与使用许可', '了解 AI 娘二创档案的整理方式、图片署名与授权状态、统计与隐私，以及补署名和下架申请流程。'],
    '/changelog.html': ['蓝色大肥鱼更新日志：内容收录与站点变更', '查阅蓝色大肥鱼正式站点的历史更新记录，了解作品收录、功能和维护变更。查看正式站点的内容收录与功能变更。'],
    '/projects.html': ['蓝色大肥鱼相关项目与图片来源仓库', '访问图片存档仓库、站点源码、首批上游图片档案和前台设计展览，了解作品整理与创作的相关项目。'],
    '/404.html': ['页面不存在 — 蓝色大肥鱼', '这个页面不存在或作品已下架。返回作品档案，按角色与类型继续寻找图片。'],
    '/category.html': ['AI 娘角色目录旧入口 — 蓝色大肥鱼', '保留旧角色目录与历史链接，前往新的角色档案查找表情包、插画和漫画。']
  };
  const full = p => /^https?:/.test(p) ? p : ORIGIN + p;
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const characterFor = w => chars.find(c => c.id === w.cid);
  function lookup(url) {
    if (collections.has(url)) return { ...collections.get(url), n: 1 };
    const match = url.match(/^(.*)\/page\/(\d+)\.html$/);
    const base = match ? (match[1] ? match[1] + '.html' : '/browse.html') : '';
    return collections.has(base) ? { ...collections.get(base), n: Number(match[2]) } : null;
  }
  function description(c) {
    if (c.kind === 'topic') return `${c.topic.summary} 本合集收录 ${c.list.length} 件作品，保留每张图片的说明、来源、署名与授权记录。`;
    const aliases = c.character?.aliases?.length ? `（现有别名：${c.character.aliases.join('、')}）` : '';
    const subject = c.character ? c.character.name + aliases : 'AI 娘';
    const scope = c.type ? kindNames[c.type] : '表情包、插画、设定图与漫画';
    return `浏览 ${subject}的${scope}，本栏收录 ${c.list.length} 件作品。查看图片说明、原图、来源及使用许可，或继续按${c.type ? '角色' : '类型'}寻找相关作品。`;
  }
  function metadata(url, fallback, active, options = {}) {
    const canonicalPath = url === '/index.html' ? '/' : url;
    const canonical = full(canonicalPath), c = lookup(url), w = workMap.get(url);
    let title = main[url]?.[0] || fallback + ' — 蓝色大肥鱼';
    let desc = main[url]?.[1] || options.desc || '';
    let image = '/avatar.png', schema, trail = [['蓝色大肥鱼', '/']];
    let indexOnPublish = !['/search.html', '/404.html', '/category.html'].includes(url);
    if (c) {
      title = c.name + (c.n > 1 ? ` · 第 ${c.n} 页` : '') + ' — 蓝色大肥鱼';
      desc = description(c) + (c.n > 1 ? ` 当前为第 ${c.n} 页。` : '');
      const visible = c.list.slice((c.n - 1) * 24, c.n * 24);
      image = (c.kind === 'topic' && c.n === 1 ? c.topic.cover?.l : visible[0]?.l) || visible[0]?.l || image;
      if (c.character) trail.push(['角色档案', '/characters.html']);
      else if (c.kind === 'topic') trail.push(['主题合集', '/topics.html']);
      else if (c.kind === 'type') trail.push(['全部作品', '/browse.html']);
      if (c.kind === 'character-type') trail.push([c.character.name, '/characters/' + c.character.id + '.html']);
      trail.push([c.name, c.base]);
      if (c.n > 1) trail.push([`第 ${c.n} 页`, url]);
      schema = { '@type': 'CollectionPage', '@id': canonical + '#page', url: canonical, name: c.name, description: desc, inLanguage: 'zh-CN', mainEntity: {
        '@type': 'ItemList', itemListElement: visible.map((item, i) => ({ '@type': 'ListItem', position: (c.n - 1) * 24 + i + 1, item: { '@type': 'CreativeWork', name: item.n, url: full('/works/' + item.slug + '.html'), image: full(item.i) } }))
      } };
      indexOnPublish = c.n === 1 && !(c.kind === 'character-type' && c.list.length < 2);
    } else if (w) {
      title = seoTitle(seoContext({ name: w.n, tags: w.tg, categoryIds: w.k }, characterFor(w)));
      if (titleScenes[w.slug]) title = title.replace(/ - .* \| 蓝色大肥鱼$/, ` — ${titleScenes[w.slug]} | 蓝色大肥鱼`);
      desc = `《${w.n}》${w.c}：${w.d || w.cm || '查看这张已归档的二创图片。'} 查看原图、来源、署名与授权状态。`;
      image = w.l;
      trail.push(['全部作品', '/browse.html'], [w.c, '/characters/' + w.cid + '.html'], [w.n, url]);
      schema = imageMetadata(workBySlug.get(w.slug), {description: w.d || w.cm, genre: w.k.join(' · ')});
      schema['@id'] = canonical + '#image';
    } else {
      trail.push([title, canonicalPath]);
      schema = { '@type': url === '/index.html' ? 'WebSite' : 'WebPage', '@id': canonical + '#page', url: canonical, name: title, description: desc, inLanguage: 'zh-CN' };
    }
    const breadcrumb = { '@type': 'BreadcrumbList', itemListElement: trail.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: full(p) })) };
    const record = { url: canonicalPath, canonical, title, description: desc, image: full(image), og: ogCard('archive-' + (url === '/index.html' ? 'home' : url.replace(/[^a-z0-9-]/gi, '-')), { displayUrl: image, description: w?.d || title, name: w?.n || title }, title, w?.c || c?.character?.name || 'AI 娘二创档案', c?.type || ''), indexOnPublish,
      robots: indexOnPublish && (!c || c.n === 1) ? 'index,follow' : 'noindex,follow', schemas: [schema, ...(url === '/index.html' ? [] : [breadcrumb])], collectionBase: c?.base || null, total: c?.list.length || 0, page: c?.n || 1 };
    return record;
  }
  function pagination(c, n = 1) {
    const total = Math.ceil(c.list.length / 24);
    if (n >= total) return '';
    // Static links keep archived routes discoverable when JavaScript is unavailable.
    return `<noscript><nav data-next="${pageURL(c.base, n + 1)}" class="pagination" aria-label="更多作品">${button(pageURL(c.base, n + 1), tr('loadMore', '再看一些', 'Load more', 'もっと見る'), 'small')}</nav></noscript>`;
  }
  function questions(rows) {
    return `<div class="reading-faq">${rows.map(([q, a]) => `<details><summary>${esc(q)}</summary><div>${a}</div></details>`).join('')}</div>`;
  }
  function roleNotes(c) {
    const counts = types.map(t => [t, c.list.filter(w => w.k.includes(t.id)).length]).filter(([, n]) => n);
    const tags = new Map();for (const w of c.list) for (const tag of w.tg) tags.set(tag, (tags.get(tag) || 0) + 1);
    const common = [...tags].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
    return `<section class="section intro-panel role-reading">${sectionHead(esc(c.name) + '的收录范围')}<p>这份档案目前收录 ${c.list.length} 件${esc(c.name)}作品。${c.aliases.length ? `现有角色记录中的别名是${esc(c.aliases.join('、'))}。` : ''}${common.length ? `作品中常见的标签包括${esc(common.join('、'))}，可以从这些线索开始找图。` : ''}</p><div class="role-type-links">${counts.map(([t, n]) => `<a class="chip" href="/characters/${c.id}/${t.id}.html">${esc(c.name + kindNames[t.id])}<small>${n}</small></a>`).join('')}</div><p class="source-note">每张作品只归入一个类型，各类型数量之和等于角色作品总数。本站展示社区二创；不同作者的设计以各作品原始来源为准。</p>${questions([[`怎样找到${c.name}的表情包？`, `<p>进入${counts.some(([t]) => t.id === 'meme') ? button('/characters/' + c.id + '/meme.html', esc(c.name) + '表情包与梗图', 'small') : button('/characters/' + c.id + '/' + counts[0][0].id + '.html', esc(c.name + kindNames[counts[0][0].id]), 'small')}，或在本页按类型筛选。${counts.some(([t]) => t.id === 'meme') ? '' : '这个角色暂未收录梗图，可先浏览其他类型。'}</p>`], ['下载后可以转载或商用吗？', '<p>收录和下载不等于获得转载、改编或商业使用许可。请进入作品详情核对原作者、来源和授权备注；授权状态不明时，先联系权利人确认。</p><a class="text-link" href="/about.html#licensing">查看取得使用许可的方法</a>']])}</section>`;
  }
  const topicNotes = {
    maojing: ['按投稿者阅读猫鲸的不同表情', '这个作者作品集保留现有收录顺序。先看头像与表情变化，再对照每张作品的说明；想找特定情绪时，可以在合集内筛选梗图或搜索相关标签。'],
    'morning-night': ['把一天的问候串起来', '这一组选图从“早上好”走到晚安与睡前陪伴。适合先按一天的时间顺序阅读，再挑选符合当下心情的问候图。'],
    'working-fish': ['从开工、摸鱼到收工', '这一组选图围绕电脑前的工作、代码排查和休息展开。漫画适合连着看，单张梗图可以从作品说明中寻找对应的工作场景。'],
    'soft-moments': ['先读说明，再挑一张温柔的图', '摸摸头、安慰与睡前问候构成这组选图的线索。相似的表情可能有不同台词，进入详情可以同时查看原图和原始说明。'],
    'meet-ai-girls': ['从代表图进入不同角色的档案', '这里选择多个角色的已收录作品作为初见入口。代表图来自不同创作者，不是统一角色设定；沿作品上的角色链接，可以继续比较她们的其他二创形象。']
  };
  function enrich(url, content) {
    const c = collections.get(url);
    if (url === '/index.html') {
      const ds = chars.find(c => c.id === 'deepseek');
      if (ds) content = content.replace('<section class="section">', `<section class="section">${sectionHead('DeepSeek娘表情包与二创', '蓝色大肥鱼、鲸鱼娘：从代表作品进入角色档案。', '/characters/deepseek.html', '浏览 DeepSeek娘的全部作品')}${grid(ds.list.filter(w => w.k.includes('meme')).slice(8, 12))}</section><section class="section">`);
      content += `<section class="section intro-panel">${sectionHead('第一次来，怎样找到想要的图？')}<div class="reading-columns"><div><h3>按角色和类型找</h3><p>本站收录社区创作的 AI 娘表情包、插画、立绘设定与漫画。先选择角色，再按作品类型浏览；想按具体台词或情绪找图，可以使用搜索。</p><div class="role-entry-links">${chars.slice(0, 5).map(c => `<a class="tag" href="/characters/${c.id}.html">${esc(c.name)}表情包与二创</a>`).join('')}</div></div><div><h3>按主题连着看</h3><p>作者作品集保留投稿者的作品线索。日常场景选题把一组相关作品串起来，作品来源与授权仍保留在每张作品详情中。</p><a class="text-link" href="/topics.html">浏览作者作品集与主题合集</a></div></div>${questions([['蓝色大肥鱼与 DeepSeek娘是什么关系？', '<p>本站角色记录将“蓝色大肥鱼”和“鲸鱼娘”列为 DeepSeek娘的别名。本网站是非官方同人整理项目；这里收录的是社区二创，各作品来源请查看详情。</p>'], ['怎样下载原图并确认使用范围？', '<p>打开作品详情，使用“下载原图”查看原始图片，同时核对来源、署名和授权备注。图片可下载不代表可以任意转载或商用。</p><a class="text-link" href="/about.html#license">阅读授权说明</a>']])}</section>`;
    }
    if (c?.kind === 'character') {
      const kinds = types.filter(t => c.list.some(w => w.k.includes(t.id))).map(t => kindNames[t.id]);
      content = content.replace(`<h1>${esc(c.character.name)}</h1>`, `<h1>${esc(c.character.name)}<small>${esc(kinds.join('、'))}档案</small></h1>`);
      const firstSection = content.indexOf('<section class="section"');
      content = content.slice(0, firstSection) + roleNotes(c.character) + content.slice(firstSection);
    }
    if (c?.kind === 'character-type' || c?.kind === 'type') {
      const heading = kindNames[c.type], sample = c.list.slice(0, 3).map(w => `《${w.n}》`).join('、');
      content += `<section class="section intro-panel">${sectionHead('这一栏可以怎样看？')}<p>本栏整理${esc(c.character?.name || 'AI 娘')}的${esc(heading)}，包括${esc(sample)}等已收录作品。${c.type === 'comic' ? '漫画包含多格分镜，可以表达反应、对比或笑点，建议进入详情放大阅读。' : c.type === 'setting' ? '不同作品由不同作者创作，设定内容以来源中的说明为准。' : c.type === 'meme' ? '可以按台词、情绪和聊天场景继续搜索，再查看作品详情选择原图。' : '进入作品详情可查看完整构图、原始来源和作者署名。'}</p><a class="text-link" href="${c.character ? '/characters/' + c.character.id + '.html' : '/characters.html'}">${esc(c.character ? '回到' + c.character.name + '角色档案' : '按角色继续找作品')}</a></section>`;
    }
    if (c?.kind === 'topic') {
      const note = topicNotes[c.topic.id];
      if (note) content = content.replace('<section class="section" id="collection-works">', `<section class="section intro-panel collection-reading">${sectionHead(esc(note[0]))}<p>${esc(note[1])}</p><p class="source-note">收录顺序与作品范围按现有合集记录展示。 图片来源与授权记录保留在各作品详情中。</p></section><section class="section" id="collection-works">`);
    }
    const w = workMap.get(url);
    if (w) for (const type of w.k) content = content.replace(`href="/categories/${type}.html"`, `href="/characters/${w.cid}/${type}.html"`);
    if (c && c.list.length > 24) {
      content = content.replace(/<nav class="pagination"[\s\S]*?<\/nav>/, '');
      content = content.replace('<div class="load-more-wrap">', pagination(c) + '<div class="load-more-wrap">');
      content = content.replace(/<button([^>]*\bdata-load-more\b[^>]*)>/, (tag, attrs) => /\bhidden\b/.test(attrs) ? tag : `<button${attrs} hidden>`);
    }
    return content;
  }
  function generatePages(write, browsePage, breadcrumbs) {
    for (const c of collections.values()) for (let n = 2; n <= Math.ceil(c.list.length / 24); n++) {
      let body = breadcrumbs([[c.name, c.base], [`第 ${n} 页`]]) + browsePage(c.list, c.base, esc(c.name), c.type || '', c.character?.id || '', n, description(c));
      body = body.replace(/<nav class="pagination"[\s\S]*?<\/nav>/, '') + pagination(c, n);
      const attrs = `data-list-page data-page-number="${n}" data-list-base="${c.base}" ${c.character ? `data-character="${c.character.id}"` : ''} ${c.type ? `data-type="${c.type}"` : ''} ${c.kind === 'topic' ? 'data-sort="curated"' : ''}`;
      write(pageURL(c.base, n), c.name, c.kind === 'topic' ? 'topics' : c.character ? 'characters' : 'browse', body, { attrs });
    }
  }
  return { metadata, enrich, generatePages, collections };
}
