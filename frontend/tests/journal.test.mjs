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
    const localized=href=>href==='/'?'/'+prefix:'/'+prefix+href.slice(1);
    const expected=['/','/browse.html','/videos.html','/creators.html','/community-projects.html','/community.html','/events.html','/friend-links.html','/about.html'].map(localized);
    const mainLinks=[...document.querySelectorAll('.sidebar-rail .main-nav a')];
    const mobileLinks=[...document.querySelectorAll('.mobile-bottom a')];
    const drawerLinks=[...document.querySelectorAll('.mobile-drawer .drawer-nav a')];
    assert.deepEqual(mainLinks.map(link=>link.getAttribute('href')),expected,prefix);
    assert.deepEqual(mobileLinks.map(link=>link.getAttribute('href')),['/','/browse.html','/videos.html','/creators.html','/saved.html'].map(localized),prefix);
    assert.deepEqual(drawerLinks.map(link=>link.getAttribute('href')),['/','/browse.html','/videos.html','/creators.html'].map(localized).concat('https://weekly.xn--pssy23gqgbz2d718b.com/',['/community.html','/community-projects.html','/friend-links.html','/about.html','/events.html'].map(localized)),prefix);
    for(const href of expected){
      const pathname=href.split('#')[0];
      assert.ok(fs.existsSync(path.join(out,pathname.endsWith('/')?pathname+'index.html':pathname)),href);
    }
    assert.equal(mainLinks.filter(link=>link.getAttribute('aria-current')==='page').length,1,prefix);
    assert.equal(mobileLinks.length,5,prefix);
    assert.equal(mainLinks.length,9,prefix);
    assert.equal(drawerLinks.length,10,prefix);
    assert.equal(document.querySelector('[data-sidebar-collapse]'),null);
    assert.equal(document.querySelector('[data-menu]')?.getAttribute('aria-controls'),'sidebar');
    assert.ok(document.querySelector('.mobile-drawer [data-menu-close]'));
    assert.ok(document.querySelector('.menu-scrim[data-menu-close][hidden]'));
    assert.ok(document.querySelector('.mobile-bottom.mobile-nav'),'Uses the Demo mobile layout');
    const savedEntry=document.querySelector('.topbar .saved-entry[href$="/saved.html"]');
    assert.ok(savedEntry);
    assert.equal(savedEntry.getAttribute('aria-label'),({'':'我的收藏','en/':'Saved works','ja/':'お気に入り','zh-hant/':'我的收藏'})[prefix]);
    const topics=document.querySelectorAll('[data-design-slide]');assert.ok(topics.length>=2);
    assert.equal(document.querySelectorAll('[data-design-slide]:not([hidden])').length,1);
    assert.equal(document.querySelectorAll('.portal-primary > a').length,1);
    assert.equal(document.querySelector('.portal-welcome-actions'),null);
    assert.equal(document.querySelector('.portal-videos'),null);
    assert.equal(document.querySelectorAll('.portal-secondary > a').length,3);
    assert.ok(document.querySelector('[data-design-slide] a[href*="/topics/"]'));
    assert.ok(document.querySelector('.portal-participate a[href$="/submit.html"]'));
    assert.ok(document.querySelector('script[src="/analytics.js"]'));
    assert.equal(document.querySelector('#demo-toolbar'),null);
    assert.equal(document.querySelector('script[src*="/demo/"]'),null);
  }
});
