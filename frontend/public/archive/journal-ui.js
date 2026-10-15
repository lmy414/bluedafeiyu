/* Collapsible navigation and interaction feedback. */
(() => {
  'use strict';
  const sidebar=document.querySelector('#sidebar');
  if(!sidebar) return;
  const locale=location.pathname.startsWith('/en/')?'en':location.pathname.startsWith('/ja/')?'ja':location.pathname.startsWith('/zh-hant/')?'zh-Hant':'zh';
  const words={zh:['收起侧栏','展开侧栏','更多入口'],'zh-Hant':['收起側欄','展開側欄','更多入口'],en:['Collapse sidebar','Expand sidebar','More pages'],ja:['サイドバーを閉じる','サイドバーを開く','その他のページ']}[locale];
  const desktop=matchMedia('(min-width:761px)'), reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const icon=paths=>`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const toggle=document.createElement('button');
  toggle.type='button'; toggle.className='j-sidebar-toggle'; toggle.setAttribute('aria-controls','sidebar');
  toggle.innerHTML=icon('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m7-11-3 3 3 3"/>');
  sidebar.querySelector('.brand').after(toggle);
  const rail=document.createElement('nav');rail.className='j-rail-extra';rail.setAttribute('aria-label',words[2]);
  const sourceLinks=[sidebar.querySelector('.side-note a'),...sidebar.querySelectorAll('.sidebar-bottom>a')].filter(Boolean);
  const glyphs=['<path d="m7 8 5-5 5 5M12 3v13M3 15v6h18v-6"/>','<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/>','<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>','<path d="m12 3 3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1z"/>','<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 24"/>','<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/>'];
  sourceLinks.forEach((source,i)=>{
    const link=document.createElement('a');link.href=source.getAttribute('href');
    for(const attr of ['target','rel'])if(source.hasAttribute(attr))link.setAttribute(attr,source.getAttribute(attr));
    link.innerHTML=icon(glyphs[i]||glyphs[1]);
    link.setAttribute('aria-label',source.textContent.trim());link.dataset.jTooltip=source.textContent.trim();
    rail.append(link);
  });
  sidebar.append(rail);
  const tip=document.createElement('div');tip.id='journal-nav-tip';tip.role='tooltip';tip.hidden=true;document.body.append(tip);
  let collapsed=false,activeLink=null,oldDescription=null;
  try{collapsed=localStorage.getItem('bluefish-sidebar-collapsed')==='true';}catch{}
  const enabled=()=>true;
  const links=[...sidebar.querySelectorAll('.main-nav a'),...rail.children];
  for(const link of links){
    if(!link.dataset.jTooltip)link.dataset.jTooltip=link.querySelector('span')?.textContent.trim()||link.textContent.trim();
    if(!link.hasAttribute('aria-label'))link.setAttribute('aria-label',link.dataset.jTooltip);
  }
  function hideTip(){
    if(activeLink){if(oldDescription===null)activeLink.removeAttribute('aria-describedby');else activeLink.setAttribute('aria-describedby',oldDescription);}
    activeLink=null;oldDescription=null;tip.hidden=true;
  }
  function showTip(link){
    if(!enabled()||!desktop.matches||(!collapsed&&link!==toggle))return;
    hideTip();activeLink=link;oldDescription=link.getAttribute('aria-describedby');
    tip.textContent=link.dataset.jTooltip||link.getAttribute('aria-label');tip.hidden=false;
    const rect=link.getBoundingClientRect();tip.style.left=`${sidebar.getBoundingClientRect().right+12}px`;
    tip.style.top=`${Math.min(innerHeight-tip.offsetHeight-12,Math.max(12,rect.top+(rect.height-tip.offsetHeight)/2))}px`;
    link.setAttribute('aria-describedby',[oldDescription,tip.id].filter(Boolean).join(' '));
  }
  function sync(){
    const on=enabled();document.body.classList.toggle('j-sidebar-ready',on);
    document.body.classList.toggle('j-sidebar-collapsed',on&&desktop.matches&&collapsed);
    toggle.hidden=!on;rail.hidden=!on;
    toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',words[collapsed?1:0]);
    toggle.dataset.jTooltip=words[collapsed?1:0];hideTip();
  }
  toggle.addEventListener('click',()=>{collapsed=!collapsed;try{localStorage.setItem('bluefish-sidebar-collapsed',String(collapsed));}catch{}sync();});
  sidebar.addEventListener('pointerover',e=>{const link=e.target.closest('a,button');if(link&&(links.includes(link)||link===toggle))showTip(link);});
  sidebar.addEventListener('pointerout',e=>{if(activeLink&&!activeLink.contains(e.relatedTarget)&&!activeLink.matches(':focus-visible'))hideTip();});
  sidebar.addEventListener('focusin',e=>{if(links.includes(e.target)||e.target===toggle)showTip(e.target);});
  sidebar.addEventListener('focusout',hideTip);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip();});
  window.addEventListener('scroll',hideTip,{passive:true,capture:true});
  window.addEventListener('resize',hideTip,{passive:true});desktop.addEventListener('change',sync);
  document.addEventListener('site:langchange',()=>{links.forEach(link=>{const span=link.querySelector('span');if(span){link.dataset.jTooltip=span.textContent.trim();link.setAttribute('aria-label',link.dataset.jTooltip);}});});
  sync();

  // Animate refreshed results only; content is never hidden while waiting for a reveal.
  const results=document.querySelector('#results');let pending=false;const animations=new Set();
  const finishAnimations=()=>{for(const a of animations)a.cancel();animations.clear();};
  const animateResults=()=>{
    pending=false;if(!enabled()||reduced.matches||!results)return;
    const visible=[...results.querySelectorAll('.work-card')].filter(el=>{const r=el.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;}).slice(0,8);
    for(const [i,el] of visible.entries()){
      const animation=el.animate([{opacity:.65,translate:'0 8px'},{opacity:1,translate:'0 0'}],{duration:220,delay:i*20,easing:'cubic-bezier(.2,.65,.3,1)'});
      animations.add(animation);animation.finished.then(()=>animations.delete(animation)).catch(()=>{});
    }
  };
  if(results)new MutationObserver(()=>{if(!pending){pending=true;requestAnimationFrame(animateResults);}}).observe(results,{childList:true,subtree:false});
  reduced.addEventListener('change',()=>{if(reduced.matches)finishAnimations();});
})();
