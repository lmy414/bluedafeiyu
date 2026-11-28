import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorText, Field, Pagination, Panel, RecordDetails, Results, SelectField, Status, Table, fieldValue, readForm, useToast } from '../components/ui';
import { adminApi, recordPath } from '../lib/api';
import { useList, useMutation, useResource } from '../lib/hooks';
import { asObject, editorialProgress, options, rightStatuses, rightTypes, safeUrl, time } from '../lib/models';
import type { RightsRequest } from '../lib/models';

const pageSize = 20;
const labelFor = (type: string) => (rightTypes as Record<string, string>)[type] || type;
const corrections = {
  attribution: { key: 'author', label: '更正后的作者署名', type: 'text' },
  'source-correction': { key: 'sourceUrl', label: '更正后的来源链接', type: 'url' },
  'license-correction': { key: 'licenseNote', label: '更正后的授权说明', type: 'text' },
} as const;

function RequestEditor({ row, done, close }: { row: RightsRequest; done: () => void; close: () => void }) {
  const mutation = useMutation();
  const notify = useToast();
  const issue = row.issueData;
  const issueUrl = safeUrl(issue?.htmlUrl ?? issue?.html_url ?? issue?.url ?? (row.id.startsWith('github-rights-') ? `https://github.com/lmy414/ai-girl-stickers/issues/${encodeURIComponent(row.id.slice('github-rights-'.length))}` : undefined));
  const body = issue?.body ?? issue?.bodyText ?? issue?.text;
  const editable = !['approved', 'rejected', 'reply_queued', 'completed'].includes(row.status);
  const field = corrections[row.requestType as keyof typeof corrections];
  const draft = asObject(row.agentProgress?.draft) ?? asObject(issue?.correction);
  const proposed = field && (draft?.[field.key] ?? (field.key === 'licenseNote' ? asObject(draft?.license)?.note : asObject(draft?.origin)?.[field.key]));

  return <Panel focus title={typeof issue?.title === 'string' ? issue.title : `${labelFor(row.requestType)}申请 ${row.id}`} action={<button onClick={close}>收起</button>}>
    <div className="panel-body review-grid">
      <div className="stack">
        <div className="actions"><Status value={row.status} labels={rightStatuses} />{issueUrl && <a href={issueUrl} target="_blank" rel="noreferrer">打开 GitHub Issue</a>}{row.workId && <Link to={`/works?id=${encodeURIComponent(row.workId)}`}>查看关联作品</Link>}</div>
        <h3>Issue 原文</h3><p className="preserve issue-body">{typeof body === 'string' && body ? body : '暂无已同步的正文'}</p>
        <RecordDetails label="GitHub 评论" value={issue?.comments} />
        <RecordDetails label="申请人资料" value={row.requester} />
        <RecordDetails label="Hermes 处理进度" value={editorialProgress(row.agentProgress)} />
      </div>
      <div className="stack"><h3>人工处理</h3>
        {editable ? <form className="stack" onSubmit={event => {
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          const action = submitter instanceof HTMLButtonElement && submitter.value === 'reject' ? 'reject' : 'approve';
          const form = readForm(event);
          void mutation.run(async () => {
            const decisionNote = fieldValue(form, 'decisionNote');
            if (!decisionNote) throw new Error('请填写处理说明');
            const value = fieldValue(form, 'correction');
            if (action === 'approve' && field && !value) throw new Error(`请填写${field.label}`);
            const correction = action === 'approve' && field ? { [field.key]: value } : undefined;
            await adminApi(`${recordPath('requests', row.id)}/${action}`, { method: 'POST', body: { decisionNote, ...(correction ? { correction } : {}) } });
          }, () => { notify(action === 'approve' ? '申请已批准，已提交 Issue 回复与关闭' : '申请已拒绝，已提交 Issue 回复与关闭'); done(); });
        }}>
          {field && <Field label={field.label} name="correction" value={typeof proposed === 'string' ? proposed : ''} type={field.type} multiline={field.key === 'licenseNote'} />}
          <Field label="处理说明" name="decisionNote" value={row.decisionNote} required multiline />
          <div className="actions"><button className="primary" value="approve" disabled={mutation.busy}>批准并回复</button><button value="reject" className="quiet-danger" disabled={mutation.busy} formNoValidate>拒绝并回复</button></div>
        </form> : <p className="preserve">{row.decisionNote || '暂无处理说明'}</p>}
        <ErrorText message={mutation.error} />
      </div>
    </div>
  </Panel>;
}

export function RequestsPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [selected, select] = useState<string>();
  const list = useList<RightsRequest>('/requests', { requestType: type, status, page, pageSize });
  const detail = useResource<RightsRequest>(selected ? recordPath('requests', selected) : null);
  return <>
    <Panel title="维权申请" action={<button onClick={list.reload}>刷新</button>}>
      <div className="filters"><SelectField label="申请类型" choices={options(rightTypes)} value={type} empty="全部类型" onChange={value => { setType(value); setPage(1); }} />
        <SelectField label="处理状态" choices={options(rightStatuses)} value={status} empty="全部状态" onChange={value => { setStatus(value); setPage(1); }} /></div>
      <Results state={list}><Table label="维权申请" columns={['申请', '类型', '关联作品', '状态', '登记时间']}>
        {list.rows.map(row => <tr key={row.id}><th scope="row"><button className="text-button" onClick={() => select(row.id)}>{typeof row.issueData?.title === 'string' ? row.issueData.title : row.id}</button><small className="mono">{row.id}</small></th>
          <td>{labelFor(row.requestType)}</td><td className="mono">{row.workId || '—'}</td><td><Status value={row.status} labels={rightStatuses} /></td><td className="mono">{time(row.createdAt)}</td></tr>)}
      </Table></Results>
      <Pagination page={page} pageSize={pageSize} data={list.data} onPage={setPage} />
    </Panel>
    <ErrorText message={detail.error} />
    {detail.loading && <p className="empty">正在读取申请…</p>}
    {detail.data && <RequestEditor key={selected} row={detail.data} close={() => select(undefined)} done={() => { list.reload(); detail.reload(); }} />}
  </>;
}
