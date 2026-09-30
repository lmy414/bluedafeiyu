'use client'

import React from 'react'

import { CHANNELS, labelOf } from './constants'
import type { CharacterDoc, WorkDoc } from './types'
import { asObject, authorOf, workImageURL } from './types'

function confidenceText(value?: number): string {
  if (typeof value !== 'number') return '未记录'
  return `${Math.round(value * 100)}%`
}

export function WorkCard({
  onOpen,
  onSelect,
  selected,
  work,
}: {
  onOpen: () => void
  onSelect: () => void
  selected: boolean
  work: WorkDoc
}) {
  const character = asObject<CharacterDoc>(work.character)
  const categories = Array.isArray(work.categories)
    ? work.categories.map((item) => asObject<{ name?: string }>(item)?.name).filter(Boolean)
    : []
  const image = workImageURL(work)
  return (
    <article className={`s3-card ${selected ? 's3-card--selected' : ''}`}>
      <label className="s3-select">
        <input checked={selected} onChange={onSelect} type="checkbox" />
        <span>选择</span>
      </label>
      <button className="s3-card-main" onClick={onOpen} type="button">
        <div className="s3-card-image">
          {image ? <img alt={work.name} loading="lazy" src={image} /> : <span>暂无预览图</span>}
        </div>
        <div className="s3-card-content">
          <div className="s3-card-title-row">
            <h3>{work.name}</h3>
            <span className={`s3-status s3-status--${work.status}`}>
              {work.status === 'pending' ? '待发布' : work.status === 'published' ? '已上线' : work.status === 'hidden' ? '已隐藏' : work.status === 'removed' ? '已移除' : '已删除'}
            </span>
          </div>
          <p>{character?.name || '未设置角色'} · {authorOf(work) || '未署名'}</p>
          <p className="s3-card-meta">
            {labelOf(CHANNELS, work.channel)} · {categories.length ? categories.join(' / ') : '未分类'}
          </p>
          <p className="s3-card-confidence">AI 置信度：{confidenceText(work.review?.confidence)}</p>
        </div>
      </button>
    </article>
  )
}
