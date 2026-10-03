import fs from 'node:fs';
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
const program = new vm.Script(source, { filename: 'lang.js' });
const converter = Converter({ from: 'cn', to: 'twp' });
const normalizeHome = p => p === '/index.html' ? '/' : p;
export const localizedPath = (base, locale) => locale.prefix + normalizeHome(base);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function setMeta(document, selector, value) {
  if (value != null) document.querySelector(selector)?.setAttribute('content', value);
}

function pageMeta(document, api, base, snapshot) {
  const page = document.body.getAttribute('data-i18n-page');
  const slug = base.match(/^\/works\/([^/]+)\.html$/)?.[1];
  const work = slug && snapshot.works.find(w => w.slug === slug);
  const name = document.querySelector('main h1')?.textContent || '';
  const count = document.querySelector('[data-feed]')?.getAttribute('data-total') || 0;
  const n = base.match(/\/page\/(\d+)\.html$/)?.[1];
  const locale = api.current;
  if (locale === 'en' || locale === 'ja') {
    let title, desc;
    if (work) {
      const character = snapshot.characters.find(c => c.id === work.characterId)?.name || work.characterId;
      const kindId = work.categoryIds?.[0] || 'meme';
      title = api.fmt('page.work.title', '', { name: work.name, character, kindId });
      desc = api.fmt('page.work.desc', '', { name: work.name, character, kindId });
    } else if (['characterDetail', 'categoryDetail', 'topicDetail'].includes(page)) {
      title = api.fmt('page.' + page + '.title', '', { name });
      desc = api.fmt('page.' + page + '.desc', '', { name, count });
    }
    if (title) document.title = title;
    if (desc) setMeta(document, 'meta[name="description"]', desc);
    if (n) document.title += ' · ' + api.fmt('v2.pageN', '第 {n} 页', { n });
  } else if (locale === 'zh-Hant' && !document.body.getAttribute('data-i18n-page')) {
    document.title = converter(document.title);
    setMeta(document, 'meta[name="description"]', converter(document.querySelector('meta[name="description"]')?.getAttribute('content') || ''));
  } else if (locale === 'zh-Hant' && !['index', 'category', 'topics', 'submit', 'about', 'characters', 'community', 'search', 'projects', 'changelog', 'notfound', 'event'].includes(page)) {
    document.title = converter(document.title);
    setMeta(document, 'meta[name="description"]', converter(document.querySelector('meta[name="description"]')?.getAttribute('content') || ''));
  }
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
  const window = { location: new URL(ORIGIN + base), navigator: { languages: ['zh-CN'] },
    localStorage: { getItem() { return null; }, setItem() {} }, OpenCC: { Converter: () => converter } };
  program.runInNewContext({ window, document, URL, URLSearchParams, WeakMap, Promise, CustomEvent: parsed.CustomEvent });
  await window.SiteLang.setLang(locale.id, false);
  const api = window.SiteLang;
  const { work, desc } = pageMeta(document, api, base, snapshot);
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
    if (data['@type'] === 'ImageObject') {
      data.url = ORIGIN + localizedPath(base, locale);
      data.license = ORIGIN + toPage(data.license);
      data.acquireLicensePage = ORIGIN + toPage(data.acquireLicensePage);
      if (locale.id !== 'zh') {
        data.description = desc;
        data.creditText = document.querySelector('[data-i18n-tpl="work.imageCreditText"]')?.textContent || data.creditText;
        data.copyrightNotice = document.querySelector('[data-copyright]')?.textContent || data.copyrightNotice;
        if (work) data.genre = api.fmt('kind.' + (work.categoryIds?.[0] || 'meme'), data.genre);
      }
      script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    }
  }
  // 无 JS 时保留可折叠的语言入口；JS 入口由 lang.js 绑定统一交互。
  for (const host of document.querySelectorAll('[data-lang-host]')) {
    host.replaceChildren();
    const fallback = document.createElement('noscript');
    fallback.innerHTML = '<details class="lang-fallback"><summary class="lang-trigger">◎ ' + locale.label + ' ⌄</summary><div class="lang-menu">' + LOCALES.map(other => '<a class="lang-option" href="' + escape(localizedPath(base, other)) + '" lang="' + other.html + '">' + other.label + '</a>').join('') + '</div></details>';
    host.appendChild(fallback);
  }
  return document.toString();
}

export async function buildLanguagePages(out, snapshot) {
  const files = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.name.endsWith('.html')) files.push(file);
    }
  }
  walk(out);
  let count = 0;
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('class="v2"')) continue;
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

export function languageSitemap(paths) {
  const rows = paths.flatMap(base => LOCALES.map(locale => {
    const alternatives = LOCALES.concat([{ prefix: '', hreflang: 'x-default' }]).map(other => '<xhtml:link rel="alternate" hreflang="' + other.hreflang + '" href="' + escape(ORIGIN + localizedPath(base, other)) + '"/>').join('');
    return '  <url><loc>' + escape(ORIGIN + localizedPath(base, locale)) + '</loc>' + alternatives + '</url>';
  }));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + rows.join('\n') + '\n</urlset>\n';
}
