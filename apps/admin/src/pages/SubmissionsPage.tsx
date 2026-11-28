import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WorkEditor, readWork } from '../components/editors';
import { ErrorText, Field, Pagination, Panel, RecordDetails, Results, SearchForm, SelectField, Status, Table, fieldValue, readForm, useToast } from '../components/ui';
import { adminApi, recordPath } from '../lib/api';
import { useList, useMutation, useResource } from '../lib/hooks';
import { asObject, editorialProgress, options, safeUrl, sources, submissionStates, time } from '../lib/models';
import type { I18n, Submission, SubmissionFields, Taxon, WorkFields } from '../lib/models';

const pageSize = 20;

function SubmissionEditor({ row, characters, categories, reload, close }: { row: Submission; characters: Taxon[]; categories: Taxon[]; reload: () => void; close: () => void }) {
  const mutation = useMutation();
  const notify = useToast();
  const path = recordPath('submissions', row.id);
  const draft = asObject(row.agentProgress?.draft) as SubmissionFields | undefined;
  const fields = { ...row.fields, ...draft, ...row.editorial };
  const i18n: I18n = { ...row.fields?.i18n, ...draft?.i18n, ...row.editorial?.i18n };
  const edit: WorkFields = {
    ...fields,
    name: fields.name ?? fields.title,
    primaryCharacterId: fields.primaryCharacterId ?? fields.characterId ?? fields.character ?? fields.characterIds?.[0],
    categoryId: fields.categoryId ?? fields.categoryIds?.[0],
    submitter: fields.submitter ?? (fields.credit ? { credit: fields.credit, name: fields.creditName, url: fields.creditUrl } : undefined),
    origin: fields.origin ?? row.origin,
    i18n,
  };
  const originalUrl = safeUrl(row.originalUrl);
  const previewUrl = originalUrl ?? safeUrl(row.previewUrl);
  const legacyPreview = asObject(row.review?.legacyPreview);
  const attachmentName = originalUrl ? '投稿原图' : legacyPreview ? '旧 CMS WebP 预览' : '预览图';
  const canProcess = row.state !== 'published';
  const draftReview = asObject(row.agentProgress?.review);
  const reason = row.review?.reason ?? row.review?.reasoning ?? row.review?.summary ?? draftReview?.reason;
  const stage = row.agentProgress?.stage;
  const onSuccess = (message: string) => {
    notify(message);
    close();
    reload();
  };

  return <Panel focus title={edit.name || row.id} action={<button onClick={close}>收起</button>}>
    <div className="review-grid panel-body">
      <div className="stack">
        {typeof legacyPreview?.note === 'string' && <p>{legacyPreview.note}</p>}
        {previewUrl ? <a className="preview checker draft-corners" href={previewUrl} target="_blank" rel="noreferrer"><img src={previewUrl} alt={`在新标签页打开${attachmentName}`} /></a> : <p className="empty">暂无原图预览</p>}
        {previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer">在新标签页打开{attachmentName}</a>}
        <dl className="status-rows"><div><dt>来源</dt><dd>{options(sources).find(item => item.id === row.source)?.name ?? row.source}</dd></div><div><dt>状态</dt><dd><Status value={row.state} labels={submissionStates} /></dd></div><div><dt>Hermes 阶段</dt><dd>{typeof stage === 'string' ? stage : '—'}</dd></div></dl>
        <section><h3>AI 审核理由</h3><p className="preserve">{typeof reason === 'string' ? reason : '暂无审核理由'}</p></section>
        <RecordDetails label="审核详情" value={Object.keys(row.review ?? {}).length ? row.review : draftReview} />
        <RecordDetails label="Hermes 处理进度" value={editorialProgress(row.agentProgress)} />
        {row.workId && <Link to={`/works?id=${encodeURIComponent(row.workId)}`}>查看关联作品</Link>}
      </div>
      <div className="stack">
        {canProcess && <>
          {!legacyPreview && <form className="stack" onSubmit={event => {
            const form = readForm(event);
            void mutation.run(async () => adminApi(`${path}/publish`, { method: 'POST', body: readWork(form, edit, true) }), () => onSuccess('投稿已收录上线'));
          }}><WorkEditor value={edit} characters={characters} categories={categories} publishing /><div className="actions"><button className="primary" disabled={mutation.busy}>收录并上线</button></div></form>}
          <form className="separated stack" onSubmit={event => {
            const form = readForm(event);
            void mutation.run(() => adminApi(`${path}/reject`, { method: 'POST', body: { reason: fieldValue(form, 'reason') } }), () => onSuccess('投稿已拒绝'));
          }}><Field label="拒绝理由" name="reason" required multiline /><div className="actions">
            <button className="quiet-danger" disabled={mutation.busy}>拒绝投稿</button>
            {!legacyPreview && <button type="button" disabled={mutation.busy} onClick={() => void mutation.run(() => adminApi(`${path}/retry`, { method: 'POST' }), () => onSuccess('投稿已提交重审'))}>触发重审</button>}
          </div></form>
        </>}
        <ErrorText message={mutation.error} />
      </div>
    </div>
  </Panel>;
}

export function SubmissionsPage() {
  const [params, setParams] = useSearchParams();
  const state = params.get('state') ?? '';
  const source = params.get('source') ?? '';
  const q = params.get('q') ?? '';
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string>();
  const list = useList<Submission>('/submissions', { page, pageSize, state, source, q });
  const characters = useList<Taxon>('/characters');
  const categories = useList<Taxon>('/categories');
  const detail = useResource<Submission>(selected ? recordPath('submissions', selected) : null);
  const taxonomyLoading = characters.loading || categories.loading;
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setPage(1);
    setParams(next);
  }

  return <>
    <Panel title="投稿队列" action={<button onClick={list.reload}>刷新</button>}>
      <SearchForm label="搜索投稿" initial={q} onSearch={value => filter('q', value)}>
        <SelectField label="审核状态" value={state} choices={options(submissionStates)} empty="全部状态" onChange={value => filter('state', value)} />
        <SelectField label="投稿渠道" value={source} choices={options(sources).filter(option => !['owner', 'blue-fish'].includes(option.id))} empty="全部渠道" onChange={value => filter('source', value)} />
      </SearchForm>
      <Results state={list}><Table label="投稿队列" columns={['投稿', '渠道', '状态', 'Hermes', '收到时间']}>
        {list.rows.map(row => <tr key={row.id}><th scope="row"><button className="text-button" onClick={() => setSelected(row.id)} aria-label={`查看 ${row.editorial?.name || row.fields?.name || row.id}`}>{row.editorial?.name || row.fields?.name || row.id}</button><small className="mono">{row.id}</small></th>
          <td>{options(sources).find(item => item.id === row.source)?.name ?? row.source}</td><td><Status value={row.state} labels={submissionStates} /></td><td>{String(row.agentProgress?.stage ?? '—')}</td><td className="mono">{time(row.createdAt)}</td></tr>)}
      </Table></Results>
      <Pagination page={page} pageSize={pageSize} data={list.data} onPage={setPage} />
    </Panel>
    {selected && <><ErrorText message={detail.error || characters.error || categories.error} />{(detail.loading || taxonomyLoading) && <p className="empty">正在读取投稿…</p>}
      {detail.data && !taxonomyLoading && <SubmissionEditor key={selected} row={detail.data} characters={characters.rows} categories={categories.rows} reload={list.reload} close={() => setSelected(undefined)} />}</>}
  </>;
}
