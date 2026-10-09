'use client'

import { Gutter } from '@payloadcms/ui'
import { useSearchParams } from 'next/navigation'
import React, { useEffect, useMemo, useState } from 'react'

import { getAllDocs, useAdminApi } from '../components/admin/api'
import { BulkBar } from '../components/admin/BulkBar'
import { CHANNELS, SUBMISSION_STATES, labelOf } from '../components/admin/constants'
import { PageHeader } from '../components/admin/PageHeader'
import { Pagination } from '../components/admin/Pagination'
import { WorkCard } from '../components/admin/WorkCard'
import { WorkDrawer } from '../components/admin/WorkDrawer'
import type { CategoryDoc, CharacterDoc, ListResponse, SubmissionDoc, WorkDoc } from '../components/admin/types'
import { NO_AUTHOR, authorOf, authorOptions, submissionImageURL } from '../components/admin/types'

type ChannelFilter = 'all' | 'github-issue' | 'qq' | 'web'
type ReviewMode = 'pending' | 'published' | 'rejected' | 'reviewed'

const CHANNEL_TABS: Array<{ label: string; value: ChannelFilter }> = [
  { label: '全部', value: 'all' },
  { label: '网页', value: 'web' },
  { label: 'GitHub', value: 'github-issue' },
  { label: 'QQ', value: 'qq' },
]

const MODE_TABS: Array<{ label: string; value: ReviewMode }> = [
  { label: '待发布', value: 'pending' },
  { label: '已上线（复审）', value: 'published' },
  { label: 'AI 拒绝 / 转人工', value: 'rejected' },
  { label: '已处理的 AI 记录', value: 'reviewed' },
]

function confidenceText(value?: number): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '未记录'
}

export function ReviewView() {
  const { get, mutate } = useAdminApi()
  const searchParams = useSearchParams()
  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [mode, setMode] = useState<ReviewMode>(() => {
    const requested = searchParams.get('mode')
    return MODE_TABS.some((tab) => tab.value === requested) ? requested as ReviewMode : 'pending'
  })
  const submissionMode = mode === 'rejected' || mode === 'reviewed'
  const [works, setWorks] = useState<WorkDoc[]>([])
  const [submissions, setSubmissions] = useState<SubmissionDoc[]>([])
  const [characters, setCharacters] = useState<CharacterDoc[]>([])
  const [categories, setCategories] = useState<CategoryDoc[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [activeWork, setActiveWork] = useState<WorkDoc | null>(null)
  const [activeSubmission, setActiveSubmission] = useState<SubmissionDoc | null>(null)
  const [page, setPage] = useState(1)
  const [author, setAuthor] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    setMessage('')
    try {
      const [characterResult, categoryResult] = await Promise.all([
        get<ListResponse<CharacterDoc>>('/characters', { depth: 0, limit: 1000, pagination: false }),
        get<ListResponse<CategoryDoc>>('/categories', { depth: 0, limit: 1000, pagination: false }),
      ])
      setCharacters(characterResult.docs || [])
      setCategories(categoryResult.docs || [])

      if (submissionMode) {
        const docs = await getAllDocs<SubmissionDoc>(get, '/submissions', {
          depth: 2,
          sort: '-createdAt',
          'where[state][in]': 'auto_rejected,needs_manual',
          'where[work][exists]': mode === 'reviewed',
          ...(channel === 'all' ? {} : { 'where[source][equals]': channel }),
        })
        setSubmissions(docs)
        setWorks([])
      } else {
        const docs = await getAllDocs<WorkDoc>(get, '/works', {
          depth: 2,
          sort: '-updatedAt',
          'where[status][equals]': mode,
          ...(channel === 'all' ? {} : { 'where[channel][equals]': channel }),
        })
        setWorks(docs)
        setSubmissions([])
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '审核列表读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
    setSelected([])
    void load()
  }, [channel, mode])

  const authors = useMemo(
    () => (submissionMode ? authorOptions(submissions, authorOf) : authorOptions(works, authorOf)),
    [mode, submissions, works],
  )
  const matchAuthor = (value: string) => !author || (author === NO_AUTHOR ? value === '' : value === author)
  const filteredWorks = useMemo(() => works.filter((work) => matchAuthor(authorOf(work))), [author, works])
  const filteredSubmissions = useMemo(() => submissions.filter((item) => {
    const linked = typeof item.work === 'object' && item.work ? item.work : undefined
    return matchAuthor(authorOf(linked || item))
  }), [author, submissions])
  useEffect(() => setPage(1), [author])

  const count = submissionMode ? filteredSubmissions.length : filteredWorks.length
  const totalPages = Math.max(1, Math.ceil(count / 48))
  const pageWorks = useMemo(() => filteredWorks.slice((page - 1) * 48, page * 48), [page, filteredWorks])
  const pageSubmissions = useMemo(() => filteredSubmissions.slice((page - 1) * 48, page * 48), [page, filteredSubmissions])

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  async function bulk(action: 'hide' | 'remove') {
    if (!selected.length) return
    setMessage('正在处理…')
    try {
      await mutate('/works/bulk', 'POST', { action, ids: selected })
      setSelected([])
      await load()
      setMessage(action === 'hide' ? '已隐藏，下一次发布会生效。' : '已移除，未发布作品不会进入公开清单。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量操作失败')
    }
  }

  return (
    <Gutter className="s3-admin-page">
      <PageHeader description="AI 通过后直接进入待发布；拒绝或转人工条目须在详情中逐条人工复核收录，不能批量纳入。" title="投稿审核" />
      <div className="s3-tab-row">
        {CHANNEL_TABS.map((tab) => (
          <button className={channel === tab.value ? 's3-tab s3-tab--active' : 's3-tab'} key={tab.value} onClick={() => setChannel(tab.value)} type="button">
            {tab.label}
          </button>
        ))}
      </div>
      <div className="s3-subtab-row">
        {MODE_TABS.map((tab) => (
          <button className={mode === tab.value ? 's3-subtab s3-subtab--active' : 's3-subtab'} key={tab.value} onClick={() => setMode(tab.value)} type="button">
            {tab.label}
          </button>
        ))}
      </div>
      <section className="s3-filter-panel">
        <label>
          作者
          <select onChange={(event) => setAuthor(event.target.value)} value={author}>
            <option value="">全部作者</option>
            {authors.map((item) => (
              <option key={item.value || NO_AUTHOR} value={item.value || NO_AUTHOR}>
                {item.value || '未署名'}（{item.count}）
              </option>
            ))}
          </select>
        </label>
      </section>
      {message ? <p className="s3-notice">{message}</p> : null}
      {loading ? <p className="s3-loading">正在读取审核队列…</p> : null}
      {!loading && count === 0 ? <div className="s3-empty">当前筛选下没有条目。</div> : null}

      <section className="s3-card-grid">
        {!submissionMode && pageWorks.map((work) => (
          <WorkCard
            key={String(work.id)}
            onOpen={() => setActiveWork(work)}
            onSelect={() => toggle(work.workId)}
            selected={selected.includes(work.workId)}
            work={work}
          />
        ))}
        {submissionMode && pageSubmissions.map((submission) => {
          const image = submissionImageURL(submission)
          const content = submission.fields || {}
          const categoryNames = Array.isArray(content.categoryIds)
            ? content.categoryIds.map((id) => categories.find((item) => item.id === id || item.categoryId === id)?.name || String(id))
            : []
          return (
            <article className="s3-card" key={String(submission.id)}>
              <button className="s3-card-main" onClick={() => setActiveSubmission(submission)} type="button">
                <div className="s3-card-image">
                  {image ? <img alt={submission.title} loading="lazy" src={image} /> : <span>暂无预览图</span>}
                </div>
                <div className="s3-card-content">
                  <div className="s3-card-title-row">
                    <h3>{submission.title}</h3>
                    <span className="s3-status s3-status--rejected">{SUBMISSION_STATES[submission.state] || submission.state}</span>
                  </div>
                  <p>{String(content.characterId || content.character || '未设置角色')}</p>
                  {submission.work ? <p className="s3-card-meta">已关联作品：{typeof submission.work === 'object' ? submission.work.name : String(submission.work)}</p> : null}
                  <p className="s3-card-meta">{labelOf(CHANNELS, submission.source)} · {categoryNames.length ? categoryNames.join(' / ') : '未分类'}</p>
                  <p className="s3-card-confidence">AI 置信度：{confidenceText(submission.review?.confidence)}</p>
                  <p className="s3-card-meta">AI 理由：{String(submission.review?.reason || submission.review?.summary || '未记录')}</p>
                </div>
              </button>
            </article>
          )
        })}
      </section>
      <Pagination page={page} setPage={setPage} totalPages={totalPages} />

      {!submissionMode ? (
        <BulkBar count={selected.length}>
          {mode === 'pending' ? <button className="s3-button s3-button--danger" onClick={() => void bulk('remove')} type="button">批量移除</button> : null}
          {mode === 'published' ? <button className="s3-button s3-button--warning" onClick={() => void bulk('hide')} type="button">批量隐藏</button> : null}
        </BulkBar>
      ) : null}

      {activeWork ? (
        <WorkDrawer
          categories={categories}
          characters={characters}
          item={{ kind: 'work', work: activeWork }}
          onClose={() => setActiveWork(null)}
          onSaved={() => void load()}
        />
      ) : null}
      {activeSubmission ? (
        <WorkDrawer
          categories={categories}
          characters={characters}
          item={{ kind: 'submission', submission: activeSubmission }}
          onClose={() => setActiveSubmission(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </Gutter>
  )
}
