import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Page } from '../lib/models';

export { UiSelect as SelectField } from './UiSelect';

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ message: string; id: number }>();
  const popover = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const liveId = useId();
  const notify = (message: string) => setNotice(previous => ({ message, id: (previous?.id ?? 0) + 1 }));

  useEffect(() => {
    const node = popover.current;
    if (notice && node?.showPopover && !node.matches(':popover-open')) node.showPopover();
  }, [notice]);

  return <ToastContext value={notify}>
    {children}
    <div id={liveId} ref={popover} className="toast" popover="manual" hidden={!notice} role="region" aria-label="操作反馈">
      <span key={notice?.id} aria-hidden="true">{notice?.message}</span>
      <button type="button" popoverTarget={liveId} popoverTargetAction="hide" onFocus={event => {
        const related = event.relatedTarget;
        if (related instanceof HTMLElement && !popover.current?.contains(related)) previousFocus.current = related;
      }} onClick={() => {
        const node = popover.current;
        if (node?.hidePopover && node.matches(':popover-open')) node.hidePopover();
        setNotice(undefined);
        if (previousFocus.current?.isConnected) previousFocus.current.focus();
        previousFocus.current = null;
      }}>关闭</button>
    </div>
    <div className="sr-only" role="status" aria-atomic="true"><span key={notice?.id}>{notice?.message}</span></div>
  </ToastContext>;
}

export function useToast() {
  return useContext(ToastContext);
}

export function ErrorText({ message }: { message?: string }) {
  return <div className={message ? 'error' : 'sr-only'} role="alert">{message}</div>;
}

export function Panel({ title, action, children, focus = false }: { title: string; action?: ReactNode; children: ReactNode; focus?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focus) heading.current?.focus(); }, [focus]);
  return <section className="panel"><div className="panel-heading"><h2 ref={heading} tabIndex={focus ? -1 : undefined}>{title}</h2>{action}</div>{children}</section>;
}

export function Status({ value, labels }: { value?: string | boolean; labels?: Record<string, string> }) {
  const key = String(value ?? 'unknown');
  const good = /^(active|published|approved|completed|sent|succeeded|ok|healthy|up|true)$/.test(key);
  const bad = /^(hidden|removed|deleted|failed|rejected|auto_rejected|error|down|unhealthy|unavailable|revoked|false)$/.test(key);
  const text = value === true ? '正常' : value === false ? '异常' : labels?.[key] ?? value ?? '未知';
  return <span className={`status ${good ? 'good' : bad ? 'bad' : ''}`}>{text}</span>;
}

type FieldProps = {
  label: string; name: string; value?: string | number | null; required?: boolean; multiline?: boolean;
  type?: string; min?: number; max?: number; autoComplete?: string; placeholder?: string; hint?: string;
};

export function Field({ label, name, value, multiline, hint, ...props }: FieldProps) {
  const id = useId();
  const common = { id, name, defaultValue: value ?? '', required: props.required, placeholder: props.placeholder, 'aria-describedby': hint ? `${id}-hint` : undefined };
  return <div className={`field${multiline ? ' field-wide' : ''}`}><label htmlFor={id}>{label}</label>
    {hint && <small id={`${id}-hint`}>{hint}</small>}
    {multiline ? <textarea {...common} rows={3} /> : <input {...common} type={props.type} min={props.min} max={props.max} autoComplete={props.autoComplete} />}
  </div>;
}

export function RecordDetails({ label, value }: { label: string; value: unknown }) {
  if (value == null || (typeof value === 'object' && !Object.keys(value).length)) return null;
  return <details className="record-details"><summary>{label}</summary><pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></details>;
}

export function readForm(event: FormEvent<HTMLFormElement>): FormData {
  event.preventDefault();
  return new FormData(event.currentTarget);
}

export function fieldValue(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function lines(value: string): string[] {
  return [...new Set(value.split(/[\n,，]/).map(part => part.trim()).filter(Boolean))];
}

export function objectValue(form: FormData, key: string, label: string): Record<string, unknown> | null {
  const text = fieldValue(form, key);
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Show the field name rather than a browser-specific JSON parser message.
  }
  throw new Error(`${label}须为 JSON 对象`);
}

export function jsonText(value: unknown): string {
  return value == null ? '' : JSON.stringify(value, null, 2);
}

export function SearchForm({ label = '搜索', initial = '', onSearch, children }: { label?: string; initial?: string; onSearch: (value: string) => void; children?: ReactNode }) {
  const id = useId();
  return <form role="search" className="filters" aria-label={label} onSubmit={event => onSearch(fieldValue(readForm(event), 'q'))}>
    <div className="field filter-search"><div className="search-label"><label htmlFor={id}>{label}</label><small><kbd>/</kbd> 聚焦</small></div><input id={id} name="q" type="search" defaultValue={initial} data-search-target /></div>
    {children}<button type="submit">搜索</button>
  </form>;
}

export function Pagination<T>({ page, pageSize, data, onPage }: { page: number; pageSize: number; data?: Page<T>; onPage: (page: number) => void }) {
  const count = data?.total;
  const more = data?.hasMore ?? (count !== undefined ? page * pageSize < count : (data?.items.length ?? 0) >= pageSize);
  return <nav className="pagination" aria-label="分页">
    <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
    <span>第 <b>{page}</b> 页{count !== undefined && <> · 共 <b>{count}</b> 条</>}</span>
    <button type="button" disabled={!more} onClick={() => onPage(page + 1)}>下一页</button>
  </nav>;
}

export function Results({ state, empty = '没有符合条件的记录', children }: { state: { loading: boolean; error?: string; rows: unknown[]; reload: () => void }; empty?: string; children: ReactNode }) {
  if (state.loading) return <p className="empty">正在读取…</p>;
  return <>
    {state.error && <div className="feedback"><ErrorText message={state.error} /><button onClick={state.reload}>重试</button></div>}
    {state.rows.length ? children : !state.error && <p className="empty">{empty}</p>}
  </>;
}

export function Table({ label, columns, children }: { label: string; columns: (string | ReactNode)[]; children: ReactNode }) {
  type TableElement = { children?: ReactNode; role?: string };
  const caption = useId();
  const rows = Children.map(children, row => {
    if (!isValidElement<TableElement>(row) || row.type !== 'tr') return row;
    const cells = Children.map(row.props.children, (cell, index) => {
      if (!isValidElement<TableElement>(cell)) return cell;
      if (cell.type === 'th') return cloneElement(cell, { role: 'rowheader' });
      if (cell.type !== 'td') return cell;
      const heading = columns[index];
      return cloneElement(cell, { role: 'cell' }, typeof heading === 'string'
        ? <><span className="compact-cell-label" aria-hidden="true">{heading}</span><div className="cell-value">{cell.props.children}</div></>
        : cell.props.children);
    });
    return cloneElement(row, { role: 'row' }, cells);
  });

  return <div className="table-scroll" tabIndex={0} role="region" aria-labelledby={caption}>
    <table role="table">
      <caption className="sr-only" id={caption}>{label}</caption>
      <colgroup>{columns.map((column, index) => <col key={index} className={typeof column === 'string' ? undefined : 'selection-column'} />)}</colgroup>
      <thead role="rowgroup"><tr role="row">
        {columns.map((column, index) => <th scope="col" role="columnheader" key={index}>{column}</th>)}
      </tr></thead>
      <tbody role="rowgroup">{rows}</tbody>
    </table>
  </div>;
}

export function ConfirmDialog({ title, description, label, onCancel, onConfirm }: {
  title: string; description: string; label: string; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) {
      node.returnValue = '';
      cancel.current?.setAttribute('autofocus', '');
      node.showModal();
    }
  }, []);
  return <dialog ref={dialog} aria-labelledby={id} aria-describedby={`${id}-message`} onClose={event => {
    const confirmed = event.currentTarget.returnValue === 'confirm';
    event.currentTarget.returnValue = '';
    onCancel();
    if (confirmed) onConfirm();
  }}>
    <h1 id={id}>{title}</h1><p id={`${id}-message`}>{description}</p>
    <form method="dialog" className="actions dialog-actions">
      <button ref={cancel} value="cancel">取消</button><button className="danger" value="confirm">{label}</button>
    </form>
  </dialog>;
}
