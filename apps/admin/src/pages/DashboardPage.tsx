import { Link } from 'react-router-dom';
import { Icon } from '../components/icons';
import { ErrorText, Panel, Results, Status, Table, useToast } from '../components/ui';
import { adminApi, recordPath } from '../lib/api';
import { useMutation, useResource } from '../lib/hooks';
import { notificationStatuses, thumbnail, time, workStatuses } from '../lib/models';
import type { Dashboard } from '../lib/models';

export function DashboardPage() {
  const resource = useResource<Dashboard>('/dashboard', {}, 30_000);
  const hide = useMutation();
  const notify = useToast();
  const data = resource.data;
  const stats = [
    ['今日自动上线', data?.autoPublishedToday, '/works?status=published', 'check', 'blue'],
    ['本周自动上线', data?.autoPublishedThisWeek, '/works?status=published', 'clock', 'blue'],
    ['待审核', data?.pendingReview, '/submissions', 'submissions', 'green'],
    ['待人工', data?.needsManual, '/submissions?state=needs_manual', 'alert', 'amber'],
  ] as const;

  return <>
    <div className="stat-grid">{stats.map(([label, count, href, icon, tone]) => <Link to={href} key={label} className="stat">
      <span className="stat-heading"><span className="stat-badge" data-tone={tone}><Icon name={icon} /></span><span>{label}</span></span>
      <strong>{count?.toLocaleString('zh-CN') ?? '—'}</strong>
    </Link>)}</div>
    <div className="dashboard-grid">
      <Panel title="最近自动上线" action={<button onClick={resource.reload}>刷新</button>}>
        <ErrorText message={hide.error} />
        <Results state={{ ...resource, rows: data?.recentAutoPublished ?? [] }} empty="暂无自动上线的作品">
          <Table label="最近自动上线" columns={['作品', '上线时间', '状态', '操作']}>
            {data?.recentAutoPublished.map(work => <tr key={work.id}>
              <th scope="row"><div className="work-cell">{thumbnail(work) && <img className="thumb" src={thumbnail(work)} alt="" />}<div><Link to={`/works?id=${encodeURIComponent(work.id)}`}>{work.name || work.id}</Link><small className="mono">{work.id}</small></div></div></th>
              <td className="mono">{time(work.publishedAt)}</td><td><Status value={work.status} labels={workStatuses} /></td>
              <td>{work.status === 'published' && <button className="quiet-danger" aria-label={`立即隐藏 ${work.name || work.id}`} disabled={hide.busy} onClick={() => {
                void hide.run(() => adminApi(`${recordPath('works', work.id)}/hide`, { method: 'POST' }), () => {
                  notify(`已隐藏「${work.name || work.id}」`);
                  resource.reload();
                });
              }}>立即隐藏</button>}</td>
            </tr>)}
          </Table>
        </Results>
      </Panel>
      <div className="stack">
        <Panel title="服务状态"><dl className="status-rows"><div><dt>PostgreSQL</dt><dd><Status value={data?.health?.db} labels={{ ok: '正常', unavailable: '不可用' }} /></dd></div><div><dt>R2 媒体</dt><dd><Status value={data?.health?.r2} labels={{ ok: '正常', unavailable: '不可用' }} /></dd></div></dl></Panel>
        <Panel title="最近飞书通知">
          {data?.recentNotifications.length ? <ul className="notification-list">{data.recentNotifications.map(item => <li key={item.id}>
            <div><strong>{item.eventType}</strong><Status value={item.status} labels={notificationStatuses} /></div>
            <small className="mono">{time(item.createdAt)}{item.attempts !== undefined && ` · 已尝试 ${item.attempts} 次`}</small>
            {item.nextRetryAt && item.status !== 'sent' && <small className="mono">下次重试 {time(item.nextRetryAt)}</small>}
            {item.error && <p className="muted">{item.error}</p>}
          </li>)}</ul> : <p className="empty">{resource.loading ? '正在读取…' : resource.error ? '暂时无法读取通知' : '暂无通知'}</p>}
        </Panel>
      </div>
    </div>
  </>;
}
