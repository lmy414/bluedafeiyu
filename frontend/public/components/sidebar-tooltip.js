export function installSidebarTooltip() {
  const sidebar = document.querySelector('#sidebar');
  if (!sidebar) return;
  const tip = document.createElement('div');
  tip.id = 'sidebar-nav-tooltip'; tip.className = 'sidebar-nav-tooltip'; tip.role = 'tooltip'; tip.hidden = true;
  document.body.append(tip);
  let active, previous;
  const hide = () => {
    if(active){if(previous === null)active.removeAttribute('aria-describedby');else active.setAttribute('aria-describedby',previous);}
    active = null; tip.hidden = true;
  };
  const show = target => {
    const link = target.closest('a,button');
    if (!link || !sidebar.contains(link) || !matchMedia('(min-width:761px)').matches || !document.body.classList.contains('sidebar-collapsed')) return;
    hide(); active = link; previous = link.getAttribute('aria-describedby');
    tip.textContent = link.getAttribute('aria-label') || link.querySelector('span')?.textContent.trim() || link.title || link.textContent.trim();
    tip.hidden = false;
    const rect = link.getBoundingClientRect();
    SiteComponents.tooltip(tip, sidebar.getBoundingClientRect().right + 12, Math.max(8,Math.min(innerHeight-tip.offsetHeight-8,rect.top+(rect.height-tip.offsetHeight)/2)));
    link.setAttribute('aria-describedby',[previous,tip.id].filter(Boolean).join(' '));
  };
  sidebar.addEventListener('pointerover',event=>show(event.target));
  sidebar.addEventListener('pointerout',event=>{if(active&&!active.contains(event.relatedTarget))hide();});
  sidebar.addEventListener('focusin',event=>show(event.target));
  sidebar.addEventListener('focusout',hide);
  sidebar.querySelector('[data-sidebar-collapse]')?.addEventListener('click',hide);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
  window.addEventListener('resize',hide);
  document.addEventListener('scroll',hide,true);
}
