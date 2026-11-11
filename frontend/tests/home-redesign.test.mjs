import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseHTML} from 'linkedom';
import {renderHomeCard} from '../src/components/home/HomeCard.mjs';
import {installWorkPreview} from '../public/components/work-preview.js';
import {homeCopy} from '../src/components/home/home-copy.mjs';
const work={slug:'frozen-name',id:'stable-id',n:'作品',d:'介绍',i:'/thumb.webp',l:'/large.webp',o:'/original.png',p:[600,1200],w:600,h:1200,k:['meme'],roles:[{id:'deepseek',name:'DeepSeek娘',color:'#36f'}],tg:[],dt:'2026.11.11',f:'PNG',s:'4 KB',lk:'unknown',lt:'Unknown'};
test('redesigned card preserves intrinsic image proportions, stable URL, ID and preview semantics',()=>{
 const {document}=parseHTML(renderHomeCard(work,{eager:true}));
 assert.equal(document.querySelector('.work-card').dataset.slug,work.slug);
 for(const link of document.querySelectorAll('[data-preview]')){assert.equal(link.href,'/works/frozen-name.html');assert.equal(link.dataset.preview,work.slug);assert.equal(link.getAttribute('aria-controls'),'preview-dialog');}
 assert.equal(document.querySelector('img').getAttribute('width'),'600');assert.equal(document.querySelector('img').getAttribute('height'),'1200');
 assert.equal(document.querySelector('img').getAttribute('loading'),'eager');assert.equal(document.querySelector('[style]'),null);
});
test('home image and title open the shared real preview, retain modifiers and restore focus',async()=>{
 const {document,window}=parseHTML(`<html><body><main><div data-feed-grid>${renderHomeCard(work)}${renderHomeCard({...work,id:'second',slug:'second'})}</div></main><dialog id="preview-dialog"><button data-preview-close>Close</button><div id="preview-body"></div></dialog></body></html>`);
 const dialog=document.querySelector('dialog');dialog.showModal=()=>dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new window.Event('close'));};
 let focused;for(const node of document.querySelectorAll('a,button'))node.focus=()=>focused=node;
 installWorkPreview({document,load:async()=>({works:[work,{...work,id:'second',slug:'second'}]}),loadMetadata:async()=>({id:work.id}),translate:(_k,t)=>t,url:href=>'/ja'+href,names:t=>t,toast:()=>assert.fail('unexpected preview error'),components:{scrollLock:()=>{},roleDot:()=>''}});
 const click=(node,extras={})=>{const event=new window.Event('click',{bubbles:true,cancelable:true});Object.assign(event,{button:0,...extras});node.dispatchEvent(event);return event;};
 for(const selector of ['.work-art','.work-title']){
 const opener=document.querySelector(selector);assert.equal(click(opener,{ctrlKey:true}).defaultPrevented,false);
 assert.equal(click(opener).defaultPrevented,true);await new Promise(r=>setImmediate(r));
 assert.equal(dialog.open,true);assert.equal(document.querySelector('.preview-detail-link').href,'/ja/works/frozen-name.html');
 assert.equal(document.querySelector('[data-preview-step="1"]').disabled,false);
 assert.equal(click(document.querySelector('.preview-detail-link')).defaultPrevented,false);
 click(document.querySelector('[data-preview-close]'));assert.equal(dialog.open,false);assert.equal(focused,opener);
 }
});
test('homepage is a source component using live gallery data without preview-site guards or embedded images',()=>{
 const page=fs.readFileSync(new URL('../src/pages/index.astro',import.meta.url),'utf8');assert.match(page,/HomePage/);
 const source=fs.readFileSync(new URL('../src/components/home/HomeBody.astro',import.meta.url),'utf8');
 assert.match(source,/orderWorks\(galleryWorks\)/);assert.match(source,/galleryWorks.length/);assert.match(source,/src="\/avatar.png"/);
 assert.doesNotMatch(source,/data:image|preview-isolation|noindex|DecompressionStream/);
 const css=fs.readFileSync(new URL('../src/components/home/HomePage.css',import.meta.url),'utf8');assert.match(css,/height:56px;min-height:56px;flex:0 0 56px/);assert.match(css,/flex-direction:column;gap:12px/);assert.match(css,/column-count:5/);
 assert.ok(Object.values(homeCopy).every(row=>row.length===3&&row.every(Boolean)));
});

test('custom language control is baked with the page locale and exactly one selected option',async()=>{
 const {localizeHome}=await import('../src/components/home/localize-home.mjs');
 for(const [locale,value,label] of [['zh','zh-CN','简中'],['zh-Hant','zh-TW','繁中'],['en','en','EN'],['ja','ja','日本語']]){
 const {document}=parseHTML('<body class="home-page"><button id="lang"><span>简中</span></button><ul id="language-options">'+['zh-CN','zh-TW','en','ja'].map(v=>`<li role="option" data-value="${v}" aria-selected="true"></li>`).join('')+'</ul></body>');
 localizeHome(document,{current:locale});
 assert.equal(document.querySelector('#lang span').textContent,label);
 const selected=document.querySelectorAll('[aria-selected="true"]');assert.equal(selected.length,1);assert.equal(selected[0].dataset.value,value);
 }
});

test('home preview uses Chinese type names and lets the shared language API translate other locales',async()=>{
 const {homePreviewText}=await import('../public/components/home-preview-copy.js');
 for(const [id,label] of Object.entries({meme:'梗图',illustration:'插画',setting:'设定图',comic:'漫画',standing:'立绘',other:'其他'})){
 assert.equal(homePreviewText('v2.type.'+id,id),label);
 assert.equal(homePreviewText('v2.type.'+id,id,null,{fmt:(_key,fallback)=>fallback}),label);
 }
 assert.equal(homePreviewText('v2.type.meme','meme',null,{fmt:key=>key==='v2.type.meme'?'Memes':'unknown'}),'Memes');
});
