// 线上页面的 SEO 外壳原样复用：title、description、robots、canonical、hreflang、Markdown 副本、og/twitter、JSON-LD
// 全部从 .build/site 对应页面读取，演示只替换正文的结构、样式和交互。URL 集合也以线上为准。
import {readFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {parseHTML} from '../../../frontend/node_modules/linkedom/esm/index.js';
import {BUILT} from './data.mjs';

const fileOf = url => path.join(BUILT, url === '/' ? 'index.html' : url.slice(1));
const cache = new Map();
export function live(url) {
  if (cache.has(url)) return cache.get(url);
  const file = fileOf(url);
  if (!existsSync(file)) throw new Error('线上没有这个页面：' + url);
  const {document} = parseHTML(readFileSync(file, 'utf8'));
  const keep = [...document.head.children].filter(el => {
    const name = el.getAttribute('name'), prop = el.getAttribute('property'), rel = el.getAttribute('rel');
    if (el.tagName === 'TITLE') return true;
    if (el.tagName === 'META') return ['description', 'robots', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt'].includes(name) || /^og:/.test(prop || '');
    if (el.tagName === 'LINK') return rel === 'canonical' || (rel === 'alternate' && (el.hasAttribute('hreflang') || el.getAttribute('type') === 'text/markdown'));
    if (el.tagName === 'SCRIPT') return el.getAttribute('type') === 'application/ld+json';
    return false;
  });
  const main = document.querySelector('main');
  const info = {
    head: keep.map(el => el.outerHTML).join('\n'),
    title: document.title,
    h1: main?.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim() || '',
    lede: main?.querySelector('.page-head .lede, header .lede, .lede')?.textContent.replace(/\s+/g, ' ').trim() || '',
    robots: document.querySelector('meta[name=robots]')?.getAttribute('content') || 'index,follow',
    document,
  };
  cache.set(url, info);
  return info;
}

// 线上简体中文页面清单（不含其他语言目录）。演示必须一页不少。
export function liveURLs() {
  const out = [];
  const walk = dir => { for (const f of readdirSync(dir)) {
    const p = path.join(dir, f), rel = '/' + path.relative(BUILT, p).split(path.sep).join('/');
    if (statSync(p).isDirectory()) { if (!/^\/(en|ja|zh-hant|_astro|submissions|data|vendor|og|archive-data|credits)$/.test(rel)) walk(p); }
    else if (f.endsWith('.html')) out.push(rel === '/index.html' ? '/' : rel);
  } };
  walk(BUILT);
  return out.sort();
}
