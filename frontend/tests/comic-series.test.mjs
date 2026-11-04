import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {mergeTopicSources,normalizeComicReader} from '../../tools/comic-series.mjs';
import {comicPageURL,createComicSeries} from '../src/components/archive/ComicSeries.mjs';
import {createComicArchive} from '../src/components/archive/ComicArchive.mjs';
import {nonSerialWorks} from '../public/archive/topic-visibility.js';
import {archiveCreators} from '../src/lib/creators.mjs';
import {clientArchiveData} from '../src/lib/client-data.mjs';
import {packArchiveCatalog,unpackArchiveCatalog} from '../public/components/archive-catalog.js';

const root=path.resolve(import.meta.dirname,'../..');
const [serial]=JSON.parse(fs.readFileSync(path.join(root,'data/serial-topics.json'),'utf8'));
const works=JSON.parse(fs.readFileSync(path.join(root,'data/works.json'),'utf8'));

test('compact browser catalogs preserve serial visibility and every original image path',()=>{
  const images=['ordinary','cover','page'].map(slug=>({id:'id-'+slug,slug,i:'/previews/'+slug+'.webp',l:'/large/'+slug+'.webp',o:'https://example.test/original/'+slug+'.png',i18n:{en:{name:slug},ja:{name:slug}}}));
  const data={characters:[],types:[],works:images,topics:[{id:'style',name:'Style',slugs:['ordinary','page']},{id:'story',name:'Story',slugs:['cover','page'],workIds:['id-cover','id-page'],reader:{totalPages:1,pages:[{number:1,workId:'id-page'}]}}]};
  const before=structuredClone(data);
  for(const locale of ['zh','en','ja']){
    const decoded=unpackArchiveCatalog(JSON.parse(JSON.stringify(packArchiveCatalog(clientArchiveData(data,locale)))));
    assert.deepEqual(nonSerialWorks(decoded.works,decoded.topics).map(work=>work.id),['id-ordinary']);
    assert.deepEqual(decoded.topics.find(topic=>topic.id==='story').reader,data.topics[1].reader);
    assert.deepEqual(decoded.works.map(({id,slug,i,l,o})=>({id,slug,i,l,o})),images.map(({id,slug,i,l,o})=>({id,slug,i,l,o})));
  }
  assert.deepEqual(data,before);
});

test('overlapping ordinary topics preserve work order and independent memberships; serial visibility takes precedence',()=>{
  const images=[{id:'first'},{id:'page'},{id:'last'},{id:'uncollected'}];
  const topics=[{id:'style',workIds:['last','first']},{id:'author',workIds:['first','last']}];
  const before=structuredClone({images,topics});
  assert.deepEqual(nonSerialWorks(images,topics),images);
  topics[0].workIds.push('uncollected');
  assert.deepEqual(topics[1],before.topics[1]);
  assert.deepEqual(nonSerialWorks(images,topics).map(work=>work.id),before.images.map(work=>work.id));
  topics.push({id:'story',workIds:['page'],reader:{}});
  topics[0].workIds.push('page');
  const memberships=structuredClone(topics);
  assert.deepEqual(nonSerialWorks(images,topics).map(work=>work.id),['first','last','uncollected']);
  assert.deepEqual(topics,memberships);
  assert.deepEqual(images,before.images);
});

test('creator archives exclude serial images even when an ordinary author topic also contains them',()=>{
  const images=[{id:'ordinary',dt:'2026.11.04'},{id:'cover',dt:'2026.11.03'},{id:'page',dt:'2026.11.02'}];
  const author={name:'Artist',channels:[{platform:'Bilibili',url:'https://space.bilibili.com/1'}]};
  const topics=[{id:'story',author,workIds:['cover','page'],reader:{},list:images.slice(1)},{id:'artist',author,workIds:images.map(work=>work.id),list:images}];
  const before=structuredClone(topics);
  const [creator]=archiveCreators(topics,{creators:[],videos:[]});
  assert.deepEqual(creator.images.map(work=>work.id),['ordinary']);
  assert.equal(creator.total,1);
  assert.deepEqual(topics,before);
});

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
  const list=serial.workIds.map(id=>({id,slug:id,n:id,l:'/image.webp',w:0,h:0,v:[1000,1500]}));
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
    if(workId){
      assert.equal(document.querySelector('.comic-sheet').getAttribute('data-comic-work'),workId);
      assert.equal(document.querySelector('.comic-sheet img').getAttribute('width'),'1000');
      assert.equal(document.querySelector('.comic-sheet img').getAttribute('height'),'1500');
    }
    else {assert.equal(document.querySelector('.comic-sheet'),null);assert.ok(document.querySelector('.comic-unavailable'));}
  }
});

test('reader supports missing covers, missing pages and serials without creator profiles',()=>{
  const rendered=new Map();
  const topic={id:'example',name:'Example',summary:'Story',workIds:['one'],coverWorkId:'',list:[{id:'one',slug:'one',n:'One',l:'/one.webp',w:100,h:150}],cover:null,reader:{totalPages:2,credits:'',pages:[{number:2,workId:'one'}]}};
  const ctx={esc:String,tr:(_key,zh)=>zh,icon:()=>'',button:(url,label)=>`<a href="${url}">${label}</a>`,breadcrumbs:()=>'',write:(url,title,active,content)=>rendered.set(url,content)};
  createComicSeries(ctx,topic);
  const cover=parseHTML(rendered.get('/topics/example.html')).document;
  assert.ok(cover.querySelector('.comic-unavailable'));
  assert.ok(cover.querySelector('.comic-intro-actions a[href="/topics/example/page/1.html"]'));
  const missing=parseHTML(rendered.get('/topics/example/page/1.html')).document;
  assert.ok(missing.querySelector('.comic-unavailable'));
  assert.ok(missing.querySelector('.comic-pages .comic-missing-link[href="/topics/example/page/1.html"]'));
  assert.ok(missing.querySelector('.comic-navigation a[href="/topics/example/page/2.html"]'));
});

test('serial directory renders one cover card per explicit series and handles missing covers',()=>{
  let content='';
  const base={id:'one',name:'One',summary:'First',reader:{totalPages:3,pages:[{number:2,workId:'page'}]},cover:{i:'/cover.webp',w:300,h:400},author:{name:'Artist'}};
  const ctx={topics:[base,{...base,id:'two',name:'Two',cover:null,author:null},{id:'collection'}],esc:String,tr:(_key,zh)=>zh,old:(_key,zh)=>zh,icon:()=>'',pageHead:(_eyebrow,title,lead)=>`<header><h1>${title}</h1><p>${lead}</p></header>`,write:(_url,_title,_active,html)=>content=html};
  createComicArchive(ctx);
  const {document}=parseHTML(content);
  assert.equal(document.querySelectorAll('.comic-card').length,2);
  assert.equal(document.querySelector('[data-comic-series="one"] img').getAttribute('src'),'/cover.webp');
  assert.equal(document.querySelector('[data-comic-series="one"] a').getAttribute('href'),'/topics/one.html');
  assert.match(document.querySelector('[data-comic-series="one"] .comic-card-pages').textContent,/1 \/ 3/);
  assert.match(document.querySelector('[data-comic-series="two"] .comic-card-cover').textContent,/封面暂未收录/);
});

test('built gallery separates serial members while retaining the reader and stable details',()=>{
  const out=process.env.SITE_OUT_DIR||path.join(root,'.build/site');
  const data=JSON.parse(fs.readFileSync(path.join(out,'archive-data.json'),'utf8'));
  const serials=data.topics.filter(topic=>topic.reader);
  const serialIds=new Set(serials.flatMap(topic=>topic.workIds));
  const regular=data.works.filter(work=>!serialIds.has(work.id));
  assert.ok(serials.length>0);
  const read=file=>parseHTML(fs.readFileSync(path.join(out,file),'utf8')).document;
  for(const prefix of ['','en/','ja/','zh-hant/']){
    const gallery=read(prefix+'browse.html');
    assert.deepEqual(JSON.parse(gallery.querySelector('#results').getAttribute('data-list')),regular.map(work=>work.slug));
    const home=read(prefix+'index.html');
    assert.ok(home.querySelector(`.portal-welcome-actions a[href="/${prefix}serials.html"]`));
    assert.equal(home.querySelector(`.portal-entry[href="/${prefix}browse.html"] .portal-entry-meta`).textContent,String(regular.length));
    assert.equal(home.querySelector('.portal-edition dd').textContent,String(regular.length));
    for(const link of read(prefix+'search.html').querySelectorAll('.tag-cloud a')){
      const tag=new URL(link.getAttribute('href'),'https://example.test').searchParams.get('q');
      assert.equal(Number(link.querySelector('small').textContent),regular.filter(work=>work.tg.includes(tag)).length);
    }
    for(const card of home.querySelectorAll('.home-latest .work-card'))assert.ok(!serialIds.has(data.works.find(work=>work.slug===card.getAttribute('data-slug')).id));
    for(const character of data.characters){
      const expected=regular.filter(work=>work.cids.includes(character.id));
      const page=read(prefix+'characters/'+character.id+'.html');
      const list=page.querySelector('#results');
      if(expected.length){
        assert.deepEqual(JSON.parse(list.getAttribute('data-list')),expected.map(work=>work.slug));
      }else assert.ok(page.querySelector(`.empty-state a[href="/${prefix}serials.html"]`));
      for(const topic of serials)assert.equal(page.querySelector(`.collection-grid a[href="/${prefix}topics/${topic.id}.html"]`),null);
      for(const type of data.types){
        const prior=data.works.filter(work=>work.cids.includes(character.id)&&work.k.includes(type.id));
        if(!prior.length)continue;
        const roleType=read(prefix+'characters/'+character.id+'/'+type.id+'.html');
        const expectedType=expected.filter(work=>work.k.includes(type.id));
        assert.deepEqual(JSON.parse(roleType.querySelector('#results').getAttribute('data-list')),expectedType.map(work=>work.slug));
      }
      const all=data.works.filter(work=>work.cids.includes(character.id));
      const oldLast=Math.ceil(all.length/24),newLast=Math.max(1,Math.ceil(expected.length/24));
      if(oldLast>newLast){
        const oldPage=read(prefix+'characters/'+character.id+'/page/'+oldLast+'.html');
        assert.equal(oldPage.querySelector('body').getAttribute('data-page-number'),String(newLast));
        assert.deepEqual(JSON.parse(oldPage.querySelector('#results').getAttribute('data-list')),expected.map(work=>work.slug));
      }
    }
    const directory=read(prefix+'serials.html');
    assert.equal(directory.querySelector('.gallery-tabs [aria-current="page"]').getAttribute('href'),'/'+prefix+'serials.html');
    for(const route of ['browse.html','characters.html','topics.html','gifs.html'])assert.ok(read(prefix+route).querySelector(`.gallery-tabs a[href="/${prefix}serials.html"]`));
    const ordinaryRoutes=['index.html','topics.html','creators.html',...data.topics.filter(topic=>!topic.reader).map(topic=>'topics/'+topic.id+'.html'),...fs.readdirSync(path.join(out,prefix,'creators')).filter(name=>name.endsWith('.html')).map(name=>'creators/'+name)];
    const serialSlugs=new Set(data.works.filter(work=>serialIds.has(work.id)).map(work=>work.slug));
    for(const route of ordinaryRoutes){
      const page=read(prefix+route);
      for(const card of page.querySelectorAll('.work-card'))assert.ok(!serialSlugs.has(card.getAttribute('data-slug')),prefix+route+' excludes serial images');
      for(const topic of serials){
        assert.equal(page.querySelector(`.collection-card[href="/${prefix}topics/${topic.id}.html"]`),null,prefix+route+' excludes serial topic cards');
        assert.equal(page.querySelector(`.paper-feature[href="/${prefix}topics/${topic.id}.html"]`),null,prefix+route+' excludes serial recommendations');
      }
    }
    assert.equal(directory.querySelectorAll('.comic-card').length,serials.length);
    for(const topic of serials){
      const card=directory.querySelector(`[data-comic-series="${topic.id}"]`);
      assert.equal(card.querySelector('a').getAttribute('href'),'/'+prefix+'topics/'+topic.id+'.html');
      const cover=data.works.find(work=>work.id===topic.coverWorkId);
      if(cover)assert.equal(card.querySelector('img').getAttribute('src'),cover.i);
      if(prefix==='en/'||prefix==='ja/')assert.equal(card.querySelector('h2').textContent,topic.i18n[prefix.slice(0,-1)].name);
      const reader=read(prefix+'topics/'+topic.id+'.html');
      assert.ok(reader.querySelector(`.breadcrumbs a[href="/${prefix}serials.html"]`));
      assert.ok(reader.querySelector(`.comic-intro-actions a[href="/${prefix}topics/${topic.id}/page/1.html"]`));
    }
    for(const type of data.types){
      const list=JSON.parse(read(prefix+'categories/'+type.id+'.html').querySelector('#results').getAttribute('data-list'));
      assert.deepEqual(list,regular.filter(work=>work.k.includes(type.id)).map(work=>work.slug));
    }
  }
  const download=JSON.parse(fs.readFileSync(path.join(out,'archive-downloads.json'),'utf8'));
  assert.ok(download.works.every(work=>!serialIds.has(work.id)));
  const recent=JSON.parse(fs.readFileSync(path.join(out,'archive-home.json'),'utf8'));
  assert.ok(recent.works.every(work=>!serialIds.has(work.id)));
  const search=JSON.parse(fs.readFileSync(path.join(out,'search-index.json'),'utf8'));
  assert.deepEqual(search.map(work=>work.id),regular.map(work=>work.id));
  for(const id of serialIds){
    const work=data.works.find(item=>item.id===id);
    assert.ok(fs.existsSync(path.join(out,'works',work.slug+'.html')));
  }
  const oldLast=Math.ceil(data.works.length/24),newLast=Math.ceil(regular.length/24);
  if(oldLast>newLast){
    const page=read('page/'+oldLast+'.html');
    assert.equal(page.querySelector('body').getAttribute('data-page-number'),String(newLast));
    assert.equal(page.querySelector('meta[name="robots"]').getAttribute('content'),'noindex,follow');
    assert.ok(page.querySelectorAll('#results .work-card').length>0);
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
