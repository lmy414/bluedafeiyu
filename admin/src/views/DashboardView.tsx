'use client'

import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'

import { useAdminApi } from '../components/admin/api'
import { CHANNELS, formatDate, labelOf } from '../components/admin/constants'
import { PageHeader } from '../components/admin/PageHeader'
import { StatusBadge } from '../components/admin/StatusBadge'
import type { PublishRun } from '../components/admin/types'

type Stats = {
  aiReviewing: number
  autoRejected: number
  latestRun: PublishRun | null
  needsAttention: number
  needsPublish: number
  needsPublishByChannel: Record<string, number>
  pendingByChannel: Record<string, number>
  pendingReview: number
  topicsNeedsPublish: number
}

const EMPTY_STATS: Stats = {
  aiReviewing: 0,
  autoRejected: 0,
  latestRun: null,
  needsAttention: 0,
  needsPublish: 0,
  needsPublishByChannel: {},
  pendingByChannel: {},
  pendingReview: 0,
  topicsNeedsPublish: 0,
}

export function DashboardView() {
  const { get, mutate } = useAdminApi()
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    try {
      setStats(await get<Stats>('/dashboard/stats'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '概览读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function syncSubmissions() {
    setMessage('正在同步投稿…')
    try {
      const result = await mutate<{ stats: Record<string, unknown> }>('/submissions/sync', 'POST')
      await load()
      setMessage(`同步完成：${JSON.stringify(result.stats)}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '同步失败')
    }
  }

  return (
    <Gutter className="s3-admin-page">
      <PageHeader
        actions={
          <>
            <button className="s3-button s3-button--secondary" onClick={() => void syncSubmissions()} type="button">
              立即同步投稿
            </button>
            <Link className="s3-button s3-button--primary" href="/admin/publish">去发布</Link>
          </>
        }
        description="查看投稿、待发布变更与最近发布状态。"
        title="概览"
      />
      {message ? <p className="s3-notice">{message}</p> : null}
      <section className="s3-stat-grid">
        {CHANNELS.filter((channel) => ['web', 'github-issue', 'qq', 'manual'].includes(channel.value)).map((channel) => (
          <article className="s3-stat-card" key={channel.value}>
            <span>{channel.label}待发布</span>
            <strong>{loading ? '…' : stats.pendingByChannel[channel.value] || 0}</strong>
            <small>其中 {stats.needsPublishByChannel[channel.value] || 0} 项有未发布改动</small>
          </article>
        ))}
        <article className="s3-stat-card">
          <span>AI 审核中</span>
          <strong>{loading ? '…' : stats.aiReviewing}</strong>
          <small>同步后更新</small>
        </article>
        <Link className="s3-stat-card s3-stat-card--warning" href="/admin/review">
          <span>AI 拒绝 / 转人工</span>
          <strong>{loading ? '…' : stats.needsAttention}</strong>
          <small>可在投稿审核中收录</small>
        </Link>
        <article className="s3-stat-card s3-stat-card--blue">
          <span>待发布改动</span>
          <strong>{loading ? '…' : stats.needsPublish + stats.topicsNeedsPublish}</strong>
          <small>作品 {stats.needsPublish} · 专题 {stats.topicsNeedsPublish}</small>
        </article>
      </section>

      <section className="s3-panel">
        <div className="s3-panel-heading">
          <div>
            <p className="s3-eyebrow">最近一次发布批次</p>
            <h2>{stats.latestRun?.runId || '暂无发布记录'}</h2>
          </div>
          {stats.latestRun ? <StatusBadge status={stats.latestRun.status} /> : null}
        </div>
        {stats.latestRun ? (
          <dl className="s3-detail-list s3-detail-list--wide">
            <div><dt>请求时间</dt><dd>{formatDate(stats.latestRun.requestedAt)}</dd></div>
            <div><dt>提交</dt><dd>{stats.latestRun.commits ? JSON.stringify(stats.latestRun.commits) : '尚未产生提交'}</dd></div>
            <div><dt>当前步骤</dt><dd>{stats.latestRun.step || '等待执行器'}</dd></div>
            <div><dt>渠道</dt><dd>{CHANNELS.map((item) => `${labelOf(CHANNELS, item.value)} ${stats.pendingByChannel[item.value] || 0}`).join(' · ')}</dd></div>
          </dl>
        ) : <p className="s3-muted">完成第一次发布后，这里会显示状态、时间和提交记录。</p>}
      </section>
    </Gutter>
  )
}
