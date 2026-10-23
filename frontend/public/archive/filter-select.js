(() => {
  'use strict';
  const controls = [];
  let opened;
  const text = option => {
    const match = option.textContent.trim().match(/^(.*?)\s*\((\d+)\)$/);
    return match ? [match[1], match[2]] : [option.textContent.trim(), ''];
  };
  const content = (node, option) => {
    const [name, count] = text(option);
    node.replaceChildren();
    const title = document.createElement('span');
    title.className = 'filter-option-name'; title.textContent = name; node.append(title);
    if (count) { const badge = document.createElement('span'); badge.className = 'filter-option-count'; badge.textContent = count; node.append(badge); }
  };
  function close(focus = false) {
    if (!opened) return;
    const control = opened; opened = null;
    control.panel.hidden = true; control.button.setAttribute('aria-expanded', 'false');
    control.button.removeAttribute('aria-activedescendant');
    if (focus) control.button.focus();
  }
  function active(control, index, direction = 1) {
    const options = [...control.panel.children];
    index = Math.max(0, Math.min(index, options.length - 1));
    while (control.select.options[index]?.disabled) index += direction;
    if (index < 0 || index >= options.length) return;
    control.index = index;
    options.forEach((option, i) => option.classList.toggle('is-active', i === control.index));
    control.button.setAttribute('aria-activedescendant', options[control.index].id);
    const item = options[control.index], panel = control.panel;
    if (item.offsetTop < panel.scrollTop) panel.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > panel.scrollTop + panel.clientHeight) panel.scrollTop = item.offsetTop + item.offsetHeight - panel.clientHeight;
  }
  function sync(control) {
    const selected = [...control.select.selectedOptions].filter(option => option.value);
    const option = selected.length ? {textContent:selected.map(option=>text(option)[0]).join(' + ')} : control.select.options[0];
    content(control.value, control.select.multiple ? option : control.select.selectedOptions[0] || control.select.options[0]);
    control.button.setAttribute('aria-label', control.select.getAttribute('aria-label'));
    control.button.title = control.value.textContent;
    [...control.panel.children].forEach((item,index)=>item.setAttribute('aria-selected',String(control.select.options[index].selected)));
  }
  function open(control) {
    close(); opened = control; sync(control);
    control.panel.replaceChildren();
    [...control.select.options].forEach((option, index) => {
      const item = document.createElement('div');
      item.id = control.panel.id + '-' + index;
      item.className = 'filter-option'; item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.setAttribute('aria-disabled', String(option.disabled));
      content(item, option);
      const check = document.createElement('span'); check.className = 'filter-option-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true'); item.append(check);
      item.addEventListener('pointermove', () => { if (!option.disabled) active(control, index); });
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', () => choose(control, index));
      control.panel.append(item);
    });
    const rect = control.button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, control.select.name === 'character' ? 250 : 180), innerWidth - 24);
    const bottomNav = document.querySelector('.mobile-bottom');
    const bottom = bottomNav?.getClientRects().length ? bottomNav.getBoundingClientRect().top : innerHeight;
    const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
    const below = bottom - rect.bottom - 12, above = rect.top - Math.max(12,top + 8);
    const up = below < 240 && above > below;
    const height = Math.min(332, up ? above : below);
    SiteComponents.popover(control.panel, {width, height:Math.max(90,height), left:Math.max(12,Math.min(rect.left,innerWidth-width-12)), top:up?null:rect.bottom+8, bottom:up?innerHeight-rect.top+8:null});
    control.panel.hidden = false; control.button.setAttribute('aria-expanded', 'true');
    active(control, control.select.selectedIndex);
  }
  function choose(control, index) {
    if (control.select.options[index].disabled) return;
    if (control.select.multiple) {
      const option = control.select.options[index];
      if (!option.value) [...control.select.options].forEach(entry=>entry.selected=!entry.value);
      else {
        option.selected = !option.selected;
        control.select.options[0].selected = ![...control.select.selectedOptions].some(entry=>entry.value);
      }
      sync(control);
    } else { control.select.selectedIndex = index; sync(control); close(true); }
    control.select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  document.querySelectorAll('#filter-form select').forEach(select => {
    const wrapper = document.createElement('div'); wrapper.className = 'filter-select'; wrapper.dataset.filter = select.name;
    select.before(wrapper); wrapper.append(select);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'filter-select-button';
    button.setAttribute('role', 'combobox'); button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span'); value.className = 'filter-select-value'; button.append(value);
    const arrow = document.createElement('span'); arrow.className = 'filter-select-arrow'; arrow.setAttribute('aria-hidden', 'true'); button.append(arrow);
    wrapper.append(button);
    const panel = document.createElement('div'); panel.id = 'filter-options-' + select.name; panel.className = 'filter-select-menu'; panel.hidden = true;
    panel.setAttribute('role', 'listbox'); panel.setAttribute('aria-label', select.getAttribute('aria-label')); document.body.append(panel);
    button.setAttribute('aria-controls', panel.id);
    if (select.hasAttribute('aria-describedby')) button.setAttribute('aria-describedby',select.getAttribute('aria-describedby'));
    if (select.multiple) panel.setAttribute('aria-multiselectable','true');
    const control = { select, button, value, panel, index: 0, typed: '', typedAt: 0 }; controls.push(control);
    sync(control); select.hidden = true;
    select.addEventListener('change', () => sync(control));
    button.addEventListener('click', () => opened === control ? close() : open(control));
    button.addEventListener('keydown', event => {
      const isOpen = opened === control;
      if (event.key === 'Escape') { if (isOpen) { event.preventDefault(); close(true); } return; }
      if (event.key === 'Tab') { close(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        if (!isOpen) { open(control); if (event.key === 'Home') active(control, 0); if (event.key === 'End') active(control, select.options.length - 1); return; }
        if (event.key === 'Enter' || event.key === ' ') choose(control, control.index);
        else active(control, event.key === 'Home' ? 0 : event.key === 'End' ? select.options.length - 1 : control.index + (event.key === 'ArrowDown' ? 1 : -1), event.key === 'ArrowUp' ? -1 : 1);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); if (!isOpen) open(control);
        const now = Date.now(); control.typed = (now - control.typedAt > 600 ? '' : control.typed) + event.key.toLocaleLowerCase(); control.typedAt = now;
        const index = [...select.options].findIndex(option => !option.disabled && text(option)[0].toLocaleLowerCase().startsWith(control.typed));
        if (index >= 0) active(control, index);
      }
    });
  });
  document.addEventListener('pointerdown', event => { if (opened && !opened.button.contains(event.target) && !opened.panel.contains(event.target)) close(); });
  document.addEventListener('focusin', event => { if (opened && event.target !== opened.button && !opened.panel.contains(event.target)) close(); });
  document.addEventListener('click', event => { if (event.target.closest('[data-reset]')) queueMicrotask(() => controls.forEach(sync)); });
  document.addEventListener('site:langchange', () => { close(); controls.forEach(sync); });
  document.addEventListener('archive:filter-sync', () => controls.forEach(sync));
  window.addEventListener('resize', () => close());
  window.addEventListener('scroll', event => { if (opened && !opened.panel.contains(event.target)) close(); }, true);
})();
