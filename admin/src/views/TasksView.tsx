'use client'
import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import { useAdminApi } from '../components/admin/api'
import {
  OPERATIONS,
  TASK_KINDS,
  TASK_STATUSES,
  type ConsoleTask,
  type TaskList,
} from '../components/admin/task-types'
import { PageHeader } from '../components/admin/PageHeader'
import { Pagination } from '../components/admin/Pagination'
import { formatDate } from '../components/admin/constants'
import { UploadPanel } from '../components/admin/UploadPanel'

const VIEWS = [
  { value: 'attention', label: '待我处理' },
  { value: 'running', label: '处理中' },
  { value: 'ready', label: '待发布' },
  { value: 'completed', label: '已完成' },
  { value: 'all', label: '全部' },
]
const STAGES: Record<string, string> = {
  superseded: '后续批次已成功发布，原失败记录保留',
  editing: '补齐必要文案',
  translating: '生成英日译文',
  ready: '校验并保存内容',
  blocked: '技术问题暂挂',
  retry: '等待自动重试',
  queued: '等待执行',
  pending: '等待确认发布',
  included: '已收录',
  auto_rejected: '需要人工复核',
  needs_manual: '需要人工复核',
  awaiting_publish: '等待发布',
  reply_queued: '等待回写结果',
  active: '持续同步作者的公开视频',
  approved: 'AI 审核通过',
  rejected: '未通过收录审核',
  manual: '证据不足，待复核',
  paused: '作者同步已暂停',
}
export function TasksView() {
  const params = useSearchParams(),
    { get, mutate } = useAdminApi()
  const [view, setView] = useState(params.get('view') || 'attention'),
    [focus, setFocus] = useState(params.get('task') || '')
  const [kind, setKind] = useState(''),
    [page, setPage] = useState(1),
    [data, setData] = useState<TaskList | null>(null)
  const [selected, setSelected] = useState<ConsoleTask | null>(null),
    [detail, setDetail] = useState<any>(null)
  const [revision, setRevision] = useState(0),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [upload, setUpload] = useState(false)
  useEffect(() => {
    if (params.get('task')) {
      setFocus(params.get('task')!)
      setView('all')
      setPage(1)
    }
  }, [params])
  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const result = await get<TaskList>('/console/tasks', {
          status: view,
          kind,
          page,
          task: focus,
        })
        if (!live) return
        setData(result)
        setError('')
        setSelected(
          (current) => result.docs.find((t) => t.key === current?.key) || result.docs[0] || null,
        )
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : '任务读取失败')
      }
    }
    void load()
    const timer = setInterval(() => void load(), 5000)
    window.addEventListener('s3-bulk-submitted', load)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('s3-bulk-submitted', load)
    }
  }, [get, view, kind, page, revision, focus])
  useEffect(() => {
    let live = true
    setDetail(null)
    const path =
      selected?.kind === 'bulk'
        ? '/bulk/jobs'
        : selected?.kind === 'publish'
          ? '/publish/runs/' + encodeURIComponent(selected.sourceId)
          : ''
    if (path)
      void get(path, selected?.kind === 'bulk' ? { jobId: selected.sourceId } : undefined)
        .then((r) => {
          if (live) setDetail(r)
        })
        .catch(() => {})
    return () => {
      live = false
    }
  }, [get, selected?.key, selected?.updatedAt])
  async function action(path: string) {
    if (!selected || busy) return
    if (path.endsWith('cancel') && !window.confirm('取消尚未执行的条目？已完成的条目会保留。'))
      return
    setBusy(true)
    setMessage('')
    try {
      const r = await mutate<any>(path, 'POST', { jobId: selected.sourceId })
      if (r.job?.jobId && focus) setFocus(r.job.jobId)
      setMessage('请求已提交，任务进度将自动更新。')
      setRevision((v) => v + 1)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  async function sync() {
    if (busy) return
    setBusy(true)
    try {
      const r = await mutate<any>('/submissions/sync', 'POST')
      setMessage(
        `同步完成：新增 ${r.stats.createdSubmissions}，更新 ${r.stats.updatedSubmissions}${r.stats.errors?.length ? '；部分条目失败，请重试同步' : ''}。`,
      )
      setRevision((v) => v + 1)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '同步失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Gutter className="s3-admin-page s3-workspace">
      <PageHeader
        title="任务中心"
        description="网页与本地机器人共用任务；先处理需要你决定的事。"
        actions={
          <>
            <button
              className="s3-button s3-button--ghost"
              type="button"
              disabled={busy}
              onClick={() => void sync()}
            >
              同步投稿
            </button>
            <button
              className="s3-button s3-button--primary"
              type="button"
              onClick={() => setUpload(!upload)}
            >
              上传作品
            </button>
          </>
        }
      />
      {upload ? (
        <UploadPanel
          onUploaded={(id) => {
            setUpload(false)
            setFocus(id)
            setView('all')
            setRevision((v) => v + 1)
          }}
        />
      ) : null}
      <div className="s3-task-tabs" role="group" aria-label="任务视图">
        {VIEWS.map((v) => (
          <button
            type="button"
            key={v.value}
            aria-pressed={view === v.value}
            onClick={() => {
              setView(v.value)
              setPage(1)
              setFocus('')
            }}
          >
            {v.label}
            <span>{data?.counts[v.value] || 0}</span>
          </button>
        ))}
      </div>
      <div className="s3-result-line">
        <label>
          任务类型{' '}
          <select
            aria-label="任务类型"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value)
              setPage(1)
            }}
          >
            {TASK_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <Link href="/admin/review?mode=rejected">看图审核</Link>
          <Link href="/admin/publish">检查并发布内容</Link>
          {focus ? (
            <button type="button" className="s3-text-button" onClick={() => setFocus('')}>
              查看全部任务
            </button>
          ) : null}
        </div>
      </div>
      {message ? (
        <p role="status" className="s3-notice">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="s3-danger-copy">
          {error}
        </p>
      ) : null}
      {!data && !error ? <p className="s3-loading">正在读取任务…</p> : null}
      <div className="s3-task-workspace">
        <section className="s3-task-list" aria-label="任务列表">
          {data?.docs.map((t) => (
            <button
              key={t.key}
              type="button"
              className="s3-task-row"
              aria-pressed={selected?.key === t.key}
              onClick={() => setSelected(t)}
            >
              <span className={`s3-status s3-status--${t.status}`}>
                {TASK_STATUSES.find((s) => s.value === t.status)?.label || t.status}
              </span>
              <strong>
                {OPERATIONS[t.operation] || t.title}
                {t.kind === 'bulk' ? ` · ${t.total} 项` : ''}
              </strong>
              <span>
                {t.kind === 'submission'
                  ? t.title
                  : t.kind === 'rights'
                    ? t.title
                    : STAGES[t.stage || ''] || t.stage || ''}
              </span>
              <small>
                {t.actor || '站长'} · {formatDate(t.updatedAt)}
              </small>
            </button>
          ))}
          {data && !data.docs.length ? (
            <div className="s3-empty">
              <h3>当前任务已处理完</h3>
              <p>可以切换视图查看处理中或待发布内容。</p>
            </div>
          ) : null}
        </section>
        <section className="s3-panel s3-task-detail" aria-label="任务详情">
          {selected ? (
            <>
              <div className="s3-panel-heading">
                <h2>{OPERATIONS[selected.operation] || selected.title}</h2>
                <span className={`s3-status s3-status--${selected.status}`}>
                  {TASK_STATUSES.find((s) => s.value === selected.status)?.label}
                </span>
              </div>
              {['submission', 'creator', 'video'].includes(selected.kind) ? <p>{selected.title}</p> : null}
              <p className="s3-muted">
                发起人：{selected.actor || '站长'} · 更新于 {formatDate(selected.updatedAt)}
              </p>
              <p className="s3-task-stage">
                {STAGES[selected.stage || ''] ||
                  selected.stage ||
                  (selected.status === 'queued' ? '任务已接收，等待执行器' : '查看处理结果')}
              </p>
              {selected.total > 0 ? (
                <p>
                  已处理 {selected.current} / {selected.total} 项
                </p>
              ) : null}
              {selected.error ? <p className="s3-danger-copy">{selected.error}</p> : null}
              {selected.operation === 'manual-include' ? (
                <ol className="s3-workflow-steps">
                  <li>保留人工收录判断</li>
                  <li>补齐必要文案</li>
                  <li>生成英文和日文</li>
                  <li>校验图片与内容，进入待发布</li>
                </ol>
              ) : null}
              {selected.status === 'ready' ? (
                <p className="s3-notice">内容已准备完成，公开网站将在发布成功后更新。</p>
              ) : null}
              <div className="s3-page-actions">
                <Link
                  className="s3-button s3-button--primary"
                  href={selected.status === 'ready' ? '/admin/publish' : selected.href}
                >
                  {selected.kind === 'submission'
                    ? '打开看图审核'
                    : selected.kind === 'changes' || selected.status === 'ready'
                      ? '检查待发布内容'
                      : selected.kind === 'rights'
                        ? '处理申请'
                        : '查看关联内容'}
                </Link>
                {selected.canRetry ? (
                  <button
                    className="s3-button s3-button--secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void action('/bulk/retry')}
                  >
                    重试失败步骤
                  </button>
                ) : null}
                {selected.canCancel ? (
                  <button
                    className="s3-button s3-button--ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => void action('/bulk/cancel')}
                  >
                    取消剩余项
                  </button>
                ) : null}
              </div>
              {detail?.job?.results?.length ? (
                <section className="s3-task-results">
                  <h3>逐项处理结果</h3>
                  <ul>
                    {detail.job.results.map((r: any, i: number) => (
                      <li key={r.id + i}>
                        <strong>
                          {r.status === 'succeeded'
                            ? '完成'
                            : r.status === 'skipped'
                              ? '跳过'
                              : '失败'}
                        </strong>{' '}
                        · {r.message}
                        <small>{r.id}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {detail?.run?.error ? <p className="s3-danger-copy">{detail.run.error}</p> : null}
              <details className="s3-form-section">
                <summary>技术记录与任务编号</summary>
                <p>{selected.sourceId}</p>
                {detail?.run ? (
                  <pre className="s3-log">{detail.run.log || '暂无执行日志'}</pre>
                ) : null}
              </details>
            </>
          ) : (
            <p className="s3-muted">选择一条任务查看步骤和结果。</p>
          )}
        </section>
      </div>
      <Pagination page={data?.page || page} totalPages={data?.totalPages || 1} setPage={setPage} />
    </Gutter>
  )
}
