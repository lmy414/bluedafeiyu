import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {Converter} from 'opencc-js/cn2t';
import {renderWorkCard} from '../public/components/work-card.js';
import {installWorkPreview,workPreviewAttributes} from '../public/components/work-preview.js';
import {createCreatorViews} from '../src/components/archive/CreatorViews.mjs';
import {applyNativeContent} from '../scripts/native-content.mjs';

const work = slug => ({slug,id:'id-'+slug,n:'Title '+slug,d:'Description',i:'/thumb.webp',l:'/large.webp',o:'/original.gif',w:400,h:400,k:['meme'],roles:[{id:'deepseek',name:'DeepSeek',color:'#36f'}],tg:[],dt:'2026.10.26',f:'GIF',s:'40 KB',lk:'unknown',lt:'Unknown',owners:[{name:'Artist',href:'/creators/artist.html'}]});
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({load,prefix='',localize=w=>w,names=value=>value} = {}) {
  const works = ['a','b','c'].map(work);
  const {document,window} = parseHTML(`<html><body><div class="work-grid" id="one">${works.slice(0,2).map(w=>renderWorkCard(w)).join('')}</div><div class="work-grid" id="two">${renderWorkCard(works[2])}</div><dialog id="preview-dialog"><button data-preview-close>Close</button><div id="preview-body"></div></dialog><dialog id="share-card-dialog"></dialog></body></html>`);
  const dialog = document.querySelector('#preview-dialog'), locks = [], views = [], errors = [];
  let focused;
  document.addEventListener('work:show',event=>{assert.equal(event.detail.viewType,'preview');views.push(event.detail.id);});
  const trackFocus = () => {
    for (const node of document.querySelectorAll('a,button')) node.focus = options => {focused={node,options};};
  };
  trackFocus();
  document.addEventListener('preview:render',trackFocus);
  dialog.showModal = () => {dialog.open=true;};
  dialog.close = () => {dialog.open=false;dialog.dispatchEvent(new window.Event('close'));};
  dialog.getBoundingClientRect = () => ({top:10,bottom:600,left:10,right:800});
  const controller = installWorkPreview({document,localize,load:load||async function(){return {works};},translate:(_key,text)=>text,url:href=>prefix+href,names,toast:message=>errors.push(message),components:{scrollLock:value=>locks.push(value),roleDot:()=>'<i></i>'}});
  const click = (node,props={}) => {
    const event = new window.Event('click',{bubbles:true,cancelable:true});
    Object.assign(event,{button:0,...props});node.dispatchEvent(event);return event;
  };
  const key = (key,target=focused?.node||document.querySelector('[data-preview-close]')) => {
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
  assert.equal(f.document.querySelector('.preview-photo img').getAttribute('alt'),'Title a — Description');
  const detail=f.document.querySelector('.preview-detail-link');
  assert.equal(detail.href,'/ja/works/a.html');assert.equal(detail.textContent,'查看详情');
  assert.equal(f.click(detail).defaultPrevented,false);
  f.controller.close();
  f.click(f.document.querySelector('[data-slug="b"] .work-title'));await flush();
  assert.equal(f.document.querySelector('.preview-info h2').textContent,'Title b');
  assert.equal(f.document.querySelector('[data-copy-link]').dataset.copyLink,'/ja/works/b.html');
  assert.equal(f.document.querySelector('[data-copy-img]').dataset.copyAnimated,'true');
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

test('click and keyboard navigation focus the current step control, including both list boundaries',async()=>{
  const f=fixture(),trigger=f.document.querySelector('#one .work-art');
  f.document.querySelector('#one').insertAdjacentHTML('beforeend',renderWorkCard(work('c')));
  f.click(trigger);await flush();
  assert.equal(f.focused().node,f.document.querySelector('[data-preview-close]'));
  const checkStep = direction => {
    const button=f.document.querySelector(`[data-preview-step="${direction}"]`);
    assert.ok(f.focused().node===button,'focus stays on the current navigation control');
    assert.equal(button.disabled,false);assert.equal(button.isConnected,true);
    assert.deepEqual(f.focused().options,{preventScroll:true});
  };
  f.click(f.document.querySelector('[data-preview-step="1"]'));await flush();checkStep(1);
  const before=f.focused();
  f.document.dispatchEvent(new f.window.CustomEvent('site:langchange',{detail:{lang:'zh-Hant'}}));
  assert.equal(f.focused(),before);
  f.key('ArrowRight');await flush();checkStep(-1);
  assert.equal(f.document.querySelector('.preview-info h2').textContent,'Title c');
  f.key('ArrowLeft');await flush();checkStep(-1);
  f.key('ArrowLeft');await flush();checkStep(1);
  assert.deepEqual(f.views,['id-a','id-b','id-c','id-b','id-a']);
  f.key('ArrowRight',f.document.querySelector('.preview-detail-link'));await flush();checkStep(1);
  assert.equal(f.document.querySelector('.preview-detail-link').href,'/works/b.html');
  f.controller.close();assert.equal(f.focused().node,trigger);
});

test('obsolete or cancelled navigation cannot move focus, and failed navigation remains usable',async()=>{
  const pending=[],f=fixture({load:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
  const trigger=f.document.querySelector('#one .work-art');
  f.click(trigger);pending[0].resolve({works:f.works});await flush();
  f.key('ArrowRight');f.key('ArrowRight');
  pending[2].resolve({works:f.works});await flush();
  const latest=f.focused();assert.equal(latest.node.dataset.previewStep,'-1');
  pending[1].resolve({works:f.works});await flush();assert.equal(f.focused(),latest);
  f.key('ArrowLeft');pending[3].reject(Error('offline'));await flush();
  assert.equal(f.errors.length,1);assert.equal(f.focused(),latest);assert.equal(latest.node.isConnected,true);
  f.key('ArrowLeft');f.controller.close();const restored=f.focused();
  pending[4].resolve({works:f.works});await flush();
  assert.equal(f.dialog.open,false);assert.equal(f.focused(),restored);assert.equal(restored.node,trigger);
  f.click(trigger);pending[5].resolve({works:f.works});await flush();
  assert.equal(f.focused().node,f.document.querySelector('[data-preview-close]'));
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
  const video=document.querySelector('.creator-work-preview[data-video-bvid]');
  assert.equal(video.hasAttribute('data-preview'),false);assert.equal(video.target,'_blank');
});


test('late Traditional readiness refreshes the open preview in place, including next work and zoom',async()=>{
  const convert=Converter({from:'cn',to:'twp'});
  let ready=false;
  const names=text=>ready?convert(text).replace(/孃/g,'娘'):text;
  const works=['a','b'].map(slug=>({...work(slug),n:'鲸鱼画册 '+slug,d:'蓝发少女与鲸鱼',cm:'画册说明',tg:['绘画']}));
  const localize=w=>({...w,n:names(w.n),d:names(w.d),cm:names(w.cm),tg:w.tg.map(names)});
  const f=fixture({load:async()=>({works}),localize,names});
  await f.controller.open('a','work',f.document.querySelector('.work-art'));
  assert.match(f.document.querySelector('.preview-photo img').alt,/鲸鱼/);
  await f.controller.open('b'); // change the work before the converter finishes
  const image=f.document.querySelector('.preview-photo img'), title=f.document.querySelector('h2');
  const before={src:image.src,views:f.views.length,focus:f.focused(),locks:f.locks.length};
  f.dialog.scrollTop=57;
  ready=true;
  f.document.dispatchEvent(new f.window.CustomEvent('site:langchange',{detail:{lang:'zh-Hant'}}));
  assert.equal(f.document.querySelector('.preview-photo img'),image);
  assert.equal(image.alt,'鯨魚畫冊 b — 藍髮少女與鯨魚');
  assert.equal(title.textContent,'鯨魚畫冊 b');
  assert.equal(f.document.querySelector('.preview-note p').textContent,'畫冊說明');
  assert.equal(image.src,before.src);assert.equal(f.dialog.scrollTop,57);
  assert.equal(f.views.length,before.views);assert.equal(f.focused(),before.focus);assert.equal(f.locks.length,before.locks);
  ready=false;await f.controller.open('a','image');
  const zoom=f.document.querySelector('.preview-zoom img');
  ready=true;f.document.dispatchEvent(new f.window.CustomEvent('site:langchange',{detail:{lang:'zh-Hant'}}));
  assert.equal(f.document.querySelector('.preview-zoom img'),zoom);
  assert.equal(zoom.alt,'鯨魚畫冊 a — 藍髮少女與鯨魚');
  await f.controller.open('b');assert.equal(f.document.querySelector('.preview-photo img').alt,'鯨魚畫冊 b — 藍髮少女與鯨魚');
  f.controller.close();
  f.document.dispatchEvent(new f.window.CustomEvent('site:langchange',{detail:{lang:'zh-Hant'}}));
  assert.equal(f.dialog.open,false);
});

test('readiness during an in-flight open cannot restore an obsolete preview or affect other locales',async()=>{
  let finish,ready=false;
  const names=text=>ready?text.replaceAll('画','畫'):text;
  const f=fixture({load:()=>new Promise(resolve=>{finish=resolve;}),names,localize:w=>({...w,n:names(w.n),d:names(w.d)})});
  const pending=f.controller.open('a');
  ready=true;f.document.dispatchEvent(new f.window.CustomEvent('site:langchange',{detail:{lang:'zh-Hant'}}));
  finish({works:[{...work('a'),n:'画a',d:'画稿'}]});await pending;
  const image=f.document.querySelector('.preview-photo img');
  assert.equal(image.alt,'畫a — 畫稿');
  for(const lang of ['zh','en','ja']){
    image.alt='画';f.document.dispatchEvent(new f.window.CustomEvent('site:langchange',{detail:{lang}}));assert.equal(image.alt,'画',lang);
  }
});


test('late readiness while the next work loads updates only the current DOM and keeps the pending navigation',async()=>{
  let ready=false,finish,calls=0;
  const names=text=>ready?text.replaceAll('画','畫'):text;
  const works=['a','b'].map(slug=>({...work(slug),n:'画'+slug,d:'画稿'}));
  const f=fixture({load:()=>++calls===1?Promise.resolve({works}):new Promise(resolve=>{finish=resolve;}),names,localize:w=>({...w,n:names(w.n),d:names(w.d)})});
  await f.controller.open('a');
  const image=f.document.querySelector('.preview-photo img'),pending=f.controller.open('b');
  ready=true;f.document.dispatchEvent(new f.window.CustomEvent('site:langchange',{detail:{lang:'zh-Hant'}}));
  assert.equal(image.alt,'畫a — 畫稿');
  finish({works});await pending;
  assert.equal(f.document.querySelector('.preview-photo img').alt,'畫b — 畫稿');
  assert.deepEqual(f.views,['id-a','id-b']);
});
