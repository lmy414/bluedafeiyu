import { useState } from 'react';
import { ErrorText, Pagination, Panel, RecordDetails, Results, SearchForm, SelectField, Status, Table, useToast } from '../components/ui';
import { adminApi, recordPath } from '../lib/api';
import { useList, useMutation, useResource } from '../lib/hooks';
import { creatorStatuses, editorialProgress, options, safeUrl, time, videoStatuses } from '../lib/models';
import type { Creator, Video } from '../lib/models';

const pageSize = 20;

function Creators() {
  const [page, setPage] = useState(1);
  const [q, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const list = useList<Creator>('/creators', { q, status, page, pageSize }, 30_000);
  const mutation = useMutation();
  const notify = useToast();

  function act(row: Creator, action: 'pause' | 'resume' | 'sync') {
    const message = { pause: '已暂停同步', resume: '已恢复同步', sync: '已安排一次同步' }[action];
    void mutation.run(() => adminApi(`${recordPath('creators', row.id)}/${action}`, { method: 'POST' }), () => {
      notify(message);
      list.reload();
    });
  }

  return <Panel title="登记作者" action={<button onClick={list.reload}>刷新</button>}>
    <SearchForm label="搜索作者" onSearch={value => { setQuery(value); setPage(1); }}>
      <SelectField label="同步状态" choices={options(creatorStatuses)} empty="全部状态" value={status} onChange={value => { setStatus(value); setPage(1); }} />
    </SearchForm>
    <ErrorText message={mutation.error} />
    <Results state={list}><Table label="B 站登记作者" columns={['作者', '状态', '最近同步', '错误', '操作']}>
      {list.rows.map(row => {
        const name = row.name || row.uid;
        const homepage = safeUrl(row.homepage);
        return <tr key={row.id}><th scope="row">{homepage ? <a href={homepage} target="_blank" rel="noreferrer">{name}</a> : name}<small className="mono">UID {row.uid}</small></th>
          <td><Status value={row.status} labels={creatorStatuses} />{row.syncPage !== undefined && <small className="mono">第 {row.syncPage} 页</small>}<RecordDetails label="同步任务" value={editorialProgress(row.syncLease)} /></td>
          <td className="mono">{time(row.lastSyncedAt)}{row.retryAt && <small>重试 {time(row.retryAt)}</small>}</td>
          <td className="error-cell">{typeof row.error === 'string' ? row.error : row.error ? <RecordDetails label="错误详情" value={row.error} /> : '—'}</td>
          <td><div className="actions">{row.status === 'paused' ? <button disabled={mutation.busy} aria-label={`恢复 ${name}`} onClick={() => act(row, 'resume')}>恢复</button> : <button disabled={mutation.busy} aria-label={`暂停 ${name}`} onClick={() => act(row, 'pause')}>暂停</button>}
            <button disabled={mutation.busy || row.status === 'paused'} aria-label={`立即同步 ${name}`} onClick={() => act(row, 'sync')}>立即同步</button></div></td></tr>;
      })}
    </Table></Results>
    <Pagination page={page} pageSize={pageSize} data={list.data} onPage={setPage} />
  </Panel>;
}

function VideoReview() {
  const [page, setPage] = useState(1);
  const [q, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [id, select] = useState<string>();
  const list = useList<Video>('/videos', { q, status, page, pageSize });
  const detail = useResource<Video>(id ? recordPath('videos', id) : null);
  const row = detail.data ?? list.rows.find(video => video.id === id);
  const mutation = useMutation();
  const notify = useToast();

  function act(video: Video, action: 'hide' | 'restore') {
    void mutation.run(() => adminApi(`${recordPath('videos', video.id)}/${action}`, { method: 'POST' }), () => {
      notify(action === 'hide' ? '视频已下架' : '视频已恢复');
      list.reload();
      detail.reload();
    });
  }

  return <>
    <Panel title="视频审核" action={<button onClick={list.reload}>刷新</button>}>
      <SearchForm label="搜索视频或 BV 号" onSearch={value => { setQuery(value); setPage(1); }}>
        <SelectField label="审核状态" choices={options(videoStatuses)} empty="全部状态" value={status} onChange={value => { setStatus(value); setPage(1); }} />
      </SearchForm>
      <Results state={list}><Table label="视频审核" columns={['视频', '作者标识', '状态', '登记时间']}>
        {list.rows.map(video => <tr key={video.id}><th scope="row"><button className="text-button" onClick={() => select(video.id)}>{video.title || video.bvid}</button><small className="mono">{video.bvid}</small></th>
          <td className="mono">{video.creatorId}</td><td><Status value={video.status} labels={videoStatuses} /></td><td className="mono">{time(video.createdAt)}</td></tr>)}
      </Table></Results>
      <Pagination page={page} pageSize={pageSize} data={list.data} onPage={setPage} />
    </Panel>
    {row && <Panel key={row.id} focus title={row.title || row.bvid} action={<button onClick={() => select(undefined)}>收起</button>}>
      <div className="panel-body stack"><div className="actions"><Status value={row.status} labels={videoStatuses} /><a href={`https://www.bilibili.com/video/${encodeURIComponent(row.bvid)}`} target="_blank" rel="noreferrer">查看 B 站视频</a></div>
        <h3>AI 审核理由</h3><p className="preserve">{String(row.review?.reason ?? row.review?.reasoning ?? row.review?.summary ?? '暂无审核理由')}</p>
        <RecordDetails label="审核证据与译文" value={row.review} />
        <ErrorText message={mutation.error || detail.error} />
        <div className="actions">{row.status === 'approved' && <button className="quiet-danger" disabled={mutation.busy} onClick={() => act(row, 'hide')}>下架视频</button>}
          {row.status === 'hidden' && <button disabled={mutation.busy} onClick={() => act(row, 'restore')}>恢复视频</button>}</div>
      </div>
    </Panel>}
  </>;
}

export function VideosPage() {
  const [section, setSection] = useState<'creators' | 'videos'>('creators');
  return <>
    <div className="segment" aria-label="作者与视频" role="group">
      <button aria-pressed={section === 'creators'} onClick={() => setSection('creators')}>登记作者</button>
      <button aria-pressed={section === 'videos'} onClick={() => setSection('videos')}>视频审核</button>
    </div>
    {section === 'creators' ? <Creators /> : <VideoReview />}
  </>;
}
