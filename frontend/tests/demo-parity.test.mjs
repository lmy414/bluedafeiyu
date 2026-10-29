import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {archiveCreators} from '../src/lib/creators.mjs';
import {readSaved,toggleSaved} from '../public/archive/saved-items.js';
import {renderWorkCard} from '../public/archive/work-card.js';
import {decorateDocument} from '../src/lib/demo-design.mjs';

test('saved items preserve other entries, remove duplicates and recover from malformed browser storage',()=>{
  const values=new Map();const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  assert.equal(toggleSaved('works','a',storage),true);
  toggleSaved('works','b',storage);toggleSaved('creators','author',storage);
  assert.equal(toggleSaved('works','a',storage),false);
  assert.deepEqual(readSaved('works',storage),['b']);
  assert.deepEqual(readSaved('creators',storage),['author']);
  values.set('bluefish-demo:works','["a","a",null,1]');assert.deepEqual(readSaved('works',storage),['a']);
  values.set('bluefish-demo:works','broken');assert.deepEqual(readSaved('works',storage),[]);
});

test('creator archives combine explicit credited images with their own videos and pin the two contributors',()=>{
  const archive={creators:[{uid:'8',name:'A'},{uid:'4456176',name:'Second'},{uid:'4168597',name:'First'}],videos:[{uid:'4168597',bvid:'one',publishedAt:'2026-10-22T01:00:00Z'},{uid:'8',bvid:'other',publishedAt:'2026-10-23T01:00:00Z'}]};
  const image={id:'image',slug:'art',dt:'2026.10.21'};
  const topics=[{id:'creator',author:{name:'First',channels:[{platform:'Bilibili',url:'https://space.bilibili.com/4168597'}]},list:[image]}];
  const creators=archiveCreators(topics,archive);
  assert.deepEqual(creators.slice(0,2).map(c=>c.uid),['4168597','4456176']);
  assert.equal(creators[0].total,2);assert.deepEqual(creators[0].media.map(m=>m.kind),['video','image']);
  assert.deepEqual(creators[0].videos.map(v=>v.bvid),['one']);assert.equal(creators[0].href,'/creators/bilibili-4168597.html');
});

test('the shared image card retains detail, preview, source credit, license and save actions without nesting buttons in links',()=>{
  const html=renderWorkCard({id:'id',slug:'slug',n:'Title',i:'/image.webp',k:['illustration'],dt:'2026.10.23',lk:'unknown',lt:'Unknown',owners:[{name:'Artist',href:'/creators/artist.html'}],roles:[]});
  const {document}=parseHTML('<html><body>'+html+'</body></html>');
  assert.equal(document.querySelector('[data-save]').getAttribute('data-id'),'slug');
  assert.equal(document.querySelector('[data-preview]').getAttribute('data-preview'),'slug');
  assert.equal(document.querySelector('.art-owner a').getAttribute('href'),'/creators/artist.html');
  assert.equal(document.querySelectorAll('a button').length,0);assert.ok(document.querySelector('.art-license'));
});

test('information-page migration removes competing layout classes while retaining copyright anchors and source text',()=>{
  const html=decorateDocument('<h1>About</h1><div class="about-columns"><div class="about-main"><h2 id="license">License</h2><div class="panel about-card"><p>Credit must remain.</p></div></div><aside>Community</aside></div>','about');
  const {document}=parseHTML('<html><body>'+html+'</body></html>');
  assert.equal(document.querySelectorAll('h1').length,1);assert.ok(document.querySelector('.reading-section #license'));
  assert.ok(document.querySelector('.about-community'));assert.equal(document.querySelector('.panel'),null);
  assert.ok(document.body.textContent.includes('Credit must remain.'));
});


test('image cards expose a real original-download link without opening a preview',()=>{
 const work={id:'id',slug:'slug',n:'Title',i:'/image.webp',o:'https://example.test/original.png',k:['meme'],dt:'2026.10.23',roles:[]};
 const {document}=parseHTML(renderWorkCard(work));
 const link=document.querySelector('.card-download-action');
 assert.equal(link.getAttribute('href'),work.o);
 assert.equal(link.getAttribute('data-download-work'),work.id);
 assert.equal(link.closest('[data-preview]'),null);
 assert.equal(parseHTML(renderWorkCard({...work,o:'javascript:alert(1)'})).document.querySelector('.card-download-action'),null);
});
