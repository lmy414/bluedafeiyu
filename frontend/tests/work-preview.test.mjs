import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderWorkCard} from '../public/components/work-card.js';
import {installWorkPreview,workPreviewAttributes} from '../public/components/work-preview.js';
import {createCreatorViews} from '../src/components/archive/CreatorViews.mjs';
import {applyNativeContent} from '../scripts/native-content.mjs';

const work = slug => ({slug,id:'id-'+slug,n:'Title '+slug,d:'Description',i:'/thumb.webp',l:'/large.webp',o:'/original.gif',w:400,h:400,k:['meme'],roles:[{id:'deepseek',name:'DeepSeek',color:'#36f'}],tg:[],dt:'2026.10.26',f:'GIF',s:'40 KB',sa:'Artist',su:'https://example.test/source',lk:'unknown',lt:'Unknown',owners:[{name:'Artist',href:'/creators/artist.html'}]});
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({load,prefix=''} = {}) {
  const works = ['a','b','c'].map(work);
  const {document,window} = parseHTML(`<html><body><div class="work-grid" id="one">${works.slice(0,2).map(w=>renderWorkCard(w)).join('')}</div><div class="work-grid" id="two">${renderWorkCard(works[2])}</div><dialog id="preview-dialog"><button data-preview-close>Close</button><div id="preview-body"></div></dialog><dialog id="share-card-dialog"></dialog></body></html>`);
  const dialog = document.querySelector('#preview-dialog'), locks = [], views = [], errors = [];
  let focused;
  document.addEventListener('work:show',event=>{assert.equal(event.detail.viewType,'preview');views.push(event.detail.id);});
  for (const node of document.querySelectorAll('a,button')) node.focus = options => {focused={node,options};};
  dialog.showModal = () => {dialog.open=true;};
  dialog.close = () => {dialog.open=false;dialog.dispatchEvent(new window.Event('close'));};
  dialog.getBoundingClientRect = () => ({top:10,bottom:600,left:10,right:800});
  const controller = installWorkPreview({document,load:load||async function(){return {works};},translate:(_key,text)=>text,url:href=>prefix+href,names:value=>value,toast:message=>errors.push(message),components:{scrollLock:value=>locks.push(value),roleDot:()=>'<i></i>'}});
  const click = (node,props={}) => {
    const event = new window.Event('click',{bubbles:true,cancelable:true});
    Object.assign(event,{button:0,...props});node.dispatchEvent(event);return event;
  };
  const key = (key,target=document.querySelector('[data-preview-close]')) => {
    const event = new window.Event('keydown',{bubbles:true,cancelable:true});event.key=key;target.dispatchEvent(event);return event;
  };
  return {works,document,window,dialog,controller,locks,views,errors,click,key,focused:()=>focused};
}

test('both card entry links announce the shared preview and retain localized, crawlable detail URLs',()=>{
  const {document}=parseHTML(renderWorkCard(work('a'),{url:href=>'/en'+href}));
  for (const link of document.querySelectorAll('.work-art,.work-title')) {
    assert.equal(link.dataset.preview,'a');assert.equal(link.getAttribute('href'),'/en/works/a.html');
    assert.equal(link.getAttribute('aria-haspopup'),'dialog');assert.equal(link.getAttribute('aria-controls'),'preview-dialog');
  }
  assert.equal(document.querySelector('.art-owner a').hasAttribute('data-preview'),false);
  assert.equal(document.querySelector('[data-save]').hasAttribute('data-preview'),false);
  assert.equal(document.querySelector('[data-share-card]').hasAttribute('data-preview'),false);
  assert.equal(document.querySelector('a button'),null);
  const unsafe=parseHTML(`<a ${workPreviewAttributes('x" onclick="bad')}></a>`).document.querySelector('a');
  assert.equal(unsafe.getAttribute('onclick'),null);
});

test('native card localization updates every labeled preview trigger rather than only the first',()=>{
  for(const language of ['en','ja']){
    const {document}=parseHTML('<html><head></head><body>'+renderWorkCard({...work('a'),n:'中文作品'})+'</body></html>');
    const name=language==='en'?'Native title':'作品名';
    const snapshot={works:[{slug:'a',name:'中文作品',characterId:'deepseek',tags:[],i18n:{[language]:{name,description:name}}}],characters:[],categories:[],topics:[]};
    applyNativeContent(document,{current:language,fmt:()=>language==='en'?'Preview':'プレビュー',contentText:value=>value,characterName:()=> 'DeepSeek'},'/fixture.html',snapshot);
    const labels=[...document.querySelectorAll('[data-preview][aria-label]')];
    assert.equal(labels.length,2);
    for(const label of labels)assert.equal(label.getAttribute('aria-label'),(language==='en'?'Preview ':'プレビュー ')+name);
  }
});

test('ordinary image and title clicks open the preview; only its detail link follows the detail URL',async()=>{
  const f=fixture({prefix:'/ja'});
  assert.equal(f.click(f.document.querySelector('.work-art img')).defaultPrevented,true);
  await flush();assert.equal(f.dialog.open,true);assert.deepEqual(f.views,['id-a']);
  const detail=f.document.querySelector('.preview-detail-link');
  assert.equal(detail.href,'/ja/works/a.html');assert.equal(detail.textContent,'查看详情');
  assert.equal(f.click(detail).defaultPrevented,false);
  f.controller.close();
  f.click(f.document.querySelector('[data-slug="b"] .work-title'));await flush();
  assert.equal(f.document.querySelector('.preview-info h2').textContent,'Title b');
  assert.equal(f.document.querySelector('[data-copy-link]').dataset.copyLink,'/ja/works/b.html');
  assert.equal(f.document.querySelector('[data-copy-img]').dataset.copyAnimated,'true');
  assert.match(f.document.querySelector('.preview-facts').textContent,/Artist/);
  assert.equal(f.document.querySelector('.preview-facts a').getAttribute('href'),'https://example.test/source');
});

test('modified clicks and independent save, share, author and role actions keep their browser behavior',async()=>{
  const f=fixture(), link=f.document.querySelector('.work-art');
  for(const props of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}])assert.equal(f.click(link,props).defaultPrevented,false);
  for(const selector of ['[data-save]','[data-share-card]','.art-owner a','.card-roles a'])assert.equal(f.click(f.document.querySelector(selector)).defaultPrevented,false);
  const prevented=new f.window.Event('click',{bubbles:true,cancelable:true});prevented.preventDefault();link.dispatchEvent(prevented);
  await flush();assert.ok(!f.dialog.open);assert.deepEqual(f.views,[]);
});

test('delegation covers newly appended cards and keeps next/previous inside the selected visible list',async()=>{
  const f=fixture();
  f.document.querySelector('#one').insertAdjacentHTML('beforeend',renderWorkCard(work('c')));
  f.document.querySelector('#two').insertAdjacentHTML('beforeend','<div hidden><a data-preview="hidden"></a></div>');
  f.click(f.document.querySelector('#one [data-slug="b"] .work-art'));await flush();
  assert.equal(f.document.querySelector('.preview-position').textContent,'02/03');
  f.click(f.document.querySelector('[data-preview-step="1"]'));await flush();
  assert.equal(f.document.querySelector('.preview-info h2').textContent,'Title c');
  assert.equal(f.document.querySelector('[data-preview-step="1"]').disabled,true);
  f.key('ArrowLeft');await flush();assert.equal(f.document.querySelector('.preview-info h2').textContent,'Title b');
  f.controller.close();f.click(f.document.querySelector('#two .work-art'));await flush();
  assert.equal(f.document.querySelector('.preview-position').textContent,'01/01');
});

test('Escape, backdrop and native close release the scroll lock and restore the exact trigger without scrolling',async()=>{
  for (const method of ['cancel','backdrop','native']) {
    const f=fixture(),trigger=f.document.querySelector('.work-art');f.click(trigger);await flush();
    if(method==='cancel')f.dialog.dispatchEvent(new f.window.Event('cancel',{cancelable:true}));
    else if(method==='backdrop')f.click(f.dialog,{clientX:0,clientY:0});
    else f.dialog.close();
    assert.equal(f.dialog.open,false);assert.equal(f.locks.at(-1),false);
    assert.equal(f.focused().node,trigger);assert.deepEqual(f.focused().options,{preventScroll:true});
  }
});

test('preview requests cannot race, reopen after closing or swallow failures; zoom retains the details entry',async()=>{
  const pending=[];const f=fixture({load:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
  f.click(f.document.querySelector('#one .work-art'));f.click(f.document.querySelector('#two .work-art'));
  pending[1].resolve({works:f.works});await flush();pending[0].resolve({works:f.works});await flush();
  assert.equal(f.document.querySelector('.preview-info h2').textContent,'Title c');
  const opening=f.controller.open('a');f.controller.close();pending[2].resolve({works:f.works});await opening;
  assert.equal(f.dialog.open,false);
  const failed=f.controller.open('a');pending[3].reject(Error('offline'));await failed;
  assert.equal(f.errors.length,1);assert.equal(f.dialog.open,false);
  const zoom=f.controller.open('a','image');pending[4].resolve({works:f.works});await zoom;
  assert.ok(f.document.querySelector('.preview-zoom img'));assert.equal(f.document.querySelector('.preview-detail-link').href,'/works/a.html');
  assert.equal(f.document.querySelector('.preview-nav'),null);
});

test('creator overview rails use the same preview attributes for images while videos stay external',()=>{
  const creator={id:'artist',name:'Artist',href:'/creators/artist.html',latest:'2026-10-26',images:[work('a')],videos:[{bvid:'BV1',url:'https://www.bilibili.com/video/BV1',title:'Video',cover:'https://i0.hdslb.com/cover.jpg'}],channels:[],total:2};
  creator.media=[{kind:'image',item:creator.images[0],date:'2026-10-26'},{kind:'video',item:creator.videos[0],date:'2026-10-26'}];
  const ctx={esc:String,tr:(_key,zh)=>zh,icon:()=>'',card:()=>'',videoCard:()=>'',pageHead:()=>'',write(){},breadcrumbs:()=>'',button:()=>''};
  const {creatorCard}=createCreatorViews(ctx,[creator]);
  const {document}=parseHTML(creatorCard(creator));
  assert.equal(document.querySelector('.creator-work-preview[data-preview]').dataset.preview,'a');
  assert.equal(document.querySelector('.creator-preview-item [data-download-work]').getAttribute('href'),'https://xn--pssy23gqgbz2d718b.com/original.gif');
  const video=document.querySelector('.creator-work-preview[data-video-bvid]');
  assert.equal(video.hasAttribute('data-preview'),false);assert.equal(video.target,'_blank');
});


test('zoom entered from a preview returns to the same work on Escape',async()=>{
  const f=fixture();f.click(f.document.querySelector('.work-art'));await flush();
  f.click(f.document.querySelector('[data-preview-zoom]'));await flush();
  assert.ok(f.document.querySelector('.preview-zoom img'));
  assert.ok(f.document.querySelector('[data-preview-back]'));
  f.dialog.dispatchEvent(new f.window.Event('cancel',{cancelable:true}));await flush();
  assert.equal(f.dialog.open,true);
  assert.equal(f.document.querySelector('.preview-info h2').textContent,'Title a');
  assert.equal(f.locks.at(-1),true);
  assert.deepEqual(f.views,['id-a'],'returning from zoom does not count another view');
});


test('latest homepage cards navigate the full latest row rather than a single work',async()=>{
  const f=fixture();
  f.document.querySelector('#one').className='home-works-grid';
  f.click(f.document.querySelector('#one [data-slug="a"] .work-art'));await flush();
  assert.equal(f.document.querySelector('.preview-position').textContent,'01/02');
  f.click(f.document.querySelector('[data-preview-step="1"]'));await flush();
  assert.equal(f.document.querySelector('.preview-info h2').textContent,'Title b');
});


test('native close clears zoom history before opening a standalone image',async()=>{
  const f=fixture();f.click(f.document.querySelector('.work-art'));await flush();
  f.click(f.document.querySelector('[data-preview-zoom]'));await flush();
  f.dialog.close();await f.controller.open('b','image');
  assert.equal(f.document.querySelector('[data-preview-back]'),null);
});
