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

test('weekly gallery selection retains report dates, real slugs and original-download tracking',()=>{
  for(const locale of LOCALES){
    const gallery=read(localizedPath('/browse.html',locale));
    const weekly=gallery.querySelector('[data-archive-view="weekly"]');
    assert.ok(weekly);
    const form=gallery.querySelector('[data-weekly-slugs]');
    assert.match(form.getAttribute('data-weekly-slugs'),/deepseek202609300025/);
    assert.match(gallery.querySelector('[data-weekly-period]').textContent,/2026-10-12.*2026-10-18/);
    const detail=read(localizedPath('/works/deepseek202609300025.html',locale));
    const download=detail.querySelector('[data-download-work]');
    assert.ok(download.dataset.downloadWork);assert.ok(download.getAttribute('href'));
  }
});
