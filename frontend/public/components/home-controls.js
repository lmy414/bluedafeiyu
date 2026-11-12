
(function(){
  var app=document.getElementById('app');
  var collapse=document.getElementById('collapse');
  var menu=document.getElementById('menu');
  var theme=document.getElementById('theme');
  var lang=document.getElementById('lang');
  function syncCollapse(){
    var c=app.classList.contains('is-collapsed');
    collapse.setAttribute('aria-expanded',String(!c));
    collapse.setAttribute('aria-label',window.SiteLang?SiteLang.fmt(c?'d.home.expand':'d.home.collapse',c?'展开侧栏':'收起侧栏'):(c?'展开侧栏':'收起侧栏'));
  }
  collapse.addEventListener('click',function(){if(window.matchMedia('(max-width:1024px)').matches){app.classList.remove('menu-open');menu.setAttribute('aria-expanded','false');document.querySelector('.main').inert=false;menu.focus({preventScroll:true});return;}app.classList.toggle('is-collapsed');syncCollapse();});
  menu.addEventListener('click',function(){app.classList.toggle('menu-open');menu.setAttribute('aria-expanded',String(app.classList.contains('menu-open')));});
  app.addEventListener('click',function(e){
    if(app.classList.contains('menu-open')&&!e.target.closest('.sidebar')&&!e.target.closest('#menu')){app.classList.remove('menu-open');menu.setAttribute('aria-expanded','false');}
  });
  var picker=document.getElementById('language-picker');
  var panel=document.getElementById('language-options');
  var options=Array.from(panel.querySelectorAll('[role="option"]'));
  function closeLanguage(restore){panel.hidden=true;lang.setAttribute('aria-expanded','false');if(restore)lang.focus({preventScroll:true});}
  function openLanguage(index){panel.hidden=false;lang.setAttribute('aria-expanded','true');options[index||0].focus({preventScroll:true});}
  lang.addEventListener('click',function(){if(panel.hidden)openLanguage(0);else closeLanguage(true);});
  lang.addEventListener('keydown',function(e){if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();openLanguage(e.key==='ArrowUp'?options.length-1:0);}});
  function chooseLanguage(option){
    var path={'zh-CN':'/index.html','zh-TW':'/zh-hant/index.html','en':'/en/index.html','ja':'/ja/index.html'}[option.dataset.value];
    closeLanguage(true);if(path)location.href=path;
  }
  options.forEach(function(option,index){
    option.addEventListener('click',function(){chooseLanguage(option);});
    option.addEventListener('keydown',function(e){
      var next=index;
      if(e.key==='ArrowDown')next=(index+1)%options.length;
      else if(e.key==='ArrowUp')next=(index+options.length-1)%options.length;
      else if(e.key==='Home')next=0;
      else if(e.key==='End')next=options.length-1;
      else if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseLanguage(option);return;}
      else return;
      e.preventDefault();options[next].focus({preventScroll:true});
    });
  });
  document.addEventListener('pointerdown',function(e){if(!picker.contains(e.target))closeLanguage(false);});
  picker.addEventListener('focusout',function(e){if(!picker.contains(e.relatedTarget))closeLanguage(false);});
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&!panel.hidden){e.preventDefault();closeLanguage(true);}
    if(e.key==='Escape'&&app.classList.contains('menu-open')){app.classList.remove('menu-open');menu.setAttribute('aria-expanded','false');document.querySelector('.main').inert=false;menu.focus({preventScroll:true});}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.querySelector('.search input').focus();}
  });

  theme.setAttribute('aria-pressed',String(document.documentElement.getAttribute('data-theme')==='dark'));
  function syncLanguage(){
    var current=window.SiteLang?.current||'zh';
    var value={zh:'zh-CN','zh-Hant':'zh-TW',en:'en',ja:'ja'}[current];
    var label={zh:'简中','zh-Hant':'繁中',en:'EN',ja:'日本語'}[current];
    lang.querySelector('span').textContent=label;
    lang.setAttribute('aria-label',label);
    options.forEach(option=>option.setAttribute('aria-selected',String(option.dataset.value===value)));
    for(const option of document.querySelectorAll('[data-filter-picker="character"] [data-character-id]')) option.textContent=window.SiteLang?SiteLang.characterName(option.dataset.characterId,option.textContent):option.textContent;
    syncCollapse();
  }
  document.addEventListener('site:langchange',syncLanguage);
  syncLanguage();
})();


(function(){
var app=document.getElementById('app'),sidebar=document.querySelector('.sidebar'),main=document.querySelector('.main'),menu=document.getElementById('menu'),collapse=document.getElementById('collapse'),media=matchMedia('(max-width:1024px)');
function sync(){var mobile=media.matches,open=app.classList.contains('menu-open');sidebar.inert=mobile&&!open;main.inert=mobile&&open;menu.setAttribute('aria-expanded',String(mobile&&open));}
new MutationObserver(sync).observe(app,{attributes:true,attributeFilter:['class']});media.addEventListener('change',function(){app.classList.remove('menu-open');sync();});menu.addEventListener('click',function(){if(app.classList.contains('menu-open')){sidebar.inert=false;collapse.focus({preventScroll:true});}});
sidebar.addEventListener('keydown',function(e){if(e.key!=='Tab'||!media.matches||!app.classList.contains('menu-open'))return;var items=Array.from(sidebar.querySelectorAll('a,button')).filter(el=>el.offsetParent!==null),i=items.indexOf(document.activeElement);if(e.shiftKey&&i===0){e.preventDefault();items[items.length-1].focus();}else if(!e.shiftKey&&i===items.length-1){e.preventDefault();items[0].focus();}});sync();
})();
