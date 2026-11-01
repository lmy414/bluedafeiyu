'use client'

import React from 'react'

import { CHANNELS, labelOf } from './constants'
import type { CharacterDoc, WorkDoc } from './types'
import { asObject, authorOf, workImageURL } from './types'

const STATE_LABELS: Record<string, string> = {
  blocked: '技术暂挂',
  deleted: '已删除',
  hidden: '已隐藏',
  needs_publish: '待发布改动',
  needs_review: '待判断',
  processing: '处理中',
  published: '已上线',
  rejected: '已拒绝',
  removed: '已移除',
  unknown: '状态未知',
}

function confidenceText(value?: number): string {
  if (typeof value !== 'number') return '未记录'
  return `${Math.round(value * 100)}%`
}

export function WorkCard({
  onAddToTopic,
  onOpen,
  onSelect,
  selected,
  work,
  metrics,
}: {
  onAddToTopic?: () => void
  onOpen: () => void
  onSelect: () => void
  selected: boolean
  work: WorkDoc
  metrics?: { views: number; downloads: number }
}) {
  const characterNames = (work.characters?.length ? work.characters : [work.character])
    .map((value) => asObject<CharacterDoc>(value)?.name)
    .filter(Boolean)
    .join('、')
  const categories = Array.isArray(work.categories)
    ? work.categories.map((item) => asObject<{ name?: string }>(item)?.name).filter(Boolean)
    : []
  const image = workImageURL(work)
  const activeJob = work.activeJob?.jobId ? work.activeJob : null
  const enriched: WorkDoc & {
    processingState?: string
    targetStatus?: string
    topicIds?: string[]
  } = work
  const state =
    enriched.processingState ||
    (activeJob ? 'processing' : work.status === 'pending' ? 'needs_publish' : work.status)
  const statusLabel = STATE_LABELS[state] || STATE_LABELS.unknown
  const liveVersion = Boolean(work.liveVersion)
  return (
    <article className={`s3-card ${selected ? 's3-card--selected' : ''} ${activeJob ? 's3-card--busy' : ''}`}>
      <label className="s3-select">
        <input checked={selected} onChange={onSelect} type="checkbox" />
        <span>选择</span>
      </label>
      <button className="s3-card-main" onClick={onOpen} type="button">
        <div className="s3-card-image">
          {image ? <img alt={work.name} loading="lazy" src={image} /> : <span>暂无预览图</span>}
          {activeJob ? (
            <span className="s3-card-job" title={activeJob.jobId}>
              处理中{activeJob.total ? ` ${activeJob.cursor || 0}/${activeJob.total}` : ''}
            </span>
          ) : null}
        </div>
        <div className="s3-card-content">
          <div className="s3-card-title-row">
            <h3>{work.name}</h3>
            <span className={`s3-status s3-status--${state}`}>{statusLabel}</span>
          </div>
          {state === 'needs_publish' && liveVersion ? <p className="s3-card-flag">已有线上版本，发布后更新</p> : null}
          {state === 'needs_publish' && ['hidden', 'removed', 'deleted'].includes(enriched.targetStatus || '') ? (
            <p className="s3-card-flag">
              发布后{enriched.targetStatus === 'hidden' ? '隐藏' : enriched.targetStatus === 'removed' ? '移除' : '删除'}
            </p>
          ) : null}
          <p>
            {characterNames || '未设置角色'} · {authorOf(work) || '未署名'}
          </p>
          <p className="s3-card-meta">
            {labelOf(CHANNELS, work.channel)} · {categories.length ? categories.join(' / ') : '未分类'}
          </p>
          <div className="s3-card-footer">
            <span className="s3-card-confidence">AI 置信度：{confidenceText(work.review?.confidence)}</span>
            <span className="s3-card-meta">
              浏览 {metrics ? metrics.views.toLocaleString() : '—'} · 下载 {metrics ? metrics.downloads.toLocaleString() : '—'}
            </span>
          </div>
        </div>
      </button>
      {onAddToTopic ? (
        <div className="s3-card-actions">
          <button className="s3-text-button" onClick={onAddToTopic} type="button">
            加入专题
          </button>
          {enriched.topicIds?.length ? <span className="s3-card-meta">已在 {enriched.topicIds.length} 个专题</span> : null}
        </div>
      ) : null}
    </article>
  )
}
