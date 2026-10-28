import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {mergeTopicSources,normalizeComicReader} from '../../tools/comic-series.mjs';
import {comicPageURL,createComicSeries} from '../src/components/archive/ComicSeries.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const [serial]=JSON.parse(fs.readFileSync(path.join(root,'data/serial-topics.json'),'utf8'));
const works=JSON.parse(fs.readFileSync(path.join(root,'data/works.json'),'utf8'));

test('explicit serial selection preserves ZIP page numbers, cover, title and named attribution',()=>{
  const selected=serial.workIds.map(id=>works.find(work=>work.id===id));
  assert.ok(selected.every(work=>work?.status==='published'));
  assert.equal(serial.name,'伊甸园罪孽的绽放（连载）');
  assert.equal(serial.author.name,'ADK');
  assert.equal(serial.author.url,'https://space.bilibili.com/2988768');
  assert.equal(selected[0].origin.archive.index,0);
  assert.equal(serial.coverWorkId,selected[0].id);
  assert.equal(selected.length,29);
  for(const page of serial.reader.pages){
    const work=selected.find(work=>work.id===page.workId);
    assert.equal(page.number,work.origin.archive.index);
    assert.equal(work.submitter.name,'ADK');
  }
  assert.deepEqual(serial.reader.pages.map(page=>page.number),Array.from({length:28},(_,i)=>i+1));
});

test('CMS exports cannot remove a curated serial; unpublished pages retain their original gaps',()=>{
  const merged=mergeTopicSources([{id:'ordinary'},{id:serial.id,name:'old'}],[serial]);
  assert.deepEqual(merged.map(topic=>topic.id),['ordinary',serial.id]);
  assert.equal(merged[1],serial);
  const available=serial.workIds.filter(id=>id!==serial.reader.pages[0].workId);
  const reader=normalizeComicReader(serial.reader,available,serial.coverWorkId);
  assert.equal(reader.totalPages,28);
  assert.equal(reader.pages[0].number,2);
  const duplicate=structuredClone(serial.reader);duplicate.pages.push({...duplicate.pages[0]});
  assert.throws(()=>normalizeComicReader(duplicate,serial.workIds,serial.coverWorkId),/重复/);
  const wrong=structuredClone(serial.reader);wrong.pages[0].number=29;
  assert.throws(()=>normalizeComicReader(wrong,serial.workIds,serial.coverWorkId),/无效/);
});

test('reader renders each original page separately with both boundaries and explicit missing-page states',()=>{
  const pages=new Map();
  const list=serial.workIds.map(id=>({id,slug:id,n:id,l:'/image.webp',w:1000,h:1500}));
  const topic={...serial,list,cover:list[0],avatar:'/author-avatars/eden-sins-bloom.webp'};
  const ctx={esc:String,tr:(_key,zh)=>zh,icon:()=>'',button:(url,label)=>`<a href="${url}">${label}</a>`,breadcrumbs:()=>'',write:(url,title,active,content,options)=>pages.set(url,{content,options})};
  createComicSeries(ctx,topic);
  assert.equal(pages.size,29);
  for(let number=0;number<=28;number++){
    const {document}=parseHTML(pages.get(comicPageURL(topic.id,number)).content);
    assert.equal(document.querySelector('[data-comic-reader]').getAttribute('data-comic-page'),String(number));
    assert.equal(document.querySelectorAll('.comic-pages [aria-current="page"]').length,1);
    assert.equal(document.querySelector('.comic-pages [aria-current="page"]').getAttribute('href'),comicPageURL(topic.id,number));
    assert.equal(document.querySelectorAll('.comic-pages a').length,29);
    assert.equal(document.querySelector('select[name="sort"]'),null);
    const nav=document.querySelector('.comic-navigation');
    if(number>0)assert.ok(nav.querySelector(`a[href="${comicPageURL(topic.id,number-1)}"]`));
    if(number<28)assert.ok(nav.querySelector(`a[href="${comicPageURL(topic.id,number+1)}"]`));
    const workId=number?serial.reader.pages.find(page=>page.number===number)?.workId:serial.coverWorkId;
    if(workId)assert.equal(document.querySelector('.comic-sheet').getAttribute('data-comic-work'),workId);
    else {assert.equal(document.querySelector('.comic-sheet'),null);assert.ok(document.querySelector('.comic-unavailable'));}
  }
});

test('built serial pages preserve localized navigation, attribution, canonical URLs and missing-page indexing',()=>{
  const out=process.env.SITE_OUT_DIR||path.join(root,'.build/site');
  for(const prefix of ['','en/','ja/','zh-hant/'])for(let number=0;number<=28;number++){
    const route=comicPageURL(serial.id,number);
    const {document}=parseHTML(fs.readFileSync(path.join(out,prefix+route.slice(1)),'utf8'));
    assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'),'https://xn--pssy23gqgbz2d718b.com/'+prefix+route.slice(1));
    assert.ok(document.querySelector('a[href="https://space.bilibili.com/2988768"]'));
    assert.equal(document.querySelector('.author-avatar').getAttribute('src'),'/author-avatars/eden-sins-bloom.webp');
    const current=document.querySelector('.comic-pages [aria-current="page"]');
    assert.equal(current.getAttribute('href'),'/'+prefix+route.slice(1));
    for(const link of document.querySelectorAll('.comic-navigation a,.comic-pages a')){
      const href=link.getAttribute('href');
      assert.ok(href.startsWith('/'+prefix+'topics/'),href);
      assert.ok(fs.existsSync(path.join(out,href.slice(1))),href);
    }
    const sheet=number?serial.reader.pages.find(page=>page.number===number):true;
    assert.equal(document.querySelector('meta[name="robots"]').getAttribute('content'),sheet?'index,follow':'noindex,follow');
    if(prefix==='en/')assert.match(document.title,number?new RegExp('Original page '+number+'\\b'):/Cover & contents/);
  }
  const {document}=parseHTML(fs.readFileSync(path.join(out,'works',works.find(w=>w.id===serial.reader.pages[0].workId).slug+'.html'),'utf8'));
  assert.ok(document.querySelector('.comic-work-navigation a[href="'+comicPageURL(serial.id,1)+'"]'));
});
