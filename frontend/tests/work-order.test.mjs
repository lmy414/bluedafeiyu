import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {orderWorks, shuffledSlugs} from '../public/components/work-order.js';
import {selectDownloadHighlights, renderDownloadPick, DOWNLOAD_HIGHLIGHT_COUNT, installHomeDownloads} from '../public/components/home-downloads.js';
import {installMasonry} from '../src/scripts/masonry.mjs';

const works = [
  {id:'a',slug:'a',dt:'2026-10-23',createdAt:'2026-10-23T01:00:00Z'},
  {id:'b',slug:'b',dt:'2026-10-23',createdAt:'2026-10-23T23:00:00Z'},
  {id:'c',slug:'c',dt:'2026-10-24',createdAt:'2026-10-24T12:00:00Z'},
  {id:'d',slug:'d',dt:'2026-10-25',createdAt:'2026-10-25T12:00:00Z'},
  {id:'e',slug:'e',dt:'2026-10-26',createdAt:'2026-10-26T12:00:00Z'}
];
const ids = list => list.map(work => work.id);
const snapshot = {available:true,works:{a:{views:99,downloads:1},b:{views:20,downloads:40},c:{views:20,downloads:8},d:{views:0,downloads:40},e:{views:5,downloads:4},removed:{views:999,downloads:999}}};
const metric = (id,sort) => snapshot.works[id]?.[sort === 'downloads' ? 'downloads' : 'views'];

test('time ordering compares full creation timestamps, sorts both directions and keeps input immutable',()=>{
  assert.deepEqual(ids(orderWorks(works)),['e','d','c','b','a']);
  assert.deepEqual(ids(orderWorks(works,{direction:'asc'})),['a','b','c','d','e']);
  const compact=works.map(({createdAt,...work})=>({...work,at:Date.parse(createdAt)}));
  assert.deepEqual(ids(orderWorks(compact)),ids(orderWorks(works)));
  assert.deepEqual(ids(orderWorks([{...works[0],createdAt:'2026-10-23T23:00:00+08:00'},works[1]])),['b','a']);
  assert.deepEqual(ids(works),['a','b','c','d','e']);
});

test('views and downloads sort the entire list before pagination, with deterministic ties and exact reversals',()=>{
  for(const [sort,expected] of [['popular',['a','c','b','e','d']],['downloads',['d','b','c','e','a']]]){
    assert.deepEqual(ids(orderWorks(works,{sort,metric})),expected);
    assert.deepEqual(ids(orderWorks(works,{sort,metric,direction:'asc'})),[...expected].reverse());
    assert.deepEqual(ids(orderWorks(works,{sort,metric}).slice(0,2)),expected.slice(0,2));
  }
  assert.deepEqual(ids(orderWorks(works,{sort:'relevance',scores:new Map([['a',2],['b',3]])})).slice(0,2),['b','a']);
});

test('random ordering stays stable on append and filter changes; the direction reverses the same shuffle',()=>{
  const randomOrder=shuffledSlugs(works,()=>0.3);
  const options={sort:'random',randomOrder,direction:'asc'};
  const ordered=orderWorks(works,options);
  assert.deepEqual(ids(orderWorks(works,options)),ids(ordered));
  assert.deepEqual(ids(orderWorks(works,{...options,direction:'desc'})),ids(ordered).reverse());
  assert.deepEqual(ids(orderWorks(works.slice(1),options)),ids(ordered).filter(id=>id!=='a'));
  assert.deepEqual(ids(orderWorks(works,{sort:'curated',direction:'asc'})),ids(works));
  assert.deepEqual(ids(orderWorks(works,{sort:'curated'})),ids(works).reverse());
});

test('download highlights include six measured published works, ignore unknown or removed IDs, and use download counts',()=>{
  const extra={id:'f',slug:'f',dt:'2026-10-25',createdAt:'2026-10-25T00:00:00Z'};
  const measured={...snapshot,works:{...snapshot.works,f:{views:0,downloads:2}}};
  const selected=selectDownloadHighlights([...works,extra],measured);
  assert.equal(selected.length,DOWNLOAD_HIGHLIGHT_COUNT);
  assert.deepEqual(ids(selected),['d','b','c','e','f','a']);
  assert.deepEqual(selectDownloadHighlights(works,{available:false,works:snapshot.works}),[]);
  assert.deepEqual(selectDownloadHighlights(works,{available:true,works:{a:{downloads:0},b:{views:1000}}}),[]);
  assert.deepEqual(ids(selectDownloadHighlights(works,{available:true,works:{a:{downloads:5},b:{views:1000}}})),['a']);
  const work={...works[0],o:'https://example.test/original?a=1&b=2'};
  const {document}=parseHTML(renderDownloadPick(work,{card:()=>'<article class="work-card"></article>',label:'Download original'}));
  assert.equal(document.querySelector('[data-download-work]').dataset.downloadWork,'a');
  assert.equal(document.querySelector('[data-download-work]').getAttribute('href'),work.o);
});

test('the masonry installer ignores a saved grid preference and always packs into shortest columns',()=>{
  const {document,window}=parseHTML('<html><body><main><div class="work-grid"><article class="work-card"></article><article class="work-card"></article><article class="work-card"></article></div></main></body></html>');
  const grid=document.querySelector('.work-grid');
  Object.defineProperty(grid,'clientWidth',{value:420});
  [...grid.children].forEach((item,i)=>Object.defineProperty(item,'offsetHeight',{value:[100,200,150][i]}));
  const frames=[];
  const overrides={document,window,localStorage:{getItem(){throw Error('obsolete layout preference was read');}},getComputedStyle:()=>({getPropertyValue:name=>name==='--columns'?'2':'20'}),requestAnimationFrame:callback=>(frames.push(callback),frames.length),cancelAnimationFrame:()=>{},ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}}};
  const before=Object.fromEntries(Object.keys(overrides).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  try{
    for(const [key,value] of Object.entries(overrides))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
    installMasonry();frames.at(-1)();
    assert.ok(grid.classList.contains('is-laid-out'));
    assert.equal(grid.classList.contains('layout-grid'),false);
    assert.deepEqual([...grid.children].map(item=>[item.style.left,item.style.top]),[['0px','0px'],['220px','0px'],['0px','120px']]);
    assert.equal(grid.style.height,'270px');
  }finally{for(const [key,descriptor] of Object.entries(before))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});

test('the download component replaces its whole fallback row using real counts and keeps the available originals when statistics fail',async()=>{
  const catalog=works.map(work=>({...work,c:'DeepSeek',cid:'deepseek',roles:[],k:['meme'],tg:[],n:work.slug,i:'/image.webp',o:'https://example.test/'+work.id+'.png',w:400,h:400}));
  for(const available of [true,false]){
    const fallback=catalog.slice(0,DOWNLOAD_HIGHLIGHT_COUNT).map(work=>renderDownloadPick(work)).join('');
    const {document,window}=parseHTML(`<html lang="zh-CN"><body><section data-home-downloads><h2 data-home-download-title>精选作品</h2><p data-home-download-note>下载统计暂不可用时，展示这组精选作品。</p><div class="home-downloads-list">${fallback}</div></section></body></html>`);
    window.WorkStats={ready:Promise.resolve({...snapshot,available,syncedAt:'2026-10-27T01:00:00Z'}),paint(){}};
    let requests=0;
    const overrides={document,window,fetch:async url=>{assert.equal(url,'/archive-downloads.json?v=1');requests++;return {ok:true,json:async()=>({works:catalog})};}};
    const before=Object.fromEntries(Object.keys(overrides).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    try{
      for(const [key,value] of Object.entries(overrides))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
      installHomeDownloads();await new Promise(resolve=>setImmediate(resolve));
      assert.equal(document.querySelectorAll('.home-download-pick').length,catalog.length);
      assert.equal(requests,available?1:0,'the compact catalog is only needed for an available ranking');
      const title=document.querySelector('[data-home-download-title]').textContent;
      assert.equal(title,available?'热门下载':'精选作品');
      if(available){
        assert.deepEqual([...document.querySelectorAll('[data-download-work]')].map(link=>link.dataset.downloadWork),['d','b','c','e','a']);
        assert.doesNotMatch(document.querySelector('[data-home-download-note]').textContent,/\{date\}/);
      }
    }finally{for(const [key,descriptor] of Object.entries(before))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
