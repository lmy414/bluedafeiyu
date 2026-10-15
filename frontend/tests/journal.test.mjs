import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {rankSubmissions} from '../public/archive/journal-ranking.js';
const out=process.env.SITE_OUT_DIR||path.resolve(import.meta.dirname,'../../.build/site');
test('homepage ranks only submissions with actual positive recorded views',()=>{
  const works=['new','known','tie','external','zero'].map(id=>({id,slug:id}));
  const stats={available:true,works:{known:{views:10,downloads:2},tie:{views:10,downloads:3},external:{views:999},zero:{views:0}}};
  assert.deepEqual(rankSubmissions(works,['new','known','tie','zero'],stats).map(w=>w.id),['tie','known']);
  assert.deepEqual(rankSubmissions(works,['known'],{...stats,available:false}),[]);
  assert.equal(works[0].id,'new');
});
test('homepage and mobile navigation work before scripts and keep production handlers',()=>{
  for(const prefix of ['', 'en/','ja/','zh-hant/']){
    const {document}=parseHTML(fs.readFileSync(path.join(out,prefix+'index.html'),'utf8'));
    assert.equal(document.querySelectorAll('.mobile-bottom a').length,5,prefix);
    assert.ok(document.querySelector('.mobile-bottom a[href$="/submit.html"]'));
    const topics=document.querySelectorAll('.journal-slide');assert.ok(topics.length>=2);
    assert.equal(document.querySelectorAll('.journal-slide:not([hidden])').length,1);
    assert.equal(document.querySelectorAll('.journal-popular .work-card').length,4);
    assert.ok(document.querySelector('.journal-slide [data-download-topic]'));
    assert.ok(document.querySelector('script[src="/analytics.js"]'));
    assert.equal(document.querySelector('#demo-toolbar'),null);
    assert.equal(document.querySelector('script[src*="/demo/"]'),null);
  }
});
