import {installMasonry} from './masonry.mjs';
installMasonry();
document.querySelectorAll('[data-design-slider]').forEach(slider=>{
  const slides=[...slider.querySelectorAll('[data-design-slide]')];const dots=[...slider.querySelectorAll('[data-design-dot]')];let current=0;
  const show=n=>{current=n;slides.forEach((s,i)=>s.hidden=i!==n);dots.forEach((d,i)=>{d.classList.toggle('is-active',i===n);d.setAttribute('aria-pressed',String(i===n));});};
  dots.forEach((dot,i)=>dot.addEventListener('click',()=>show(i)));
});
const tabs=[...document.querySelectorAll('[data-submission-mode]')];
if(tabs.length){const image=document.getElementById('image-submission-panel'),video=document.getElementById('creator-registration');const set=mode=>{image.hidden=mode!=='image';video.hidden=mode!=='video';tabs.forEach(t=>{const on=t.dataset.submissionMode===mode;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});};tabs.forEach((t,i)=>{t.addEventListener('click',()=>set(t.dataset.submissionMode));t.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=tabs[(i+1)%tabs.length];set(next.dataset.submissionMode);next.focus();}});});set(new URLSearchParams(location.search).get('media')==='video'||location.hash==='#creator-registration'?'video':'image');}

const sidebarToggle=document.querySelector('[data-sidebar-collapse]');
if(sidebarToggle){
 const apply=collapsed=>{document.body.classList.toggle('sidebar-collapsed',collapsed);sidebarToggle.setAttribute('aria-expanded',String(!collapsed));window.dispatchEvent(new Event('resize'));};
 try{apply(localStorage.getItem('bluefish-sidebar')!=='expanded');}catch{}
 sidebarToggle.addEventListener('click',()=>{const collapsed=!document.body.classList.contains('sidebar-collapsed');apply(collapsed);try{localStorage.setItem('bluefish-sidebar',collapsed?'collapsed':'expanded');}catch{}});
}
const videoSort=document.querySelector('[data-video-sort]');
videoSort?.addEventListener('change',()=>{const grid=document.querySelector('.dense-video-grid');const cards=[...grid.children];cards.sort((a,b)=>videoSort.value==='oldest'?a.dataset.published.localeCompare(b.dataset.published):b.dataset.published.localeCompare(a.dataset.published));grid.append(...cards);});

window.WorkStats?.paint();
