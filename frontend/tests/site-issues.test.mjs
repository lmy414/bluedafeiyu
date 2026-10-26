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
  assert.ok(doc.querySelector('.portal-heading').textContent.includes('藍色大肥魚'));
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

test('English character pages use Blue Dafeiyu and keep compact character headings',()=>{
  const directory=path.join(out,'en/characters');
  for(const file of fs.readdirSync(directory,{recursive:true}).filter(file=>file.endsWith('.html'))){
    const doc=read('/en/characters/'+file.replaceAll('\\','/'));
    assert.ok(doc.title.endsWith(' | Blue Dafeiyu'),file+': '+doc.title);
    assert.doesNotMatch(doc.title,/ChanFan|\| DeepSeek Chan/);
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

test('the homepage supplies a complete editorial download row and original-download tracking in every language',()=>{
  const archive=JSON.parse(fs.readFileSync(path.join(out,'archive-data.json'),'utf8'));
  const work=archive.works.find(w=>w.slug==='deepseek202609300025');
  for(const locale of LOCALES){
    const section=read(localizedPath('/',locale)).querySelector('#popular-downloads');
    assert.ok(section,locale.id);
    const download=section.querySelector('[data-download-work]');
    assert.equal(download.dataset.downloadWork,work.id);
    assert.equal(download.getAttribute('href'),work.o);
    const picks=[...section.querySelectorAll('.home-download-pick')];
    assert.equal(picks.length,4,locale.id+' complete row');
    assert.equal(new Set(picks.map(pick=>pick.querySelector('[data-download-work]').dataset.downloadWork)).size,4);
    assert.ok(section.querySelector('[data-home-download-note]'));
    assert.ok(section.querySelector(`a[href="${localizedPath('/works/'+work.slug+'.html',locale)}"]`));
  }
});

test('the Mistral correction preserves the DeepSeek co-star and the published URL',()=>{
  const archive=JSON.parse(fs.readFileSync(path.join(out,'archive-data.json'),'utf8'));
  const work=archive.works.find(w=>w.slug==='deepseek202610150012');
  assert.equal(work.id,'sticker_9d10b178a9f645d4bc1d6857');
  assert.deepEqual(work.cids,['deepseek','mistral']);
  for(const locale of LOCALES){
    const page=read(localizedPath('/works/'+work.slug+'.html',locale));
    assert.ok(page.querySelector(`main a[href="${localizedPath('/characters/mistral.html',locale)}"]`));
    assert.ok(page.querySelector(`main a[href="${localizedPath('/characters/deepseek.html',locale)}"]`));
  }
});

test('non-AI search is discoverable and uses an explicitly documented hand-drawn work',()=>{
  const archive=JSON.parse(fs.readFileSync(path.join(out,'archive-data.json'),'utf8'));
  const tagged=archive.works.filter(w=>w.tg.includes('非AI'));
  assert.ok(tagged.some(w=>w.slug==='deepseek202610210008'));
  assert.ok(tagged.some(w=>w.slug==='claude202610170002'),'the maintainer-confirmed hand-drawn work is included');
  for(const locale of LOCALES){
    const page=read(localizedPath('/search.html',locale));
    const link=page.querySelector('[data-non-ai-entry]');
    assert.equal(link.getAttribute('href'),localizedPath('/search.html',locale)+'?q='+encodeURIComponent('非AI'));
    assert.ok(page.querySelector('[data-non-ai-note]').textContent.length>20);
    assert.ok(page.querySelector('select[name="creation"] option[value="non-ai"]'));
    const explanation=page.querySelector('#creation-filter-help');
    assert.ok(explanation.textContent.length>20);
    assert.equal(explanation.classList.contains('filter-help'),false,'the scope explanation must remain visible');
  }
});

test('image navigation exposes all four archive views and original-download tracking survives',()=>{
  for(const locale of LOCALES){
    const routes=['/browse.html','/characters.html','/topics.html','/gifs.html'];
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
