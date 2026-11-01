'use client'

import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'

import { PageHeader } from '../components/admin/PageHeader'
import { Pagination } from '../components/admin/Pagination'
import { JobProgress } from '../components/admin/JobProgress'
import { useAdminApi } from '../components/admin/api'
import { STATUS_LABELS, formatDate } from '../components/admin/constants'
import {
  OPERATIONS,
  TASK_KINDS,
  TASK_STATUSES,
  type ConsoleTask,
  type TaskCounts,
  type TaskGroup,
} from '../components/admin/task-types'
import { useUrlState } from '../components/admin/useUrlState'
import { UploadPanel } from '../components/admin/UploadPanel'

type TaskRow = ConsoleTask & {
  batchId?: string | null
  batchItemCount?: number | null
  batchLabel?: string | null
  sourceKind?: string | null
  sourceLabel?: string | null
}
type TaskBatch = {
  batchId: string
  batchLabel?: string | null
  count: number
  itemCount?: number | null
  sourceKind?: string | null
  sourceLabel?: string | null
  updatedAt?: string | null
}
type ServerBatch = {
  batchId: string
  batchLabel?: string | null
  durationMs?: number | null
  error?: string | null
  fireId?: string | null
  itemCount?: number | null
  itemDetail?: string | null
  jobId: string
  sourceKind?: string | null
  sourceLabel?: string | null
  startedAt?: string | null
  status?: string | null
}
type ServerBatchPayload = {
  batches: ServerBatch[]
  capturedAt?: string | null
  capturedAtNote?: string | null
  configured: boolean
  generatedAt?: string | null
  note?: string
  source?: string
}
type TaskPayload = {
  batchPage?: number
  batchPageSize?: number
  batchTotal?: number
  batches?: TaskBatch[]
  counts: TaskCounts
  hasMore?: boolean
  docs: TaskRow[]
  page: number
  totalDocs: number
  totalPages: number
}

const GROUPS: Array<{ hint: string; label: string; value: TaskGroup }> = [
  { value: 'decide', label: '需要判断', hint: '人工收录或复核' },
  { value: 'intervene', label: '需要介入', hint: '失败或技术暂挂' },
  { value: 'publish', label: '待发布', hint: '内容已保存，等你确认' },
  { value: 'processing', label: '系统处理中', hint: '无需操作' },
  { value: 'history', label: '历史与全部', hint: '已完成与全部记录' },
]

const CONTENT_TYPE_LABELS: Record<string, string> = {
  creator: '作者资料',
  topic: '专题',
  video: '视频',
  work: '作品',
}

const SOURCE_OPTIONS = [
  { label: '全部来源', value: '' },
  { label: 'Hermes', value: 'hermes' },
  { label: '批量执行器', value: 'bulk-worker' },
  { label: '发布执行器', value: 'publish-executor' },
  { label: '视频同步', value: 'video-sync' },
  { label: '作者同步', value: 'creator-sync' },
  { label: '投稿同步', value: 'submission-sync' },
  { label: '下架处理', value: 'rights-agent' },
]

const COLLAPSED_ROWS = 5
const SERVER_STATUS_LABELS: Record<string, string> = {
  failed: '失败',
  finished: '已结束',
  queued: '排队中',
  running: '执行中',
  succeeded: '成功',
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function TasksView() {
  const { get, mutate } = useAdminApi()
  const { values, set } = useUrlState({
    batch: '',
    contentType: '',
    group: 'decide',
    kind: '',
    keyword: '',
    owner: '',
    page: '1',
    sourceKind: '',
    task: '',
  })
  const group = (GROUPS.some((item) => item.value === values.group) ? values.group : 'decide') as TaskGroup
  const focus = values.task
  const page = Math.max(1, Number(values.page) || 1)
  const [data, setData] = useState<TaskPayload | null>(null)
  const [selected, setSelected] = useState<TaskRow | null>(null)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [upload, setUpload] = useState(false)
  const [keywordInput, setKeywordInput] = useState(values.keyword)
  const [batchInput, setBatchInput] = useState(values.batch)
  const [missing, setMissing] = useState(false)
  const [expandedRows, setExpandedRows] = useState(false)
  const [expandedBatch, setExpandedBatch] = useState('')
  const [allBatches, setAllBatches] = useState(false)
  const [batchItems, setBatchItems] = useState<TaskBatch[]>([])
  const [batchHasMore, setBatchHasMore] = useState(false)
  const [batchPage, setBatchPage] = useState(1)
  const [batchTotal, setBatchTotal] = useState(0)
  const [batchTasks, setBatchTasks] = useState<TaskRow[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [serverBatches, setServerBatches] = useState<ServerBatchPayload | null>(null)

  useEffect(() => {
    setKeywordInput(values.keyword)
  }, [values.keyword])
  useEffect(() => {
    setBatchInput(values.batch)
  }, [values.batch])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (keywordInput === values.keyword) return
      set({ keyword: keywordInput, page: 1, task: '' })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [keywordInput, set, values.keyword])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (batchInput === values.batch) return
      set({ batch: batchInput, page: 1, task: '', group: batchInput ? 'history' : group })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [batchInput, group, set, values.batch])

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const [result, summary] = await Promise.all([
          get<TaskPayload>('/console/tasks', {
            batch: values.batch || undefined,
            contentType: values.contentType || undefined,
            group:
              focus || values.batch
                ? values.kind === 'content' || values.contentType
                  ? 'publish'
                  : 'all'
                : group,
            kind: values.kind,
            owner: values.owner,
            task: focus || undefined,
            keyword: values.keyword,
            page,
            sourceKind: values.sourceKind || undefined,
          }),
          get<{ counts: TaskCounts }>('/console/tasks', { summary: true, group: 'all' }),
        ])
        if (!live) return
        setData({ ...result, counts: summary.counts || result.counts })
        setActionError('')
        setLoading(false)
        const rows = result.docs || []
        setSelected((current) => {
          if (!rows.length) {
            setMissing(Boolean(current))
            return current
          }
          const key = current?.key
          const same = key ? rows.find((task) => task.key === key) : undefined
          if (same) {
            setMissing(false)
            return same
          }
          if (focus) {
            const focused = rows.find(
              (task) =>
                task.sourceId === focus &&
                (!values.contentType || task.contentType === values.contentType),
            )
            if (focused) return focused
          }
          if (!current) {
            setMissing(false)
            return rows[0]
          }
          if (current) setMissing(true)
          return current
        })
      } catch (error) {
        if (!live) return
        setLoading(false)
        setActionError(error instanceof Error ? error.message : '任务读取失败')
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    const submitted = () => void load()
    window.addEventListener('s3-bulk-submitted', submitted)
    return () => {
      live = false
      window.clearInterval(timer)
      window.removeEventListener('s3-bulk-submitted', submitted)
    }
  }, [focus, get, group, page, values.batch, values.contentType, values.kind, values.keyword, values.owner, values.sourceKind])

  useEffect(() => {
    setSelected(null)
    setMissing(false)
    setExpandedRows(false)
    setExpandedBatch('')
    setAllBatches(false)
    setBatchTasks([])
  }, [group, page, values.batch, values.contentType, values.kind, values.keyword, values.owner, values.sourceKind])

  useEffect(() => {
    let live = true
    setDetail(null)
    const path =
      selected?.kind === 'publish'
        ? `/publish/runs/${encodeURIComponent(selected.sourceId)}`
        : selected?.kind === 'bulk' || selected?.job
          ? '/bulk/jobs'
          : ''
    if (!path) return
    const params = path === '/bulk/jobs' ? { jobId: selected?.job?.jobId || selected?.sourceId } : undefined
    void get<Record<string, unknown>>(path, params)
      .then((result) => {
        if (live) setDetail(result)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [get, selected?.job?.jobId, selected?.key, selected?.sourceId, selected?.updatedAt])

  useEffect(() => {
    let live = true
    void get<ServerBatchPayload>('/console/server-batches')
      .then((result) => {
        if (live) setServerBatches(result)
      })
      .catch(() => {
        if (live) setServerBatches(null)
      })
    return () => {
      live = false
    }
  }, [get])

  useEffect(() => {
    setBatchItems([])
    setBatchPage(1)
    setBatchHasMore(false)
    setBatchTotal(0)
    if (!['processing', 'history'].includes(group) || values.keyword || values.batch) return
    let live = true
    void get<TaskPayload>('/console/tasks', {
      batchPage: 1,
      batchPageSize: 20,
      group,
      kind: values.kind,
      owner: values.owner,
      sourceKind: values.sourceKind || undefined,
    })
      .then((result) => {
        if (!live) return
        setBatchItems(result.batches || [])
        setBatchTotal(Number(result.batchTotal || 0))
        setBatchHasMore(Boolean(result.hasMore))
        setBatchPage(Number(result.batchPage || 1))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [get, group, values.batch, values.kind, values.keyword, values.owner, values.sourceKind])

  useEffect(() => {
    if (!expandedBatch) {
      setBatchTasks([])
      return
    }
    let live = true
    setBatchLoading(true)
    void get<TaskPayload>('/console/tasks', {
      batch: expandedBatch,
      group: 'all',
      page: 1,
    })
      .then((result) => {
        if (live) setBatchTasks(result.docs || [])
      })
      .catch(() => {
        if (live) setBatchTasks([])
      })
      .finally(() => {
        if (live) setBatchLoading(false)
      })
    return () => {
      live = false
    }
  }, [expandedBatch, get])

  async function loadBatchPage(nextPage: number) {
    if (!['processing', 'history'].includes(group) || values.keyword || values.batch) return
    setBatchLoading(true)
    try {
      const result = await get<TaskPayload>('/console/tasks', {
        batchPage: nextPage,
        batchPageSize: 20,
        group,
        kind: values.kind,
        owner: values.owner,
        sourceKind: values.sourceKind || undefined,
      })
      setBatchItems(result.batches || [])
      setBatchPage(Number(result.batchPage || nextPage))
      setBatchTotal(Number(result.batchTotal || 0))
      setBatchHasMore(Boolean(result.hasMore))
      setExpandedBatch('')
      setBatchTasks([])
      setAllBatches(false)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '批次分页读取失败')
    } finally {
      setBatchLoading(false)
    }
  }

  async function action(path: string) {
    if (!selected || busy) return
    if (path.endsWith('cancel') && !window.confirm('取消尚未执行的条目？已完成的条目会保留。')) return
    setBusy(true)
    setMessage('')
    setActionError('')
    try {
      const result = await mutate<{ job?: { jobId?: string }; ok?: boolean }>(path, 'POST', {
        jobId: selected.job?.jobId || selected.sourceId,
      })
      const nextJob = result.job?.jobId
      setMessage(
        nextJob
          ? `请求已接收，任务号 ${nextJob}；进度会在这里自动更新。`
          : '请求已接收，任务进度会自动更新。',
      )
      if (nextJob) set({ task: nextJob, kind: 'bulk', page: 1 }, { mode: 'push' })
      window.dispatchEvent(new Event('s3-bulk-submitted'))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  async function sync() {
    if (busy) return
    setBusy(true)
    setMessage('')
    setActionError('')
    try {
      const result = await mutate<{ stats: { createdSubmissions: number; errors?: unknown[]; updatedSubmissions: number } }>(
        '/submissions/sync',
        'POST',
      )
      setMessage(
        `同步完成：新增 ${result.stats.createdSubmissions} 条，更新 ${result.stats.updatedSubmissions} 条${
          result.stats.errors?.length ? '；部分条目失败，请查看任务记录后重试' : ''
        }。`,
      )
      window.dispatchEvent(new Event('s3-bulk-submitted'))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '同步失败')
    } finally {
      setBusy(false)
    }
  }

  const runDetail = recordOf(detail?.run)
  const taskCounts = data?.counts.tasks
  const contentCount = data?.counts.content.publish ?? 0
  const countFor = (value: TaskGroup) =>
    value === 'publish' ? contentCount : taskCounts?.[value] ?? data?.counts[value] ?? 0
  const ownerLabel = (owner?: string) => (owner === 'owner' ? '需要你操作' : owner === 'system' ? '系统处理' : '无需操作')
  const stageText = (task: TaskRow) =>
    task.stageLabel && task.stageLabel !== '未知状态'
      ? task.stageLabel
      : task.job?.status === 'queued'
        ? '排队等待执行器'
        : task.job?.status === 'running'
          ? '执行中'
          : task.stageLabel || '等待状态回写'
  const titleOf = (task: TaskRow) =>
    task.kind === 'bulk' ? `${OPERATIONS[task.operation] || task.operation} · ${task.total} 项` : task.title
  const shortTime = (value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat('zh-CN', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
    }).format(date)
  }
  const reasonOf = (task: TaskRow) =>
    task.reason ||
    task.error ||
    (task.stageLabel && task.stageLabel !== '未知状态' ? task.stageLabel : '') ||
    task.job?.agentError ||
    (task.unit === 'content' ? '内容已保存，等待发布' : '暂无额外说明')
  const briefOf = (task: TaskRow) => {
    const reason = reasonOf(task)
    return reason === '暂无额外说明' ? nextAction(task) : reason
  }
  const nextAction = (task: TaskRow) =>
    task.nextAction ||
    (task.group === 'decide'
      ? '看图判断是否收录'
      : task.group === 'intervene'
        ? '检查原因后决定是否重试'
        : task.group === 'publish'
          ? '到发布页核对变更'
          : task.group === 'processing'
            ? '无需操作，等待系统完成'
            : '查看结果或历史记录')

  const batches =
    ['history', 'processing'].includes(group) && !focus && !values.batch && !values.keyword
      ? batchItems
      : []
  const visibleBatches = allBatches ? batches : batches.slice(0, COLLAPSED_ROWS)
  const batchPageCount = Math.max(1, Math.ceil((batchTotal || batches.length) / 20))
  const batchIds = new Set(batches.map((batch) => batch.batchId))
  const rows = data?.docs || []
  const flatRows = batches.length ? rows.filter((task) => !task.batchId || !batchIds.has(task.batchId)) : rows
  const visibleRows = expandedRows ? flatRows : flatRows.slice(0, COLLAPSED_ROWS)
  const sourceLabelOf = (task: TaskRow) =>
    task.unit === 'content'
      ? '发布计划'
      : task.sourceLabel || SOURCE_OPTIONS.find((item) => item.value === task.sourceKind)?.label || task.sourceKind || '系统'
  const batchSourceLabel = (batch: TaskBatch) =>
    batch.sourceLabel || SOURCE_OPTIONS.find((item) => item.value === batch.sourceKind)?.label || batch.sourceKind || '系统'

  function selectTask(task: TaskRow) {
    setSelected(task)
    setMissing(false)
    set(
      {
        contentType: task.contentType || '',
        kind: task.kind,
        page: 1,
        task: task.sourceId,
      },
      { mode: 'push' },
    )
  }

  function chooseGroup(value: TaskGroup) {
    setSelected(null)
    setMissing(false)
    set({ group: value, kind: '', page: 1, task: '' }, { reset: ['task', 'page'] })
  }

  return (
    <Gutter className="s3-admin-page s3-workspace">
      <PageHeader
        actions={
          <>
            <button className="s3-button s3-button--ghost" disabled={busy} onClick={() => void sync()} type="button">
              同步投稿
            </button>
            <button className="s3-button s3-button--primary" onClick={() => setUpload((value) => !value)} type="button">
              上传作品
            </button>
          </>
        }
        description="先看需要你判断或介入的事；系统任务和已处理记录不占主屏。"
        title="任务中心"
      />
      {upload ? (
        <UploadPanel
          onUploaded={(id) => {
            setUpload(false)
            set({ task: id, kind: 'bulk', group: 'history' }, { mode: 'push' })
          }}
        />
      ) : null}

      <div className="s3-toolbar s3-inbox-toolbar">
        <div className="s3-segmented" role="group" aria-label="任务分组">
          {GROUPS.map((item) => (
            <button
              aria-pressed={group === item.value}
              key={item.value}
              onClick={() => chooseGroup(item.value)}
              type="button"
            >
              {item.label}
              <span className="s3-segmented-count">
                {countFor(item.value)}
                {item.value === 'publish' ? ' 件' : ' 条'}
              </span>
            </button>
          ))}
        </div>
        <div className="s3-toolbar-filters">
          <label>
            <span className="s3-sr-only">任务类型</span>
            <select
              aria-label="任务类型"
              onChange={(event) => set({ kind: event.target.value, page: 1, task: '' })}
              value={values.kind}
            >
              {TASK_KINDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="s3-sr-only">动作归属</span>
            <select
              aria-label="动作归属"
              onChange={(event) => set({ owner: event.target.value, page: 1, task: '' })}
              value={values.owner}
            >
              <option value="">全部归属</option>
              <option value="owner">需要我操作</option>
              <option value="system">系统处理</option>
            </select>
          </label>
          <label>
            <span className="s3-sr-only">机器人来源</span>
            <select
              aria-label="机器人来源"
              onChange={(event) => set({ sourceKind: event.target.value, page: 1, task: '' })}
              value={values.sourceKind}
            >
              {SOURCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <input
            aria-label="搜索批次号"
            onChange={(event) => setBatchInput(event.target.value)}
            placeholder="批次号"
            value={batchInput}
          />
          <input
            aria-label="搜索任务"
            onChange={(event) => setKeywordInput(event.target.value)}
            placeholder="搜索标题或任务号"
            value={keywordInput}
          />
          <button className="s3-button s3-button--ghost" onClick={() => set({ task: '', page: 1 })} type="button">
            刷新
          </button>
        </div>
      </div>

      {message ? (
        <p aria-live="polite" className="s3-notice">
          {message}
        </p>
      ) : null}
      {actionError ? (
        <p className="s3-danger-copy" role="alert">
          {actionError}
        </p>
      ) : null}
      {focus ? (
        <div className="s3-focus-line">
          <span>正在查看任务 <code>{focus}</code></span>
          <button className="s3-text-button" onClick={() => set({ task: '', group, page: 1 })} type="button">
            返回当前分组
          </button>
        </div>
      ) : null}

      {group === 'processing' && serverBatches?.configured ? (
        <details className="s3-server-batches">
          <summary>
            <span>服务器机器人批次快照</span>
            <span className="s3-status s3-status--hidden">只读快照 · 非实时</span>
            <span className="s3-muted">
              {serverBatches.batches.length} 条 · 采集时间{serverBatches.capturedAt ? ` ${formatDate(serverBatches.capturedAt)}` : '未记录'}
              {serverBatches.generatedAt ? ` · 快照生成 ${formatDate(serverBatches.generatedAt)}` : ''}
            </span>
          </summary>
          <p className="s3-muted">
            服务器只读快照，仅含历史 run 摘要；批次内逐项关联未记录，不把机器人输出里的完成文案当作已验证落库。
            {serverBatches.capturedAtNote ? ` ${serverBatches.capturedAtNote}` : ''}
          </p>
          <ul>
            {serverBatches.batches.map((batch) => (
              <li key={batch.batchId}>
                <div>
                  <strong>{batch.batchLabel || batch.batchId}</strong>
                  <small>
                    {batch.sourceLabel || 'Hermes Agent'} · {batch.startedAt ? formatDate(batch.startedAt) : '时间未记录'}
                    {batch.durationMs ? ` · ${Math.round(batch.durationMs / 1000)} 秒` : ''}
                  </small>
                </div>
                <span className={`s3-status s3-status--${batch.status || 'unknown'}`}>
                  {SERVER_STATUS_LABELS[batch.status || ''] || STATUS_LABELS[batch.status || ''] || batch.status || '状态未记录'}
                </span>
                <small>{batch.itemDetail || '未记录明细'}</small>
                <details>
                  <summary>任务与 fire ID</summary>
                  <code>{batch.jobId}</code>
                  {batch.fireId ? <code>{batch.fireId}</code> : null}
                  {batch.error ? <span className="s3-danger-copy">{batch.error}</span> : null}
                </details>
              </li>
            ))}
            {!serverBatches.batches.length ? <li className="s3-muted">快照内暂无服务器批次。</li> : null}
          </ul>
        </details>
      ) : null}
      <div className="s3-task-workspace">
        <section aria-label="任务列表" className="s3-task-list">
          <div className="s3-list-heading">
            <strong>{group === 'history' ? '历史与全部' : GROUPS.find((item) => item.value === group)?.label}</strong>
            <span className="s3-muted">
              {data ? `总计 ${data.totalDocs} 条` : '正在读取'}
              {batchTotal ? ` · 共 ${batchTotal} 个系统批次` : ''}
            </span>
          </div>
          {loading && !data ? <p className="s3-loading">正在读取任务…</p> : null}
          {visibleBatches.map((batch) => {
            const expanded = expandedBatch === batch.batchId
            return (
              <div className={`s3-batch-card ${expanded ? 'is-open' : ''}`} key={batch.batchId}>
                <button
                  aria-expanded={expanded}
                  className="s3-batch-head"
                  onClick={() => setExpandedBatch(expanded ? '' : batch.batchId)}
                  type="button"
                >
                  <span>
                    <strong>{batch.batchLabel || batch.batchId}</strong>
                    <small>
                      {batchSourceLabel(batch)} · {batch.itemCount ?? batch.count} 项 · {formatDate(batch.updatedAt || undefined)}
                    </small>
                  </span>
                  <span className="s3-status s3-status--processing">{expanded ? '收起' : '展开'}</span>
                </button>
                {expanded ? (
                  <div className="s3-batch-items">
                    {batchLoading ? <p className="s3-muted">正在读取批次条目…</p> : null}
                    {batchTasks.slice(0, 8).map((task) => (
                      <button
                        aria-pressed={selected?.key === task.key}
                        className="s3-batch-item"
                        key={task.key}
                        onClick={() => selectTask(task)}
                        type="button"
                      >
                        <span>{titleOf(task)}</span>
                        <small>{stageText(task)}</small>
                      </button>
                    ))}
                    {(batch.itemCount || 0) > 8 || batchTasks.length > 8 ? (
                      <button
                        className="s3-text-button"
                        onClick={() => set({ batch: batch.batchId, group: 'history', page: 1, task: '' })}
                        type="button"
                      >
                        查看该批次全部 {(batch.itemCount || batch.count).toLocaleString()} 项
                      </button>
                    ) : null}
                    {!batchLoading && !batchTasks.length ? <p className="s3-muted">这个批次没有可显示的条目。</p> : null}
                  </div>
                ) : null}
              </div>
            )
          })}
          {batches.length > COLLAPSED_ROWS ? (
            <button className="s3-show-more" onClick={() => setAllBatches((value) => !value)} type="button">
              {allBatches
                ? `收起，只看前 ${COLLAPSED_ROWS} 个批次`
                : `查看本页全部 ${batches.length} 个批次`}
            </button>
          ) : null}
          {batchTotal > 20 || batchPage > 1 ? (
            <div className="s3-batch-pager" aria-label="系统批次分页">
              <span>
                第 {batchPage} / {batchPageCount} 批 · 共 {batchTotal} 个批次
              </span>
              <button
                className="s3-button s3-button--ghost s3-button--small"
                disabled={batchPage <= 1 || batchLoading}
                onClick={() => void loadBatchPage(batchPage - 1)}
                type="button"
              >
                上一页
              </button>
              <button
                className="s3-button s3-button--ghost s3-button--small"
                disabled={!batchHasMore || batchLoading}
                onClick={() => void loadBatchPage(batchPage + 1)}
                type="button"
              >
                {batchLoading ? '加载中…' : '下一页'}
              </button>
            </div>
          ) : null}
          {visibleRows.map((task) => (
            <button
              aria-pressed={selected?.key === task.key}
              className={`s3-task-row s3-task-row--${task.group || group}`}
              key={task.key}
              onClick={() => selectTask(task)}
              type="button"
            >
              <span className="s3-task-row-top">
                <span className={`s3-status s3-status--${task.status}`}>
                  {task.status === 'attention' ? '需处理' : TASK_STATUSES.find((item) => item.value === task.status)?.label || task.status}
                </span>
                <strong className="s3-task-title">{titleOf(task)}</strong>
                <small className="s3-task-time">{shortTime(task.updatedAt)}</small>
              </span>
              <span className="s3-task-brief">{briefOf(task)}</span>
            </button>
          ))}
          {flatRows.length > COLLAPSED_ROWS ? (
            <button className="s3-show-more" onClick={() => setExpandedRows((value) => !value)} type="button">
              {expandedRows ? `收起，只看前 ${COLLAPSED_ROWS} 条` : `展开本页其余 ${flatRows.length - COLLAPSED_ROWS} 条`}
            </button>
          ) : null}
          {data && !data.docs.length && !batches.length ? (
            <div className="s3-empty s3-empty--action">
              <h3>{group === 'decide' ? '现在没有需要你判断的任务' : '这个分组是空的'}</h3>
              <p>{group === 'decide' ? '可以查看待发布内容，或切换到历史与全部。' : '换一个分组或清除筛选条件。'}</p>
              <div className="s3-page-actions">
                <button className="s3-button s3-button--secondary" onClick={() => chooseGroup('publish')} type="button">
                  查看待发布
                </button>
                <button className="s3-button s3-button--ghost" onClick={() => chooseGroup('history')} type="button">
                  历史与全部
                </button>
              </div>
            </div>
          ) : null}
          <Pagination
            limit={30}
            page={data?.page || page}
            setPage={(next) => set({ page: next })}
            totalDocs={data?.totalDocs}
            totalPages={data?.totalPages || 1}
          />
        </section>

        <section aria-label="任务详情" className="s3-panel s3-task-detail">
          {selected ? (
            <>
              <div className="s3-panel-heading s3-task-detail-head">
                <div>
                  <p className="s3-eyebrow">{selected.unit === 'content' ? '待发布内容' : '任务'}</p>
                  <h2>{titleOf(selected)}</h2>
                </div>
                <span className={`s3-status s3-status--${selected.status}`}>
                  {selected.stageLabel || TASK_STATUSES.find((item) => item.value === selected.status)?.label || selected.status}
                </span>
              </div>
              {missing ? (
                <p className="s3-notice">这条任务已不在当前筛选结果中；列表不会自动跳到别的任务。</p>
              ) : null}
              <div className={`s3-callout s3-callout--${selected.owner === 'owner' ? 'attention' : 'info'}`}>
                <strong>{ownerLabel(selected.owner)}</strong>
                <p>{reasonOf(selected)}</p>
                <p className="s3-callout-next">下一步：{nextAction(selected)}</p>
              </div>
              <dl className="s3-detail-list">
                <div>
                  <dt>范围</dt>
                  <dd>{selected.unit === 'content' ? '内容变更' : '任务执行'}</dd>
                </div>
                <div>
                  <dt>发起</dt>
                  <dd>{selected.actor || '系统'}</dd>
                </div>
                <div>
                  <dt>最近更新</dt>
                  <dd>{formatDate(selected.updatedAt)}</dd>
                </div>
                <div>
                  <dt>来源</dt>
                  <dd>{sourceLabelOf(selected)}</dd>
                </div>
                {selected.batchId ? (
                  <div>
                    <dt>真实批次</dt>
                    <dd>
                      {selected.batchLabel || selected.batchId}
                      {selected.batchItemCount ? ` · ${selected.batchItemCount} 项` : ''}
                    </dd>
                  </div>
                ) : null}
                {selected.kind === 'bulk' && selected.total ? (
                  <div>
                    <dt>处理进度</dt>
                    <dd>
                      {selected.current} / {selected.total} 项
                    </dd>
                  </div>
                ) : null}
                {selected.unit === 'content' ? (
                  <div>
                    <dt>发布状态</dt>
                    <dd>
                      {selected.content?.liveVersion
                        ? '已有线上版本，有未发布修改'
                        : selected.content?.state === 'published'
                          ? '已上线'
                          : selected.content?.state === 'pending_publish'
                            ? '已保存，待发布'
                            : '状态未知'}
                      {!selected.content?.liveVersion && selected.content?.needsPublish ? ' · 有未发布改动' : ''}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {selected.autoRetryAt ? (
                <p className="s3-notice">系统会在 {formatDate(new Date(selected.autoRetryAt).toISOString())} 后自动重试；这不是人工恢复承诺。</p>
              ) : null}
              {selected.retriedBy ? (
                <p className="s3-notice">
                  已创建重试任务。原失败结果仍保留，当前进度请查看{' '}
                  <Link href={selected.retriedBy.href || `/admin?task=${encodeURIComponent(selected.retriedBy.jobId)}&kind=bulk`}>
                    子任务 {selected.retriedBy.jobId}
                  </Link>
                  {selected.retriedBy.status || selected.retriedByStatus
                    ? `（${TASK_STATUSES.find((item) => item.value === (selected.retriedBy?.status || selected.retriedByStatus))?.label || selected.retriedBy.status || selected.retriedByStatus}）`
                    : ''}
                  。
                </p>
              ) : null}
              {selected.blocked ? (
                <p className="s3-danger-copy">技术问题暂挂。重试前先看错误原因；后台不会自动恢复。</p>
              ) : null}
              {selected.error ? <p className="s3-danger-copy">{selected.error}</p> : null}
              {selected.job?.jobId || selected.kind === 'bulk' ? (
                <JobProgress
                  job={selected.kind === 'bulk' ? selected.job ?? undefined : undefined}
                  jobId={selected.job?.jobId || selected.sourceId}
                  showLinks={false}
                />
              ) : null}
              {runDetail ? (
                <section className="s3-form-section">
                  <h3>发布批次</h3>
                  <p className="s3-muted">步骤：{String(runDetail.step || '等待执行器')}</p>
                  <p className="s3-muted">状态：{String(runDetail.status || '未知')}</p>
                </section>
              ) : null}
              <div className="s3-page-actions s3-task-actions">
                <Link className="s3-button s3-button--primary" href={selected.href || '/admin'}>
                  {selected.unit === 'content'
                    ? '打开发布页核对'
                    : selected.group === 'decide'
                      ? '打开看图审核'
                      : selected.kind === 'rights'
                        ? '处理申请'
                        : selected.kind === 'publish'
                          ? '查看发布批次'
                          : '查看关联内容'}
                </Link>
                {selected.content?.workId ? (
                  <Link className="s3-button s3-button--secondary" href={`/admin/library?work=${encodeURIComponent(selected.content.workId)}`}>
                    打开作品
                  </Link>
                ) : null}
                {selected.canRetry ? (
                  <button className="s3-button s3-button--secondary" disabled={busy} onClick={() => void action('/bulk/retry')} type="button">
                    {busy ? '提交中…' : '重试失败项'}
                  </button>
                ) : null}
                {selected.canCancel ? (
                  <button className="s3-button s3-button--ghost" disabled={busy} onClick={() => void action('/bulk/cancel')} type="button">
                    取消剩余项
                  </button>
                ) : null}
              </div>
              <details className="s3-form-section">
                <summary>技术记录与任务编号</summary>
                <p>
                  <code>{selected.job?.jobId || selected.sourceId}</code>
                </p>
                <p className="s3-muted">{selected.stageLabel || selected.stage || '未返回阶段'}</p>
                {runDetail ? <pre className="s3-log">{String(runDetail.log || '暂无执行日志')}</pre> : null}
              </details>
            </>
          ) : (
            <div className="s3-empty">
              <h3>选择一条任务</h3>
              <p>详情会显示为什么需要你、下一步和真实处理进度。</p>
            </div>
          )}
        </section>
      </div>
    </Gutter>
  )
}
