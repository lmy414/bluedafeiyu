import { useEffect, useRef, useState } from 'react';
import { safeHttpUrlSchema } from '@dafeiyu/shared';
import { UiSelect } from '../components/UiSelect';
import { ConfirmDialog, ErrorText, Field, Panel, Results, Status, Table, fieldValue, readForm, useToast } from '../components/ui';
import { adminApi } from '../lib/api';
import { useList, useMutation } from '../lib/hooks';
import { options } from '../lib/models';
import type { AdminEvent } from '../lib/models';

const eventStatuses = { active: '进行中', archived: '已归档', hidden: '隐藏' };
const statusOptions = options(eventStatuses);
const utc8Offset = 8 * 60 * 60 * 1000;
const eventTime = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: 'Etc/GMT-8',
});

function localEventTime(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp + utc8Offset).toISOString().slice(0, 16) : '';
}

function readEventTime(form: FormData, name: string, original?: string | null) {
  const value = fieldValue(form, name);
  if (!value) return null;
  if (original && value === localEventTime(original)) return original;
  return new Date(`${value}+08:00`).toISOString();
}

function readEventLink(form: FormData, name: string, label: string) {
  const value = fieldValue(form, name);
  if (!value || /^\/(?!\/)[^\s\\\p{Cc}]*$/u.test(value) || safeHttpUrlSchema.safeParse(value).success) return value;
  throw new Error(`${label}须使用 HTTP(S) 链接或以 / 开头的站内路径。`);
}

function readEvent(form: FormData, row?: AdminEvent): Omit<AdminEvent, 'id'> {
  const slug = fieldValue(form, 'slug');
  const title = fieldValue(form, 'title');
  const summary = fieldValue(form, 'summary');
  const status = fieldValue(form, 'status');
  const startsAt = readEventTime(form, 'startsAt', row?.startsAt);
  const endsAt = readEventTime(form, 'endsAt', row?.endsAt);
  const highlights = fieldValue(form, 'highlights').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) throw new Error('Slug 须由小写字母、数字和连字符组成，最多 64 字符。');
  if (!title || title.length > 200) throw new Error('请填写活动标题，最多 200 字符。');
  if (summary.length > 2000) throw new Error('活动摘要最多 2000 字符。');
  if (status !== 'active' && status !== 'archived' && status !== 'hidden') throw new Error('请选择活动状态。');
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new Error('截止时间不能早于开始时间。');
  if (highlights.length > 4) throw new Error('活动亮点最多填写 4 条，每行一条。');

  const coverSrc = readEventLink(form, 'cover', '海报图 URL');
  const previousCover = row?.payload?.cover?.src;
  if (!coverSrc && previousCover) throw new Error('请为已有海报填写替换地址。当前活动接口只支持替换海报。');

  return {
    slug, title, summary, status, startsAt, endsAt,
    payload: {
      body: fieldValue(form, 'body'),
      url: readEventLink(form, 'url', '活动链接'),
      exhibition: readEventLink(form, 'exhibition', '作品展链接'),
      repository: readEventLink(form, 'repository', '活动仓库链接'),
      ...(coverSrc && coverSrc !== previousCover ? { cover: { src: coverSrc } } : {}),
      popup: {
        enabled: form.has('popupEnabled'), version: fieldValue(form, 'version') || '1',
        badge: fieldValue(form, 'badge'), headline: fieldValue(form, 'headline'), description: fieldValue(form, 'description'), highlights,
        ctaLabel: fieldValue(form, 'ctaLabel'), ctaUrl: readEventLink(form, 'ctaUrl', '主按钮链接'),
        secondaryLabel: fieldValue(form, 'secondaryLabel'), secondaryUrl: readEventLink(form, 'secondaryUrl', '次按钮链接'),
      },
    },
  };
}

function EventTime({ value }: { value: string }) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? <time dateTime={value}>{eventTime.format(timestamp)}</time> : <span>{value}</span>;
}

function EventEditor({ row, busy, error, close, save }: {
  row?: AdminEvent;
  busy: boolean;
  error?: string;
  close: () => void;
  save: (form: FormData) => void;
}) {
  const payload = row?.payload;
  const popup = payload?.popup;
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorSummary.current?.focus();
  }, [error]);
  return <Panel focus title={row ? `编辑活动 ${row.title}` : '新建活动'} action={<button type="button" disabled={busy} onClick={close}>收起</button>}>
    <form method="post" className="panel-body event-editor" onSubmit={event => save(readForm(event))}>
      <fieldset className="form-grid event-fields" disabled={busy}>
        <legend>基础信息</legend>
        <Field label="Slug" name="slug" value={row?.slug} required hint="活动页面的路径标识，例如 design-2026。" />
        <Field label="标题" name="title" value={row?.title} required />
        <Field label="摘要" name="summary" value={row?.summary} multiline />
        <UiSelect label="状态" name="status" value={row?.status ?? 'active'} choices={statusOptions} />
        <Field label="活动链接" name="url" value={payload?.url} placeholder="https://… 或 /站内路径" />
        <Field label="开始时间（UTC+8）" name="startsAt" type="datetime-local" value={localEventTime(row?.startsAt)} />
        <Field label="截止时间（UTC+8）" name="endsAt" type="datetime-local" value={localEventTime(row?.endsAt)} />
        <Field label="正文说明" name="body" value={payload?.body} multiline />
        <Field label="海报图 URL" name="cover" value={payload?.cover?.src} placeholder="https://… 或 /站内路径"
          required={Boolean(payload?.cover?.src)} hint={payload?.cover?.src ? '填写新地址可替换现有海报。' : undefined} />
        <Field label="作品展链接" name="exhibition" value={payload?.exhibition} placeholder="https://… 或 /站内路径" />
        <Field label="活动仓库链接" name="repository" value={payload?.repository} placeholder="https://… 或 /站内路径" />
      </fieldset>
      <fieldset className="form-grid event-fields" disabled={busy}>
        <legend>首次访问弹窗模板配置</legend>
        <label className="event-popup-toggle field-wide"><input type="checkbox" name="popupEnabled" defaultChecked={popup?.enabled ?? true} />开放期间首次访问自动弹出</label>
        <Field label="弹窗角标" name="badge" value={popup?.badge} placeholder="设计征集进行中" />
        <Field label="弹窗版本号" name="version" value={popup?.version ?? '1'} hint="修改版本号可向已看过弹窗的访客重新提醒一次。" />
        <div className="field-wide"><Field label="弹窗标题" name="headline" value={popup?.headline} hint="留空沿用活动标题。" /></div>
        <Field label="弹窗简介" name="description" value={popup?.description} multiline hint="留空沿用活动摘要。" />
        <Field label="活动亮点" name="highlights" value={popup?.highlights?.join('\n')} multiline hint="每行一条，最多 4 条。" />
        <Field label="主按钮文案" name="ctaLabel" value={popup?.ctaLabel} />
        <Field label="主按钮链接" name="ctaUrl" value={popup?.ctaUrl} hint="留空则跳转到活动页。" />
        <Field label="次按钮文案" name="secondaryLabel" value={popup?.secondaryLabel} />
        <Field label="次按钮链接" name="secondaryUrl" value={popup?.secondaryUrl} placeholder="https://… 或 /站内路径" />
      </fieldset>
      {error && <div ref={errorSummary} tabIndex={-1}><ErrorText message={error} /></div>}
      <div className="actions"><button type="submit" className="primary" disabled={busy}>{busy ? '正在保存…' : '保存活动'}</button></div>
    </form>
  </Panel>;
}

export function EventsPage() {
  const list = useList<AdminEvent>(adminApi.events);
  const mutation = useMutation();
  const notify = useToast();
  const [editor, setEditor] = useState<AdminEvent | null>();
  const [deleting, setDeleting] = useState<AdminEvent>();
  const [errorScope, setErrorScope] = useState<'list' | 'editor'>();
  const editorLauncher = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editor !== undefined || mutation.busy) return;
    editorLauncher.current?.focus();
    editorLauncher.current = null;
  }, [editor, mutation.busy]);

  function openEditor(row: AdminEvent | null, launcher: HTMLButtonElement) {
    editorLauncher.current = launcher;
    setErrorScope(undefined);
    setEditor(row);
  }

  function closeEditor() {
    setErrorScope(undefined);
    setEditor(undefined);
  }

  function saveEvent(form: FormData) {
    setErrorScope('editor');
    void mutation.run(async () => {
      const body = readEvent(form, editor ?? undefined);
      if (editor) await adminApi.updateEvent(editor.id, body);
      else await adminApi.createEvent(body);
    }, () => {
      notify(editor ? '活动已保存' : '活动已创建');
      closeEditor();
      list.reload();
    });
  }

  function switchStatus(row: AdminEvent, status: AdminEvent['status'], disclosure: HTMLDetailsElement | null) {
    setErrorScope('list');
    void mutation.run(() => adminApi.updateEvent(row.id, { status }), () => {
      if (disclosure) {
        disclosure.open = false;
        disclosure.querySelector('summary')?.focus();
      }
      notify(`活动状态已设为${eventStatuses[status]}`);
      list.reload();
    });
  }

  function deleteEvent(row: AdminEvent) {
    setErrorScope('list');
    void mutation.run(() => adminApi.deleteEvent(row.id), () => {
      notify('活动已删除');
      list.reload();
    });
  }

  return <>
    <Panel title="活动列表" action={<button type="button" className="primary" disabled={mutation.busy} onClick={event => openEditor(null, event.currentTarget)}>新建活动</button>}>
      {errorScope === 'list' && mutation.error && <div className="feedback"><ErrorText message={mutation.error} /></div>}
      <Results state={list} empty="还没有站内活动"><Table label="活动列表" columns={['活动', '状态', '时间范围（UTC+8）', '首次弹窗', '操作']}>
        {list.rows.map(row => {
          const actionsDisabled = mutation.busy || editor?.id === row.id;
          const popupEnabled = row.payload?.popup?.enabled ?? true;
          const now = Date.now();
          const previewUnavailable = row.status === 'hidden' || (row.status === 'active' && row.startsAt && Date.parse(row.startsAt) > now
            && (!row.endsAt || Date.parse(row.endsAt) >= now));
          return <tr key={row.id}>
            <th scope="row">{row.title}<small className="mono">{row.slug}</small></th>
            <td><Status value={row.status} labels={eventStatuses} /></td>
            <td className="event-times">
              <div>开始 {row.startsAt ? <EventTime value={row.startsAt} /> : '不限'}</div>
              <div>截止 {row.endsAt ? <EventTime value={row.endsAt} /> : '不限'}</div>
            </td>
            <td className="event-popup-status"><Status value={popupEnabled ? 'active' : 'disabled'} labels={{ active: '已开启首次弹窗', disabled: '已关闭' }} /></td>
            <td>
              <div className="actions event-actions">
                <button type="button" className="text-button" aria-label={`编辑 ${row.title}`} disabled={mutation.busy} onClick={event => openEditor(row, event.currentTarget)}>编辑</button>
                <a href={`/?${new URLSearchParams({ 'preview-event-popup': row.slug })}`} target="_blank" rel="noreferrer">预览弹窗</a>
                <button type="button" className="text-button quiet-danger" aria-label={`删除 ${row.title}`} disabled={actionsDisabled} onClick={() => setDeleting(row)}>删除</button>
              </div>
              {previewUnavailable && <small>前台仅预览已公开的活动。</small>}
              <details className="event-status-actions"><summary>切换状态</summary>
                <div className="actions">
                  {(Object.keys(eventStatuses) as AdminEvent['status'][]).filter(status => status !== row.status).map(status =>
                    <button key={status} type="button" disabled={actionsDisabled} onClick={event => switchStatus(row, status, event.currentTarget.closest('details'))}>设为{eventStatuses[status]}</button>)}
                </div>
              </details>
            </td>
          </tr>;
        })}
      </Table></Results>
    </Panel>
    {editor !== undefined && <EventEditor key={editor?.id ?? ''} row={editor ?? undefined} busy={mutation.busy}
      error={errorScope === 'editor' ? mutation.error : undefined} close={closeEditor} save={saveEvent} />}
    {deleting && <ConfirmDialog title={`删除活动「${deleting.title}」？`} description="此操作会删除该活动及其弹窗配置。"
      label="删除活动" onCancel={() => setDeleting(undefined)} onConfirm={() => deleteEvent(deleting)} />}
  </>;
}
