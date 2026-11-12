import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {installHomeFeed} from '../public/components/home-feed.js';
const works=Array.from({length:75},(_,i)=>({id:'id'+i,slug:'frozen-'+i,n:i%2?'hug':'wave',cids:i%2?['a']:['a','b'],roles:[],k:['meme'],tg:[],i:'/a.webp',f:i%3?'PNG':'GIF',createdAt:new Date(2026,0,i+1).toISOString()}));
async function fixture(hash=''){
 const {document,window}=parseHTML(`<html><body><form class="search"><input></form><span data-home-count></span><a data-home-type=""></a><a data-home-type="meme"></a><a data-home-type="gif"></a><a data-home-type="comic"></a><div data-filter-picker="character"><button><span>All</span></button><ul role="listbox" aria-multiselectable="true" hidden>${['','a','b'].map(id=>`<li role="option" ${id?`data-character-id="${id}"`:''}>${id||'All'}</li>`).join('')}</ul></div><div data-filter-picker="sort"><button><span>Latest</span></button><ul role="listbox" hidden><li role="option" data-href="/browse.html#sort=latest">Latest</li><li role="option" data-href="/browse.html#sort=random">Random</li></ul></div><a data-home-reset></a><p data-home-empty hidden></p><div data-feed-grid data-excluded-ids='["id74"]'></div><span data-home-shown></span><a data-home-more></a></body></html>`);
 const location=new URL('https://example.test/ja/index.html'+hash);
 Object.defineProperty(window,'location',{value:location,configurable:true});
 Object.defineProperty(window,'history',{value:{state:null,replaceState(_state,_title,href){location.href=href;}},configurable:true});
 const click=selector=>{const e=new window.Event('click',{bubbles:true,cancelable:true});document.querySelector(selector).dispatchEvent(e);assert.equal(e.defaultPrevented,true);};
 const choose=selector=>document.querySelector(selector).dispatchEvent(new window.Event('click',{bubbles:true}));
 await installHomeFeed({document,window,load:async()=>({works,characters:[]})}).ready;
 const slugs=()=>[...document.querySelectorAll('.work-card')].map(node=>node.dataset.slug);
 return {document,window,location,click,choose,slugs};
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
