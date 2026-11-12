import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {installHomeFeed} from '../public/components/home-feed.js';
const works=Array.from({length:75},(_,i)=>({id:'id'+i,slug:'frozen-'+i,n:i%2?'hug':'wave',cids:i%2?['a']:['a','b'],roles:[],k:['meme'],tg:[],i:'/a.webp',f:i%3?'PNG':'GIF',createdAt:new Date(2026,0,i+1).toISOString()}));
async function fixture(hash='',{stats,awaitReady=true,loading=false}={}){
 const {document,window}=parseHTML(`<html><body><form class="search"><input></form><span data-home-count></span><a data-home-type=""></a><a data-home-type="meme"></a><a data-home-type="gif"></a><a data-home-type="comic"></a><div data-filter-picker="character"><button><span>All</span></button><ul role="listbox" aria-multiselectable="true" hidden>${['','a','b'].map(id=>`<li role="option" ${id?`data-character-id="${id}"`:''}>${id||'All'}</li>`).join('')}</ul></div><div data-filter-picker="sort"><button><span>Latest</span></button><ul role="listbox" hidden><li role="option" data-href="/browse.html#sort=latest">Latest</li><li role="option" data-href="/browse.html#sort=random">Random</li><li role="option" data-href="/browse.html#sort=popular">Popular</li><li role="option" data-href="/browse.html#sort=downloads">Downloads</li></ul></div><p data-home-sort-status hidden></p><a data-home-reset></a><p data-home-empty hidden></p><div data-feed-grid data-excluded-ids='["id74"]'></div><span data-home-shown></span><a data-home-more></a></body></html>`);
 const location=new URL('https://example.test/ja/index.html'+hash);
 Object.defineProperty(window,'location',{value:location,configurable:true});
 Object.defineProperty(window,'history',{value:{state:null,replaceState(_state,_title,href){location.href=href;}},configurable:true});
 const click=selector=>{const e=new window.Event('click',{bubbles:true,cancelable:true});document.querySelector(selector).dispatchEvent(e);assert.equal(e.defaultPrevented,true);};
 const choose=selector=>document.querySelector(selector).dispatchEvent(new window.Event('click',{bubbles:true}));
 if(loading)Object.defineProperty(document,'readyState',{value:'loading'});
 window.WorkStats=stats;
 const {ready}=installHomeFeed({document,window,load:async()=>({works,characters:[]})});
 if(awaitReady)await ready;
 const slugs=()=>[...document.querySelectorAll('.work-card')].map(node=>node.dataset.slug);
 return {document,window,location,click,choose,slugs,ready};
}
test('inline homepage loads full catalog, excludes serial works, pages beyond first30 and keeps stable URLs',async()=>{
 const f=await fixture();assert.equal(f.slugs().length,30);assert.equal(f.slugs()[0],'frozen-73');f.click('[data-home-more]');assert.equal(f.slugs().length,60);f.click('[data-home-more]');assert.equal(f.slugs().length,74);assert.ok(f.document.querySelector('[data-home-more]').hidden);
 for(const link of f.document.querySelectorAll('[data-preview]'))assert.equal(link.getAttribute('href'),'/works/'+link.dataset.preview+'.html');assert.equal(f.location.pathname,'/ja/index.html');
});
test('role multi-select intersects, combines GIF/search/sort, resets and handles empty results inline',async()=>{
 const f=await fixture();f.choose('[data-character-id="a"]');f.choose('[data-character-id="b"]');assert.ok(f.slugs().every(slug=>Number(slug.split('-')[1])%2===0));assert.equal(f.document.querySelectorAll('[data-filter-picker="character"] [aria-selected="true"]').length,2);
 f.click('[data-home-type="gif"]');assert.ok(f.slugs().every(slug=>Number(slug.split('-')[1])%6===0));f.choose('[data-href$="sort=random"]');const random=f.slugs();assert.equal(new Set(random).size,random.length);
 f.document.querySelector('input').value='hug';f.document.querySelector('form').dispatchEvent(new f.window.Event('submit',{cancelable:true}));assert.equal(f.slugs().length,0);assert.equal(f.document.querySelector('[data-home-empty]').hidden,false);
 f.click('[data-home-reset]');assert.equal(f.slugs().length,30);assert.equal(f.location.hash,'');assert.equal(f.document.querySelector('input').value,'');assert.equal(f.location.pathname,'/ja/index.html');
});
test('shared fragment restores filters without changing localized homepage path',async()=>{
 const f=await fixture('#character=a,b&type=gif&q=wave');assert.ok(f.slugs().length>0);assert.ok(f.slugs().every(slug=>Number(slug.split('-')[1])%6===0));assert.equal(f.document.querySelector('input').value,'wave');assert.equal(f.location.pathname,'/ja/index.html');
});
test('hash back restores role state and keyboard toggles keep multi-select panel open',async()=>{
 const f=await fixture('#character=a,b');
 f.location.hash='#character=a&type=gif';f.window.dispatchEvent(new f.window.Event('hashchange'));
 assert.equal(f.document.querySelector('[data-character-id="b"]').getAttribute('aria-selected'),'false');
 const button=f.document.querySelector('[data-filter-picker="character"] button');button.dispatchEvent(new f.window.Event('click'));
 const panel=f.document.querySelector('[data-filter-picker="character"] [role=listbox]');assert.equal(panel.hidden,false);
 const key=new f.window.Event('keydown',{bubbles:true,cancelable:true});key.key=' ';f.document.querySelector('[data-character-id="b"]').dispatchEvent(key);
 assert.equal(panel.hidden,false);assert.ok(f.slugs().every(slug=>Number(slug.split('-')[1])%6===0));
 const escape=new f.window.Event('keydown',{bubbles:true,cancelable:true});escape.key='Escape';panel.dispatchEvent(escape);assert.equal(panel.hidden,true);
 f.choose('[data-filter-picker="character"] [role=option]:not([data-character-id])');assert.equal(f.document.querySelectorAll('[data-character-id][aria-selected="true"]').length,0);
});
test('shared preview discovers only the currently filtered and rerendered home cards',async()=>{
 const {installWorkPreview}=await import('../public/components/work-preview.js');const f=await fixture();
 f.document.body.insertAdjacentHTML('beforeend','<dialog id="preview-dialog"><button data-preview-close></button><div id="preview-body"></div></dialog>');
 const dialog=f.document.querySelector('dialog');dialog.showModal=()=>dialog.open=true;dialog.close=()=>{dialog.open=false;};
 installWorkPreview({document:f.document,load:async()=>({works}),loadMetadata:async()=>({}),translate:(_key,text)=>text,url:href=>href,names:text=>text,toast:()=>assert.fail('preview failed'),components:{scrollLock(){},roleDot:()=>''}});
 f.choose('[data-character-id="b"]');f.click('[data-home-type="gif"]');
 const click=new f.window.Event('click',{bubbles:true,cancelable:true});click.button=0;f.document.querySelector('.work-art').dispatchEvent(click);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(dialog.open,true);assert.ok(f.document.querySelector('.preview-position').textContent.includes(String(f.slugs().length).padStart(2,'0')));
 assert.equal(f.document.querySelector('.preview-detail-link').getAttribute('href'),'/works/'+f.slugs()[0]+'.html');
});

const metric=(id,mode)=>{const i=Number(id.slice(2));return mode==='downloads'?(i*13)%79:(i*7)%79;};
const measured={ready:Promise.resolve(),available:()=>true,metric};
test('real metric sorting precedes paging and intersects multiple roles, type and search',async()=>{
 const {orderWorks}=await import('../public/components/work-order.js');
 for(const mode of ['popular','downloads']){
  const f=await fixture('#sort='+mode,{stats:measured});
  const expected=orderWorks(works.slice(0,74),{sort:mode,metric}).map(work=>work.slug);
  assert.deepEqual(f.slugs(),expected.slice(0,30));f.click('[data-home-more]');assert.deepEqual(f.slugs(),expected.slice(0,60));
  f.choose('[data-character-id="a"]');f.choose('[data-character-id="b"]');f.click('[data-home-type="gif"]');
  f.document.querySelector('input').value='wave';f.document.querySelector('form').dispatchEvent(new f.window.Event('submit',{cancelable:true}));
  assert.deepEqual(f.slugs(),expected.filter(slug=>Number(slug.split('-')[1])%6===0));
  assert.equal(new URLSearchParams(f.location.hash.slice(1)).get('sort'),mode);
  assert.match(f.document.querySelector('[data-home-sort-status]').textContent,/下载按钮点击/);
  f.choose('[data-href$="sort=latest"]');assert.equal(f.slugs()[0],'frozen-72');
 }
});
test('pending metric snapshot is awaited and cannot override a later latest/reset selection',async()=>{
 let resolve;let available=false;const ready=new Promise(r=>resolve=r);
 const f=await fixture('#sort=downloads',{stats:{ready,available:()=>available,metric},awaitReady:false});
 assert.equal(f.document.querySelector('[data-href$="sort=downloads"]').getAttribute('aria-disabled'),'true');
 assert.equal(f.slugs().length,0);assert.match(f.document.querySelector('[data-home-sort-status]').textContent,/加载/);
 available=true;resolve();await f.ready;assert.equal(f.slugs()[0],'frozen-6');
 let resolveSecond;const other=await fixture('#sort=popular',{stats:{ready:new Promise(r=>resolveSecond=r),available:()=>true,metric},awaitReady:false});
 other.click('[data-home-reset]');resolveSecond();await other.ready;assert.equal(other.slugs()[0],'frozen-73');assert.equal(other.location.hash,'');
});
test('unavailable or failed statistics explicitly fall back, disable metric choices and keep other filters',async()=>{
 for(const ready of [Promise.resolve(),Promise.reject(Error('offline'))]){
 const f=await fixture('#sort=popular&character=a,b&type=gif',{stats:{ready,available:()=>false,metric:()=>assert.fail('must not fabricate ranking')}});
 assert.match(f.document.querySelector('[data-home-sort-status]').textContent,/暂不可用/);assert.equal(f.slugs()[0],'frozen-72');
 assert.equal(new URLSearchParams(f.location.hash.slice(1)).has('sort'),false);assert.equal(new URLSearchParams(f.location.hash.slice(1)).get('character'),'a,b');
 assert.equal(f.document.querySelector('[data-href$="sort=popular"]').getAttribute('aria-disabled'),'true');
 f.choose('[data-href$="sort=popular"]');assert.equal(new URLSearchParams(f.location.hash.slice(1)).has('sort'),false);
 }
});

test('late deferred WorkStats initialization waits for DOM readiness and the real snapshot',async()=>{
 let resolve;const snapshot=new Promise(r=>resolve=r);
 const f=await fixture('#sort=downloads',{awaitReady:false,loading:true});
 assert.equal(f.slugs().length,0);
 f.window.WorkStats={ready:snapshot,available:()=>true,metric};
 f.document.dispatchEvent(new f.window.Event('DOMContentLoaded'));await new Promise(r=>setImmediate(r));
 assert.equal(f.slugs().length,0);resolve();await f.ready;assert.equal(f.slugs()[0],'frozen-6');
});
