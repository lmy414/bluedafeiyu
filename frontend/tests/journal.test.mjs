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
test('redesigned homepage keeps crawlable navigation, live cards and production handlers',()=>{
  for(const prefix of ['', 'en/','ja/','zh-hant/']){
    const {document}=parseHTML(fs.readFileSync(path.join(out,prefix+'index.html'),'utf8'));
    const localized=href=>href==='/'?'/'+prefix:'/'+prefix+href.slice(1);
    const expected=['/','/characters.html','/topics.html','/serials.html','/videos.html','/creators.html','/community-projects.html','/events.html','/community.html','/friend-links.html'].map(localized);
    const links=[...document.querySelectorAll('.sidebar .nav-item')];
    assert.deepEqual(links.map(link=>link.getAttribute('href')),expected,prefix);
    assert.equal(links.filter(link=>link.getAttribute('aria-current')==='page').length,1);
    for(const href of expected)assert.ok(fs.existsSync(path.join(out,href.endsWith('/')?href+'index.html':href)),href);
    assert.ok(document.querySelector('#menu[aria-expanded="false"]'));
    assert.ok(document.querySelector('#collapse[aria-expanded="true"]'));
    assert.ok(document.querySelector('.sidebar .cta[href$="/submit.html"]'));
    assert.equal(document.querySelectorAll('[data-feed-grid] .work-card').length,30);
    assert.ok(document.querySelector('#preview-dialog'));
    assert.ok(document.querySelector('#share-card-dialog'));
    assert.ok(document.querySelector('script[src="/analytics.js"]'));
    assert.equal(document.querySelector('#demo-toolbar'),null);
    assert.equal(document.querySelector('script[src*="preview-isolation"]'),null);
  }
});
