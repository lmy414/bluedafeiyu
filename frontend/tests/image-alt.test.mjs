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
  assert.deepEqual({...result,issues:undefined},{images:5,missing:1,empty:2,descriptive:2,issues:undefined});
  assert.deepEqual(result.issues.map(i=>i.kind),['missing','empty-content']);
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
