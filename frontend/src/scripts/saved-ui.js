import {readSaved,toggleSaved} from '../../public/archive/saved-items.js';
import {loadArchiveData} from '../../public/archive/data-loader.js';
import {renderWorkCard} from '../../public/archive/work-card.js';

const text=(key,fallback)=>window.SiteLang?.t(key,fallback) || fallback;
let frame;
function paint(){
  const sets={works:new Set(readSaved('works')),creators:new Set(readSaved('creators'))};
  document.querySelectorAll('[data-save]').forEach(button=>{
    const active=sets[button.dataset.save]?.has(button.dataset.id) || false;
    const label=active?text('d.unsave','取消收藏'):text(button.dataset.save==='creators'?'d.saveCreator':'d.saveWork',button.dataset.save==='creators'?'收藏作者':'收藏作品');
    button.classList.toggle('is-saved',active);
    button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',label);
    const span=button.querySelector('span');const caption=active?text('d.saved','已收藏'):label;
    if(span && span.textContent!==caption)span.textContent=caption;
  });
}
const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(paint);};
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-save]');if(!button)return;
  try{
    toggleSaved(button.dataset.save,button.dataset.id);
    document.dispatchEvent(new Event('saved:change'));
  }catch{
    const toast=document.querySelector('#toast');
    if(toast){toast.textContent=text('d.storageUnavailable','浏览器未能保存收藏。');toast.hidden=false;setTimeout(()=>toast.hidden=true,3000);}
  }
});
document.addEventListener('saved:change',paint);
document.addEventListener('preview:render',paint);
document.addEventListener('site:langchange',schedule);
window.addEventListener('storage',()=>{paint();document.dispatchEvent(new Event('saved:change'));});
new MutationObserver(schedule).observe(document.querySelector('main'),{childList:true,subtree:true});
paint();

if(document.querySelector('[data-saved-grid]')){
  let data;
  let generation=0;
  async function render(){
    const current=++generation;
    const authors=new Set(readSaved('creators'));
    let authorCount=0;
    document.querySelectorAll('[data-saved-creators] .creator-row-card').forEach(row=>{
      row.hidden=!authors.has(row.dataset.creator);if(!row.hidden)authorCount++;
    });
    document.querySelector('[data-saved-creators]').hidden=!authorCount;
    const saved=new Set(readSaved('works'));
    if(saved.size && !data){try{data=await loadArchiveData();}catch{return;}}
    if(current!==generation)return;
    const works=(data?.works || []).filter(w=>saved.has(w.slug));
    const grid=document.querySelector('[data-saved-grid]');
    grid.innerHTML=works.map(w=>renderWorkCard(window.SiteLang?.localWork(w)||w,{
      url:href=>window.SiteLang?.url(href)||href,translate:text,names:value=>window.SiteLang?.contentText(value)||value
    })).join('');
    document.querySelector('[data-saved-works]').hidden=!works.length;
    document.querySelector('[data-saved-empty]').hidden=!!(authorCount+works.length);
    paint();
  }
  document.addEventListener('saved:change',render);
  document.addEventListener('site:langchange',render);
  render();
}
