import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {LOCALES,localizedPath} from '../scripts/localize-pages.mjs';
import {characterSearchAliases} from '../src/lib/landing-copy.mjs';
const out=process.env.SITE_OUT_DIR||path.resolve(import.meta.dirname,'../../.build/site');
const read=route=>parseHTML(fs.readFileSync(path.join(out,route.endsWith('/')?route.slice(1)+'index.html':route.slice(1)),'utf8')).document;

test('Traditional home brand subtitle and every DeepSeek archive breadcrumb link to the Traditional home',()=>{
  const doc=read('/zh-hant/');
  const subtitle=doc.querySelector('.home-brand-lede');
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

test('all English character pages use Blue Dafeiyu and separate the character name from the heading subtitle',()=>{
  const directory=path.join(out,'en/characters');
  for(const file of fs.readdirSync(directory,{recursive:true}).filter(file=>file.endsWith('.html'))){
    const doc=read('/en/characters/'+file.replaceAll('\\','/'));
    assert.ok(doc.title.endsWith(' | Blue Dafeiyu'),file+': '+doc.title);
    assert.doesNotMatch(doc.title,/\| DeepSeek Chan/);
  }
  assert.equal(read('/en/characters/gemini.html').querySelector('main h1').textContent,'Gemini Chan Fan art archive');
});

test('Chinese and English character titles and descriptions include the requested search aliases',()=>{
  for(const locale of LOCALES.filter(l=>l.id!=='ja'))for(const [id,aliases] of Object.entries(characterSearchAliases)){
    const doc=read(localizedPath('/characters/'+id+'.html',locale));
    const alias=locale.id==='en'?aliases[1]:locale.id==='zh-Hant'?({gpt:'GPT龍娘',claude:'Claude娘化',deepseek:'鯨魚娘'})[id]:aliases[0];
    assert.ok(doc.title.includes(alias),locale.id+': '+doc.title);
    assert.ok(doc.querySelector('meta[name="description"]').getAttribute('content').includes(alias),locale.id+': '+id);
  }
});

test('homepage download highlight is static in every language, has the report week and retains work-download tracking',()=>{
  for(const locale of LOCALES){
    const section=read(localizedPath('/',locale)).querySelector('#popular-downloads');
    assert.ok(section);
    assert.equal(section.hidden,false);
    assert.ok(section.textContent.includes('2026-10-12'));assert.ok(section.textContent.includes('2026-10-18'));
    assert.ok(section.querySelector('a[href="'+locale.prefix+'/works/deepseek202609300025.html"]'));
    const download=section.querySelector('[data-download-work]');
    assert.ok(download.dataset.downloadWork);assert.ok(download.getAttribute('href'));
  }
});
