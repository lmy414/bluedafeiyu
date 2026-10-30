import {installMasonry} from './masonry.mjs';
import {installPagedFeeds} from '../../public/components/paged-feed.js';
import {installSidebarTooltip} from '../../public/components/sidebar-tooltip.js';
import {installHomeDownloads} from '../../public/components/home-downloads.js';
import './saved-ui.js';
installMasonry();
installPagedFeeds();
installSidebarTooltip();
installHomeDownloads();

for (const slider of document.querySelectorAll('[data-design-slider]')) {
  const slides=[...slider.querySelectorAll('[data-design-slide]')];
  const dots=[...slider.querySelectorAll('[data-design-dot]')];
  const show=index=>{
    slides.forEach((slide,i)=>slide.hidden=i!==index);
    dots.forEach((dot,i)=>{dot.classList.toggle('is-active',i===index);dot.setAttribute('aria-pressed',String(i===index));});
  };
  dots.forEach((dot,i)=>dot.addEventListener('click',()=>show(i)));
}

const tabs=[...document.querySelectorAll('[data-submission-mode]')];
if(tabs.length){
  const image=document.getElementById('image-submission-panel');
  const video=document.getElementById('creator-registration');
  const select=mode=>{
    image.hidden=mode!=='image';video.hidden=mode!=='video';
    tabs.forEach(tab=>{const active=tab.dataset.submissionMode===mode;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
  };
  tabs.forEach((tab,i)=>{
    tab.addEventListener('click',()=>select(tab.dataset.submissionMode));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowRight','ArrowLeft'].includes(event.key))return;
      event.preventDefault();const next=tabs[(i+1)%tabs.length];select(next.dataset.submissionMode);next.focus();
    });
  });
  select(new URLSearchParams(location.search).get('media')==='video'||location.hash==='#creator-registration'?'video':'image');
}

const friendFilters=[...document.querySelectorAll('[data-friend-filter]')];
if(friendFilters.length){
  const select=()=>{
    const requested=location.hash.slice(1), category=['project','website'].includes(requested)?requested:'all';
    friendFilters.forEach(link=>{if(link.dataset.friendFilter===category)link.setAttribute('aria-current','true');else link.removeAttribute('aria-current');});
    document.querySelectorAll('[data-friend-section]').forEach(section=>section.hidden=category!=='all'&&section.dataset.friendSection!==category);
  };
  window.addEventListener('hashchange',select);select();
}

const creatorSearch=document.querySelector('[data-design-creator-search]');
if(creatorSearch){
  const directory=document.querySelector('[data-design-creators]');
  const rows=[...directory.children];
  const update=()=>{
    const query=creatorSearch.elements.q.value.toLocaleLowerCase().trim();
    const latest=creatorSearch.elements.sort.value==='latest';
    const rank=row=>({'4168597':0,'4456176':1}[row.dataset.uid]??2);
    const sorted=[...rows].sort((a,b)=>rank(a)-rank(b)||(latest?b.dataset.latest.localeCompare(a.dataset.latest):a.dataset.name.localeCompare(b.dataset.name)));
    let count=0;
    sorted.forEach(row=>{row.hidden=!!query&&!row.textContent.toLocaleLowerCase().includes(query);if(!row.hidden)count++;directory.append(row);});
    document.querySelector('[data-design-creator-count]').textContent=count;
    document.querySelector('[data-creator-empty]').hidden=count!==0;
  };
  creatorSearch.addEventListener('submit',event=>{event.preventDefault();update();});
  creatorSearch.addEventListener('input',update);creatorSearch.addEventListener('change',update);
}

for(const row of document.querySelectorAll('.creator-row-card')){
  const rail=row.querySelector('[data-creator-rail]');
  const buttons=[...row.querySelectorAll('[data-design-rail]')];
  const status=row.querySelector('[data-design-rail-status]');
  if(!rail||!status)continue;
  const paint=()=>{
    const child=rail.firstElementChild;
    if(!child||!rail.clientWidth)return;
    const gap=parseFloat(getComputedStyle(rail).gap)||0;
    const step=child.getBoundingClientRect().width+gap;
    const first=Math.round(rail.scrollLeft/step)+1;
    const count=Math.max(1,Math.round((rail.clientWidth+gap)/step));
    status.textContent=first+'–'+Math.min(rail.children.length,first+count-1)+' / '+rail.children.length;
    buttons[0].disabled=rail.scrollLeft<2;
    buttons[1].disabled=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-2;
  };
  buttons.forEach(button=>button.addEventListener('click',()=>rail.scrollBy({left:Number(button.dataset.designRail)*rail.clientWidth,behavior:'smooth'})));
  rail.addEventListener('scroll',paint,{passive:true});new ResizeObserver(paint).observe(rail);paint();
}

const authorFeed=document.querySelector('[data-author-feed]');
if(authorFeed){
  const links=[...document.querySelectorAll('[data-author-type]')];
  const select=()=>{
    const type=new URLSearchParams(location.hash.slice(1)).get('type')||'all';
    links.forEach(link=>{const selected=link.dataset.authorType===type;link.classList.toggle('is-active',selected);if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    if(!authorFeed.closest('[data-paged-feed]'))[...authorFeed.children].forEach(card=>card.hidden=type==='image'?card.matches('.video-card'):type==='video'?card.matches('.work-card'):false);
  };
  window.addEventListener('hashchange',select);select();
}
window.WorkStats?.paint();
