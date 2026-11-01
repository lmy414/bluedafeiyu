'use client'

import Link from 'next/link'
import React from 'react'

import type { TopicDoc } from './types'
import { useCurrentTopic } from './useCurrentTopic'

export function CurrentTopicBar({ topics }: { topics: TopicDoc[] }) {
  const { current, setCurrent } = useCurrentTopic()
  const exists = current && topics.some((topic) => topic.topicId === current.topicId)
  return (
    <div className="s3-current-topic" role="region" aria-label="当前整理专题">
      <div>
        <span className="s3-eyebrow">当前整理专题</span>
        {exists ? (
          <strong title={current?.topicId}>
            {current?.name}
          </strong>
        ) : (
          <strong className="s3-muted">未选择</strong>
        )}
      </div>
      <div className="s3-current-topic-actions">
        <label>
          <span className="s3-sr-only">切换当前整理专题</span>
          <select
            onChange={(event) => {
              const topic = topics.find((item) => item.topicId === event.target.value)
              setCurrent(topic ? { id: String(topic.id), name: topic.name, topicId: topic.topicId } : null)
            }}
            value={exists ? current?.topicId : ''}
          >
            <option value="">选择专题</option>
            {topics.map((topic) => (
              <option key={String(topic.id)} value={topic.topicId}>
                {topic.name}
              </option>
            ))}
          </select>
        </label>
        {exists ? (
          <button className="s3-text-button" onClick={() => setCurrent(null)} type="button">
            清除
          </button>
        ) : null}
        <Link className="s3-text-button" href="/admin/topics-board">
          管理专题
        </Link>
      </div>
    </div>
  )
}
