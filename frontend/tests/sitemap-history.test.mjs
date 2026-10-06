import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOMParser } from 'linkedom';
import { pageFingerprint, readSitemapHistory, updateSitemapHistory } from '../scripts/sitemap-history.mjs';
import { languageSitemap, LOCALES, ORIGIN, localizedPath } from '../scripts/localize-pages.mjs';

const first = new Date('2026-10-06T00:00:00Z');
const later = new Date('2026-10-07T00:00:00Z');
const page = (name = 'DeepSeek Chan', description = 'A specific work') => `<html><head><title>${name}</title><meta name="description" content="${description}"><script type="application/ld+json">{"@type":"ImageObject","name":"${name}","creator":{"name":"Actual artist","@type":"Person"}}</script></head><body><main><h1>${name}</h1><p>${description}</p><img src="/image.webp" alt="${description}"><a href="/works/related.html">Related work</a><details><summary>Why?</summary><p>A specific answer</p></details><span data-work-stats="work">10 views</span><section class="comments-section">External comments</section></main><footer>Copyright 2026</footer></body></html>`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-sitemap-'));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('dafeiyu-sitemap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (route, html = page()) => {
    const file = path.join(root, route.endsWith('/') ? route.slice(1) + 'index.html' : route.slice(1));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
    fs.utimesSync(file, first, first);
  };
  return { root, write };
}

test('unchanged rebuilds retain dates; native copy changes update only the corresponding language', t => {
  const { root, write } = fixture(t);
  const routes = LOCALES.map(locale => localizedPath('/works/test.html', locale));
  for (const route of routes) write(route);
  const initial = updateSitemapHistory(routes, root, { records: new Map(), seeded: 0 }, { now: first });
  fs.writeFileSync(path.join(root, 'sitemap.xml'), languageSitemap(['/works/test.html'], initial.lastmods));
  const prior = readSitemapHistory(root, { origin: ORIGIN, now: later });
  assert.equal(prior.records.size, 4);
  write('/en/works/test.html', page('A revised English title'));
  const result = updateSitemapHistory(routes, root, prior, { now: later });
  assert.equal(result.changed, 1);
  assert.equal(result.unchanged, 3);
  assert.equal(result.lastmods.get('/en/works/test.html'), later.toISOString());
  for (const route of routes.filter(r => !r.startsWith('/en/'))) assert.equal(result.lastmods.get(route), first.toISOString());
  fs.writeFileSync(path.join(root, 'sitemap.xml'), languageSitemap(['/works/test.html'], result.lastmods));
  const repeat = updateSitemapHistory(routes, root, readSitemapHistory(root, { origin: ORIGIN, now: later }), { now: later });
  assert.equal(repeat.changed, 0);
  assert.equal(repeat.unchanged, 4);
});

test('initial baseline uses previous published file times, and new or removed URLs are handled independently', t => {
  const { root, write } = fixture(t);
  write('/');
  write('/en/');
  write('/ja/');
  write('/zh-hant/');
  fs.writeFileSync(path.join(root, 'sitemap.xml'), languageSitemap(['/']));
  const prior = readSitemapHistory(root, { origin: ORIGIN, now: later });
  assert.equal(prior.seeded, 4);
  assert.equal(prior.records.get('/').lastmod, first.toISOString());
  write('/works/new.html');
  const result = updateSitemapHistory(['/', '/works/new.html'], root, prior, { now: later });
  assert.equal(result.unchanged, 1);
  assert.equal(result.added, 1);
  assert.equal(result.lastmods.size, 2);
  assert.equal(result.lastmods.has('/en/'), false);
  assert.equal(result.lastmods.get('/works/new.html'), later.toISOString());
});

test('layout, build assets, counters, external comments and footer changes do not refresh content dates', () => {
  const original = page();
  const decoration = original.replace('<h1>', '<h1 class="new-layout" id="heading">').replace('10 views', '9999 views').replace('External comments', 'New external comment').replace('Copyright 2026', 'Copyright 2027').replace('</head>', '<script src="/app.js?v=2"></script><link rel="stylesheet" href="/style.css?v=3"></head>');
  assert.equal(pageFingerprint(original), pageFingerprint(decoration));
  const reordered = original.replace('"creator":{"name":"Actual artist","@type":"Person"}', '"creator":{"@type":"Person","name":"Actual artist"}');
  assert.equal(pageFingerprint(original), pageFingerprint(reordered));
});

test('SEO copy, FAQ, artist metadata, image descriptions and related links are significant changes', () => {
  const original = page();
  const changes = [
    original.replace('<title>DeepSeek Chan</title>', '<title>A better search title</title>'),
    original.replace('content="A specific work"', 'content="A revised search description"'),
    original.replace('A specific answer', 'A revised FAQ answer'),
    original.replace('Actual artist', 'Confirmed new artist'),
    original.replace('alt="A specific work"', 'alt="A revised image description"'),
    original.replace('/works/related.html', '/works/new-related.html'),
  ];
  for (const html of changes) assert.notEqual(pageFingerprint(original), pageFingerprint(html));
});

test('sitemap retains hreflang and contains valid per-URL dates without priority or changefreq', () => {
  const dates = new Map(LOCALES.map(locale => [localizedPath('/', locale), first.toISOString()]));
  const xml = languageSitemap(['/'], dates);
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const rows = [...document.querySelectorAll('url')];
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.querySelector('lastmod').textContent, first.toISOString());
    assert.equal(row.querySelectorAll('xhtml\\:link').length, 5);
  }
  assert.doesNotMatch(xml, /priority|changefreq/);
});

test('corrupt history, missing published HTML and future timestamps stop generation', t => {
  const { root, write } = fixture(t);
  write('/');
  write('/en/');
  write('/ja/');
  write('/zh-hant/');
  const dates = new Map(LOCALES.map(locale => [localizedPath('/', locale), '2999-01-01']));
  fs.writeFileSync(path.join(root, 'sitemap.xml'), languageSitemap(['/'], dates));
  assert.throws(() => readSitemapHistory(root, { origin: ORIGIN, now: later }), /future/);
  fs.writeFileSync(path.join(root, 'sitemap.xml'), languageSitemap(['/missing.html']));
  assert.throws(() => readSitemapHistory(root, { origin: ORIGIN, now: later }), /missing/);
  fs.writeFileSync(path.join(root, 'sitemap.xml'), '<broken>');
  assert.throws(() => readSitemapHistory(root, { origin: ORIGIN, now: later }), /no URL records/);
});

test('robots opens public data and images while excluding admin and internal review routes', () => {
  const robots = fs.readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  const rules = [...robots.matchAll(/^(Allow|Disallow):\s*(\S+)/gm)].map(m => ({ blocked: m[1] === 'Disallow', prefix: m[2] }));
  const blocked = pathname => rules.filter(rule => pathname.startsWith(rule.prefix)).sort((a, b) => b.prefix.length - a.prefix.length || Number(a.blocked) - Number(b.blocked))[0]?.blocked || false;
  for (const route of ['/data/blue-fish/previews/test.webp', '/site-data.json', '/submissions/works.json', '/archive/archive.js', '/submit.html', '/admin/login']) assert.equal(blocked(route), false, route);
  for (const route of ['/admin/review', '/cms-api/works', '/api/v1/internal/submissions']) assert.equal(blocked(route), true, route);
  assert.match(robots, /Sitemap: https:\/\/xn--pssy23gqgbz2d718b.com\/sitemap.xml/);
  const nginx = fs.readFileSync(new URL('../../ops/admin/nginx-admin.conf', import.meta.url), 'utf8');
  for (const route of ['/admin', '/cms-api']) assert.match(nginx.split('location ^~ ' + route + ' {')[1].split('}')[0], /add_header X-Robots-Tag "noindex, nofollow" always;/);
});
