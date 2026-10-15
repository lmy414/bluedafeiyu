import {renderWorkCard} from './work-card.js?v=4';
import {rankSubmissions} from './journal-ranking.js?v=1';
import {copy} from './journal-copy.js?v=1';
if(document.body.dataset.page==='home'){
  const lang=location.pathname.startsWith('/zh-hant/')?'zh-Hant':location.pathname.startsWith('/en/')?'en':location.pathname.startsWith('/ja/')?'ja':'zh';
  const t=copy[lang],carousel=document.querySelector('.journal-feature');
  const media=matchMedia('(prefers-reduced-motion:reduce)');
  if(carousel){
    const slides=[...carousel.querySelectorAll('.journal-slide')];
    let index=0,timer=0,paused=false,hovered=false,focused=false,manualUntil=0;
    const canRotate=()=>!paused&&!hovered&&!focused&&!document.hidden&&!media.matches&&slides.length>1;
    const stop=()=>{clearTimeout(timer);timer=0;};
    function schedule(){stop();if(!canRotate())return;timer=setTimeout(()=>{if(!canRotate())return;if(document.querySelector('dialog[open]')){schedule();return;}show(index+1,false);schedule();},Math.max(6000,manualUntil-Date.now()));}
    function show(next,manual=true){
      index=(next+slides.length)%slides.length;
      slides.forEach((slide,i)=>{slide.hidden=i!==index;});
      carousel.querySelectorAll('[data-journal-dot]').forEach((el,i)=>el.setAttribute('aria-current',String(i===index)));
      carousel.querySelector('[data-journal-position]').textContent=`${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;
      if(manual){manualUntil=Date.now()+10000;carousel.querySelector('[data-journal-announcement]').textContent=slides[index].querySelector('h2').textContent;schedule();}
    }
    function updatePause(){
      const button=carousel.querySelector('[data-journal-pause]'),stopped=paused||media.matches;
      const reducedLabel={zh:'已根据减少动态效果设置暂停轮播','zh-Hant':'已依減少動態效果設定暫停輪播',en:'Autoplay paused by reduced motion preference',ja:'動きを減らす設定により自動切り替えを停止中'}[lang];
      button.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="${stopped?'m8 5 11 7-11 7z':'M8 6v12M16 6v12'}"/></svg>`;
      button.setAttribute('aria-label',media.matches?reducedLabel:paused?t.play:t.pause);
      button.setAttribute('aria-pressed',String(stopped));button.disabled=media.matches||slides.length<2;
    }
    const prev=carousel.querySelector('[data-journal-prev]'),next=carousel.querySelector('[data-journal-next]');
    prev.setAttribute('aria-label',t.prev);next.setAttribute('aria-label',t.next);
    prev.disabled=next.disabled=slides.length<2;
    prev.addEventListener('click',()=>show(index-1));next.addEventListener('click',()=>show(index+1));
    carousel.querySelectorAll('[data-journal-dot]').forEach((button,i)=>{button.setAttribute('aria-label',`${t.slide} ${i+1} · ${slides[i].querySelector('h2').textContent}`);button.addEventListener('click',()=>show(i));});
    carousel.querySelector('[data-journal-pause]').addEventListener('click',()=>{paused=!paused;updatePause();schedule();});
    carousel.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){hovered=true;stop();}});
    carousel.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'){hovered=false;schedule();}});
    carousel.addEventListener('focusin',()=>{focused=true;stop();});
    carousel.addEventListener('focusout',()=>queueMicrotask(()=>{focused=carousel.contains(document.activeElement);schedule();}));
    carousel.querySelector('.journal-slider-controls').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();show(e.key==='Home'?0:e.key==='End'?slides.length-1:index+(e.key==='ArrowLeft'?-1:1));}});
    document.addEventListener('visibilitychange',schedule);media.addEventListener('change',()=>{updatePause();schedule();});
    window.addEventListener('pagehide',stop);window.addEventListener('pageshow',schedule);updatePause();schedule();
  }
  const lede=document.querySelector('.page-head .lede');
  if(lede&&!lede.closest('.journal-home-intro')){const intro=document.createElement('details');intro.className='journal-home-intro';const summary=document.createElement('summary');summary.textContent=t.about;lede.before(intro);intro.append(summary,lede);}
  const hot=document.querySelector('.journal-popular');
  async function refreshPopular(){
    if(!hot)return;
    try{
      const [data,stats]=await Promise.all([fetch('/archive-data.json?v=2').then(r=>{if(!r.ok)throw Error('data');return r.json();}),window.WorkStats?.ready]);
      const ranked=rankSubmissions(data.works,JSON.parse(hot.dataset.submissionIds),stats);
      if(!ranked.length){hot.querySelector('[data-journal-ranking-note]').textContent=t.recentNote;return;}
      const grid=hot.querySelector('.journal-popular-grid');
      grid.innerHTML=ranked.map(w=>renderWorkCard(window.SiteLang?.localWork(w)||w,{eager:true,url:href=>window.SiteLang?.url(href)||href,translate:(key,fallback)=>window.SiteLang?.fmt(key,fallback)||fallback,names:value=>window.SiteLang?.contentText(value)||value})).join('');
      [...grid.children].forEach((card,i)=>{const badge=document.createElement('span');badge.className='journal-rank';badge.textContent=String(i+1).padStart(2,'0');card.prepend(badge);const metric=document.createElement('span');metric.className='journal-view-count';metric.textContent=`${stats.works[ranked[i].id].views.toLocaleString()} ${t.views}`;card.querySelector('.card-meta').append(metric);});
      hot.querySelector('#journal-popular-title .marker-highlight').textContent=t.popular;
      hot.querySelector('[data-journal-ranking-note]').textContent=t.byViews;
      const date=new Date(stats.syncedAt);const formatted=Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat(lang==='zh'?'zh-CN':lang,{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(date);
      hot.querySelector('[data-journal-ranking-source]').textContent=t.source+(formatted?` ${t.updated}：${formatted}`:'')+(stats.stale?' · '+(window.SiteLang?.fmt('stats.stale','统计更新延迟')||'统计更新延迟'):'');
      hot.querySelector('.journal-ranking-note').hidden=false;
      hot.dataset.ranking='popular';
    }catch{hot.querySelector('[data-journal-ranking-note]').textContent=t.recentNote;}
  }
  refreshPopular();
}
