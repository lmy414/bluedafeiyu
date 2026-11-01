'use client'

import Link from 'next/link'
import React, { useEffect, useMemo, useState } from 'react'

import { useAdminApi } from './api'

export type BulkJobResult = {
  error?: string
  id: string
  message?: string
  status: 'failed' | 'skipped' | 'succeeded' | string
}

export type BulkJobState = {
  agentError?: string
  agentStage?: string
  cursor?: number
  failed?: number
  finishedAt?: string
  jobId: string
  operation?: string
  results?: BulkJobResult[]
  skipped?: number
  status: string
  succeeded?: number
  total?: number
}

const OPERATION_LABELS: Record<string, string> = {
  'ai-fill': '内容编辑与多语言准备',
  'manual-include': '人工收录',
  'write-fields': '批量修改内容',
  translate: '生成多语言',
  'translate-topic': '专题英日翻译',
}

export function operationLabel(operation?: string) {
  return OPERATION_LABELS[operation || ''] || operation || '后台任务'
}

/** 只展示任务真实返回的阶段，不推断百分比或“即将上线”。 */
export function jobStageLabel(job: BulkJobState) {
  const translation = job.operation === 'translate-topic'
  if (job.agentStage === 'retry') return '等待系统自动重试'
  if (job.agentStage === 'blocked') return '技术问题暂挂，需人工检查后重试'
  if (job.status === 'queued') return translation ? '已接收，排队等待翻译' : '已接收，排队等待执行器'
  if (job.status === 'running') return translation ? '正在生成英日翻译' : '执行中'
  if (job.status === 'partial') return translation ? '部分翻译完成，仍有失败项' : '部分完成，仍有失败项'
  if (job.status === 'failed') return translation ? '翻译失败，未覆盖已有译文' : '执行失败'
  if (job.status === 'cancelled') return '已取消，已完成项保留'
  if (job.status === 'succeeded') return translation ? '英日翻译已完成' : '内容已保存，等待发布'
  return job.status || '未知状态'
}

export function jobTone(job: BulkJobState) {
  if (job.status === 'succeeded') return 'ready'
  if (job.status === 'failed' || job.status === 'partial') return 'failed'
  if (job.status === 'cancelled') return 'hidden'
  return 'running'
}

export function useBulkJob(jobId?: string) {
  const { get } = useAdminApi()
  const [job, setJob] = useState<BulkJobState | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!jobId) {
      setJob(null)
      setError('')
      return
    }
    let live = true
    let timer: number | undefined
    async function load() {
      try {
        const result = await get<{ job: BulkJobState }>('/bulk/jobs', { jobId })
        if (!live) return
        setJob(result.job)
        setError('')
        if (['queued', 'running'].includes(result.job.status)) timer = window.setTimeout(load, 2000)
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : '任务状态读取失败')
      }
    }
    void load()
    return () => {
      live = false
      if (timer) window.clearTimeout(timer)
    }
  }, [get, jobId])
  return { error, job }
}

export function JobProgress({
  job,
  jobId,
  onClose,
  resultsOpen = false,
  showLinks = true,
  taskHref,
}: {
  job?: BulkJobState | null
  jobId?: string
  onClose?: () => void
  resultsOpen?: boolean
  showLinks?: boolean
  taskHref?: string
}) {
  const polled = useBulkJob(job ? undefined : jobId)
  const active = job || polled.job
  const error = polled.error
  const counts = useMemo(() => {
    const results = active?.results || []
    return {
      failed: active?.failed ?? results.filter((item) => item.status === 'failed').length,
      skipped: active?.skipped ?? results.filter((item) => item.status === 'skipped').length,
      succeeded: active?.succeeded ?? results.filter((item) => item.status === 'succeeded').length,
    }
  }, [active])
  if (!jobId && !job) return null
  const total = active?.total || 0
  const cursor = Math.min(active?.cursor || 0, total || Number.MAX_SAFE_INTEGER)
  return (
    <section aria-live="polite" className={`s3-job-progress s3-job-progress--${active ? jobTone(active) : 'running'}`}>
      <div className="s3-job-progress-head">
        <div>
          <p className="s3-eyebrow">后台任务</p>
          <strong>{active ? jobStageLabel(active) : '正在读取任务状态…'}</strong>
          {jobId || active?.jobId ? <code>{active?.jobId || jobId}</code> : null}
        </div>
        {onClose ? (
          <button className="s3-text-button" onClick={onClose} type="button">
            收起
          </button>
        ) : null}
      </div>
      {active ? (
        <>
          <p className="s3-job-progress-meta">
            {operationLabel(active.operation)}
            {total ? ` · 已处理 ${cursor} / ${total} 项` : ''}
            {active.agentStage && active.agentStage !== 'retry' ? ` · 阶段：${jobStageLabel(active)}` : ''}
          </p>
          {counts.succeeded || counts.skipped || counts.failed ? (
            <p className="s3-job-progress-counts">
              <span className="is-ok">成功 {counts.succeeded}</span>
              <span>跳过 {counts.skipped}</span>
              <span className={counts.failed ? 'is-bad' : ''}>失败 {counts.failed}</span>
            </p>
          ) : null}
          {active.agentError ? <p className="s3-danger-copy">{active.agentError}</p> : null}
          {active.results?.length ? (
            <details className="s3-job-items" open={resultsOpen}>
              <summary>逐项结果（{active.results.length}）</summary>
              <ul>
                {active.results.map((item, index) => (
                  <li key={`${item.id}-${index}`}>
                    <span className={`s3-result-dot s3-result-dot--${item.status}`} />
                    <code>{item.id}</code>
                    <span>{item.status === 'succeeded' ? '成功' : item.status === 'skipped' ? '跳过' : '失败'}</span>
                    {item.error || item.message ? <small>{item.error || item.message}</small> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {active.status === 'succeeded' ? (
            <p className="s3-notice s3-notice--compact">
              {active.operation === 'translate-topic'
                ? '英日翻译已写入专题，可展开人工校对；不会改变作品、封面或发布状态。'
                : '任务成功只表示内容已写入。公开站点要等发布批次成功后才更新，可在任务中心或发布页继续确认。'}
            </p>
          ) : null}
          {showLinks ? (
            <div className="s3-page-actions s3-job-links">
              <Link className="s3-button s3-button--secondary" href={taskHref || `/admin?task=${encodeURIComponent(active.jobId)}&kind=bulk`}>
                查看任务中心
              </Link>
              <Link className="s3-button s3-button--ghost" href="/admin/publish">
                检查待发布内容
              </Link>
            </div>
          ) : null}
        </>
      ) : null}
      {error ? <p className="s3-danger-copy">{error}</p> : null}
    </section>
  )
}
