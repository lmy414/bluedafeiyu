import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {shareCardId,shareCardImageURL,SHARE_CARD_VERSION,renderShareButton} from '../public/components/share-card-model.js';
import {workShareCopy} from '../src/components/archive/share-card-content.mjs';
import {createFeedPager,installPagedFeeds} from '../public/components/paged-feed.js';
import {renderPagedFeed} from '../src/components/archive/PagedFeed.mjs';
import {renderWorkActions} from '../public/components/work-actions.js';
import {videoCoverURL} from '../src/components/archive/video-cover.mjs';
import {validateFriendLinks,friendLinks} from '../src/lib/friend-links.mjs';
import {createFriendWall} from '../src/components/archive/FriendWall.mjs';
import {decorateDocument} from '../src/components/archive/PageComposition.mjs';
import {localizeHtml,LOCALES,ORIGIN} from '../scripts/localize-pages.mjs';
import {videoArchive} from '../src/lib/video-archive.mjs';
import {renderArchiveTabs} from '../src/components/archive/ArchiveTabs.mjs';

test('copying a work link preserves its selected work and current language on details and previews',async()=>{
  const script=fs.readFileSync(new URL('../public/archive/archive.js',import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'');
  for(const prefix of ['','/en','/ja','/zh-hant'])for(const current of ['/works/selected.html','/browse.html']){
    const {document,window}=parseHTML('<html><body><aside id="sidebar"></aside><div class="main-wrap"><div data-work-actions><button data-copy-link="/works/selected.html">Copy</button><p data-image-copy-status></p></div></div><dialog id="group-dialog"></dialog><dialog id="preview-dialog"><div id="preview-body"></div><button data-preview-close></button></dialog><div id="toast"></div></body></html>');
    const copied=[];
    const lang={fmt:(_key,fallback)=>fallback,url:href=>prefix+href.replace(/^\/(?:en|ja|zh-hant)(?=\/)/,'')};
    const context={document,window:{SiteLang:lang},SiteLang:lang,URL,URLSearchParams,
      navigator:{clipboard:{writeText:async value=>{copied.push(value);}}},
      location:{pathname:prefix+current,search:'',hash:''},
      matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},
      performance:{getEntriesByType:()=>[]},loadArchiveData:async()=>({works:[]}),installTopicDownloads(){},installWorkPreview(){},
      setTimeout,clearTimeout,CustomEvent:window.CustomEvent,Event:window.Event};
    vm.runInNewContext(script,context);
    document.querySelector('[data-copy-link]').click();
    await Promise.resolve();
    assert.deepEqual(copied,['https://xn--pssy23gqgbz2d718b.com'+prefix+'/works/selected.html']);
  }
});

test('the image archive reuses all four page links without altering their URLs',()=>{
  const ctx={tr:(_key,zh)=>zh,old:(_key,zh)=>zh};
  for(const active of ['browse','characters','topics','gifs']){
    const {document}=parseHTML(renderArchiveTabs(active,ctx));
    const links=[...document.querySelectorAll('a')];
    assert.deepEqual(links.map(a=>[a.textContent,a.href]),[['全部','/browse.html'],['角色','/characters.html'],['合集','/topics.html'],['GIF 动图','/gifs.html']]);
    assert.equal(document.querySelectorAll('[aria-current="page"]').length,1);
    assert.equal(links[['browse','characters','topics','gifs'].indexOf(active)].getAttribute('aria-current'),'page');
  }
});

test('share images resolve to the existing generated card across locales and the home aliases',()=>{
  for(const route of ['/','/index.html','/en/','/ja/index.html'])assert.equal(shareCardId(route),'archive-home');
  for(const prefix of ['','/en','/ja','/zh-hant'])assert.equal(shareCardId(prefix+'/works/frozen-id.html?x=1#section'),'archive--works-frozen-id-html');
  assert.equal(shareCardImageURL('/en/works/frozen-id.html'),'/og/archive--works-frozen-id-html.jpg?v='+SHARE_CARD_VERSION);
  const {document}=parseHTML(renderShareButton('/works/a.html" onclick="bad',{compact:true}));
  const button=document.querySelector('button');
  assert.equal(button.getAttribute('onclick'),null);
  assert.ok(button.getAttribute('aria-label'));assert.equal(button.type,'button');
});

test('work share cards use the exact existing DeepSeek comment and fall back honestly when it is absent',()=>{
  const work={n:'一张作品',c:'Claude娘',cm:'本鱼才没有偷吃。',d:'作品说明'};
  assert.deepEqual(workShareCopy(work),{title:work.n,sub:'DeepSeek娘说：'+work.cm,tag:work.c,quote:true});
  assert.deepEqual(workShareCopy({...work,cm:''}),{title:work.n,sub:work.d,tag:work.c,quote:false});
});

test('the first-screen toolbar retains all five independent actions and uses the preview work URL',()=>{
  const work={slug:'selected',id:'work-id',o:'/original.gif',l:'/large.webp',f:'GIF'};
  const {document}=parseHTML(renderWorkActions(work,{preview:true,url:href=>'/en'+href}));
  assert.equal(document.querySelectorAll('.detail-actions > button,.detail-actions > a').length,5);
  assert.equal(document.querySelector('[data-save]').dataset.id,work.slug);
  assert.equal(document.querySelector('[data-download-work]').dataset.downloadWork,work.id);
  assert.equal(document.querySelector('[data-copy-img]').dataset.copyAnimated,'true');
  assert.equal(document.querySelector('[data-copy-link]').dataset.copyLink,'/en/works/selected.html');
  assert.equal(document.querySelector('[data-share-card]').dataset.shareCard,'/works/selected.html');
  assert.equal(document.querySelector('a button'),null);
});

test('friend wall preserves existing destinations, classifies links, and rejects unsafe or incomplete records',()=>{
  let page;
  const escape=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  createFriendWall({esc:escape,tr:(_key,zh)=>zh,pageHead:()=>'',icon:()=>'',write:(...args)=>{page=args;}});
  assert.equal(page[0],'/projects.html');
  const {document}=parseHTML(page[3]);
  assert.equal(document.querySelectorAll('.friend-wall-card').length,friendLinks.length);
  const decorated=parseHTML(decorateDocument(page[3],'projects')).document;
  assert.equal(decorated.querySelectorAll('.friend-wall-card').length,friendLinks.length);
  for(const category of ['project','website'])assert.equal(document.querySelectorAll(`[data-friend-section="${category}"] .friend-wall-card`).length,friendLinks.filter(row=>row.category===category).length);
  assert.deepEqual([...document.querySelectorAll('.friend-wall-card')].map(a=>a.href),['project','website'].flatMap(category=>friendLinks.filter(row=>row.category===category).map(row=>row.url)));
  for(const link of document.querySelectorAll('.friend-wall-card')){
    assert.equal(link.target,'_blank');
    assert.ok(link.rel.split(' ').includes('noopener'));
    assert.ok(link.rel.split(' ').includes('noreferrer'));
  }
  const valid=structuredClone(friendLinks[0]);
  for(const patch of [{url:'javascript:alert(1)'},{url:'https://user:password@example.test/'},{category:'unknown'},{id:'../bad'},{i18n:{}}])assert.throws(()=>validateFriendLinks([{...valid,...patch}]));
  assert.throws(()=>validateFriendLinks([valid,valid]));
  assert.throws(()=>validateFriendLinks([valid,{...valid,id:'duplicate-url',url:valid.url+'/#section'}]),/URL 重复/);
  assert.doesNotThrow(()=>validateFriendLinks([{...valid,id:'legacy-record'}]));
});

test('Coco and water2H2O appear in their categories with native copy in all four languages',async()=>{
  const coco=friendLinks.find(row=>row.id==='cc-coco');
  const blog=friendLinks.find(row=>row.id==='water2h2o');
  assert.equal(coco.category,'project');assert.equal(coco.url,'https://github.com/ninondev/cc-coco');
  assert.equal(blog.category,'website');assert.equal(blog.url,'https://water2h2o.com');
  for(const locale of ['en','ja'])assert.equal(coco.i18n[locale].name,'Coco');
  const escape=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  for(const locale of LOCALES){
    let page;
    createFriendWall({esc:escape,icon:()=>'',pageHead:()=>'<h1>Friends</h1>',write:(...args)=>{page=args;},
      tr:(key,zh,en,ja)=>`<span data-i18n="d.${key}">${escape(({en,ja})[locale.id]||zh)}</span>`});
    const html=`<html><head><title>Friends</title><link rel="canonical" href="${ORIGIN}/projects.html"><meta name="description"></head><body data-archive><main>${page[3]}</main></body></html>`;
    const {document}=parseHTML(await localizeHtml(html,'/projects.html',locale,{works:[],characters:[],topics:[]}));
    assert.equal(document.querySelectorAll('.friend-wall-card').length,friendLinks.length);
    for(const row of [coco,blog]){
      const link=[...document.querySelectorAll(`[data-friend-section="${row.category}"] .friend-wall-card`)].find(a=>a.href===row.url);
      assert.ok(link);
      if(['en','ja'].includes(locale.id)){
        assert.equal(link.querySelector('h3').textContent,row.i18n[locale.id].name);
        assert.equal(link.querySelector('p').textContent,row.i18n[locale.id].description);
      }else if(locale.id==='zh-Hant'){
        assert.match(link.querySelector('p').textContent,row===coco?/桌寵/:/個人部落格/);
      }
    }
  }
});

test('video cover uses a bounded WebP derivative without rewriting unrelated image hosts',()=>{
  const url='https://i1.hdslb.com/bfs/archive/abc.jpg';
  assert.equal(videoCoverURL(url),'https://i1.hdslb.com/bfs/archive/abc.jpg@480w_270h_1c.webp');
  assert.equal(videoCoverURL(url+'@1200w.webp',320),'https://i1.hdslb.com/bfs/archive/abc.jpg@320w_180h_1c.webp');
  assert.equal(videoCoverURL('https://example.test/cover.jpg'),'https://example.test/cover.jpg');
});

test('feeds expose 24 items per click, reset on filtering and sorting, and finish without duplicates',()=>{
  const items=Array.from({length:65},(_,id)=>({id,type:id%2?'image':'video'}));
  const pager=createFeedPager(items);
  assert.equal(pager.visible.length,24);assert.equal(pager.hasMore,true);
  pager.more();assert.equal(pager.visible.length,48);
  pager.more();assert.equal(pager.visible.length,65);assert.equal(pager.hasMore,false);
  assert.equal(new Set(pager.visible).size,65);
  pager.reset({order:[...items].reverse(),matches:item=>item.type==='video'});
  assert.equal(pager.visible.length,24);assert.equal(pager.visible[0].id,64);
  pager.more();assert.equal(pager.visible.length,33);assert.equal(pager.hasMore,false);
});

test('later covers stay in an inert template until loading more; sort restarts from 24',()=>{
  const cards=Array.from({length:65},(_,i)=>`<article class="video-card" data-published="${String(65-i).padStart(3,'0')}"><a href="/v/${i}"><img src="/cover-${i}.webp"></a></article>`);
  const {document,window}=parseHTML('<html><body><select data-video-sort><option value="latest" selected>Latest</option></select>'+renderPagedFeed(cards)+'</body></html>');
  const originals=Object.getOwnPropertyDescriptors(globalThis);
  try{
    Object.defineProperty(globalThis,'document',{value:document,configurable:true});
    Object.defineProperty(globalThis,'window',{value:window,configurable:true});
    Object.defineProperty(globalThis,'location',{value:{hash:''},configurable:true});
    Object.defineProperty(globalThis,'Event',{value:window.Event,configurable:true});
    assert.equal(document.querySelectorAll('[data-feed-grid] img').length,24);
    assert.equal(document.querySelector('template').content.querySelectorAll('img').length,41);
    installPagedFeeds();
    const more=document.querySelector('[data-feed-more]');
    more.click();assert.equal(document.querySelectorAll('[data-feed-grid] img').length,48);
    more.click();assert.equal(document.querySelectorAll('[data-feed-grid] img').length,65);assert.equal(more.hidden,true);
    document.querySelector('[data-video-sort]').dispatchEvent(new window.Event('change'));
    assert.equal(document.querySelectorAll('[data-feed-grid] img').length,24);assert.equal(more.hidden,false);
  }finally{for(const key of ['document','window','location','Event']){if(originals[key])Object.defineProperty(globalThis,key,originals[key]);else delete globalThis[key];}}
});

test('deferred video titles and links are localized before each batch is opened',async()=>{
  const original=videoArchive.videos;
  videoArchive.videos=[{bvid:'BVfixture',uid:'123',characterIds:[],i18n:{en:{title:'Deferred clip',description:'Video description'},ja:{title:'次の動画',description:'動画の説明'}}}];
  try{
    const body='<article data-video-bvid="BVfixture"><h2 data-video-title>后续视频</h2><a href="/creators/bilibili-123.html">creator</a></article>';
    const html=`<html><head><title>Videos</title><link rel="canonical" href="${ORIGIN}/videos.html"><meta name="description"></head><body data-archive><main><h1>Videos</h1><template data-feed-rest>${body}</template><noscript data-feed-noscript>${body}</noscript></main></body></html>`;
    for(const locale of LOCALES.filter(l=>['en','ja'].includes(l.id))){
      const {document}=parseHTML(await localizeHtml(html,'/videos.html',locale,{works:[],characters:[],topics:[]}));
      const content=document.querySelector('template').content;
      assert.equal(content.querySelector('[data-video-title]').textContent,videoArchive.videos[0].i18n[locale.id].title);
      assert.equal(content.querySelector('a').getAttribute('href'),locale.prefix+'/creators/bilibili-123.html');
      assert.equal(document.querySelectorAll('main > article').length,0);
    }
  }finally{videoArchive.videos=original;}
});
