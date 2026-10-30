import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseHTML} from 'linkedom';
import {rankSubmissions} from '../public/archive/journal-ranking.js';
import {topicMembers} from '../public/archive/topic-zip.js';
import {selectDownloadHighlights} from '../public/components/home-downloads.js';

const root=path.resolve(import.meta.dirname,'../..');
const out=process.env.SITE_OUT_DIR||path.join(root,'.build/site');
const read=file=>JSON.parse(fs.readFileSync(path.join(out,file),'utf8'));
const publicData=read('archive-data.json');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'dist/site-data.json'),'utf8'));

test('localized catalogs retain search, preview and original download data for every work',()=>{
  for(const locale of ['zh','en','ja']){
    const data=read(`archive-data/${locale}.json`);
    assert.deepEqual(data.works.map(work=>work.id),publicData.works.map(work=>work.id));
    for(const [i,work] of data.works.entries()){
      const original=publicData.works[i];
      for(const field of ['id','slug','n','d','cm','cids','roles','tg','o','l','f','s','bytes','lk','lt','ln','k','dt'])assert.deepEqual(work[field],original[field],`${locale} ${work.id} ${field}`);
      assert.deepEqual(Object.keys(work.i18n||{}),locale==='zh'?[]:[locale]);
      if(locale!=='zh')assert.deepEqual(work.i18n[locale],original.i18n[locale]);
    }
    for(const topic of data.topics)assert.deepEqual(topicMembers(data,topic.id).works.map(w=>w.id),topicMembers(publicData,topic.id).works.map(w=>w.id));
    // Bound the actual catalog transfer. Editorial text length can grow without
    // changing the number of works, so a fixed per-work average is misleading.
    const compressedBytes=zlib.gzipSync(Buffer.from(JSON.stringify(data))).length;
    const transferBudget=locale==='zh'?512*1024:1024*1024;
    assert.ok(compressedBytes<=transferBudget,`${locale} catalog: ${compressedBytes} compressed bytes exceeds ${transferBudget}`);
  }
  assert.ok(publicData.works.every(w=>w.rights?.license),'Public rights metadata retained');
});

test('small homepage catalog gives identical real popularity results and localized card titles',()=>{
  const home=read('archive-home.json');
  const ids=snapshot.works.filter(w=>w.source==='submission'&&w.status==='published').map(w=>w.id);
  assert.deepEqual(new Set(home.works.map(w=>w.id)),new Set(ids));
  const stats={available:true,works:Object.fromEntries(publicData.works.map((w,i)=>[w.id,{views:i%13,downloads:i%5}]))};
  assert.deepEqual(rankSubmissions(home.works,ids,stats).map(w=>w.id),rankSubmissions(publicData.works,ids,stats).map(w=>w.id));
  for(const work of home.works){
    const original=publicData.works.find(w=>w.id===work.id);
    assert.deepEqual(work.tg,original.tg,'Traditional Chinese card conversion retains its tag array');
    for(const locale of ['en','ja'])assert.equal(work.i18n[locale].name,original.i18n[locale].name);
  }
  assert.ok(zlib.gzipSync(Buffer.from(JSON.stringify(home))).length<110*home.works.length,'Compact catalog stays within 110 compressed bytes per submission');
});

test('homepage bundles styles and keeps lower galleries lazy in all four languages',()=>{
  for(const prefix of ['','en/','ja/','zh-hant/']){
    const {document}=parseHTML(fs.readFileSync(path.join(out,prefix+'index.html'),'utf8'));
    const styles=[...document.querySelectorAll('link[rel=stylesheet]')];
    assert.equal(styles.length,1,prefix+' one stylesheet');
    assert.match(styles[0].getAttribute('href'),/^\/_astro\/.+\.css$/);
    const images=[...document.querySelectorAll('img')];
    assert.equal(images.filter(img=>img.getAttribute('fetchpriority')==='high').length,1);
    const recent=document.querySelector('.portal-curated');
    assert.equal(recent.querySelectorAll('img[loading=eager]').length,0);
    assert.ok(document.querySelector('script[type=module][src^="/_astro/"]'));
    for(const name of ['archive-copy','archive-labels'])assert.equal(!!document.querySelector(`script[src^="/${name}.js"]`),['en/','ja/'].includes(prefix),prefix+' runtime dictionaries');
  }
});

test('compact downloads catalog keeps all published works, originals and translations without the full descriptions',()=>{
  const data=read('archive-downloads.json');
  assert.deepEqual(data.works.map(work=>work.id),publicData.works.map(work=>work.id));
  const stats={available:true,works:Object.fromEntries(publicData.works.map((work,i)=>[work.id,{downloads:i%17}]))};
  assert.deepEqual(selectDownloadHighlights(data.works,stats).map(work=>work.id),selectDownloadHighlights(publicData.works,stats).map(work=>work.id));
  for(const [i,work] of data.works.entries()){
    const original=publicData.works[i];
    assert.equal(work.o,original.o);
    for(const locale of ['en','ja'])assert.equal(work.i18n[locale].name,original.i18n[locale].name);
  }
  assert.ok(zlib.gzipSync(Buffer.from(JSON.stringify(data))).length<180*data.works.length,'download ranking uses a compact lazy catalog');
});
