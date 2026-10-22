'use client'

import { Gutter } from '@payloadcms/ui'
import React, { useEffect, useMemo, useState } from 'react'

import { getAllDocs, useAdminApi } from '../components/admin/api'
import { TaskLink } from '../components/admin/TaskLink'
import { formatDate } from '../components/admin/constants'
import { Modal } from '../components/admin/Modal'
import { PageHeader } from '../components/admin/PageHeader'
import { StatusBadge } from '../components/admin/StatusBadge'
import type { ListResponse, PublishPlan, PublishPlanItem, PublishRun, WorkDoc } from '../components/admin/types'
import { workImageURL } from '../components/admin/types'

const PLAN_SECTIONS: Array<{ key: keyof Pick<PublishPlan, 'added' | 'deleted' | 'hidden' | 'restored' | 'topics' | 'updated' | 'videos'>; label: string }> = [
  { key: 'added', label: '新增作品' },
  { key: 'updated', label: '修改作品' },
  { key: 'hidden', label: '隐藏作品' },
  { key: 'restored', label: '恢复作品' },
  { key: 'deleted', label: '删除作品' },
  { key: 'topics', label: '专题变更' },
  { key: 'videos', label: '视频与作者变更' },
]

export function PublishView() {
  const { get, mutate } = useAdminApi()
  const [plan, setPlan] = useState<PublishPlan | null>(null)
  const [works, setWorks] = useState<WorkDoc[]>([])
  const [runs, setRuns] = useState<PublishRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string>('')
  const [activeRun, setActiveRun] = useState<PublishRun | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  async function loadPlan() {
    const [nextPlan, workResult, runResult] = await Promise.all([
      get<PublishPlan>('/publish/plan'),
      getAllDocs<WorkDoc>(get, '/works', { depth: 1, 'where[needsPublish][equals]': true }),
      get<ListResponse<PublishRun>>('/publish-runs', { depth: 0, limit: 30, sort: '-requestedAt' }),
    ])
    setPlan(nextPlan)
    setWorks(workResult || [])
    setRuns(runResult.docs || [])
    const active = (runResult.docs || []).find((run) => ['queued', 'in_progress'].includes(run.status))
    setActiveRunId(active?.runId || '')
  }

  useEffect(() => {
    void loadPlan().catch((error) => setMessage(error instanceof Error ? error.message : '发布计划读取失败')).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeRunId) return
    let stopped = false
    async function poll() {
      try {
        const result = await get<{ run: PublishRun }>('/publish/runs/' + encodeURIComponent(activeRunId))
        if (!stopped) setActiveRun(result.run)
        if (!stopped && ['failed', 'succeeded'].includes(result.run.status)) { setActiveRunId(''); await loadPlan() }
      } catch (error) {
        if (!stopped) setMessage(error instanceof Error ? error.message : '发布状态读取失败')
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2500)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [activeRunId])

  const totalChanges = useMemo(() => plan ? PLAN_SECTIONS.reduce((sum, section) => sum + (plan[section.key]?.length || 0), 0) : 0, [plan])
  const workByID = useMemo(() => new Map(works.map((work) => [work.workId, work])), [works])

  async function requestPublish() {
    if (sending) return
    setSending(true)
    setConfirming(false)
    setMessage('正在创建发布批次…')
    try {
      const result = await mutate<{ runId: string }>('/publish/request', 'POST')
      setActiveRun(null)
      setActiveRunId(result.runId)
      await loadPlan()
      setMessage('发布请求已创建，可在任务中心继续查看进度，关闭页面后仍会执行。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发布请求失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <Gutter className="s3-admin-page">
      <PageHeader
        actions={
          <button className="s3-button s3-button--primary" disabled={sending || !totalChanges || Boolean(activeRunId)} onClick={() => setConfirming(true)} type="button">
            {activeRunId ? '已有发布进行中' : '发布'}
          </button>
        }
        description="确认本次导出所列出的全部作品和专题变更。"
        title="发布"
      />
      {message ? <p className="s3-notice">{message}</p> : null}
      {loading ? <p className="s3-loading">正在计算发布计划…</p> : null}
      {plan ? (
        <section className="s3-panel">
          <div className="s3-panel-heading">
            <div><p className="s3-eyebrow">本次变更清单</p><h2>{totalChanges ? '共 ' + totalChanges + ' 项' : '没有待发布变更'}</h2></div>
            <button className="s3-button s3-button--ghost" onClick={() => void loadPlan()} type="button">刷新计划</button>
          </div>
          <div className="s3-plan-grid">
            {PLAN_SECTIONS.map((section) => (
              <div className="s3-plan-section" key={section.key}>
                <h3>{section.label}<span>{plan[section.key]?.length || 0}</span></h3>
                <div className="s3-plan-items">
                  {(plan[section.key] || []).map((item: PublishPlanItem) => {
                    const work = item.workId ? workByID.get(item.workId) : undefined
                    const image = work ? workImageURL(work) : undefined
                    return (
                      <div className="s3-plan-item" key={String(item.id)}>
                        <div className="s3-plan-thumb">{image ? <img alt="" src={image} /> : <span>{section.key === 'topics' ? '专' : '作'}</span>}</div>
                        <span><strong>{item.name}</strong><small>{item.workId || item.topicId || item.id}</small></span>
                        <StatusBadge status={item.status} />
                      </div>
                    )
                  })}
                  {!plan[section.key]?.length ? <p className="s3-muted">无</p> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeRun ? (
        <section className="s3-panel s3-run-live">
          <div className="s3-panel-heading"><div><p className="s3-eyebrow">当前批次</p><h2>{activeRun.runId}</h2></div><StatusBadge status={activeRun.status} /></div>
          <dl className="s3-detail-list s3-detail-list--wide">
            <div><dt>步骤</dt><dd>{activeRun.step || '等待执行器'}</dd></div>
            <div><dt>开始</dt><dd>{formatDate(activeRun.startedAt)}</dd></div>
            <div><dt>结束</dt><dd>{formatDate(activeRun.finishedAt)}</dd></div>
            <div><dt>提交</dt><dd>{activeRun.commits ? JSON.stringify(activeRun.commits) : '未产生'}</dd></div>
          </dl>
          <TaskLink id={activeRun.runId} /><details><summary>查看技术日志</summary><pre className="s3-log">{activeRun.log || activeRun.error || '暂无日志。'}</pre></details>
        </section>
      ) : null}

      <details className="s3-panel">
        <summary>历史发布记录</summary>
        <div className="s3-table-wrap">
          <table className="s3-table">
            <thead><tr><th>批次</th><th>状态</th><th>请求时间</th><th>步骤</th><th>提交</th></tr></thead>
            <tbody>
              {runs.map((run) => (
                <tr key={String(run.id)} onClick={() => setActiveRun(run)}>
                  <td>{run.runId}</td>
                  <td><StatusBadge status={run.status} /></td>
                  <td>{formatDate(run.requestedAt)}</td>
                  <td>{run.step || '—'}</td>
                  <td>{run.commits ? JSON.stringify(run.commits) : '—'}</td>
                </tr>
              ))}
              {!runs.length ? <tr><td colSpan={5}>暂无发布批次。</td></tr> : null}
            </tbody>
          </table>
        </div>
      </details>

      <Modal disabled={sending} confirmLabel={sending ? '提交中…' : '确认发布'} onClose={() => setConfirming(false)} onConfirm={() => void requestPublish()} open={confirming} title="确认发布">
        <p>将创建发布批次并导出 {totalChanges} 项变更。该操作会通知发布执行器，确认后不能从后台撤销。</p>
      </Modal>
    </Gutter>
  )
}
