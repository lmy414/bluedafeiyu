import { renderIconSvg } from '../../../../packages/shared/src/design/icons';
import { characterLimit, characterQuery, parseCharacters } from '../lib/character-filter';

let activeSelect: { trigger: HTMLButtonElement; menu: HTMLElement; close: () => boolean | void; position: () => void } | undefined;
let nextId = 0;

function placeMenu(trigger: HTMLElement, menu: HTMLElement, close: () => void, minWidth: number, maxHeight: number, alignEnd = false) {
  const rect = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const startX = viewport?.offsetLeft ?? 0;
  const startY = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? document.documentElement.clientWidth;
  const height = viewport?.height ?? document.documentElement.clientHeight;
  const inset = 8;
  const gap = 6;
  if (rect.bottom < startY || rect.top > startY + height) { close(); return; }
  const menuWidth = Math.min(width - 2 * inset, Math.max(rect.width, minWidth));
  const endX = startX + width - inset;
  const left = alignEnd || rect.left + menuWidth > endX ? rect.right - menuWidth : rect.left;
  menu.style.width = `${menuWidth}px`;
  menu.style.left = `${Math.max(startX + inset, Math.min(left, endX - menuWidth))}px`;
  const below = startY + height - inset - rect.bottom - gap;
  const above = rect.top - startY - inset - gap;
  const opensUp = Math.min(menu.scrollHeight + 2, maxHeight) > below && above > below;
  menu.style.maxHeight = `${Math.max(0, Math.min(maxHeight, opensUp ? above : below))}px`;
  menu.style.top = `${opensUp ? rect.top - gap - menu.getBoundingClientRect().height : rect.bottom + gap}px`;
}

function enhance(select: HTMLSelectElement) {
  const id = `ui-select-${++nextId}`;
  const labels = [...select.labels ?? []];
  const alignEnd = select.name === 'sort';
  const wrap = document.createElement('div');
  wrap.className = 'ui-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = id;
  trigger.className = 'ui-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-expanded', 'false');
  if (select.required) trigger.setAttribute('aria-required', 'true');

  const label = document.createElement('span');
  label.className = 'ui-select-label';
  trigger.append(label);
  trigger.insertAdjacentHTML('beforeend', renderIconSvg('chevronDown', 'ui-select-chevron'));

  const menu = document.createElement('ul');
  menu.id = `${id}-menu`;
  menu.className = 'ui-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-labelledby', id);
  menu.hidden = true;
  trigger.setAttribute('aria-controls', menu.id);

  const error = document.createElement('span');
  error.id = `${id}-error`;
  error.className = 'ui-select-error';
  error.setAttribute('aria-live', 'polite');
  const description = [select.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' ');
  trigger.setAttribute('aria-describedby', description);

  const accessibleName = select.getAttribute('aria-label');
  const labelledBy = select.getAttribute('aria-labelledby');
  if (accessibleName) trigger.setAttribute('aria-label', accessibleName);
  if (labelledBy) trigger.setAttribute('aria-labelledby', labelledBy);
  for (const fieldLabel of labels) fieldLabel.htmlFor = id;
  select.after(wrap);
  wrap.append(select, trigger);
  wrap.after(error);
  select.hidden = true;
  document.body.append(menu);

  let activeIndex = -1;
  let enabled: number[] = [];
  let options: HTMLLIElement[] = [];

  function sync() {
    label.textContent = select.selectedOptions[0]?.label ?? '';
    trigger.disabled = select.matches(':disabled');
    if (select.validity.valid) {
      trigger.removeAttribute('aria-invalid');
      error.textContent = '';
    }
  }

  function position() {
    placeMenu(trigger, menu, close, alignEnd ? 164 : 190, 320, alignEnd);
  }

  function highlight(index: number) {
    options[activeIndex]?.removeAttribute('data-active');
    const option = options[index];
    if (!option) return;
    activeIndex = index;
    option.dataset.active = '';
    trigger.setAttribute('aria-activedescendant', option.id);
    const { offsetTop, offsetHeight } = option;
    if (offsetTop < menu.scrollTop) menu.scrollTop = offsetTop;
    if (offsetTop + offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = offsetTop + offsetHeight - menu.clientHeight;
    }
  }

  function open(initial?: 'first' | 'last') {
    if (select.matches(':disabled')) return;
    if (activeSelect?.close()) return;
    enabled = [];
    options = Array.from(select.options, (native, index) => {
      const option = document.createElement('li');
      option.id = `${id}-option-${index}`;
      option.className = 'ui-select-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(native.selected));
      if (native.matches(':disabled')) option.setAttribute('aria-disabled', 'true');
      else if (!native.hidden) enabled.push(index);
      option.hidden = native.hidden;
      const text = document.createElement('span');
      text.textContent = native.label;
      option.append(text);
      if (native.selected) option.insertAdjacentHTML('beforeend', renderIconSvg('check', 'ui-select-check'));
      option.addEventListener('click', () => choose(index));
      return option;
    });
    menu.replaceChildren(...options);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    activeSelect = { trigger, menu, close, position };
    position();
    highlight(initial === 'last' ? enabled.at(-1) ?? -1
      : initial === 'first' || !enabled.includes(select.selectedIndex) ? enabled[0] ?? -1 : select.selectedIndex);
  }

  function close() {
    menu.hidden = true;
    activeIndex = -1;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    if (activeSelect?.trigger === trigger) activeSelect = undefined;
  }

  function choose(index: number) {
    if (!enabled.includes(index)) return;
    close();
    trigger.focus({ preventScroll: true });
    if (select.selectedIndex === index) return;
    select.selectedIndex = index;
    sync();
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  trigger.addEventListener('click', (event) => {
    if (menu.hidden) open();
    else if (event.detail === 0) choose(activeIndex);
    else close();
  });
  trigger.addEventListener('keydown', (event) => {
    const { key } = event;
    if (key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      close();
    } else if (key === 'Tab') {
      close();
    } else if (key === 'Home' || key === 'End') {
      event.preventDefault();
      const first = key === 'Home';
      if (menu.hidden) open(first ? 'first' : 'last');
      else highlight((first ? enabled[0] : enabled.at(-1)) ?? -1);
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      if (menu.hidden) open();
      else {
        const next = enabled.indexOf(activeIndex) + (key === 'ArrowDown' ? 1 : -1);
        highlight(enabled[Math.max(0, Math.min(next, enabled.length - 1))] ?? -1);
      }
    } else if (key === 'Enter' && event.repeat) {
      event.preventDefault();
    }
  });
  menu.addEventListener('mousedown', (event) => {
    if (event.target instanceof Element && event.target.closest('.ui-select-option')) event.preventDefault();
  });
  select.addEventListener('change', sync);
  select.addEventListener('invalid', (event) => {
    event.preventDefault();
    error.textContent = select.validationMessage;
    trigger.setAttribute('aria-invalid', 'true');
    if (select.form?.querySelector('input:invalid, select:invalid, textarea:invalid') === select) trigger.focus();
  });
  select.form?.addEventListener('reset', () => window.setTimeout(sync, 0));
  window.addEventListener('pageshow', sync);
  sync();
}

function enhanceMultiple(select: HTMLSelectElement, form: HTMLFormElement) {
  const id = `ui-select-${++nextId}`;
  const accessibleName = select.getAttribute('aria-label') ?? '';
  const wrap = document.createElement('div');
  wrap.className = 'ui-select';
  const trigger = document.createElement('button');
  trigger.className = 'ui-select-trigger';
  trigger.type = 'button';
  trigger.id = id;
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-haspopup', 'dialog');
  const label = document.createElement('span');
  label.className = 'ui-select-label';
  trigger.append(label);
  trigger.insertAdjacentHTML('beforeend', renderIconSvg('chevronDown', 'ui-select-chevron'));
  const menu = document.createElement('section');
  menu.id = `${id}-menu`;
  menu.className = 'ui-select-menu ui-select-menu-multi';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-labelledby', id);
  menu.hidden = true;
  trigger.setAttribute('aria-controls', menu.id);
  const header = document.createElement('div');
  header.className = 'ui-select-multi-header';
  const hint = document.createElement('p');
  hint.className = 'ui-select-hint';
  hint.id = `${id}-hint`;
  hint.textContent = select.dataset.hint ?? '';
  menu.setAttribute('aria-describedby', hint.id);
  const count = document.createElement('output');
  count.className = 'mono ui-select-count';
  count.setAttribute('aria-label', select.dataset.selectedLabel ?? accessibleName);
  header.append(hint, count);
  const list = document.createElement('div');
  list.className = 'ui-select-list';
  list.setAttribute('role', 'grid');
  list.setAttribute('aria-label', accessibleName);
  const options = new Map(Array.from(select.options, option => [option.value, option]));
  const selected = () => [...select.selectedOptions].map(option => option.value);
  let draft = parseCharacters(new URLSearchParams({ character: select.dataset.order ?? '' }));
  const entries = [...options.values()].filter(option => !option.hidden && !option.disabled).map(option => {
    const cell = document.createElement('div');
    cell.setAttribute('role', 'gridcell');
    const tile = document.createElement('label');
    tile.className = 'ui-select-option';
    tile.title = option.label;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = option.value;
    checkbox.tabIndex = -1;
    const name = document.createElement('span');
    name.textContent = option.label;
    tile.append(checkbox, name);
    cell.append(tile);
    return { cell, checkbox };
  });
  const limit = document.createElement('p');
  limit.className = 'ui-select-limit';
  limit.setAttribute('role', 'status');
  limit.hidden = true;
  limit.textContent = select.dataset.limit ?? '';
  const actions = document.createElement('div');
  actions.className = 'ui-select-actions';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'console-btn';
  clear.textContent = select.dataset.clear ?? '';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'console-btn console-btn-primary';
  apply.textContent = select.dataset.apply ?? '';
  actions.append(clear, apply);
  menu.append(header, list, limit, actions);
  select.after(wrap);
  wrap.append(select, trigger, menu);
  select.hidden = true;

  const updateCount = () => { count.value = `${draft.length} / ${characterLimit}`; };
  let columns = 0;
  let tabStop: HTMLInputElement | undefined;
  function setTabStop(checkbox: HTMLInputElement) {
    if (tabStop) tabStop.tabIndex = -1;
    checkbox.tabIndex = 0;
    tabStop = checkbox;
  }
  function focusChoice(checkbox: HTMLInputElement) {
    setTabStop(checkbox);
    checkbox.focus({ preventScroll: true });
    checkbox.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function updateRows() {
    const next = Number(getComputedStyle(list).getPropertyValue('--select-columns')) || 2;
    if (columns === next) return;
    columns = next;
    const focused = document.activeElement;
    const rows = document.createDocumentFragment();
    for (let index = 0; index < entries.length; index += columns) {
      const row = document.createElement('div');
      row.className = 'ui-select-row';
      row.setAttribute('role', 'row');
      row.append(...entries.slice(index, index + columns).map(({ cell }) => cell));
      rows.append(row);
    }
    list.replaceChildren(rows);
    if (focused === tabStop) tabStop?.focus({ preventScroll: true });
  }
  const sync = () => {
    const values = selected();
    const order = [...draft.filter(id => values.includes(id)), ...values.filter(id => !draft.includes(id))];
    const names = order.map(id => options.get(id)!.label);
    const text = names[0] ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}` : accessibleName;
    label.textContent = text;
    trigger.title = names.join(', ');
    trigger.setAttribute('aria-label', names.length ? `${accessibleName}: ${names.join(', ')}` : accessibleName);
  };
  function dismiss() {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (activeSelect?.trigger === trigger) activeSelect = undefined;
  }
  function commit() {
    const previous = selected();
    dismiss();
    if (previous.length === draft.length && previous.every(id => draft.includes(id))) return false;
    for (const option of options.values()) option.selected = draft.includes(option.value);
    sync();
    select.dataset.order = draft.join(',');
    form.requestSubmit();
    return true;
  }
  const position = () => {
    updateRows();
    menu.style.maxHeight = '';
    placeMenu(trigger, menu, commit, 616, 520, true);
  };
  function open(last = false) {
    if (activeSelect?.close()) return;
    draft = parseCharacters(new URLSearchParams({ character: select.dataset.order ?? '' })).filter(id => options.get(id)?.selected);
    for (const id of selected()) if (!draft.includes(id)) draft.push(id);
    for (const { checkbox } of entries) checkbox.checked = draft.includes(checkbox.value);
    updateCount();
    limit.hidden = true;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    activeSelect = { trigger, menu, close: commit, position };
    position();
    if (menu.hidden) return;
    const entry = last ? entries.at(-1) : entries.find(({ checkbox }) => checkbox.checked) ?? entries[0];
    if (entry) focusChoice(entry.checkbox);
    else apply.focus({ preventScroll: true });
  }
  trigger.addEventListener('click', () => { if (menu.hidden) open(); else commit(); });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (menu.hidden) open(event.key === 'ArrowUp'); }
  });
  list.addEventListener('focusin', event => {
    if (event.target instanceof HTMLInputElement) setTabStop(event.target);
  });
  list.addEventListener('change', event => {
    if (!(event.target instanceof HTMLInputElement)) return;
    const checkbox = event.target;
    if (checkbox.checked && draft.length >= characterLimit) { checkbox.checked = false; limit.hidden = false; position(); return; }
    const wasLimited = !limit.hidden;
    limit.hidden = true;
    draft = checkbox.checked ? [...draft, checkbox.value] : draft.filter(id => id !== checkbox.value);
    updateCount();
    if (wasLimited) position();
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      trigger.focus({ preventScroll: true });
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    const index = entries.findIndex(({ checkbox }) => checkbox === event.target);
    if (index < 0) return;
    if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) entries[index]!.checkbox.click(); return; }
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, Home: -index, End: entries.length - 1 - index };
    const next = entries[index + (moves[event.key] ?? 0)];
    if (!next || next === entries[index]) return;
    event.preventDefault();
    focusChoice(next.checkbox);
  });
  apply.addEventListener('click', () => { if (!commit()) trigger.focus({ preventScroll: true }); });
  clear.addEventListener('click', () => { draft = []; if (!commit()) trigger.focus({ preventScroll: true }); });
  window.addEventListener('pageshow', sync);
  sync();
}

export function initializeSelects() {
  for (const select of document.querySelectorAll<HTMLSelectElement>('.inline-sort select, .submit-form select')) {
    if (select.multiple && select.name === 'character' && select.form) enhanceMultiple(select, select.form);
    else if (!select.multiple && select.size <= 1 && !select.hidden) enhance(select);
  }
  for (const form of document.querySelectorAll<HTMLFormElement>('[data-auto-filter]')) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = new URLSearchParams();
      for (const [name, value] of new FormData(form)) if (typeof value === 'string') data.append(name, value);
      const select = form.querySelector<HTMLSelectElement>('select[name="character"]');
      const selected = parseCharacters(data);
      const order = parseCharacters(new URLSearchParams({ character: select?.dataset.order ?? '' })).filter(id => selected.includes(id));
      for (const id of selected) if (!order.includes(id)) order.push(id);
      location.assign(form.action + characterQuery(data, order));
    });
  }
  function dismissOutside(event: Event) {
    if (activeSelect && event.target instanceof Node && !activeSelect.trigger.contains(event.target) && !activeSelect.menu.contains(event.target)) {
      if (activeSelect.close()) event.preventDefault();
    }
  }
  document.addEventListener('click', dismissOutside, { capture: true });
  document.addEventListener('focusin', event => {
    if (activeSelect?.trigger.getAttribute('role') === 'combobox') dismissOutside(event);
  });
  window.addEventListener('resize', () => activeSelect?.position());
  window.addEventListener('scroll', (event) => {
    if (activeSelect && !(event.target instanceof Node && activeSelect.menu.contains(event.target))) activeSelect.position();
  }, { capture: true, passive: true });
  window.visualViewport?.addEventListener('resize', () => activeSelect?.position());
  window.visualViewport?.addEventListener('scroll', () => activeSelect?.position());
}
