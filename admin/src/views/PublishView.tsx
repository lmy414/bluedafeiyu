'use client'

import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import React, { useEffect, useMemo, useState } from 'react'

import { getAllDocs, useAdminApi } from '../components/admin/api'
import { Modal } from '../components/admin/Modal'
import { PageHeader } from '../components/admin/PageHeader'
import { StatusBadge } from '../components/admin/StatusBadge'
import { formatDate } from '../components/admin/constants'
import type { ListResponse, PublishPlan, PublishPlanItem, PublishRun, WorkDoc } from '../components/admin/types'
import { workImageURL } from '../components/admin/types'

type PlanWithRun = PublishPlan & {
  pendingRun?: { createdAt?: string; runId: string; status: string } | null
}

const PLAN_SECTIONS: Array<{
  collectionHref?: (item: PublishPlanItem) => string
  key: keyof Pick<PublishPlan, 'added' | 'deleted' | 'hidden' | 'restored' | 'topics' | 'updated' | 'videos'>
  label: string
  unit: string
}> = [
  { key: 'added', label: '新增作品', unit: '件' },
  { key: 'updated', label: '修改作品', unit: '件' },
  { key: 'hidden', label: '隐藏作品', unit: '件' },
  { key: 'restored', label: '恢复作品', unit: '件' },
  { key: 'deleted', label: '删除作品', unit: '件' },
  { key: 'topics', label: '专题变更', unit: '个' },
  { key: 'videos', label: '视频与作者变更', unit: '项' },
]

const STEP_LABELS: Record<string, string> = {
  build: '构建静态站点',
  export: '导出后台数据',
  health: '健康检查',
  publish: '切换发布目录',
  queued: '等待执行器取走请求',
  snapshot: '生成发布快照',
  sync: '同步发布结果',
}

function stageLabel(run: PublishRun) {
  if (run.status === 'queued') return '已排队，等待独立发布执行器取走；后台不会自行宣布上线'
  if (run.status === 'in_progress') return run.step ? STEP_LABELS[run.step] || run.step : '执行器正在处理'
  if (run.status === 'succeeded') return '发布批次成功；请打开线上页面核对实际结果'
  if (run.status === 'failed') return '发布批次失败'
  if (run.status === 'cancelled') return '发布批次已取消'
  return run.status || '未知状态'
}

function statusText(value?: string) {
  return (
    {
      active: '已上线',
      deleted: '已删除',
      draft: '草稿',
      hidden: '已隐藏',
      pending: '待发布',
      published: '已上线',
      removed: '已移除',
    } as Record<string, string>
  )[value || ''] || value || '状态未知'
}

function planLink(item: PublishPlanItem, section: string) {
  if (section === 'topics') return item.topicId ? `/admin/topics-board?topic=${encodeURIComponent(item.topicId)}` : '/admin/topics-board'
  if (section === 'videos') return '/admin/collections/videos'
  if (item.workId) return `/admin/library?work=${encodeURIComponent(item.workId)}`
  return '/admin/library'
}

export function PublishView() {
  const { get, mutate } = useAdminApi()
  const [plan, setPlan] = useState<PlanWithRun | null>(null)
  const [works, setWorks] = useState<WorkDoc[]>([])
  const [runs, setRuns] = useState<PublishRun[]>([])
  const [activeRun, setActiveRun] = useState<PublishRun | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const pendingRunId = plan?.pendingRun?.runId || ''

  async function loadPlan() {
    const [nextPlan, needsPublish, pendingWorks, runResult] = await Promise.all([
      get<PlanWithRun>('/publish/plan'),
      getAllDocs<WorkDoc>(get, '/works', { depth: 1, 'where[needsPublish][equals]': true }),
      getAllDocs<WorkDoc>(get, '/works', { depth: 1, 'where[status][equals]': 'pending' }),
      get<ListResponse<PublishRun>>('/publish-runs', { depth: 0, limit: 30, sort: '-requestedAt' }),
    ])
    setPlan(nextPlan)
    setWorks([...new Map([...needsPublish, ...pendingWorks].map((work) => [String(work.id), work])).values()])
    setRuns(runResult.docs || [])
  }

  useEffect(() => {
    void loadPlan()
      .catch((cause) => setError(cause instanceof Error ? cause.message : '发布计划读取失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const runId = activeRun?.runId || pendingRunId
    if (!runId) return
    let stopped = false
    async function poll() {
      try {
        const result = await get<{ run: PublishRun }>('/publish/runs/' + encodeURIComponent(runId))
        if (stopped) return
        setActiveRun(result.run)
        if (['failed', 'succeeded', 'cancelled'].includes(result.run.status)) {
          await loadPlan()
        } else {
          window.setTimeout(() => void poll(), 2500)
        }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : '发布状态读取失败')
      }
    }
    void poll()
    return () => {
      stopped = true
    }
    // pendingRunId 变化时重新跟踪；activeRun 只用于首次读取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRunId])

  const totalChanges = useMemo(() => {
    if (!plan) return 0
    if (typeof plan.summary?.contents === 'number') return plan.summary.contents
    return PLAN_SECTIONS.reduce((sum, section) => sum + (plan[section.key]?.length || 0), 0)
  }, [plan])
  const workByID = useMemo(() => new Map(works.map((work) => [work.workId, work])), [works])
  const nonEmptySections = PLAN_SECTIONS.filter((section) => (plan?.[section.key]?.length || 0) > 0)
  const unitSummary = PLAN_SECTIONS.filter((section) => section.key !== 'videos')
    .map((section) => ({ count: plan?.[section.key]?.length || 0, label: section.label, unit: section.unit }))
    .filter((item) => item.count > 0)
  const videoCount = plan?.videos?.length || 0
  const busyRun = Boolean(activeRun && ['queued', 'in_progress'].includes(activeRun.status)) || Boolean(pendingRunId)

  async function requestPublish() {
    if (sending) return
    setSending(true)
    setConfirming(false)
    setMessage('正在创建发布批次…')
    setError('')
    try {
      const result = await mutate<{ runId: string }>('/publish/request', 'POST')
      setActiveRun(null)
      setMessage(`发布请求已创建（${result.runId}）。它现在只是排队请求，等独立执行器取走后才会进入执行阶段。`)
      await loadPlan()
      const run = await get<{ run: PublishRun }>('/publish/runs/' + encodeURIComponent(result.runId)).catch(() => null)
      if (run?.run) setActiveRun(run.run)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '发布请求失败')
      setMessage('')
    } finally {
      setSending(false)
    }
  }

  return (
    <Gutter className="s3-admin-page s3-workspace">
      <PageHeader
        actions={
          <button
            className="s3-button s3-button--primary"
            disabled={sending || !totalChanges || busyRun}
            onClick={() => setConfirming(true)}
            type="button"
          >
            {busyRun ? '已有发布进行中' : totalChanges ? `发布 ${totalChanges} 项` : '没有待发布内容'}
          </button>
        }
        description="核对本次变更，确认后发布到站点。"
        title="发布"
      />
      {message ? <p className="s3-notice" role="status">{message}</p> : null}
      {error ? <p className="s3-danger-copy" role="alert">{error}</p> : null}
      {loading ? <p className="s3-loading">正在计算发布计划…</p> : null}

      {plan ? (
        <>
          <section className="s3-publish-summary" aria-label="本次发布摘要">
            <div className="s3-publish-total">
              <span>本次待发布</span>
              <strong>{totalChanges}</strong>
              <small>项内容 · 不是任务条数</small>
            </div>
            <div className="s3-publish-breakdown">
              {unitSummary.map((item) => (
                <span key={item.label}>
                  {item.label} <strong>{item.count}</strong> {item.unit}
                </span>
              ))}
              {videoCount ? <span>视频与作者 <strong>{videoCount}</strong> 项</span> : null}
              {!totalChanges ? <span className="s3-muted">没有待发布内容</span> : null}
            </div>
            <button className="s3-button s3-button--ghost" onClick={() => void loadPlan()} type="button">
              刷新计划
            </button>
          </section>

          <section className="s3-panel">
            <div className="s3-panel-heading">
              <div>
                <p className="s3-eyebrow">变更清单</p>
                <h2>{totalChanges ? `共 ${totalChanges} 项，按变更类型分组` : '没有待发布变更'}</h2>
              </div>
              <span className="s3-muted">条目可直达核对；发布前不会上线</span>
            </div>
            {nonEmptySections.length ? (
              <div className="s3-plan-grid">
                {nonEmptySections.map((section) => (
                  <div className="s3-plan-section" key={section.key}>
                    <h3>
                      {section.label}
                      <span>{plan[section.key]?.length || 0} {section.unit}</span>
                    </h3>
                    <div className="s3-plan-items">
                      {(plan[section.key] || []).map((item: PublishPlanItem) => {
                        const work = item.workId ? workByID.get(item.workId) : undefined
                        const image = work ? workImageURL(work) : undefined
                        return (
                          <div className="s3-plan-item" key={String(item.id)}>
                            <div className="s3-plan-thumb">{image ? <img alt="" src={image} /> : <span>{section.key === 'topics' ? '专' : '作'}</span>}</div>
                            <span title={item.workId || item.topicId || String(item.id)}>
                              <strong>{item.name}</strong>
                              <small>
                                {item.changeAction ? changeActionLabel(item.changeAction) : section.label}
                                {item.status ? ` · ${statusText(item.status)}` : ''}
                              </small>
                            </span>
                            <Link className="s3-text-button" href={planLink(item, section.key)}>
                              核对
                            </Link>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="s3-empty s3-empty--action">
                <h3>当前没有待发布内容</h3>
                <p>作品、专题或视频保存修改后会出现在这里。</p>
                <Link className="s3-button s3-button--secondary" href="/admin/library">
                  去作品库
                </Link>
              </div>
            )}
          </section>
        </>
      ) : null}

      <section className="s3-panel s3-run-live">
        <div className="s3-panel-heading">
          <div>
            <p className="s3-eyebrow">当前批次</p>
            <h2>{activeRun ? activeRun.runId : pendingRunId || '没有进行中的发布批次'}</h2>
          </div>
          {activeRun ? <StatusBadge status={activeRun.status} /> : <span className="s3-status s3-status--hidden">未执行</span>}
        </div>
        {activeRun ? (
          <>
            <p className={`s3-run-stage ${activeRun.status === 'failed' ? 'is-bad' : ''}`}>{stageLabel(activeRun)}</p>
            <dl className="s3-detail-list s3-detail-list--wide">
              <div>
                <dt>步骤</dt>
                <dd>{activeRun.step ? STEP_LABELS[activeRun.step] || activeRun.step : '等待执行器回写'}</dd>
              </div>
              <div>
                <dt>开始</dt>
                <dd>{formatDate(activeRun.startedAt)}</dd>
              </div>
              <div>
                <dt>结束</dt>
                <dd>{formatDate(activeRun.finishedAt)}</dd>
              </div>
              <div>
                <dt>提交</dt>
                <dd>{activeRun.commits ? JSON.stringify(activeRun.commits) : '未产生'}</dd>
              </div>
            </dl>
            {activeRun.error ? <p className="s3-danger-copy">{activeRun.error}</p> : null}
            {activeRun.status === 'queued' ? (
              <p className="s3-notice">发布请求已排队，等待站点执行器取走；完成前不会显示为已上线。</p>
            ) : null}
            <details className="s3-form-section">
              <summary>技术日志</summary>
              <pre className="s3-log">{activeRun.log || activeRun.error || '暂无日志。'}</pre>
            </details>
          </>
        ) : (
          <p className="s3-muted">提交后可在这里查看排队、执行和发布结果。</p>
        )}
      </section>

      <details className="s3-panel">
        <summary>历史发布记录（{runs.length}）</summary>
        <div className="s3-table-wrap">
          <table className="s3-table">
            <thead>
              <tr><th>批次</th><th>状态</th><th>请求时间</th><th>步骤</th><th>提交</th></tr>
            </thead>
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

      <Modal
        confirmLabel={sending ? '提交中…' : '确认发布'}
        disabled={sending || !totalChanges}
        onClose={() => setConfirming(false)}
        onConfirm={() => void requestPublish()}
        open={confirming}
        title="确认发布"
      >
        <p>
          将创建发布批次并导出 {totalChanges} 项变更：{unitSummary.map((item) => `${item.label} ${item.count} ${item.unit}`).join('、')}
          {videoCount ? `、视频与作者 ${videoCount} 项` : ''}。
        </p>
        <p className="s3-muted">确认后不能从后台撤销。提交后可在本页和任务中心查看排队、执行与发布结果。</p>
      </Modal>
    </Gutter>
  )
}

function changeActionLabel(value: string) {
  return (
    {
      add: '新增',
      delete: '删除',
      hide: '隐藏',
      remove: '移除',
      restore: '恢复',
      update: '修改',
    } as Record<string, string>
  )[value] || value
}
