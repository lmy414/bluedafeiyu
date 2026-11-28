import { useState } from 'react';
import { ConfirmDialog, ErrorText, Field, Pagination, Panel, RecordDetails, Results, SearchForm, SelectField, Status, Table, fieldValue, readForm, useToast } from '../components/ui';
import { adminApi, recordPath } from '../lib/api';
import { useList, useMutation } from '../lib/hooks';
import { jobStatuses, options, time } from '../lib/models';
import type { AuditEvent, Bot, BulkJob } from '../lib/models';

const pageSize = 25;

function Bots() {
  const list = useList<Bot>('/bots');
  const mutation = useMutation();
  const notify = useToast();
  const [secret, setSecret] = useState('');
  const [confirmation, confirm] = useState<{ action: 'rotate' | 'revoke'; row: Bot }>();

  function finish(result: { apiKey?: string; token?: string }, message: string) {
    setSecret(result?.apiKey ?? result?.token ?? '');
    notify(message);
    list.reload();
  }

  return <Panel title="机器人 API Key" action={<button onClick={list.reload}>刷新</button>}>
    <form className="filters" onSubmit={event => {
      const formElement = event.currentTarget;
      const form = readForm(event);
      void mutation.run(() => adminApi<{ apiKey?: string; token?: string }>('/bots', { method: 'POST', body: { email: fieldValue(form, 'email') } }), result => {
        formElement.reset();
        finish(result, '机器人密钥已创建');
      });
    }}><Field label="机器人邮箱" name="email" type="email" placeholder="hermes@bot.local" required /><button className="primary" disabled={mutation.busy}>创建机器人密钥</button></form>
    {secret && <div className="secret stack"><label className="field">新 API Key（仅此处显示一次）<input className="mono" value={secret} readOnly onFocus={event => event.currentTarget.select()} /></label>
      <div className="actions"><button onClick={() => void mutation.run(() => navigator.clipboard.writeText(secret), () => notify('已复制 API Key'))}>复制</button><button onClick={() => setSecret('')}>关闭密钥显示</button></div></div>}
    <ErrorText message={mutation.error} />
    <Results state={list}><Table label="机器人 API Key" columns={['机器人', '密钥状态', '最近使用', '操作']}>
      {list.rows.map(row => <tr key={row.id}><th scope="row">{row.email}</th><td><Status value={row.hasKey === undefined ? row.status : row.hasKey ? 'active' : 'revoked'} labels={{ active: '已启用', revoked: '已吊销' }} /></td>
        <td className="mono">{time(row.lastLoginAt)}</td><td><div className="actions">
          <button disabled={mutation.busy} aria-label={`重置 ${row.email} 的密钥`} onClick={() => confirm({ action: 'rotate', row })}>重置密钥</button>
          <button disabled={mutation.busy || row.hasKey === false || row.status === 'revoked'} className="quiet-danger" aria-label={`吊销 ${row.email} 的密钥`} onClick={() => confirm({ action: 'revoke', row })}>吊销</button>
        </div></td></tr>)}
    </Table></Results>
    {confirmation && <ConfirmDialog title={confirmation.action === 'rotate' ? '重置机器人密钥？' : '吊销机器人密钥？'} description={`${confirmation.row.email} 当前使用的密钥会立即失效。`}
      label={confirmation.action === 'rotate' ? '重置密钥' : '吊销密钥'} onCancel={() => confirm(undefined)} onConfirm={() => {
        const { action, row } = confirmation;
        void mutation.run(() => adminApi<{ apiKey?: string; token?: string }>(`${recordPath('bots', row.id)}/${action}`, { method: 'POST' }), result => finish(result, action === 'rotate' ? '机器人密钥已重置' : '机器人密钥已吊销'));
      }} />}
  </Panel>;
}

function BulkJobs() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const list = useList<BulkJob>('/bulk-jobs', { status, page, pageSize }, 10_000);
  return <Panel title="异步任务" action={<button onClick={list.reload}>刷新</button>}>
    <div className="filters"><SelectField label="任务状态" choices={options(jobStatuses)} empty="全部状态" value={status} onChange={value => { setStatus(value); setPage(1); }} /></div>
    <Results state={list}><Table label="后台异步任务" columns={['任务', '状态', '进度', '更新时间', '结果']}>
      {list.rows.map(row => {
        const done = row.progress?.completed ?? row.progress?.done ?? row.progress?.processed;
        const total = row.progress?.total;
        return <tr key={row.id}><th scope="row">{row.kind}<small className="mono">{row.id}</small></th><td><Status value={row.status} labels={jobStatuses} /></td>
          <td>{typeof done === 'number' && typeof total === 'number' && total > 0 && <div className="job-progress"><progress aria-label={`${row.kind} 完成进度`} max={total} value={done} /><small className="mono">{done} / {total}</small></div>}<RecordDetails label="进度详情" value={row.progress} /></td>
          <td className="mono">{time(row.updatedAt)}</td><td><RecordDetails label="查看任务结果" value={row.result} /></td></tr>;
      })}
    </Table></Results>
    <Pagination page={page} pageSize={pageSize} data={list.data} onPage={setPage} />
  </Panel>;
}

function Audit() {
  const [page, setPage] = useState(1);
  const [q, setQuery] = useState('');
  const [actorType, setActor] = useState('');
  const list = useList<AuditEvent>('/audit-events', { q, actorType, page, pageSize });
  return <Panel title="全站审计" action={<button onClick={list.reload}>刷新</button>}>
    <SearchForm label="搜索实体或动作" onSearch={value => { setQuery(value); setPage(1); }}>
      <SelectField label="操作者类型" choices={options({ owner: '站长', hermes: 'Hermes', system: '系统' })} empty="全部类型" value={actorType} onChange={value => { setActor(value); setPage(1); }} />
    </SearchForm>
    <Results state={list}><Table label="全站审计日志" columns={['时间', '操作者', '实体', '操作', '变更']}>
      {list.rows.map(row => <tr key={row.id}><th scope="row" className="mono">{time(row.createdAt)}<small>{row.id}</small></th>
        <td>{row.actorType}<small className="mono">{row.actorId || '—'}</small></td><td>{row.entityType}<small className="mono">{row.entityId}</small></td><td>{row.action}</td><td><RecordDetails label="查看变更" value={row.diff} /></td></tr>)}
    </Table></Results>
    <Pagination page={page} pageSize={pageSize} data={list.data} onPage={setPage} />
  </Panel>;
}

export function LogsPage() {
  const [section, setSection] = useState<'bots' | 'jobs' | 'audit'>('bots');
  return <>
    <div className="segment" aria-label="日志模块" role="group">
      <button aria-pressed={section === 'bots'} onClick={() => setSection('bots')}>机器人 API Key</button>
      <button aria-pressed={section === 'jobs'} onClick={() => setSection('jobs')}>异步任务</button>
      <button aria-pressed={section === 'audit'} onClick={() => setSection('audit')}>审计日志</button>
    </div>
    {section === 'bots' ? <Bots /> : section === 'jobs' ? <BulkJobs /> : <Audit />}
  </>;
}
