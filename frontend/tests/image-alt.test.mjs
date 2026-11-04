import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {workImageAlt} from '../public/components/image-alt.js';
import {renderWorkCard} from '../public/components/work-card.js';
import {auditImages} from '../scripts/audit-image-alt.mjs';
import {createVideoPages} from '../src/components/archive/VideoPages.mjs';
import {videoArchive} from '../src/lib/video-archive.mjs';
import {localizeHtml,LOCALES} from '../scripts/localize-pages.mjs';

test('recorded titles distinguish repeated descriptions without guessing visual details',()=>{
  assert.equal(workImageAlt({n:'Tokentaker 25',d:'Gemini fan art'}),'Tokentaker 25 — Gemini fan art');
  assert.notEqual(workImageAlt({n:'25',d:'Fan art'}),workImageAlt({n:'26',d:'Fan art'}));
  assert.equal(workImageAlt({name:'A',description:'A smiling'}),'A smiling');
  assert.equal(workImageAlt({n:'A'}),'A');
  assert.equal(workImageAlt({description:'Recorded description'}),'Recorded description');
  const work={slug:'test',n:'Title "<&',d:'Description >',k:[],roles:[]};
  const {document}=parseHTML(renderWorkCard(work));
  assert.equal(document.querySelector('img').getAttribute('alt'),workImageAlt(work));
  assert.equal(document.querySelectorAll('img').length,1);
});

test('audit distinguishes missing attributes, legitimate decoration and empty content, including templates',()=>{
  const result=auditImages('<img src="missing"><img alt=""><img alt="A > B"><template><img alt="template"></template><a class="video-cover"><img alt=" "></a>');
  assert.deepEqual({...result,issues:undefined,decorations:undefined},{images:5,missing:1,empty:2,descriptive:2,issues:undefined,decorations:undefined});
  assert.deepEqual(result.issues.map(i=>i.kind),['missing','unreviewed-empty','empty-content']);
});

test('video cover links identify the real title in all four static locales; adjacent avatar stays decorative',async()=>{
  const video=videoArchive.videos[0];
  assert.ok(video?.i18n?.en?.title && video?.i18n?.ja?.title);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const {videoCard}=createVideoPages({esc,tr:(_key,zh)=>zh,write:()=>{},pageHead:()=>'',icon:()=>''});
  const html=`<html><head><title>视频</title><link rel="canonical" href="https://example.com/videos.html"></head><body><main>${videoCard(video)}</main></body></html>`;
  for(const locale of LOCALES){
    const {document}=parseHTML(await localizeHtml(html,'/videos.html',locale,{works:[],characters:[],topics:[]}));
    const title=document.querySelector('[data-video-title]').textContent;
    const alt=document.querySelector('.video-cover img').getAttribute('alt');
    assert.equal(alt,title,locale.id);
    assert.ok(alt.trim(),locale.id);
    for(const avatar of document.querySelectorAll('.creator-avatar'))assert.equal(avatar.getAttribute('alt'),'');
  }
});


test('baked traditional Chinese cards convert titles and alt on the home route',async()=>{
  const html='<html><head><title>首页</title><link rel="canonical" href="https://example.com/"></head><body>'+renderWorkCard({slug:'test',n:'绘画作品25',d:'角色创作图片',k:[],roles:[]})+'<img class="credit-avatar" alt="蓝色作者"></body></html>';
  const {document}=parseHTML(await localizeHtml(html,'/index.html',LOCALES.find(l=>l.id==='zh-Hant'),{works:[],characters:[],topics:[]}));
  assert.equal(document.querySelector('img').getAttribute('alt'),'繪畫作品25 — 角色創作圖片');
  assert.equal(document.querySelector('.work-title').textContent,'繪畫作品25');
  assert.equal(document.querySelector('.credit-avatar').getAttribute('alt'),'蓝色作者');
});


test('empty previews, zoom, role portraits and independent controls cannot hide behind decoration',()=>{
  for(const cls of ['preview-photo','preview-zoom','role-card','character-portrait','live-character-portrait']){
    assert.equal(auditImages(`<div class="${cls}"><img alt=""></div>`).issues[0].kind,'empty-content',cls);
  }
  for(const html of ['<a href="/work"><img alt=""></a>','<button><img alt=""><span hidden>Hidden label</span></button>','<a class="avatar-link"><span class="avatar" aria-hidden="true"><img alt=""></span></a>'])assert.equal(auditImages(html).issues[0].kind,'empty-image-control');
  assert.equal(auditImages('<a><div class="character-portrait"><img src="/avatar.png" alt=""></div></a>').issues[0].kind,'empty-content');
  assert.equal(auditImages('<a class="collection-card"><div class="collection-art preview-photo"><img alt=""></div><div class="collection-copy"><h2>Collection</h2></div></a>').issues[0].kind,'empty-content');
  assert.equal(auditImages('<a aria-label="Open work"><img alt=""></a>').issues[0].kind,'unreviewed-empty','an arbitrary label alone is not a reviewed decoration');
});

test('reviewed decorations require their actual adjacent title or author; unknown empties fail closed',()=>{
  const cases=[
    '<a class="collection-card"><div class="collection-art"><img alt=""></div><div class="collection-copy"><h2>Collection</h2></div></a>',
    '<a class="creator-work-preview"><div class="creator-preview-cover"><img alt=""></div><b class="creator-preview-title">Work</b></a>',
    '<a class="video-author"><img class="creator-avatar" alt=""><span data-creator-name>Artist</span></a>',
    '<a class="avatar-link" aria-label="Artist"><span class="avatar" aria-hidden="true"><img alt=""></span></a>',
    '<div class="character-portrait"><img src="/avatar.png" alt=""></div>'
  ];
  cases.push('<section hidden>'+cases[0]+'</section>');
  for(const html of cases){const r=auditImages(html);assert.deepEqual(r.issues,[]);assert.equal(Object.values(r.decorations).reduce((a,b)=>a+b,0),1);}
  assert.equal(auditImages('<a class="collection-card"><div class="collection-art"><img alt=""></div><div class="collection-copy" hidden><h2>Invisible title</h2></div><span>Open</span></a>').issues[0].kind,'unreviewed-empty');
  assert.equal(auditImages('<a class="collection-card"><div class="collection-art"><img alt=""></div><div class="collection-copy"><h2 hidden>Invisible title</h2></div><span>Open</span></a>').issues[0].kind,'unreviewed-empty');
  assert.equal(auditImages('<a class="collection-card"><div class="collection-art"><img alt=""></div><span>Generic action</span></a>').issues[0].kind,'unreviewed-empty');
});
