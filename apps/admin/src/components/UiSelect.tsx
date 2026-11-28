import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Option } from '../lib/models';
import { Icon } from './icons';

type UiSelectProps = {
  label: string;
  choices: Option[];
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  empty?: string;
  required?: boolean;
};

function positionMenu(menu: HTMLElement, trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? document.documentElement.clientWidth;
  const height = viewport?.height ?? document.documentElement.clientHeight;
  const right = left + width;
  const bottom = top + height;
  const padding = 8;
  const gap = 4;
  const above = rect.top - top - padding - gap;
  const below = bottom - rect.bottom - padding - gap;

  if (rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right) return false;
  const menuWidth = Math.min(Math.max(rect.width, 192), Math.max(0, width - padding * 2));
  const menuLeft = Math.max(left + padding, Math.min(rect.left, right - padding - menuWidth));
  menu.style.width = `${menuWidth}px`;
  const flip = below < Math.min(272, menu.scrollHeight + 2) && above > below;
  menu.style.left = `${menuLeft}px`;
  menu.style.maxHeight = `${Math.max(0, Math.min(272, flip ? above : below))}px`;
  menu.style.top = `${flip ? rect.top - gap - menu.getBoundingClientRect().height : rect.bottom + gap}px`;
  menu.style.visibility = 'visible';
  return true;
}

export function UiSelect({ label, name, value, onChange, choices, empty, required }: UiSelectProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const formControl = useRef<HTMLInputElement>(null);
  const scrollActive = useRef(true);
  const [localValue, setLocalValue] = useState<string>();
  const [activeIndex, setActiveIndex] = useState<number>();
  const [invalid, setInvalid] = useState(false);
  const selected = (onChange ? value : localValue ?? value) || (empty !== undefined ? '' : choices[0]?.id ?? '');
  const items = [
    ...(empty !== undefined ? [{ id: '', name: empty }] : []),
    ...(value && !choices.some(item => item.id === value) ? [{ id: value, name: value }] : []),
    ...choices,
  ];
  const focusedIndex = activeIndex === undefined ? undefined : Math.min(activeIndex, items.length - 1);
  const open = focusedIndex !== undefined && focusedIndex >= 0;
  const listId = `${id}-options`;

  useEffect(() => {
    const form = formControl.current?.form;
    if (!form) return;
    function reset(event: Event) {
      queueMicrotask(() => {
        if (event.defaultPrevented) return;
        setLocalValue(undefined);
        setActiveIndex(undefined);
        setInvalid(false);
      });
    }
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, []);

  useLayoutEffect(() => {
    const button = trigger.current;
    const menu = listbox.current;
    if (!open || !button || !menu) return;
    const anchor = button;
    const panel = menu;
    const viewport = window.visualViewport;

    function updatePosition(event?: Event) {
      if (event?.target instanceof Node && panel.contains(event.target)) return;
      if (!positionMenu(panel, anchor)) setActiveIndex(undefined);
    }

    function outside(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (!anchor.contains(event.target) && !panel.contains(event.target)) setActiveIndex(undefined);
    }

    updatePosition();
    const observer = new ResizeObserver(() => updatePosition());
    observer.observe(anchor);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    viewport?.addEventListener('resize', updatePosition);
    viewport?.addEventListener('scroll', updatePosition);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      viewport?.removeEventListener('resize', updatePosition);
      viewport?.removeEventListener('scroll', updatePosition);
    };
  }, [open, items.length]);

  useLayoutEffect(() => {
    if (!scrollActive.current || focusedIndex === undefined || focusedIndex < 0) return;
    const menu = listbox.current;
    const option = menu?.children[focusedIndex];
    if (!menu || !(option instanceof HTMLElement)) return;
    const menuBounds = menu.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < menuBounds.top + menu.clientTop) menu.scrollTop += optionBounds.top - menuBounds.top - menu.clientTop;
    else if (optionBounds.bottom > menuBounds.bottom - menu.clientTop) menu.scrollTop += optionBounds.bottom - menuBounds.bottom + menu.clientTop;
  }, [focusedIndex]);

  function openMenu(index = items.findIndex(item => item.id === selected)) {
    scrollActive.current = true;
    setActiveIndex(Math.max(0, index));
  }

  function commit(choice: Option | undefined) {
    if (!choice) return;
    setActiveIndex(undefined);
    if (choice.id) setInvalid(false);
    if (choice.id === selected) return;
    if (onChange) onChange(choice.id);
    else setLocalValue(choice.id);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    const { key } = event;
    if (key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(undefined);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (open) commit(items[focusedIndex]);
      else openMenu();
    } else if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault();
      if (key === 'Home') openMenu(0);
      else if (key === 'End') openMenu(items.length - 1);
      else if (open) openMenu(Math.min(items.length - 1, focusedIndex + (key === 'ArrowDown' ? 1 : -1)));
      else openMenu();
    } else if (key === 'Tab' && open) {
      commit(items[focusedIndex]);
    }
  }

  return <div className="field ui-select">
    <label htmlFor={id} id={`${id}-label`}>{label}</label>
    <button id={id} ref={trigger} className="ui-select-trigger" type="button" role="combobox"
      aria-labelledby={`${id}-label`} aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${focusedIndex}` : undefined}
      aria-required={required || undefined} aria-invalid={invalid && !selected ? true : undefined}
      aria-describedby={invalid && !selected ? `${id}-error` : undefined}
      onKeyDown={handleKey} onClick={event => {
        if (open) setActiveIndex(undefined);
        else {
          event.currentTarget.focus({ preventScroll: true });
          openMenu();
        }
      }} onBlur={event => {
        if (event.relatedTarget) setActiveIndex(undefined);
      }} disabled={items.length === 0}>
      <span className="ui-select-value">{items.find(item => item.id === selected)?.name ?? '暂无选项'}</span>
      <span className="ui-select-caret"><Icon name="chevronDown" /></span>
    </button>
    {/* Required fields use a text input so native constraint validation can block form submission. */}
    {(name || required) && <input ref={formControl} type={required ? 'text' : 'hidden'} className="ui-select-form-control" aria-hidden="true" tabIndex={-1}
      name={name} value={selected} autoComplete="off" required={required} onChange={() => {}}
      onInvalid={event => {
        event.preventDefault();
        setInvalid(true);
        const firstInvalid = event.currentTarget.form?.querySelector('input:invalid, textarea:invalid, select:invalid');
        if (firstInvalid === event.currentTarget) trigger.current?.focus();
      }} />}
    {invalid && !selected && <small id={`${id}-error`} className="ui-select-error" role="alert">请选择{label}</small>}
    {open && createPortal(<div className="ui-select-menu" ref={listbox} id={listId} role="listbox" aria-labelledby={`${id}-label`}>
      {items.map((item, index) => <div key={item.id} id={`${listId}-${index}`} className="ui-select-option" role="option"
        aria-selected={item.id === selected} data-active={index === focusedIndex || undefined}
        onMouseMove={() => { scrollActive.current = false; setActiveIndex(index); }}
        onMouseDown={event => event.preventDefault()} onClick={() => {
          trigger.current?.focus({ preventScroll: true });
          commit(item);
        }}>
        <span>{item.name}</span>
        {item.id === selected && <Icon name="check" />}
      </div>)}
    </div>, trigger.current?.closest('dialog') ?? document.body)}
  </div>;
}
