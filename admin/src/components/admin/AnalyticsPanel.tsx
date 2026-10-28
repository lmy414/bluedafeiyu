'use client'

import React, { useEffect, useState } from 'react'
import { useAdminApi } from './api'

export type AnalyticsData = {
  available: boolean
  configured: boolean
  startDate: string | null
  syncedAt: string | null
  stale: boolean
  limited: boolean
  works: Record<string, { views: number; downloads: number }>
  totals: { views: number; downloads: number; detailViews: number; previewViews: number; unclassifiedViews: number }
  pageViews: number | null
  timeZone: string | null
  viewTypeAvailable: boolean
}

export function AnalyticsPanel() {
  const { get, mutate } = useAdminApi()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { void get<AnalyticsData>('/analytics').then(setData).catch(error => setMessage(error.message)) }, [get])
  async function sync() {
    setBusy(true); setMessage('')
    try { setData(await mutate<AnalyticsData>('/analytics/sync', 'POST')); setMessage('GA4 统计已同步。') }
    catch (error) { setMessage(error instanceof Error ? error.message : '同步失败，上次统计保留。') }
    finally { setBusy(false) }
  }
  return <section className="s3-panel">
    <div className="s3-panel-heading">
      <div><p className="s3-eyebrow">GA4 站点与作品统计</p><h2>页面访问、作品浏览与下载</h2></div>
      <button className="s3-button s3-button--secondary" disabled={busy || !data?.configured} onClick={() => void sync()} type="button">{busy ? '正在同步…' : '同步 GA4'}</button>
    </div>
    <p>页面 PV 统计本站数据流的 page_view；作品浏览统计当前已发布作品的 work_view。详情与预览分别计数，普通预览弹窗不额外发送页面 PV。下载量为下载原图按钮的点击次数。</p>
    <div className="s3-stat-grid">
      <article className="s3-stat-card"><span>页面 PV（全站）</span><strong>{data?.available && data.pageViews != null ? data.pageViews.toLocaleString() : '—'}</strong></article>
      <article className="s3-stat-card"><span>作品浏览次数（合计）</span><strong>{data?.available ? data.totals.views.toLocaleString() : '—'}</strong></article>
      <article className="s3-stat-card"><span>详情浏览</span><strong>{data?.available ? data.totals.detailViews.toLocaleString() : '—'}</strong></article>
      <article className="s3-stat-card"><span>预览浏览</span><strong>{data?.available ? data.totals.previewViews.toLocaleString() : '—'}</strong></article>
      <article className="s3-stat-card"><span>未区分来源的作品浏览</span><strong>{data?.available ? data.totals.unclassifiedViews.toLocaleString() : '—'}</strong></article>
      <article className="s3-stat-card"><span>下载点击次数</span><strong>{data?.available ? data.totals.downloads.toLocaleString() : '—'}</strong></article>
    </div>
    <p>作品浏览合计包含详情、预览和未区分来源的历史事件。页面 PV 与作品浏览不相加。{data?.available && !data.viewTypeAvailable ? '请在 GA4 注册 view_type 事件维度；处理完成前，作品浏览暂列为未区分。' : ''}</p>
    <p className="s3-notice">{data?.available ? `统计始于 ${data.startDate}，时区 ${data.timeZone || '以 GA4 媒体资源配置为准'}，更新于 ${new Date(data.syncedAt!).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）。${data.stale ? '统计更新已延迟超过一天。' : ''}${data.limited ? '部分事件受 GA4 汇总或维度限制。' : ''}` : data?.configured ? '等待首次同步。请先在 GA4 登记 work_id 事件维度。' : '尚未配置 GA4 读取权限，请按接入文档配置媒体资源 ID 和服务账号。'}</p>
    {message ? <p className="s3-notice" role="status">{message}</p> : null}
  </section>
}
