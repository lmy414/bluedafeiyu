import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkEditor, changedWorkFields, readWork } from '../components/editors';
import { ConfirmDialog, ErrorText, Field, Pagination, Panel, RecordDetails, Results, SearchForm, SelectField, Status, Table, fieldValue, readForm, useToast } from '../components/ui';
import { adminApi, recordPath } from '../lib/api';
import { useList, useMutation, useResource } from '../lib/hooks';
import { options, publicMedia, safeUrl, sources, thumbnail, time, workKinds, workStatuses } from '../lib/models';
import type { Taxon, Work } from '../lib/models';

const pageSize = 25;
type WorkAction = 'hide' | 'restore' | 'remove' | 'delete';
const labels: Record<WorkAction, string> = { hide: '隐藏', restore: '恢复', remove: '移除', delete: '彻底删除' };

function WorkDetail({ row, characters, categories, done, close, shortcut }: { row: Work; characters: Taxon[]; categories: Taxon[]; done: () => void; close: () => void; shortcut: boolean }) {
  const mutation = useMutation();
  const notify = useToast();
  const [confirmation, setConfirmation] = useState<'remove' | 'delete'>();
  const title = row.name || row.id;
  const path = recordPath('works', row.id);
  const original = !['removed', 'deleted'].includes(row.status) ? safeUrl(row.image?.originalUrl || row.originalUrl) || publicMedia(row.r2OriginalKey) : undefined;

  function act(action: WorkAction) {
    void mutation.run(() => adminApi(action === 'delete' ? path : `${path}/${action}`, { method: action === 'delete' ? 'DELETE' : 'POST' }), () => {
      notify(`已${labels[action]}「${title}」`);
      done();
    });
  }

  return <Panel focus title={title} action={<button onClick={close}>收起</button>}>
    <div className="panel-body stack">
      <div className="record-banner">
        {thumbnail(row) && <img className="thumb" src={thumbnail(row)} alt="" />}
        <div><strong className="mono">{row.id}</strong><small className="mono">{row.slug}</small></div>
        <Status value={row.status} labels={workStatuses} />
        {row.width && row.height ? <span className="mono">{row.width} × {row.height} {row.format?.toUpperCase()}</span> : null}
        {row.fileSize ? <span className="mono">{row.fileSize.toLocaleString()} B</span> : null}
        {original && <a href={original} target="_blank" rel="noreferrer">查看原图</a>}
        {shortcut && row.status === 'published' && <button className="quiet-danger" disabled={mutation.busy} onClick={() => act('hide')}>立即隐藏</button>}
      </div>
      {row.status === 'deleted' ? <p className="mono">SHA-256 {row.sha256 ?? '—'}</p> : <>
        <RecordDetails label="媒体与记录信息" value={{
          sha256: row.sha256, submissionId: row.submissionId, revision: row.revision,
          mimeType: row.mimeType, isAnimated: row.isAnimated,
          width: row.width, height: row.height, fileSize: row.fileSize,
          thumbWidth: row.thumbWidth, thumbHeight: row.thumbHeight, displayWidth: row.displayWidth, displayHeight: row.displayHeight,
          viewCount: row.viewCount, downloadCount: row.downloadCount, publishedAt: row.publishedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
        }} />
        <form className="stack" onSubmit={event => {
          const form = readForm(event);
          void mutation.run(async () => {
            const body = changedWorkFields(row, readWork(form, row));
            if (!Object.keys(body).length) throw new Error('作品资料没有改动');
            return adminApi(path, { method: 'PATCH', body });
          }, () => {
            notify('作品资料已保存');
            done();
          });
        }}>
          <WorkEditor value={row} characters={characters} categories={categories} />
          <div className="actions"><button className="primary" disabled={mutation.busy}>保存作品</button></div>
        </form>
        <div className="actions separated">
          {row.status === 'published' && <button disabled={mutation.busy} onClick={() => act('hide')}>隐藏</button>}
          {['hidden', 'removed'].includes(row.status) && <button disabled={mutation.busy} onClick={() => act('restore')}>恢复</button>}
          {row.status !== 'removed' && <button className="quiet-danger" disabled={mutation.busy} onClick={() => setConfirmation('remove')}>移除</button>}
          <button className="quiet-danger" disabled={mutation.busy} onClick={() => setConfirmation('delete')}>彻底删除</button>
        </div>
      </>}
      <ErrorText message={mutation.error} />
    </div>
    {confirmation && <ConfirmDialog title={`${labels[confirmation]}「${title}」？`} label={labels[confirmation]}
      description={confirmation === 'delete' ? '此操作会永久删除 R2 原图和派生图，保留 SHA-256 去重墓碑。作品无法恢复。' : '作品将从公开页面和接口移除，公开媒体将转入私有隔离。'}
      onCancel={() => setConfirmation(undefined)} onConfirm={() => act(confirmation)} />}
  </Panel>;
}

export function WorksPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id') ?? params.get('workId');
  const shortcut = params.get('action') === 'hide';
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const character = params.get('character') ?? '';
  const category = params.get('category') ?? '';
  const channel = params.get('channel') ?? '';
  const kind = params.get('kind') ?? '';
  const tag = params.get('tag') ?? '';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: '', ids: new Set() });
  const key = JSON.stringify([q, status, character, category, channel, kind, tag, page]);
  const selected = selection.key === key ? selection.ids : new Set<string>();
  const list = useList<Work>('/works', { q, status, character, category, channel, kind, tag, page, pageSize });
  const characters = useList<Taxon>('/characters');
  const categories = useList<Taxon>('/categories');
  const detail = useResource<Work>(selectedId ? recordPath('works', selectedId) : null);
  const taxonomyLoading = characters.loading || categories.loading;
  const bulk = useMutation();
  const notify = useToast();
  const toggle = (id: string) => setSelection({ key, ids: selected.has(id) ? new Set([...selected].filter(value => value !== id)) : new Set([...selected, id]) });

  function filter(field: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(field, value);
    else next.delete(field);
    if (field === 'id') {
      next.delete('workId');
      next.delete('action');
    }
    if (field !== 'page' && field !== 'id') next.delete('page');
    setParams(next);
  }

  return <>
    <Panel title="作品检索" action={<button onClick={list.reload}>刷新</button>}>
      <SearchForm label="搜索作品" initial={q} onSearch={value => filter('q', value)}>
        <SelectField label="状态" value={status} choices={options(workStatuses)} empty="全部状态" onChange={value => filter('status', value)} />
        <SelectField label="角色" value={character} choices={characters.rows} empty="全部角色" onChange={value => filter('character', value)} />
        <SelectField label="分类" value={category} choices={categories.rows} empty="全部分类" onChange={value => filter('category', value)} />
        <SelectField label="渠道" value={channel} choices={options(sources)} empty="全部渠道" onChange={value => filter('channel', value)} />
        <SelectField label="类型" value={kind} choices={options(workKinds)} empty="全部类型" onChange={value => filter('kind', value)} />
      </SearchForm>
      <form className="filters tag-filter" onSubmit={event => filter('tag', fieldValue(readForm(event), 'tag'))}>
        <Field label="精确标签" name="tag" value={tag} /><button>筛选标签</button>
        {tag && <button type="button" onClick={event => {
          event.currentTarget.form?.reset();
          filter('tag', '');
        }}>清除标签</button>}
      </form>
      <ErrorText message={characters.error || categories.error} />
      {selected.size > 0 && <form className="filters bulk-bar" onSubmit={event => {
        const form = readForm(event);
        const categoryId = fieldValue(form, 'categoryId');
        const primaryCharacterId = fieldValue(form, 'primaryCharacterId');
        const tags = fieldValue(form, 'tags');
        const replaceCharacters = form.has('replaceCharacters');
        const extraCharacters = form.getAll('bulkCharacterIds').flatMap(item => typeof item === 'string' ? [item] : []);
        const patch = {
          ...(categoryId ? { categoryId } : {}),
          ...(primaryCharacterId ? { primaryCharacterId } : {}),
          ...(replaceCharacters && primaryCharacterId ? { characterIds: [...new Set([primaryCharacterId, ...extraCharacters])] } : {}),
          ...(tags ? { tags: tags.split(/[,，]/).map(value => value.trim()).filter(Boolean) } : {}),
        };
        void bulk.run(async () => {
          if (replaceCharacters && !primaryCharacterId) throw new Error('替换关联角色时，请选择新的主角色');
          if (!Object.keys(patch).length) throw new Error('请选择至少一项要修改的字段');
          await adminApi('/works/bulk', { method: 'PATCH', body: { ids: [...selected], ...patch } });
        }, () => {
          notify(`已提交 ${selected.size} 件作品的修改`);
          setSelection({ key, ids: new Set() });
          list.reload();
          detail.reload();
        });
      }}><strong className="mono">已选 {selected.size} 件</strong>
        <SelectField name="categoryId" label="批量改分类" choices={categories.rows} empty="保留分类" />
        <SelectField name="primaryCharacterId" label="批量改主角色" choices={characters.rows} empty="保留主角色" />
        <Field label="批量替换标签" name="tags" placeholder="逗号分隔" />
        <button className="primary" disabled={bulk.busy}>应用修改</button><button type="button" onClick={() => setSelection({ key, ids: new Set() })}>取消选择</button>
        <details className="bulk-characters"><summary>批量替换关联角色</summary><div className="stack">
          <label><input type="checkbox" name="replaceCharacters" />替换已选作品的关联角色</label>
          <fieldset className="check-group"><legend>保留新主角色及以下角色</legend>
            {characters.rows.map(item => <label key={item.id}><input type="checkbox" name="bulkCharacterIds" value={item.id} />{item.name}</label>)}
          </fieldset>
        </div></details>
        <ErrorText message={bulk.error} />
      </form>}
      <Results state={list}><Table label="作品库" columns={[
        <label className="table-select-all"><input type="checkbox" aria-label="选择本页可编辑作品" checked={list.rows.length > 0 && list.rows.some(work => work.status !== 'deleted') && list.rows.every(work => work.status === 'deleted' || selected.has(work.id))} onChange={event => setSelection({ key, ids: new Set(event.target.checked ? list.rows.filter(work => work.status !== 'deleted').map(work => work.id) : []) })} /><span aria-hidden="true">选择本页</span></label>,
        '作品', '主角色与分类', '状态', '上线时间',
      ]}>
        {list.rows.map(work => <tr key={work.id}>
          <td><input type="checkbox" aria-label={`选择 ${work.name || work.id}`} disabled={work.status === 'deleted'} checked={selected.has(work.id)} onChange={() => toggle(work.id)} /></td>
          <th scope="row"><div className="work-cell">{thumbnail(work) && <img src={thumbnail(work)} className="thumb" loading="lazy" alt="" />}<div><button className="text-button" onClick={() => filter('id', work.id)}>{work.name || work.id}</button><small className="mono">{work.id}</small></div></div></th>
          <td>{characters.rows.find(item => item.id === work.primaryCharacterId)?.name ?? work.primaryCharacterId ?? '—'}<small>{categories.rows.find(item => item.id === work.categoryId)?.name ?? work.categoryId ?? '—'}</small></td>
          <td><Status value={work.status} labels={workStatuses} /></td><td className="mono">{time(work.publishedAt)}</td>
        </tr>)}
      </Table></Results>
      <Pagination page={page} pageSize={pageSize} data={list.data} onPage={value => filter('page', String(value))} />
    </Panel>
    {selectedId && <><ErrorText message={detail.error} />{(detail.loading || taxonomyLoading) && <p className="empty">正在读取作品…</p>}
      {detail.data && !taxonomyLoading && <WorkDetail key={`${selectedId}:${detail.data.revision ?? ''}`} row={detail.data} characters={characters.rows} categories={categories.rows}
        shortcut={shortcut} done={() => { list.reload(); detail.reload(); }} close={() => filter('id', '')} />}</>}
  </>;
}
