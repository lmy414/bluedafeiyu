import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {renderWorkCard} from '../public/archive/work-card.js';
import {matchesCreationMethod} from '../public/archive/creation-method.js';
import {orderWorks,shuffledSlugs} from '../public/components/work-order.js';

const root=path.resolve(import.meta.dirname,'../..');
const out=process.env.SITE_OUT_DIR||path.join(root,'.build/site');
const source=fs.readFileSync(path.join(root,'frontend/public/archive/archive.js'),'utf8').replace(/^import .+;\n/gm,'');
const works=Array.from({length:60},(_,i)=>({id:'id-'+i,slug:'work-'+String(i).padStart(2,'0'),n:'Work '+i,c:'DeepSeek',cid:'deepseek',cids:i%2?['deepseek']:['deepseek','gpt'],roles:[{id:'deepseek',name:'DeepSeek'}],k:['meme'],tg:[],i:'/image.webp',o:'https://example.test/'+i+'.png',dt:'2026-10-23',createdAt:new Date(Date.UTC(2026,9,23,0,i)).toISOString(),w:400,h:400}));
const stats={available:true,works:Object.fromEntries(works.map((work,i)=>[work.id,{views:(i*7)%61,downloads:(i*13)%61}]))};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture({url='https://archive.test/browse.html',available=true,curated=false,statsReady=Promise.resolve(stats),initialCards=false}={}) {
  const {document,window}=parseHTML(fs.readFileSync(path.join(out,'browse.html'),'utf8'));
  // linkedom deliberately omits form state; provide native selection semantics
  // while exercising the actual page controls, events, URLs and archive script.
  const form=document.querySelector('#filter-form');
  if(curated){document.body.dataset.sort='curated';form.querySelector('select[name=sort]').insertAdjacentHTML('afterbegin','<option value="curated">Curated</option>');}
  const controls=Object.fromEntries([...form.querySelectorAll('select')].map(select=>[select.name,select]));
  for(const select of Object.values(controls))for(const option of select.options)Object.defineProperty(option,'selected',{
    get:()=>option.hasAttribute('selected'),set:value=>option.toggleAttribute('selected',!!value)
  });
  for(const select of Object.values(controls))Object.defineProperties(select,{
    value:{get:()=>[...select.options].find(option=>option.selected)?.value||select.options[0]?.value||'',set:value=>{for(const option of select.options)option.selected=option.value===value;}},
    selectedOptions:{get:()=>[...select.options].filter(option=>option.selected)}
  });
  Object.defineProperty(form,'elements',{value:controls});
  document.querySelector('#results').dataset.list=JSON.stringify(works.map(work=>work.slug));
  if(initialCards)document.querySelector('#results').innerHTML='<div class="work-grid">'+orderWorks(works,{sort:'latest',direction:'desc'}).slice(0,24).map(work=>renderWorkCard(work,{eager:true})).join('')+'</div>';
  const initialNodes=[...document.querySelectorAll('#results .work-card')];
  const location=new URL(url),navigations=[];
  location.assign=href=>navigations.push(href);location.replace=href=>navigations.push(href);
  const history={state:null,replaceState(state,_title,href){this.state=state;if(href)location.href=href;}};
  window.WorkStats={ready:statsReady,available:()=>available,metric:(id,mode)=>available?stats.works[id]?.[mode==='downloads'?'downloads':'views']||0:0};
  const context={window,document,location,history,URL,URLSearchParams,performance:{getEntriesByType:()=>[]},navigator:{},Event:window.Event,CustomEvent:window.CustomEvent,setTimeout,clearTimeout,requestAnimationFrame:callback=>callback(),matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener:window.addEventListener.bind(window),loadArchiveData:()=>Promise.resolve({works,characters:[]}),renderWorkCard,matchesCreationMethod,orderWorks,shuffledSlugs,installTopicDownloads(){},installWorkPreview(){},copyImage(){},console};
  vm.runInNewContext(source,context);
  await flush();await flush();
  const visible=()=>[...document.querySelectorAll('#results .work-card')].map(card=>card.dataset.slug);
  const select=(name,value)=>{controls[name].value=value;controls[name].dispatchEvent(new window.Event('change',{bubbles:true}));};
  const click=selector=>document.querySelector(selector).dispatchEvent(new window.Event('click',{bubbles:true}));
  return {document,controls,location,history,visible,select,click,navigations,initialNodes};
}

test('loading the catalog retains matching static cards and their eager images, then filters normally',async()=>{
  const f=await fixture({initialCards:true});
  assert.ok(f.initialNodes.every((node,index)=>node===f.document.querySelectorAll('#results .work-card')[index]));
  assert.equal(f.document.querySelector('#results img').getAttribute('loading'),'eager');
  f.select('direction','asc');
  assert.notEqual(f.document.querySelector('#results .work-card'),f.initialNodes[0]);
  assert.deepEqual(f.visible(),works.slice(0,24).map(work=>work.slug));
});

test('real archive controls apply all metric/time directions, retain fragments and append the next correctly ordered page',async()=>{
  const f=await fixture();
  const metric=(id,sort)=>stats.works[id][sort==='downloads'?'downloads':'views'];
  for(const sort of ['latest','popular','downloads'])for(const direction of ['asc','desc']){
    f.select('sort',sort);f.select('direction',direction);
    const expected=orderWorks(works,{sort,direction,metric}).map(work=>work.slug);
    assert.deepEqual(f.visible(),expected.slice(0,24),sort+' '+direction);
    assert.equal(f.history.state.filters.direction,direction);
    f.click('[data-load-more]');assert.deepEqual(f.visible(),expected.slice(0,48));
  }
  f.select('direction','asc');
  assert.match(f.location.hash,/sort=downloads/);assert.match(f.location.hash,/direction=asc/);
  f.click('[data-reset]');
  assert.equal(f.controls.sort.value,'latest');assert.equal(f.controls.direction.value,'desc');assert.equal(f.location.hash,'');
});

test('shared metric links wait for statistics, restore direction, and fall back honestly when unavailable',async()=>{
  let resolve;const ready=new Promise(done=>{resolve=done;});
  const f=await fixture({url:'https://archive.test/browse.html?sort=downloads&direction=asc',statsReady:ready});
  assert.equal(f.controls.sort.value,'downloads');resolve(stats);await flush();await flush();
  assert.equal(f.location.search,'');assert.match(f.location.hash,/sort=downloads&direction=asc/);
  assert.equal(f.visible()[0],works.find(work=>stats.works[work.id].downloads===0).slug);
  const offline=await fixture({url:'https://archive.test/browse.html#sort=downloads&direction=asc',available:false,statsReady:Promise.resolve(null)});
  assert.equal(offline.controls.sort.value,'latest');assert.equal(offline.controls.direction.value,'asc');
  assert.deepEqual(offline.visible(),works.slice(0,24).map(work=>work.slug));
});

test('random paging and direction changes reuse one shuffle, and character/type navigation retains the direction',async()=>{
  const f=await fixture();f.select('sort','random');
  f.click('[data-load-more]');f.click('[data-load-more]');const shuffled=f.visible();
  assert.equal(new Set(shuffled).size,works.length);
  f.select('direction','asc');f.click('[data-load-more]');f.click('[data-load-more]');
  assert.deepEqual(f.visible(),[...shuffled].reverse());
  f.select('type','meme');
  assert.match(f.navigations.at(-1),/\/categories\/meme.html#sort=random&direction=asc$/);
});

test('collection defaults preserve the manual order while time and metric options actually re-sort its members',async()=>{
  const f=await fixture({curated:true});
  assert.deepEqual(f.visible(),works.slice(0,24).map(work=>work.slug));
  assert.equal(f.controls.direction.value,'asc');
  f.select('sort','downloads');f.select('direction','desc');
  assert.notDeepEqual(f.visible(),works.slice(0,24).map(work=>work.slug));
  f.click('[data-reset]');
  assert.equal(f.controls.sort.value,'curated');assert.deepEqual(f.visible(),works.slice(0,24).map(work=>work.slug));
});
