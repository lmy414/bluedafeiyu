import {installWorkPreview} from '../components/work-preview.js';
import {renderWorkCard} from './work-card.js?v=20261023-3';
import {copyImage} from './image-copy.js?v=1';
import {installTopicDownloads} from './topic-download.js?v=4';
import {loadArchiveData} from './data-loader.js?v=1';
import {matchesCreationMethod} from './creation-method.js';
(() => {
  'use strict';
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[s]);
  const typeNames={meme:'梗图',illustration:'插画',setting:'设定图',comic:'漫画',standing:'立绘',other:'其他'};
  const tx = (key, fallback, vars) => {
    if(key.startsWith('v2.type.'))fallback=typeNames[key.slice(8)]||fallback;
    return window.SiteLang ? SiteLang.fmt(key, fallback, vars) : String(fallback).replace(/\{(\w+)\}/g,(_,k)=>vars?.[k]??'');
  };
  const localURL = href => window.SiteLang ? SiteLang.url(href) : href;
  const names = value => window.SiteLang ? SiteLang.contentText(value) : value;
  const localized = w => window.SiteLang ? SiteLang.localWork(w) : w;
  const basePath = path => path.replace(/^\/(?:en|ja|zh-hant)(?=\/)/, '');
  const load = loadArchiveData;
  const toast = text => { const el=$('#toast'); el.textContent=text;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,3000); };
  const card = w => renderWorkCard(localized(w), {url:localURL, translate:tx, names});
  const drawGrid = list => `<div class="work-grid">${list.map(card).join('')}</div>`;
  async function copy(value, feedback) {const report = message => {if(feedback)feedback.textContent=message;else toast(message);};try { await navigator.clipboard.writeText(value);report(tx('ui.copied','已复制')); } catch { report(tx('d.copyFail','复制失败，请手动复制。')); } }
  installTopicDownloads({load,tx,toast});
  const groupDialog = $('#group-dialog');
  let groupFocus;
  document.addEventListener('click', async event => {
    const opener = event.target.closest('[data-group-open]');
    if (opener && !groupDialog.open) {
      groupFocus = opener;
      $('[data-group-copy-status]', groupDialog).textContent = '';
      groupDialog.showModal();
    }
    if (event.target.closest('[data-group-close]')) groupDialog.close();
    const button = event.target.closest('[data-group-copy]');
    if (!button || button.disabled) return;
    const feedback = $('[data-group-copy-status]', groupDialog);
    button.disabled = true;
    try {
      try { await navigator.clipboard.writeText(button.dataset.groupCopy); }
      catch {
        const field = document.createElement('textarea');
        field.value = button.dataset.groupCopy;
        SiteComponents.clipboardField(field);
        groupDialog.append(field);
        try { field.select(); if (!document.execCommand('copy')) throw Error('copy'); }
        finally { field.remove(); }
      }
      feedback.textContent = tx('ui.copied', '已复制');
    } catch { feedback.textContent = tx('d.copyFail', '复制失败，请手动复制。'); }
    finally { button.disabled = false; button.focus(); }
  });
  groupDialog.addEventListener('close', () => groupFocus?.focus());
  groupDialog.addEventListener('click', event => {
    const rect = groupDialog.getBoundingClientRect();
    if (event.target === groupDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) groupDialog.close();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-copy-img]');
    if (!button || button.disabled) return;
    const feedback = button.closest('[data-work-actions],.detail-info,.preview-info')?.querySelector('[data-image-copy-status]');
    if (feedback) feedback.textContent = '';
    const report = message => { if (feedback) feedback.textContent = message; else toast(message); };
    const copying = copyImage(button.dataset.copyImg);
    button.disabled = true;
    button.setAttribute('aria-busy','true');
    copying.then(() => report(button.dataset.copyAnimated === 'true' ? tx('d.copyStill','已复制静态图片，动图请下载原图') : tx('v2.copiedImg','已复制图片')),
      error => report(error.message === 'unsupported' ? tx('v2.copyImgFail','浏览器不支持，请长按保存') : tx('d.copyImageFail','复制失败，请重试或下载原图')))
      .finally(() => {button.disabled = false;button.removeAttribute('aria-busy');});
  });
  let menuPrevious;
  const mobileQuery=matchMedia('(max-width:760px)');
  const sidebar=$('#sidebar');
  function syncDrawer(){const open=document.body.classList.contains('menu-open');sidebar.inert=mobileQuery.matches&&!open;$('.main-wrap').inert=mobileQuery.matches&&open;}
  syncDrawer();mobileQuery.addEventListener('change',syncDrawer);
  function menu(open) {
    document.body.classList.toggle('menu-open',open);$('.menu-scrim').hidden=!open;$('[data-menu]').setAttribute('aria-expanded',String(open));
    syncDrawer();
    if(open){menuPrevious=document.activeElement;$('.sidebar a').focus();}else menuPrevious?.focus();
  }
  $('[data-menu]')?.addEventListener('click',()=>menu(true));$$('[data-menu-close]').forEach(el=>el.addEventListener('click',()=>menu(false)));
  document.addEventListener('keydown',event=>{
    if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){event.preventDefault();$('#top-q').focus();}
    if(event.key==='Escape'&&document.body.classList.contains('menu-open'))menu(false);
    if(event.key==='Tab'&&document.body.classList.contains('menu-open')){const items=$$('.sidebar a,.sidebar button').filter(x=>x.offsetParent);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  });
  document.addEventListener('click',e=>{const copyEl=e.target.closest('[data-copy]');if(copyEl)copy(copyEl.dataset.copy);const link=e.target.closest('[data-copy-link]');if(link)copy(new URL(localURL(link.dataset.copyLink||location.pathname),'https://xn--pssy23gqgbz2d718b.com').href,link.closest('[data-work-actions]')?.querySelector('[data-image-copy-status]'));});
  // All list controls use the same frozen public dataset and preserve their state in the URL.
  const listPage=document.body.hasAttribute('data-list-page'),searchPage=document.body.hasAttribute('data-search-page');
  if(listPage||searchPage){
    let dataset,all=[],filtered=[],shown=24;
    const pageNumber=Number(document.body.dataset.pageNumber)||1;
    const pageStart=(pageNumber-1)*24;
    const defaultState={character:document.body.dataset.character||'',type:document.body.dataset.type||'',sort:document.body.dataset.sort||'latest',creation:''};
    const form=$('#filter-form'),params=new URLSearchParams(location.search),query=$('#search-q'),result=$('#results'),count=$('#result-count');
    // Transient sort/filter states use the fragment, so the gallery does not
    // expose an unbounded family of indexable query combinations. Old shared
    // query URLs are still accepted and normalized when the page is ready.
    for(const [key,value] of new URLSearchParams(location.hash.slice(1))) if(['character','type','sort','q','creation'].includes(key))params.set(key,value);
    const selected={character:document.body.dataset.character||'',type:document.body.dataset.type||'',sort:document.body.dataset.sort||'latest',creation:''};
    for(const name of ['character','type','sort','creation'])if(params.has(name))selected[name]=params.get(name);
    if(!['latest','random',...(defaultState.sort==='curated'?['curated']:[])].includes(selected.sort))selected.sort=defaultState.sort;
    if(!['','non-ai'].includes(selected.creation))selected.creation='';
    const setCharacters=value=>{const ids=String(value||'').split(',').filter(Boolean);for(const option of form.elements.character.options)option.selected=option.value?ids.includes(option.value):!ids.length;};
    for(const [name,value]of Object.entries(selected))if(form.elements[name]){if(name==='character')setCharacters(value);else form.elements[name].value=value;}
    const sourceQuery=params.get('q')||'',displayQuery=names(sourceQuery);
    if(query)query.value=displayQuery;
    const getState=()=>({q:query ? (query.value.trim()===displayQuery ? sourceQuery : query.value.trim()) : '',character:[...form.elements.character.selectedOptions].map(option=>option.value).filter(Boolean).join(','),type:form.elements.type.value,sort:form.elements.sort.value,creation:form.elements.creation.value});
    const listBase=document.body.dataset.listBase||basePath(location.pathname);
    const globalArchive=listBase==='/browse.html'||listBase.startsWith('/categories/');
    const categoryURL=()=>{
      const state=getState(),url=new URL(state.type?'/categories/'+state.type+'.html':'/browse.html',location.origin);
      const fragment=new URLSearchParams();
      if(state.character)fragment.set('character',state.character);if(state.creation)fragment.set('creation',state.creation);
      if(state.sort!=='latest')fragment.set('sort',state.sort);
      url.hash=fragment.toString();
      return url;
    };
    // A category change uses its dedicated archive instead of intersecting two types.
    if(globalArchive&&params.has('type')&&selected.type!==defaultState.type){location.replace(localURL(categoryURL().href));return;}
    const stateURL=()=>{const state=getState(),url=new URL(document.body.dataset.listBase||basePath(location.pathname),location.origin),fragment=new URLSearchParams();for(const[name,value]of Object.entries(state))if(value&&value!==defaultState[name]){if(searchPage&&name==='q')url.searchParams.set(name,value);else fragment.set(name,value);}url.hash=fragment.toString();return url;};
    const setURL=()=>{const state=getState();history.replaceState({...history.state,filters:state},'',localURL(stateURL().href));};
    function render(reshuffle=true,append=false){
      document.dispatchEvent(new Event('archive:filter-sync'));
      const state=getState(),words=state.q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const characters=state.character.split(',').filter(Boolean);
      filtered=all.filter(w=>matchesCreationMethod(w,state.creation)&&characters.every(id=>w.cids.includes(id))&&(!state.type||w.k.includes(state.type))&&words.every(word=>{const roles=dataset.characters.filter(c=>w.cids.includes(c.id));const text=[w.n,w.c,w.d,w.cm,...w.roles.map(role=>role.name),...roles.flatMap(role=>role.aliases||[]),...w.tg,...w.tg.map(names)].join(' ');const l=localized(w);return (text+' '+[l.n,l.c,l.d,l.cm,...l.roles.map(role=>role.name),...l.tg].join(' ')).toLocaleLowerCase().includes(word);}));
      if(state.sort==='popular'||state.sort==='downloads')filtered.sort((a,b)=>(window.WorkStats?.metric(b.id,state.sort)||0)-(window.WorkStats?.metric(a.id,state.sort)||0));
      if(state.sort==='random'){
        if(reshuffle||!render.randomOrder){render.randomOrder=filtered.map(w=>w.slug);for(let i=render.randomOrder.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[render.randomOrder[i],render.randomOrder[j]]=[render.randomOrder[j],render.randomOrder[i]];}}
        const ranks=new Map(render.randomOrder.map((slug,i)=>[slug,i]));filtered.sort((a,b)=>ranks.get(a.slug)-ranks.get(b.slug));
      }
      if(searchPage&&!state.q&&!state.character&&!state.type&&!state.creation){count.textContent=tx('d.searchPrompt','输入关键词开始查找。');result.innerHTML='';$('#search-discovery').hidden=false;$('[data-load-more]').hidden=true;$('.load-more-wrap').hidden=true;return;}
      if(searchPage)$('#search-discovery').hidden=true;
      count.textContent=tx('d.resultCounts','{count} 件作品',{count:filtered.length})+(state.q?' · “'+(query?.value||state.q)+'”':'');
      const changed=Object.entries(defaultState).some(([name,value])=>state[name]!==value)||!!state.q;
      const start=changed?0:pageStart;
      const existingGrid=$('.work-grid',result);
      if(append&&existingGrid){
        const current=$$('.work-card',existingGrid).length;
        existingGrid.insertAdjacentHTML('beforeend',filtered.slice(start+current,start+shown).map(card).join(''));
      }else result.innerHTML=filtered.length?drawGrid(filtered.slice(start,start+shown)):`<div class="empty-state"><h2>${esc(tx('d.noResults','还没找到合适的作品。'))}</h2><p>${esc(tx('d.noResultsDesc','试试减少条件、换个关键词，或按角色继续逛。'))}</p><button class="button" type="button" data-reset>${esc(tx('d.clear','清除条件'))}</button><a class="button primary" href="${localURL("/characters.html")}">${esc(tx('v2.nav.characters','角色'))}</a></div>`;
      history.replaceState({...history.state,feedShown:shown,feedVersion:6},'');
      const more=$('[data-load-more]');
      more.hidden=start+shown>=filtered.length;
      more.closest('.load-more-wrap').hidden=more.hidden;
    }
    function update(){shown=24;if(pageNumber>1){location.assign(localURL(stateURL().href));return;}setURL();if(dataset)render();}
    form.addEventListener('change',event=>{
      if(event.target.name==='type'&&globalArchive){location.assign(localURL(categoryURL().href));return;}
      if(event.target.name==='character'&&document.body.dataset.character&&!getState().character.split(',').includes(document.body.dataset.character)){
        const state=getState();const url=new URL('/browse.html',location.origin);
        const fragment=new URLSearchParams();if(state.character)fragment.set('character',state.character);if(state.creation)fragment.set('creation',state.creation);if(state.type)fragment.set('type',state.type);if(state.sort!=='latest')fragment.set('sort',state.sort);url.hash=fragment.toString();location.assign(localURL(url.href));return;
      }
      update();
    });form.addEventListener('submit',e=>e.preventDefault());
    document.addEventListener('click',e=>{if(e.target.closest('[data-reset]')){setCharacters(document.body.dataset.character||'');form.elements.type.value=document.body.dataset.type||'';form.elements.sort.value=document.body.dataset.sort||'latest';form.elements.creation.value='';if(query)query.value='';update();}});
    $('#search-form')?.addEventListener('submit',e=>{e.preventDefault();update();});
    let timer;query?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(update,220);});
    $('[data-load-more]').addEventListener('click',()=>{shown+=24;render(false,true);});
    document.addEventListener('site:langchange',()=>{if(dataset)render(false);});
    load().then(async d=>{if(['popular','downloads'].includes(form.elements.sort.value))await window.WorkStats?.ready;dataset=d;const slugs=result.dataset.list?JSON.parse(result.dataset.list):null;all=slugs?slugs.map(s=>d.works.find(w=>w.slug===s)).filter(Boolean):d.works;shown=history.state?.feedVersion===6?history.state.feedShown||24:24;if(['popular','downloads'].includes(form.elements.sort.value)&&!window.WorkStats?.available())form.elements.sort.value=defaultState.sort;if(['character','type','sort','view','creation'].some(name=>params.has(name)))setURL();render();if(performance.getEntriesByType('navigation')[0]?.type==='back_forward'){try{const y=Number(sessionStorage.getItem('bluefish-scroll:'+location.pathname+location.search));if(y)requestAnimationFrame(()=>requestAnimationFrame(()=>scrollTo(0,y)));}catch{}}}).catch(()=>{count.textContent=tx('d.loadFail','数据加载失败，请刷新页面。');});
  }
  if(document.body.hasAttribute('data-legacy-category')){
    const p=new URLSearchParams(location.hash.slice(1)),c=p.get('c'),s=p.get('s'),q=p.get('q'),safe=v=>/^[a-z0-9-]+$/i.test(v||'');
    if(q)location.replace(localURL('/search.html?q='+encodeURIComponent(q)));else if(safe(c))location.replace(localURL('/characters/'+c+(safe(s)?'/'+s:'')+'.html'));else if(safe(s))location.replace(localURL('/categories/'+s+'.html'));
  }
  installWorkPreview({load,localize:localized,translate:tx,url:localURL,names,toast});
  document.addEventListener('click',e=>{const btn=e.target.closest('[data-comments]');if(!btn)return;btn.disabled=true;const script=document.createElement('script');script.src='https://giscus.app/client.js';const attrs={'repo':'lmy414/lmy414-blog-comments','repo-id':'R_kgDOTUvnVw','category':'Announcements','category-id':'DIC_kwDOTUvnV84DF4fs','mapping':'specific','term':'sticker-'+btn.dataset.comments,'reactions-enabled':'1','input-position':'bottom','theme':document.documentElement.dataset.theme||'light','lang':({zh:'zh-CN','zh-Hant':'zh-TW',en:'en',ja:'ja'})[window.SiteLang?.current||'zh']};for(const[key,value]of Object.entries(attrs))script.setAttribute('data-'+key,value);script.crossOrigin='anonymous';script.async=true;script.onerror=()=>{btn.disabled=false;toast(tx('d.commentsFail','评论暂时无法加载，请稍后重试。'));};$('#comments-container').append(script);btn.hidden=true;});
  // Restore the list position when returning from a detail page in the same tab.
  if(document.body.dataset.workId)document.dispatchEvent(new CustomEvent('work:show',{detail:{id:document.body.dataset.workId}}));
  const scrollKey='bluefish-scroll:'+location.pathname+location.search;
  addEventListener('pagehide',()=>{try{sessionStorage.setItem(scrollKey,String(scrollY));}catch{}});
  const back=performance.getEntriesByType('navigation')[0]?.type==='back_forward';if(back){try{const y=Number(sessionStorage.getItem(scrollKey));if(y)setTimeout(()=>scrollTo(0,y),250);}catch{}}
})();
