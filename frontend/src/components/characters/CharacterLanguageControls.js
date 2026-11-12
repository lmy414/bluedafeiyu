// The homepage menu intentionally targets home. On the character index, keep
// the shared menu's keyboard navigation but navigate within the current page.
const panel=document.getElementById('language-options');
const trigger=document.getElementById('lang');
function navigate(event){
  if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
  const option=event.target.closest('[role="option"][data-value]');
  if(!option||!panel.contains(option))return;
  const next={'zh-CN':'zh','zh-TW':'zh-Hant',en:'en',ja:'ja'}[option.dataset.value];
  if(!next)return;
  event.preventDefault();event.stopImmediatePropagation();
  panel.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});
  const base=location.pathname.replace(/^\/(?:zh-hant|en|ja)(?=\/|$)/,'')||'/';
  location.href=window.SiteLang?window.SiteLang.languageUrl(next):(next==='zh'?'':next==='zh-Hant'?'/zh-hant':'/'+next)+base+location.search+location.hash;
}
panel?.addEventListener('click',navigate,true);
panel?.addEventListener('keydown',navigate,true);
