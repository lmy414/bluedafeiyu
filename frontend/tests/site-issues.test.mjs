import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {LOCALES,localizedPath} from '../scripts/localize-pages.mjs';
import {characterSearchAliases} from '../src/lib/landing-copy.mjs';
const out=process.env.SITE_OUT_DIR||path.resolve(import.meta.dirname,'../../.build/site');
const read=route=>parseHTML(fs.readFileSync(path.join(out,route.endsWith('/')?route.slice(1)+'index.html':route.slice(1)),'utf8')).document;

test('Traditional shared brand and DeepSeek archive breadcrumbs link to the Traditional home',()=>{
  const doc=read('/zh-hant/');
  const subtitle=doc.querySelector('.brand strong');
  assert.ok(subtitle.textContent.includes('藍色大肥魚'));
  assert.equal(subtitle.closest('details'),null);
  const directory=path.join(out,'zh-hant/characters');
  const routes=fs.readdirSync(directory,{recursive:true}).filter(file=>/^deepseek(?:\/|\\|\.html)/.test(file)&&file.endsWith('.html'));
  assert.ok(routes.length>2);
  for(const file of routes){
    const page=read('/zh-hant/characters/'+file.replaceAll('\\','/'));
    const brand=page.querySelector('.breadcrumbs a');
    assert.equal(brand.textContent,'藍色大肥魚',file);
    assert.equal(brand.getAttribute('href'),'/zh-hant/',file);
  }
});

test('about headings answer the brand question in Simplified and Traditional Chinese',()=>{
  assert.equal(read('/about.html').querySelector('main h1').textContent,'蓝色大肥鱼是什么？');
  assert.equal(read('/zh-hant/about.html').querySelector('main h1').textContent,'藍色大肥魚是什麼？');
});

test('English character pages use DeepSeek Chan and keep compact character headings',()=>{
  const directory=path.join(out,'en/characters');
  for(const file of fs.readdirSync(directory,{recursive:true}).filter(file=>file.endsWith('.html'))){
    const doc=read('/en/characters/'+file.replaceAll('\\','/'));
    assert.ok(doc.title.endsWith(' | DeepSeek Chan'),file+': '+doc.title);
    assert.doesNotMatch(doc.title,/\| Blue Dafeiyu/);
  }
  assert.equal(read('/en/characters/gemini.html').querySelector('main h1').textContent,'Gemini Chan');
});

test('Chinese and English character titles and descriptions include the requested search aliases',()=>{
  for(const locale of LOCALES.filter(l=>l.id!=='ja'))for(const [id,aliases] of Object.entries(characterSearchAliases)){
    const doc=read(localizedPath('/characters/'+id+'.html',locale));
    const alias=locale.id==='en'?aliases[1]:locale.id==='zh-Hant'?({gpt:'GPT龍娘',claude:'Claude娘化',deepseek:'鯨魚娘'})[id]:aliases[0];
    assert.ok(doc.title.includes(alias),locale.id+': '+doc.title);
    assert.ok(doc.querySelector('meta[name="description"]').getAttribute('content').includes(alias),locale.id+': '+id);
  }
});

test('image navigation has exactly three existing routes and original-download tracking survives',()=>{
  for(const locale of LOCALES){
    const routes=['/browse.html','/characters.html','/topics.html'];
    for(const route of routes){
      const page=read(localizedPath(route,locale));
      const tabs=[...page.querySelectorAll('.gallery-tabs a')];
      assert.deepEqual(tabs.map(a=>a.getAttribute('href')),routes.map(r=>localizedPath(r,locale)));
      assert.equal(tabs.filter(a=>a.getAttribute('aria-current')==='page').length,1);
      assert.equal(tabs.find(a=>a.getAttribute('aria-current')==='page').getAttribute('href'),localizedPath(route,locale));
      assert.equal(page.querySelector('[data-archive-view],[data-archive-sort],[data-weekly-slugs],[data-weekly-period]'),null);
      const sidebar=[...page.querySelectorAll('.main-nav a')].map(a=>a.getAttribute('href'));
      assert.ok(!sidebar.includes(localizedPath('/characters.html',locale)));
      assert.ok(!sidebar.includes(localizedPath('/topics.html',locale)));
    }
    const detail=read(localizedPath('/works/deepseek202609300025.html',locale));
    const download=detail.querySelector('[data-download-work]');
    assert.ok(download.dataset.downloadWork);assert.ok(download.getAttribute('href'));
    assert.equal(detail.querySelector('meta[property="og:image"]').getAttribute('content'),'https://xn--pssy23gqgbz2d718b.com/og/archive--works-deepseek202609300025-html.jpg?v=20261023-4');
    assert.ok(detail.querySelector('meta[property="og:image:alt"]').getAttribute('content'));
  }
  const gallery=read('/browse.html');
  assert.equal(gallery.querySelector('main h1').textContent,'全部图片');
  assert.equal(gallery.querySelector('.main-nav a[href="/browse.html"] span').textContent,'全部图片');
  assert.equal(gallery.querySelector('.main-nav a[href="/videos.html"] span').textContent,'视频');
});
