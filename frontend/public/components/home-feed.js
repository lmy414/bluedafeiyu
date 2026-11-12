import {loadArchiveData} from '../archive/data-loader.js';
import {createSearchIndex} from '../archive/search.js';
import {filterWorks} from './work-filter.js';
import {orderWorks,shuffledSlugs} from './work-order.js';
import {renderHomeCard} from '../../src/components/home/HomeCard.mjs';

export function installHomeFeed({document=globalThis.document,window=globalThis.window,load=loadArchiveData}={}) {
  const grid=document.querySelector('[data-feed-grid]');
  if(!grid)return;
  const query=document.querySelector('.search input'),form=query.closest('form');
  const more=document.querySelector('[data-home-more]'),count=document.querySelector('[data-home-count]'),shownLabel=document.querySelector('[data-home-shown]');
  const chips=[...document.querySelectorAll('[data-home-type]')];
  const pickers=[...document.querySelectorAll('[data-filter-picker]')];
  const defaults={character:'',type:'',sort:'latest',q:''};
  const state={...defaults};
  let all,index,shown=30,randomOrder,timer,composing=false,statsReady=false,statsFallback=false;
  const metricSort=()=>['popular','downloads'].includes(state.sort);
  const statsStatus=document.querySelector('[data-home-sort-status]');
  const tx=(key,text,vars)=>window.SiteLang?window.SiteLang.fmt(key,text,vars):text.replace(/\{(\w+)\}/g,(_,key)=>vars?.[key]??'');
  function readURL(){
    Object.assign(state,defaults);
    const params=new URLSearchParams(window.location.search);
    for(const [key,value] of new URLSearchParams(window.location.hash.slice(1)))params.set(key,value);
    for(const key of Object.keys(state))if(params.has(key))state[key]=params.get(key);
    if(!['latest','random','popular','downloads'].includes(state.sort))state.sort='latest';
    if(!chips.some(chip=>chip.dataset.homeType===state.type))state.type='';
    const allowed=new Set([...document.querySelectorAll('[data-filter-picker="character"] [data-character-id]')].map(option=>option.dataset.characterId));
    state.character=[...new Set(state.character.split(',').filter(id=>allowed.has(id)))].join(',');
    query.value=state.q;
  }
  function sync(){
    if(statsStatus){
      statsStatus.hidden=!metricSort()&&!statsFallback;
      statsStatus.textContent=statsFallback?tx('d.home.statsUnavailable','统计暂不可用，已按最新收录展示。'):!statsReady?tx('d.home.statsLoading','正在加载真实统计…'):tx('d.home.statsMeaning','热度按浏览次数排序；下载量为下载按钮点击次数。');
    }
    for(const chip of chips){const active=chip.dataset.homeType===state.type;chip.classList.toggle('is-active',active);chip.setAttribute('aria-current',active?'true':'false');}
    for(const picker of pickers){
      const character=picker.dataset.filterPicker==='character';
      const selected=state.character.split(',').filter(Boolean),labels=[];
      for(const option of picker.querySelectorAll('[role=option]')){
        const value=character?option.dataset.characterId||'':new URL(option.dataset.href,window.location.href).hash.split('sort=')[1];
        if(!character&&['popular','downloads'].includes(value))option.setAttribute('aria-disabled',String(!statsReady||!window.WorkStats?.available()));
        const active=character?(value?selected.includes(value):!selected.length):value===state.sort;
        option.setAttribute('aria-selected',String(active));if(active)labels.push(option.textContent);
      }
      const label=picker.querySelector('button span');label.removeAttribute('data-i18n');label.textContent=labels.join(' + ');
    }
  }
  function setURL(){
    const url=new URL(window.location.href),params=new URLSearchParams();
    for(const [key,value] of Object.entries(state)){url.searchParams.delete(key);if(value&&value!==defaults[key])params.set(key,value);}
    url.hash=params.toString();window.history.replaceState(window.history.state,'',url.href);
  }
  function render(preserveInitial=false){
    if(metricSort()&&statsReady&&!window.WorkStats?.available()){
      state.sort='latest';statsFallback=true;setURL();
    }
    sync();if(!all)return;
    if(metricSort()&&!statsReady){more.hidden=true;return;}
    const scores=state.q?index.search(state.q):null;
    const filtered=orderWorks(filterWorks(all,state,{scores,allowGif:true}),{sort:state.sort,randomOrder,metric:(id,mode)=>window.WorkStats?.metric(id,mode)||0});
    const visible=filtered.slice(0,shown);
    const sameCards=preserveInitial===true&&grid.children.length===visible.length&&visible.every((work,i)=>grid.children[i].dataset.slug===work.slug);
    if(!sameCards)grid.innerHTML=visible.map(work=>renderHomeCard(window.SiteLang?window.SiteLang.localWork(work):work,{url:href=>window.SiteLang?window.SiteLang.url(href):href,translate:tx,names:text=>window.SiteLang?window.SiteLang.contentText(text):text})).join('');
    count.removeAttribute('data-i18n-tpl');count.textContent=tx('d.home.imageCount','{count} 张图片',{count:filtered.length.toLocaleString('en-US')});
    shownLabel.removeAttribute('data-i18n-tpl');shownLabel.textContent=tx('d.home.shown','已展示 {shown} / {total} 张',{shown:Math.min(shown,filtered.length),total:filtered.length.toLocaleString('en-US')});
    document.querySelector('[data-home-empty]').hidden=filtered.length>0;
    more.hidden=shown>=filtered.length;
  }
  function update(){statsFallback=false;clearTimeout(timer);shown=30;setURL();render();}
  for(const chip of chips)chip.addEventListener('click',event=>{event.preventDefault();state.type=chip.dataset.homeType;update();});
  document.querySelector('[data-home-reset]').addEventListener('click',event=>{event.preventDefault();Object.assign(state,defaults);query.value='';update();});
  more.addEventListener('click',event=>{event.preventDefault();shown+=30;render();});
  for(const picker of pickers){
    const button=picker.querySelector('button'),panel=picker.querySelector('[role=listbox]'),options=[...panel.querySelectorAll('[role=option]')];
    const close=restore=>{panel.hidden=true;button.setAttribute('aria-expanded','false');if(restore)button.focus({preventScroll:true});};
    const focus=option=>{option.focus({preventScroll:true});option.scrollIntoView?.({block:'nearest'});};
    const open=i=>{panel.hidden=false;button.setAttribute('aria-expanded','true');focus(options[i]);};
    const choose=option=>{
      if(option.getAttribute('aria-disabled')==='true')return;
      if(picker.dataset.filterPicker==='character'){
        const id=option.dataset.characterId,selected=new Set(state.character.split(',').filter(Boolean));
        if(!id)selected.clear();else if(selected.has(id))selected.delete(id);else selected.add(id);
        state.character=[...selected].join(',');
      }else{state.sort=new URL(option.dataset.href,window.location.href).hash.split('sort=')[1];if(state.sort==='random'&&all)randomOrder=shuffledSlugs(all);close(true);}
      update();
    };
    button.addEventListener('click',()=>panel.hidden?open(Math.max(0,options.findIndex(option=>option.getAttribute('aria-selected')==='true'))):close(true));
    button.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(event.key==='ArrowUp'?options.length-1:0);}});
    options.forEach((option,i)=>{option.addEventListener('click',()=>choose(option));option.addEventListener('keydown',event=>{
      const next={ArrowDown:(i+1)%options.length,ArrowUp:(i+options.length-1)%options.length,Home:0,End:options.length-1}[event.key];
      if(next!==undefined){event.preventDefault();focus(options[next]);}else if(['Enter',' '].includes(event.key)){event.preventDefault();choose(option);}
    });});
    picker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(true);}});
    picker.addEventListener('focusout',event=>{if(!picker.contains(event.relatedTarget))close(false);});
    document.addEventListener('pointerdown',event=>{if(!picker.contains(event.target))close(false);});
  }
  const search=()=>{state.q=query.value.trim();update();};
  form.addEventListener('submit',event=>{event.preventDefault();search();});
  query.addEventListener('compositionstart',()=>{composing=true;clearTimeout(timer);});
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(search,150);};
  query.addEventListener('compositionend',()=>{composing=false;schedule();});
  query.addEventListener('input',event=>{if(!composing&&!event.isComposing)schedule();});
  window.addEventListener('hashchange',()=>{readURL();shown=30;render();});
  document.addEventListener('site:langchange',render);
  readURL();sync();
  const statistics=(async()=>{
    // Module/defer fetch timing can vary. Wait for deferred scripts before
    // deciding that WorkStats is missing, then await its actual snapshot.
    if(!window.WorkStats&&document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    try{await window.WorkStats?.ready;}catch{}
    statsReady=true;
    // A pending snapshot must never repaint over a newer sort/reset choice.
    if(metricSort())render();else sync();
  })();
  const ready=load().then(async data=>{
    const excluded=new Set(JSON.parse(grid.dataset.excludedIds||'[]'));
    all=data.works.filter(work=>!excluded.has(work.id));
    index=createSearchIndex(all,data.characters,{characterName:(id,name)=>window.SiteLang?window.SiteLang.characterName(id,name):name});
    randomOrder=shuffledSlugs(all);if(metricSort())await statistics;render(true);
  }).catch(()=>{count.textContent=tx('d.loadFail','数据加载失败，请刷新页面。');});
  return {ready};
}
if(typeof document!=='undefined')installHomeFeed();
