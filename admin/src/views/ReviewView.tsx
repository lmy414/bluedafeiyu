'use client'

import { Gutter } from '@payloadcms/ui'
import { useSearchParams } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import { useAdminApi } from '../components/admin/api'
import { useConsoleList, useConsoleVocabulary } from '../components/admin/useConsoleList'
import { BulkJobsPanel, BulkTools } from '../components/admin/BulkTools'
import { BulkBar } from '../components/admin/BulkBar'
import { CHANNELS, SUBMISSION_STATES, labelOf } from '../components/admin/constants'
import { PageHeader } from '../components/admin/PageHeader'
import { Pagination } from '../components/admin/Pagination'
import { WorkCard } from '../components/admin/WorkCard'
import { WorkDrawer } from '../components/admin/WorkDrawer'
import type { SubmissionDoc, WorkDoc } from '../components/admin/types'
import { NO_AUTHOR, submissionImageURL } from '../components/admin/types'

type ChannelFilter = 'all' | 'github-issue' | 'qq' | 'web'
type ReviewMode = 'pending' | 'published' | 'rejected' | 'reviewed'
const CHANNEL_TABS: Array<{ label: string; value: ChannelFilter }> = [
  { label: '全部', value: 'all' }, { label: '网页', value: 'web' }, { label: 'GitHub', value: 'github-issue' }, { label: 'QQ', value: 'qq' },
]
const MODE_TABS: Array<{ label: string; value: ReviewMode }> = [
  { label: '待发布', value: 'pending' }, { label: '已上线（复审）', value: 'published' },
  { label: 'AI 拒绝 / 转人工', value: 'rejected' }, { label: '已处理的 AI 记录', value: 'reviewed' },
]

export function ReviewView() {
  const { get, mutate } = useAdminApi()
  const searchParams = useSearchParams()
  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [mode, setMode] = useState<ReviewMode>(() => {
    const requested = searchParams.get('mode')
    return MODE_TABS.some(tab => tab.value === requested) ? requested as ReviewMode : 'pending'
  })
  const submissionMode = mode === 'rejected' || mode === 'reviewed'
  const { characters, categories } = useConsoleVocabulary()
  const [selected, setSelected] = useState<string[]>([])
  const [activeWork, setActiveWork] = useState<WorkDoc | null>(null)
  const [activeSubmission, setActiveSubmission] = useState<SubmissionDoc | null>(null)
  const [page, setPage] = useState(1)
  const [author, setAuthor] = useState('')
  const [message, setMessage] = useState('')
  const { data, authors, loading, error, refresh } = useConsoleList<WorkDoc | SubmissionDoc>({ kind: submissionMode ? 'submissions' : 'works', mode, channel, author, page, limit: 48 })
  const works = submissionMode ? [] : data.docs as WorkDoc[]
  const submissions = submissionMode ? data.docs as SubmissionDoc[] : []
  useEffect(() => { setPage(1); setSelected([]); setAuthor('') }, [channel, mode])
  useEffect(() => { setPage(1); setSelected([]) }, [author])
  useEffect(() => { if (data.page && data.page !== page) setPage(data.page) }, [data.page])
  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]) }
  async function openWork(work: WorkDoc) {
    try { setActiveWork(await get<WorkDoc>(`/works/${work.id}`, { depth: 2 })) }
    catch (e) { setMessage((e as Error).message) }
  }
  async function openSubmission(submission: SubmissionDoc) {
    try { setActiveSubmission(await get<SubmissionDoc>(`/submissions/${submission.id}`, { depth: 2 })) }
    catch (e) { setMessage((e as Error).message) }
  }
  async function bulk(action: 'hide' | 'remove') {
    if (!selected.length) return
    try {
      await mutate('/works/bulk', 'POST', { action, ids: selected }); setSelected([]); refresh()
      setMessage(action === 'hide' ? '已隐藏，下一次发布会生效。' : '已移除，未发布作品不会进入公开清单。')
    } catch (e) { setMessage((e as Error).message) }
  }
  return <Gutter className="s3-admin-page">
    <PageHeader description="列表仅加载当前页。多选后可批量编辑、翻译；人工收录必须确认已逐张复核，成功后进入待发布。" title="投稿审核" />
    <div className="s3-tab-row">{CHANNEL_TABS.map(tab => <button key={tab.value} type="button" className={channel === tab.value ? 's3-tab s3-tab--active' : 's3-tab'} onClick={() => setChannel(tab.value)}>{tab.label}</button>)}</div>
    <div className="s3-subtab-row">{MODE_TABS.map(tab => <button key={tab.value} type="button" className={mode === tab.value ? 's3-subtab s3-subtab--active' : 's3-subtab'} onClick={() => setMode(tab.value)}>{tab.label}</button>)}</div>
    <section className="s3-filter-panel"><label>作者<select value={author} onChange={e => setAuthor(e.target.value)}><option value="">全部作者</option>{authors.map(item => <option key={item.value || NO_AUTHOR} value={item.value || NO_AUTHOR}>{item.value || '未署名'}（{item.count}）</option>)}</select></label></section>
    <div className="s3-result-line"><span>共 {data.totalDocs || 0} 条</span>{mode !== 'reviewed' ? <div>
      <button className="s3-text-button" type="button" onClick={() => setSelected(current => [...new Set([...current, ...(submissionMode ? submissions.map(s => s.submissionId) : works.map(w => w.workId))])])}>选择本页</button>
      <button className="s3-text-button" type="button" onClick={() => setSelected([])}>清空选择</button>
    </div> : null}</div>
    {message || error ? <p className="s3-notice">{message || error}</p> : null}
    {loading ? <p className="s3-loading">正在读取审核队列…</p> : null}
    {!loading && !data.docs.length ? <div className="s3-empty">当前筛选下没有条目。</div> : null}
    <section className="s3-card-grid">
      {!submissionMode && works.map(work => <WorkCard key={String(work.id)} work={work} metrics={work.metrics} selected={selected.includes(work.workId)} onSelect={() => toggle(work.workId)} onOpen={() => void openWork(work)} />)}
      {submissionMode && submissions.map(submission => {
        const image = submissionImageURL(submission)
        return <article className={`s3-card ${selected.includes(submission.submissionId) ? 's3-card--selected' : ''}`} key={String(submission.id)}>
          {mode === 'rejected' ? <label className="s3-select"><input type="checkbox" checked={selected.includes(submission.submissionId)} onChange={() => toggle(submission.submissionId)} /><span>选择</span></label> : null}
          <button className="s3-card-main" type="button" onClick={() => void openSubmission(submission)}>
            <div className="s3-card-image">{image ? <img alt={submission.title} loading="lazy" src={image} /> : <span>暂无预览图</span>}</div>
            <div className="s3-card-content"><div className="s3-card-title-row"><h3>{submission.title}</h3><span className="s3-status s3-status--rejected">{SUBMISSION_STATES[submission.state] || submission.state}</span></div>
              <p>{String(submission.fields?.characterId || submission.fields?.character || '未设置角色')}</p>
              {submission.work ? <p className="s3-card-meta">已关联作品：{typeof submission.work === 'object' ? submission.work.name : String(submission.work)}</p> : null}
              <p className="s3-card-meta">{labelOf(CHANNELS, submission.source)}</p>
              <p className="s3-card-confidence">AI 置信度：{typeof submission.review?.confidence === 'number' ? `${Math.round(submission.review.confidence * 100)}%` : '未记录'}</p>
              <p className="s3-card-meta">AI 理由：{String(submission.review?.reason || '未记录')}</p>
            </div>
          </button>
        </article>
      })}
    </section>
    <Pagination page={page} setPage={setPage} totalPages={data.totalPages || 1} />
    {mode !== 'reviewed' ? <BulkBar count={selected.length}>
      <BulkTools ids={selected} target={submissionMode ? 'submissions' : 'works'} characters={characters} categories={categories} onSubmitted={() => { setSelected([]); setMessage('后台任务已提交，关闭页面也会继续执行。') }} />
      {mode === 'pending' ? <button className="s3-button s3-button--danger" type="button" onClick={() => void bulk('remove')}>批量移除</button> : null}
      {mode === 'published' ? <button className="s3-button s3-button--warning" type="button" onClick={() => void bulk('hide')}>批量隐藏</button> : null}
    </BulkBar> : null}
    <BulkJobsPanel onCompleted={refresh} />
    {activeWork ? <WorkDrawer categories={categories} characters={characters} item={{ kind: 'work', work: activeWork }} onClose={() => setActiveWork(null)} onSaved={refresh} /> : null}
    {activeSubmission ? <WorkDrawer categories={categories} characters={characters} item={{ kind: 'submission', submission: activeSubmission }} onClose={() => setActiveSubmission(null)} onSaved={refresh} /> : null}
  </Gutter>
}
