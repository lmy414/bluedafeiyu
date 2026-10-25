import fs from 'node:fs';
import { homeMeta, guides, guidePath, localizedCopy } from '../src/lib/landing-copy.mjs';
import { aboutSEO, aboutDescription, aboutQuestions } from '../src/lib/about-copy.mjs';
import {applyNativeContent} from './native-content.mjs';
import {nativeArchiveName} from './native-archives.mjs';
import {videoArchive} from '../src/lib/video-archive.mjs';
import {videoCopy} from '../src/lib/video-copy.mjs';
import path from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { Converter } from 'opencc-js/cn2t';

export const ORIGIN = 'https://xn--pssy23gqgbz2d718b.com';
export const LOCALES = [
  { id: 'zh', prefix: '', html: 'zh-CN', hreflang: 'zh-Hans', og: 'zh_CN', label: '简体中文' },
  { id: 'zh-Hant', prefix: '/zh-hant', html: 'zh-Hant', hreflang: 'zh-Hant', og: 'zh_TW', label: '繁體中文' },
  { id: 'en', prefix: '/en', html: 'en', hreflang: 'en', og: 'en_US', label: 'English' },
  { id: 'ja', prefix: '/ja', html: 'ja', hreflang: 'ja', og: 'ja_JP', label: '日本語' }
];
const source = fs.readFileSync(new URL('../public/lang.js', import.meta.url), 'utf8');
let program = new vm.Script(source, { filename: 'lang.js' });
const converter = Converter({ from: 'cn', to: 'twp' });
const normalizeHome = p => p === '/index.html' ? '/' : p;
export const localizedPath = (base, locale) => locale.prefix + normalizeHome(base);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function setMeta(document, selector, value) {
  if (value != null) document.querySelector(selector)?.setAttribute('content', value);
}

function pageMeta(document, api, base, snapshot, archive) {
  const page = document.body.getAttribute('data-i18n-page');
  const slug = base.match(/^\/works\/([^/]+)\.html$/)?.[1];
  const work = slug && snapshot.works.find(w => w.slug === slug);
  const name = document.querySelector('main h1')?.textContent || '';
  const count = document.body.getAttribute('data-archive-count') || document.querySelector('[data-feed]')?.getAttribute('data-total') || 0;
  const n = base.match(/\/page\/(\d+)\.html$/)?.[1];
  const locale = api.current;
  if (locale === 'en' || locale === 'ja') {
    let title, desc;
    if (work) {
      const character = snapshot.characters.find(c => c.id === work.characterId)?.name || work.characterId;
      const kindId = work.categoryIds?.[0] || 'meme';
      const native=work.i18n?.[locale];
      title = native ? native.seoTitle+' | DeepSeek Chan' : api.fmt('page.work.title', '', { name: work.name, character, kindId });
      desc = native ? native.seoDescription : api.fmt('page.work.desc', '', { name: work.name, character, kindId });
    } else if (['characterDetail', 'categoryDetail', 'topicDetail'].includes(page)) {
      title = api.fmt('page.' + page + '.title', '', { name });
      desc = api.fmt('page.' + page + '.desc', '', { name, count });
    }
    if(archive){title=archive.title;desc=archive.description;}
    if (title) document.title = title;
    if (desc) setMeta(document, 'meta[name="description"]', desc);
    if (n && !archive) document.title += ' · ' + api.fmt('v2.pageN', '第 {n} 页', { n });
  } else if (locale === 'zh-Hant' && !document.body.getAttribute('data-i18n-page')) {
    document.title = converter(document.title);
    setMeta(document, 'meta[name="description"]', converter(document.querySelector('meta[name="description"]')?.getAttribute('content') || ''));
  } else if (locale === 'zh-Hant' && !['index', 'category', 'topics', 'submit', 'about', 'characters', 'community', 'search', 'projects', 'changelog', 'notfound', 'event'].includes(page)) {
    document.title = converter(document.title);
    setMeta(document, 'meta[name="description"]', converter(document.querySelector('meta[name="description"]')?.getAttribute('content') || ''));
  }
  let landing;
  if (base === '/index.html') landing = homeMeta(snapshot.works.filter(w=>w.status === 'published').length, locale);
  if (base === '/about.html') landing = { title: localizedCopy(aboutSEO,locale), description: localizedCopy(aboutDescription,locale) };
  if (base === '/projects.html') landing = {
    title: ({zh:'友情链接墙 — 蓝色大肥鱼','zh-Hant':'友情連結牆 — 藍色大肥魚',en:'Friend Link Wall | DeepSeek Chan',ja:'リンクウォール | 藍色大肥魚'})[locale],
    description: ({zh:'按项目类、网站类浏览友情链接，发现有趣的项目与网站。','zh-Hant':'按專案類、網站類瀏覽友情連結，發現有趣的專案與網站。',en:'Browse friend links by projects and websites, and discover interesting places connected to the archive.',ja:'プロジェクトとウェブサイトに分けたリンク集から、アーカイブにつながる楽しい場所を見つけましょう。'})[locale]
  };
  const guide = guides.find(g => guidePath(g) === base);
  if (guide) landing = { title: localizedCopy(guide.name,locale) + (locale === 'en' ? ' | DeepSeek Chan' : locale === 'ja' ? ' | 藍色大肥魚' : ' — 蓝色大肥鱼'), description: localizedCopy(guide.summary,locale) };
  if (base === '/category.html' && ['en','ja'].includes(locale)) landing = {
    title: locale === 'en' ? 'AI Girl Character Guide: DeepSeek, GPT, Claude & More | DeepSeek Chan' : 'AI娘キャラクター図鑑：DeepSeek・GPT・Claudeほか | 藍色大肥魚',
    description: locale === 'en' ? 'Find AI girl memes, illustrations and comics by character. Explore separate archives for DeepSeek, GPT, Claude, GLM, Gemini and Kimi, with sources and license information.' : 'AIキャラクターのスタンプ、イラスト、漫画を探せます。DeepSeek、GPT、Claude、GLM、Gemini、Kimiのアーカイブで、作品の出典と利用許諾をご覧ください。'
  };
  if (landing) {
    document.title = locale === 'zh-Hant' && base !== '/index.html' ? converter(landing.title) : landing.title;
    setMeta(document, 'meta[name="description"]', locale === 'zh-Hant' && base !== '/index.html' ? converter(landing.description) : landing.description);
    for (const selector of ['meta[property="og:image:alt"]','meta[name="twitter:image:alt"]']) setMeta(document,selector,document.title);
  }
  // Restore canonical credits after generic language substitutions, which may
  // otherwise translate a character alias embedded inside an uploader's name.
  if (base === '/videos.html' || base.startsWith('/creators/')) {
    const index = locale === 'en' ? 1 : locale === 'ja' ? 2 : 0;
    const copy = key => locale === 'zh-Hant' ? converter(videoCopy[key][index]) : videoCopy[key][index];
    const creator = videoArchive.creators.find(c => base === `/creators/bilibili-${c.uid}.html`);
    if (locale !== 'zh') {
      document.title = (base.startsWith('/creators/') ? (creator?.name || document.querySelector('main h1')?.textContent || '') + ' · ' + copy('creatorProfile') : copy('videoTitle')) + ' | DeepSeek Chan';
      setMeta(document, 'meta[name="description"]', copy('videoLead'));
    }
    if (creator && document.querySelector('main h1')) (document.querySelector('main h1 [data-creator-name]') || document.querySelector('main h1')).textContent = creator.name;
    for (const c of videoArchive.creators) {
      for (const link of document.querySelectorAll(`a[href="/creators/bilibili-${c.uid}.html"]`)) (link.querySelector('[data-creator-name]') || link).textContent = c.name;
    }
    for (const selector of ['meta[property="og:image:alt"]', 'meta[name="twitter:image:alt"]']) setMeta(document, selector, document.title);
  }
  if(base==='/creators.html' && ['en','ja'].includes(locale)) {document.title=(locale==='en'?'Creators':'クリエイター')+' | DeepSeek Chan';setMeta(document,'meta[name="description"]',locale==='en'?'Explore the creators and their published AI-girl fan art and videos.':'AI娘の二次創作を手がける作者と公開作品をご覧ください。');for(const selector of ['meta[property="og:image:alt"]','meta[name="twitter:image:alt"]'])setMeta(document,selector,document.title);}
  for(const el of document.querySelectorAll('[data-creator-label]'))el.setAttribute('aria-label',el.getAttribute('data-creator-label'));
  if(base==='/saved.html'&&['en','ja'].includes(locale)){document.title=(locale==='en'?'Saved works':'お気に入り')+' | DeepSeek Chan';setMeta(document,'meta[name="description"]',locale==='en'?'Your saved images and creators stay in this browser.':'お気に入りの画像と作者は、このブラウザーにのみ保存されます。');for(const selector of ['meta[property="og:image:alt"]','meta[name="twitter:image:alt"]'])setMeta(document,selector,document.title);}
  if(locale==='en'&&!base.startsWith('/characters/'))document.title=document.title.replaceAll('Blue Dafeiyu','DeepSeek Chan');
  const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  if (locale !== 'zh') {
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[itemprop="name"]']) setMeta(document, selector, document.title);
    for (const selector of ['meta[property="og:description"]', 'meta[name="twitter:description"]', 'meta[itemprop="description"]']) setMeta(document, selector, desc);
  }
  return { work, desc };
}

export async function localizeHtml(html, base, locale, snapshot) {
  const parsed = parseHTML(html);
  const document = parsed.document;
  // Templates stay inert in browsers. Expose their contents only while baking
  // translations so later pages keep native text and localized links.
  const deferred = [...document.querySelectorAll('template[data-feed-rest],noscript[data-feed-noscript]')].map(node => {
    const content = document.createElement('div');
    content.innerHTML = node.innerHTML; node.replaceWith(content);
    return {node, content};
  });
  const window = { location: new URL(ORIGIN + base), navigator: { languages: ['zh-CN'] },
    localStorage: { getItem() { return null; }, setItem() {} }, OpenCC: { Converter: () => converter } };
  program.runInNewContext({ window, document, URL, URLSearchParams, WeakMap, Promise, CustomEvent: parsed.CustomEvent });
  await window.SiteLang.setLang(locale.id, false);
  const api = window.SiteLang;
  if (locale.id === 'zh-Hant' && /^\/characters\/deepseek(?:\/[^?#]*)?\.html$/.test(base)) {
    const trail = document.querySelector('.breadcrumbs');
    if (trail) {
      const brand = document.createElement('a');
      brand.setAttribute('href', '/'); brand.textContent = '藍色大肥魚';
      const separator = document.createElement('span');
      separator.setAttribute('aria-hidden', 'true'); separator.textContent = '/';
      trail.prepend(brand, separator);
    }
  }
  // These dictionaries contain only English/Japanese overrides. Chinese
  // pages use their rendered copy; Traditional Chinese uses OpenCC at runtime.
  if (!['en','ja'].includes(locale.id)) {
    for (const script of document.querySelectorAll('script[src^="/archive-copy.js"],script[src^="/archive-labels.js"]')) script.remove();
  }
  for (const label of document.querySelectorAll('[data-character-name]')) label.textContent = api.characterName(label.getAttribute('data-character-name'), label.getAttribute('data-character-label'));
  const native=applyNativeContent(document,api,base,snapshot);
  const { work, desc } = pageMeta(document, api, base, snapshot,native?.archive);
  const toPage = value => {
    if (!value || value.startsWith('#')) return value;
    const url = new URL(value, ORIGIN + base);
    if (url.origin !== ORIGIN || !(url.pathname.endsWith('.html') || url.pathname === '/')) return value;
    return localizedPath(url.pathname, locale) + url.search + url.hash;
  };
  // HTML 链接、表单与分页保持语言；图片、数据和脚本共用根目录资产。
  for (const attr of ['href', 'action', 'data-next', 'data-href']) {
    for (const el of document.querySelectorAll('[' + attr + ']')) {
      if (el.tagName === 'LINK') continue;
      el.setAttribute(attr, toPage(el.getAttribute(attr)));
    }
  }
  const canonical = document.querySelector('link[rel="canonical"]');
  const canonicalBase = normalizeHome(new URL(canonical.getAttribute('href')).pathname);
  canonical.setAttribute('href', ORIGIN + localizedPath(canonicalBase, locale));
  setMeta(document, 'meta[property="og:url"]', ORIGIN + localizedPath(canonicalBase, locale));
  setMeta(document, 'meta[property="og:locale"]', locale.og);
  document.documentElement.setAttribute('lang', locale.html);
  document.documentElement.setAttribute('data-site-lang', locale.id);
  for (const other of LOCALES.concat([{ prefix: '', hreflang: 'x-default' }])) {
    const link = document.createElement('link');
    link.setAttribute('rel', 'alternate'); link.setAttribute('hreflang', other.hreflang);
    link.setAttribute('href', ORIGIN + localizedPath(canonicalBase, other)); document.head.appendChild(link);
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const data = JSON.parse(script.textContent);
    function localizeSchema(value) {
      if (!value || typeof value !== 'object') return;
      const entitySlug=String(value.url||value.item||'').match(/\/works\/([^/]+)\.html/)?.[1];
      const entity=entitySlug && snapshot.works.find(w=>w.slug===entitySlug)?.i18n?.[locale.id];
      if(entity && value.name) value.name=entity.name;
      const archivePath=String(value.url||value.item||'');
      if(value.name&&['en','ja'].includes(locale.id)&&archivePath){
        const name=nativeArchiveName(new URL(archivePath,ORIGIN).pathname.replace(/^\/(en|ja)/,''),api,snapshot);if(name)value.name=name;
      }
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string' && ['url','@id','item','urlTemplate'].includes(key)) {
          const target = new URL(child, ORIGIN + base);
          if (target.origin === ORIGIN && (target.pathname.endsWith('.html') || target.pathname === '/')) value[key] = ORIGIN + toPage(child);
        } else if (typeof child === 'string' && ['name','description','headline','caption','text','keywords'].includes(key)) {
          value[key] = api.contentText(child);
        } else if (child && typeof child === 'object' && !['creator','author','copyrightHolder'].includes(key)) localizeSchema(child);
      }
      if (value.inLanguage) value.inLanguage = locale.html;
      if (archivePath && value.name && ['en','ja'].includes(locale.id)) {
        const route = new URL(archivePath,ORIGIN).pathname.replace(/^\/(en|ja)(?=\/)/,'');
        const guide = guides.find(g=>guidePath(g)===route);
        if (guide) value.name = localizedCopy(guide.name,locale.id);
        else if (route === '/category.html' || route === '/projects.html') value.name = document.title;
        else if (route === '/saved.html' || route === '/videos.html' || route === '/creators.html' || route.startsWith('/creators/')) value.name = document.title;
      }
      if (base === '/index.html' && ['WebSite','Organization'].includes(value['@type'])) {
        value.name = locale.id === 'en' ? 'DeepSeek Chan' : locale.id === 'zh' ? '蓝色大肥鱼' : '藍色大肥魚';
        if (value['@type'] === 'WebSite') value.description = desc;
      }
    }
    if (!(data['@type']==='FAQPage' && work?.i18n?.[locale.id])) localizeSchema(data);
    if (base === '/about.html' && data['@type'] === 'FAQPage') {
      const index = locale.id === 'en' ? 1 : locale.id === 'ja' ? 2 : 0;
      data.mainEntity = aboutQuestions.map(row=>({ '@type':'Question', name: index === 0 && locale.id === 'zh-Hant' ? converter(row[0]) : row[index], acceptedAnswer:{ '@type':'Answer', text: index === 0 && locale.id === 'zh-Hant' ? converter(row[3]) : row[index+3] } }));
    }
    if (locale.id !== 'zh' && ['WebSite','WebPage','CollectionPage'].includes(data['@type'])) {
      data.name=document.title;
      data.description=desc;
    }
    if (data['@type'] === 'ImageObject') {
      data.url = ORIGIN + localizedPath(base, locale);
      data.license = ORIGIN + toPage(data.license);
      data.acquireLicensePage = ORIGIN + toPage(data.acquireLicensePage);
      if (locale.id !== 'zh') {
        data.name = work?.i18n?.[locale.id]?.name || document.querySelector('main h1')?.textContent || data.name;
        data.description = work?.i18n?.[locale.id]?.description || desc;
        if(work?.i18n?.[locale.id]) data.keywords=work.i18n[locale.id].tags.join(', ');
        data.creditText = document.querySelector('[data-i18n-tpl="work.imageCreditText"]')?.textContent || data.creditText;
        data.copyrightNotice = document.querySelector('[data-copyright]')?.textContent || data.copyrightNotice;
        if (work) data.genre = api.fmt('kind.' + (work.categoryIds?.[0] || 'meme'), data.genre);
      }
    }
    script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  }
  // 无 JS 时保留可折叠的语言入口；JS 入口由 lang.js 绑定统一交互。
  for (const host of document.querySelectorAll('[data-lang-host]')) {
    host.replaceChildren();
    const fallback = document.createElement('noscript');
    fallback.innerHTML = '<details class="lang-fallback"><summary class="lang-trigger">◎ ' + locale.label + ' ⌄</summary><div class="lang-menu">' + LOCALES.map(other => '<a class="lang-option" href="' + escape(localizedPath(base, other)) + '" lang="' + other.html + '">' + other.label + '</a>').join('') + '</div></details>';
    host.appendChild(fallback);
  }
  for (const {node,content} of deferred) {node.innerHTML = content.innerHTML; content.replaceWith(node);}
  return document.toString();
}

export async function buildLanguagePages(out, snapshot, baseFiles = null) {
  const missing=snapshot.works.filter(w=>!w.i18n?.en||!w.i18n?.ja);
  if(missing.length) throw new Error('Native English/Japanese work content missing or stale: '+missing.map(w=>w.id).join(', '));
  program = new vm.Script(fs.readFileSync(path.join(out, 'archive-copy.js'), 'utf8')+'\n'+fs.readFileSync(path.join(out, 'archive-labels.js'), 'utf8') + '\n' + source, { filename: 'lang.js' });
  const files = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === '.rsync-tmp') continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.name.endsWith('.html')) files.push(file);
    }
  }
  if (baseFiles) files.push(...baseFiles.map(file=>path.join(out,file)));
  else walk(out);
  let count = 0;
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('class="v2"') && !html.includes('data-archive')) continue;
    const relative = path.relative(out, file).split(path.sep).join('/');
    const base = '/' + relative;
    for (const locale of LOCALES) {
      const target = path.join(out, locale.prefix.slice(1), relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await localizeHtml(html, base, locale, snapshot));
      count++;
    }
  }
  console.log('[i18n] ' + count + ' static language pages');
}

export function languageSitemap(paths, lastmods = new Map()) {
  const rows = paths.flatMap(base => LOCALES.map(locale => {
    const alternatives = LOCALES.concat([{ prefix: '', hreflang: 'x-default' }]).map(other => '<xhtml:link rel="alternate" hreflang="' + other.hreflang + '" href="' + escape(ORIGIN + localizedPath(base, other)) + '"/>').join('');
    const lastmod = lastmods.get(localizedPath(base, locale));
    return '  <url><loc>' + escape(ORIGIN + localizedPath(base, locale)) + '</loc>' + (lastmod ? '<lastmod>' + escape(lastmod) + '</lastmod>' : '') + alternatives + '</url>';
  }));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + rows.join('\n') + '\n</urlset>\n';
}
