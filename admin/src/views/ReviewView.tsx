'use client'

import { Gutter } from '@payloadcms/ui'
import React, { useEffect, useMemo, useState } from 'react'

import { useAdminApi } from '../components/admin/api'
import { BulkBar } from '../components/admin/BulkBar'
import { BulkTools } from '../components/admin/BulkTools'
import { CollectToTopic } from '../components/admin/CollectToTopic'
import { CurrentTopicBar } from '../components/admin/CurrentTopicBar'
import { FilterSummary, type ActiveFilter } from '../components/admin/FilterSummary'
import { JobProgress } from '../components/admin/JobProgress'
import { PageHeader } from '../components/admin/PageHeader'
import { Pagination } from '../components/admin/Pagination'
import { WorkCard } from '../components/admin/WorkCard'
import { WorkDrawer } from '../components/admin/WorkDrawer'
import { CHANNELS, SUBMISSION_STATES, labelOf } from '../components/admin/constants'
import { useConsoleCounts, useConsoleList, useConsoleVocabulary } from '../components/admin/useConsoleList'
import { NO_AUTHOR, submissionImageURL, type SubmissionDoc, type WorkDoc } from '../components/admin/types'
import { useUrlState } from '../components/admin/useUrlState'

type ReviewTab =
  | 'blocked'
  | 'history'
  | 'needs_publish'
  | 'needs_review'
  | 'processing'
  | 'published'
  | 'rejected'

const MODE_TABS: Array<{ label: string; value: ReviewTab }> = [
  { label: '待判断', value: 'needs_review' },
  { label: '处理中', value: 'processing' },
  { label: '待发布', value: 'needs_publish' },
  { label: '已上线', value: 'published' },
  { label: '异常', value: 'blocked' },
  { label: '已拒绝', value: 'rejected' },
  { label: '历史', value: 'history' },
]

const MODE_ALIASES: Record<string, ReviewTab> = {
  decide: 'needs_review',
  intervene: 'blocked',
  pending_publish: 'needs_publish',
  rejected: 'rejected',
  reviewed: 'history',
}

const PROCESS_STATE_LABELS: Record<string, string> = {
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

const STAGE_LABELS: Record<string, string> = {
  auto_rejected: 'AI 拒绝，等待人工判断',
  blocked: '技术问题暂挂',
  needs_manual: 'AI 转人工，等待判断',
  queued: '排队中',
  ready: '校验完成，等待保存',
  retry: '等待系统重试',
  reviewing: 'AI 审核中',
  translating: '生成英日译文',
}

const FORMAT_OPTIONS = [
  { label: '全部格式', value: '' },
  { label: 'GIF（原图格式）', value: 'gif' },
  { label: '非 GIF 图片', value: 'static' },
  { label: '格式未知', value: 'unknown' },
]

function listId(doc: WorkDoc | SubmissionDoc): string {
  return ('submissionId' in doc ? doc.submissionId : doc.workId) || ''
}

export function ReviewView() {
  const { get, mutate } = useAdminApi()
  const { values, set } = useUrlState({
    author: '',
    channel: 'all',
    character: '',
    format: '',
    keyword: '',
    kind: 'submissions',
    mode: 'needs_review',
    page: '1',
    submission: '',
    topic: '',
    type: '',
    work: '',
  })
  const normalizedMode = MODE_ALIASES[values.mode] || values.mode
  const mode = (MODE_TABS.some((tab) => tab.value === normalizedMode) ? normalizedMode : 'needs_review') as ReviewTab
  const submissionMode = values.kind !== 'works'
  const canBulk = ['needs_publish', 'needs_review', 'published', 'rejected'].includes(mode)
  const page = Math.max(1, Number(values.page) || 1)
  const { characters, categories, topics } = useConsoleVocabulary()
  const [selected, setSelected] = useState<string[]>([])
  const [quickAddWorks, setQuickAddWorks] = useState<WorkDoc[] | null>(null)
  const [active, setActive] = useState<{ index: number; item: WorkDoc | SubmissionDoc; kind: 'submission' | 'work' } | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [submittedJob, setSubmittedJob] = useState('')
  const [keywordInput, setKeywordInput] = useState(values.keyword)
  const limit = 48

  const query = {
    kind: submissionMode ? 'submissions' : 'works',
    state: mode === 'history' ? '' : mode,
    mode: mode === 'history' && submissionMode ? 'history' : '',
    channel: values.channel,
    author: values.author,
    character: values.character,
    type: values.type,
    format: values.format,
    keyword: values.keyword,
    topic: submissionMode ? '' : values.topic,
    page,
    limit,
  }
  const { data, authors, loading, refresh } = useConsoleList<WorkDoc | SubmissionDoc>(query)
  const counts = useConsoleCounts({
    kind: submissionMode ? 'submissions' : 'works',
    channel: values.channel,
    author: values.author,
    character: values.character,
    type: values.type,
    format: values.format,
    keyword: values.keyword,
    topic: submissionMode ? '' : values.topic,
  })
  const works = submissionMode ? [] : (data.docs as WorkDoc[])
  const submissions = submissionMode ? (data.docs as SubmissionDoc[]) : []
  const visible = submissionMode ? submissions : works

  useEffect(() => {
    if (!submissionMode && mode === 'history') set({ mode: 'published', page: 1 })
  }, [mode, set, submissionMode])
  useEffect(() => {
    setKeywordInput(values.keyword)
  }, [values.keyword])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (keywordInput === values.keyword) return
      set({ keyword: keywordInput, page: 1, submission: '', work: '' })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [keywordInput, set, values.keyword])

  useEffect(() => {
    setSelected((current) => current.filter((id) => data.docs.some((doc) => (submissionMode ? (doc as SubmissionDoc).submissionId : (doc as WorkDoc).workId) === id)))
  }, [data.docs, submissionMode])

  useEffect(() => {
    const workParam = values.work
    const submissionParam = values.submission
    if (!workParam && !submissionParam) {
      setActive(null)
      return
    }
    let live = true
    async function resolve() {
      try {
        if (workParam) {
          const work = await loadWork(workParam)
          if (live) {
            const index = works.findIndex((item) => String(item.id) === String(work.id))
            setActive({ index, item: work, kind: 'work' })
          }
        } else if (submissionParam) {
          const submission = await loadSubmission(submissionParam)
          if (live) {
            const index = submissions.findIndex((item) => item.submissionId === submission.submissionId)
            setActive({ index, item: submission, kind: 'submission' })
          }
        }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : '条目读取失败')
      }
    }
    void resolve()
    return () => {
      live = false
    }
    // 只在 URL 标识变化时重新解析；列表轮询不改变当前抽屉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.submission, values.work, works.length, submissions.length])

  async function loadWork(value: string): Promise<WorkDoc> {
    if (/^\d+$/.test(value)) return get<WorkDoc>(`/works/${value}`, { depth: 2 })
    const found = await get<{ docs: WorkDoc[] }>('/works', {
      'where[workId][equals]': value,
      depth: 2,
      limit: 1,
      pagination: false,
    })
    if (!found.docs[0]) throw new Error('作品不存在或已被删除')
    return found.docs[0]
  }

  async function loadSubmission(value: string): Promise<SubmissionDoc> {
    const found = await get<{ docs: SubmissionDoc[] }>('/submissions', {
      'where[submissionId][equals]': value,
      depth: 2,
      limit: 1,
      pagination: false,
    })
    if (found.docs[0]) return found.docs[0]
    if (/^\d+$/.test(value)) return get<SubmissionDoc>(`/submissions/${value}`, { depth: 2 })
    throw new Error('投稿不存在或已被删除')
  }

  function toggle(id: string) {
    const doc = data.docs.find((item) => (submissionMode ? (item as SubmissionDoc).submissionId : (item as WorkDoc).workId) === id)
    const job = doc?.activeJob?.jobId ? doc.activeJob : null
    if (job) {
      setMessage('这条内容已有后台任务在执行，完成前不能重复提交。')
      return
    }
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  function openItem(kind: 'submission' | 'work', item: WorkDoc | SubmissionDoc, index: number) {
    setActive({ index, item, kind })
    if (kind === 'work') set({ work: String((item as WorkDoc).id), submission: '' }, { mode: 'push' })
    else set({ submission: (item as SubmissionDoc).submissionId, work: '' }, { mode: 'push' })
  }

  function closeDrawer() {
    setActive(null)
    set({ work: '', submission: '' })
  }

  function navigate(offset: number) {
    if (!active || active.index < 0) return
    const nextIndex = active.index + offset
    const item = visible[nextIndex]
    if (!item) return
    openItem(submissionMode ? 'submission' : 'work', item, nextIndex)
  }

  async function bulk(action: 'hide' | 'remove') {
    if (!selected.length || busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await mutate<{
        affected?: string[]
        errors?: string[]
        failed?: string[]
        results?: Array<{ id: string; status: string }>
        skipped?: string[]
        workIds?: string[]
      }>('/works/bulk', 'POST', { action, ids: selected })
      const results = result.results || []
      const failedFromResults = results.filter((item) => item.status === 'failed').map((item) => item.id)
      const failed = result.failed?.length ? result.failed : failedFromResults
      const skipped = result.skipped || results.filter((item) => item.status === 'skipped').map((item) => item.id)
      const affected = result.affected?.length || result.workIds?.length || results.filter((item) => item.status === 'succeeded').length
      setSelected(failed)
      refresh()
      setMessage(
        `已处理 ${affected} 项${skipped.length ? `，跳过 ${skipped.length} 项` : ''}${failed.length ? `，失败 ${failed.length} 项（已保留选择）` : ''}。${
          action === 'hide' ? '隐藏要等发布成功后生效。' : '移除要等发布成功后生效。'
        }`,
      )
      if (result.errors?.length) setError(result.errors.join('；'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量操作失败')
    } finally {
      setBusy(false)
    }
  }

  const countFor = (tab: ReviewTab) => {
    if (!counts || tab === 'history') return undefined
    return counts[tab]
  }

  const activeFilters: ActiveFilter[] = []
  if (values.channel !== 'all') activeFilters.push({ key: 'channel', label: '渠道', value: labelOf(CHANNELS, values.channel), onRemove: () => set({ channel: 'all', page: 1, submission: '', work: '' }) })
  if (values.author) activeFilters.push({ key: 'author', label: '作者', value: values.author === NO_AUTHOR ? '未署名' : values.author, onRemove: () => set({ author: '', page: 1 }) })
  if (values.character) {
    const character = characters.find((item) => String(item.characterId) === values.character)
    activeFilters.push({ key: 'character', label: '角色', value: character?.name || values.character, onRemove: () => set({ character: '', page: 1 }) })
  }
  if (values.type) {
    const category = categories.find((item) => String(item.categoryId) === values.type)
    activeFilters.push({ key: 'type', label: '类型', value: category?.name || values.type, onRemove: () => set({ type: '', page: 1 }) })
  }
  if (values.format) activeFilters.push({ key: 'format', label: '格式', value: FORMAT_OPTIONS.find((item) => item.value === values.format)?.label || values.format, onRemove: () => set({ format: '', page: 1 }) })
  if (!submissionMode && values.topic) activeFilters.push({
    key: 'topic',
    label: '专题',
    value: values.topic === 'none' ? '未进任何专题' : topics.find((item) => item.topicId === values.topic)?.name || values.topic,
    onRemove: () => set({ topic: '', page: 1 }),
  })
  if (values.keyword) activeFilters.push({ key: 'keyword', label: '关键词', value: values.keyword, onRemove: () => { setKeywordInput(''); set({ keyword: '', page: 1 }) } })

  return (
    <Gutter className="s3-admin-page s3-workspace">
      <PageHeader
        description="每张图片只有一个处理状态；先看需要你判断或介入的条目，已上线单独查看。"
        title="投稿审核"
      />
      <CurrentTopicBar topics={topics} />
      <div className="s3-review-kind" role="group" aria-label="审核对象">
        <div className="s3-segmented">
          <button
            aria-pressed={submissionMode}
            onClick={() => set({ kind: 'submissions', page: 1, submission: '', work: '' })}
            type="button"
          >
            投稿
          </button>
          <button
            aria-pressed={!submissionMode}
            onClick={() =>
              set({
                kind: 'works',
                mode: ['history', 'needs_review', 'rejected'].includes(mode) ? 'needs_publish' : mode,
                page: 1,
                submission: '',
                work: '',
              })
            }
            type="button"
          >
            作品
          </button>
        </div>
        <span className="s3-muted">{submissionMode ? '按投稿处理状态查看' : '按作品处理状态查看'}</span>
      </div>
      <div className="s3-segmented s3-mode-tabs" role="tablist" aria-label="处理状态">
        {MODE_TABS.filter((tab) => submissionMode || tab.value !== 'history').map((tab) => (
          <button
            aria-pressed={mode === tab.value}
            key={tab.value}
            onClick={() => set({ mode: tab.value, page: 1, submission: '', work: '' })}
            role="tab"
            type="button"
          >
            {tab.label}
            {countFor(tab.value) != null ? <span className="s3-segmented-count">{countFor(tab.value)}</span> : null}
          </button>
        ))}
      </div>
      <FilterSummary
        active={activeFilters}
        countLabel={`${submissionMode ? '共' : '共'} ${data.totalDocs || 0} ${submissionMode ? '条投稿' : '件作品'}`}
        loading={loading}
        onClear={() => {
          setKeywordInput('')
          set({ author: '', channel: 'all', character: '', format: '', keyword: '', page: 1, topic: '', type: '', submission: '', work: '' })
        }}
        range={data.totalDocs ? `第 ${page} 页 / 共 ${data.totalPages || 1} 页` : ''}
      >
        <label>
          渠道
          <select onChange={(event) => set({ channel: event.target.value, page: 1, submission: '', work: '' })} value={values.channel}>
            <option value="all">全部渠道</option>
            {CHANNELS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          作者
          <select onChange={(event) => set({ author: event.target.value, page: 1, submission: '', work: '' })} value={values.author}>
            <option value="">全部作者</option>
            {authors.map((item) => (
              <option key={item.value || NO_AUTHOR} value={item.value || NO_AUTHOR}>
                {item.value || '未署名'}（{item.count}）
              </option>
            ))}
          </select>
        </label>
        <label>
          角色
          <select onChange={(event) => set({ character: event.target.value, page: 1, submission: '', work: '' })} value={values.character}>
            <option value="">全部角色</option>
            <option value="unknown">角色未知</option>
            {characters.map((item) => (
              <option key={String(item.id)} value={String(item.characterId)}>
                {item.name || item.characterId}
              </option>
            ))}
          </select>
        </label>
        <label>
          类型
          <select onChange={(event) => set({ type: event.target.value, page: 1, submission: '', work: '' })} value={values.type}>
            <option value="">全部类型</option>
            <option value="unknown">类型未知</option>
            {categories.map((item) => (
              <option key={String(item.id)} value={String(item.categoryId)}>
                {item.name || item.categoryId}
              </option>
            ))}
          </select>
        </label>
        <label>
          格式
          <select onChange={(event) => set({ format: event.target.value, page: 1, submission: '', work: '' })} value={values.format}>
            {FORMAT_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {!submissionMode ? (
          <label>
            专题归属
            <select onChange={(event) => set({ topic: event.target.value, page: 1, work: '' })} value={values.topic}>
              <option value="">全部专题状态</option>
              <option value="none">未进任何专题</option>
              {topics.map((topic) => (
                <option key={String(topic.id)} value={topic.topicId}>
                  {topic.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="s3-search-field">
          关键词
          <input onChange={(event) => setKeywordInput(event.target.value)} placeholder="名称、标签、作者或 ID" value={keywordInput} />
        </label>
      </FilterSummary>

      {message ? <p className="s3-notice" role="status">{message}</p> : null}
      {error ? <p className="s3-danger-copy" role="alert">{error}</p> : null}
      {submittedJob ? <JobProgress jobId={submittedJob} onClose={() => setSubmittedJob('')} /> : null}
      {loading && !data.docs.length ? <p className="s3-loading">正在读取审核队列…</p> : null}
      {!loading && !data.docs.length ? (
        <div className="s3-empty s3-empty--action">
          <h3>当前筛选下没有条目</h3>
          <p>清除筛选，或切换到其他状态继续处理。</p>
          <button className="s3-button s3-button--secondary" onClick={() => { setKeywordInput(''); set({ author: '', channel: 'all', character: '', format: '', keyword: '', page: 1, type: '' }) }} type="button">
            清除全部筛选
          </button>
        </div>
      ) : null}

      {canBulk ? (
        <div className="s3-result-toolbar">
          <span className="s3-muted">批量选择</span>
          <div className="s3-page-actions">
            <button
              className="s3-text-button"
              onClick={() =>
                setSelected((current) => [
                  ...new Set([
                    ...current,
                    ...visible.filter((doc) => !doc.activeJob?.jobId).map(listId).filter(Boolean),
                  ]),
                ])
              }
              type="button"
            >
              选择本页
            </button>
            <button className="s3-text-button" onClick={() => setSelected([])} type="button">
              清空选择
            </button>
          </div>
        </div>
      ) : null}
      <section className="s3-card-grid" aria-busy={loading}>
        {!submissionMode &&
          works.map((work, index) => (
            <WorkCard
              key={String(work.id)}
              metrics={work.metrics}
              onAddToTopic={() => setQuickAddWorks([work])}
              onOpen={() => openItem('work', work, index)}
              onSelect={() => toggle(work.workId)}
              selected={selected.includes(work.workId)}
              work={work}
            />
          ))}
        {submissionMode &&
          submissions.map((submission, index) => {
            const image = submissionImageURL(submission)
            const activeJob = submission.activeJob?.jobId ? submission.activeJob : null
            const enriched: SubmissionDoc & { processingState?: string } = submission
            const processState = enriched.processingState || (activeJob ? 'processing' : submission.state)
            return (
              <article className={`s3-card ${selected.includes(submission.submissionId) ? 's3-card--selected' : ''} ${activeJob ? 's3-card--busy' : ''}`} key={String(submission.id)}>
                <label className="s3-select">
                  <input
                    checked={selected.includes(submission.submissionId)}
                    disabled={Boolean(activeJob)}
                    onChange={() => toggle(submission.submissionId)}
                    type="checkbox"
                  />
                  <span>{activeJob ? '处理中' : '选择'}</span>
                </label>
                <button className="s3-card-main" onClick={() => openItem('submission', submission, index)} type="button">
                  <div className="s3-card-image">
                    {image ? <img alt={submission.title} loading="lazy" src={image} /> : <span>暂无预览图</span>}
                    {activeJob ? <span className="s3-card-job">处理中 {activeJob.cursor || 0}/{activeJob.total || '?'}</span> : null}
                  </div>
                  <div className="s3-card-content">
                    <div className="s3-card-title-row">
                      <h3>{submission.title}</h3>
                      <span className={`s3-status s3-status--${processState}`}>
                        {PROCESS_STATE_LABELS[processState] || SUBMISSION_STATES[submission.state] || processState}
                      </span>
                    </div>
                    <p>{String(submission.fields?.characterId || submission.fields?.character || '角色未知')}</p>
                    <p className="s3-card-meta">
                      {labelOf(CHANNELS, submission.source)}
                      {submission.work ? ` · 已关联作品 ${typeof submission.work === 'object' ? submission.work.name : submission.work}` : ''}
                    </p>
                    <p className="s3-card-reason">
                      原因：{String(submission.review?.reason || submission.agentProgress?.lastError || '未记录，请核对图片与来源。')}
                    </p>
                    <div className="s3-card-footer">
                      <span className="s3-card-confidence">
                        AI 置信度：{typeof submission.review?.confidence === 'number' ? `${Math.round(submission.review.confidence * 100)}%` : '未记录'}
                      </span>
                      <span className="s3-card-meta">
                        {submission.agentProgress?.stage ? STAGE_LABELS[submission.agentProgress.stage] || submission.agentProgress.stage : '等待下一步'}
                      </span>
                    </div>
                  </div>
                </button>
              </article>
            )
          })}
      </section>

      <Pagination
        limit={limit}
        page={data.page || page}
        setPage={(next) => set({ page: next, submission: '', work: '' })}
        totalDocs={data.totalDocs}
        totalPages={data.totalPages || 1}
      />
      <BulkBar count={canBulk ? selected.length : 0}>
        {!submissionMode ? (
          <button
            className="s3-button s3-button--secondary"
            onClick={() => setQuickAddWorks(works.filter((work) => selected.includes(work.workId)))}
            type="button"
          >
            加入专题
          </button>
        ) : null}
        <BulkTools
          categories={categories}
          characters={characters}
          ids={selected}
          onSubmitted={(jobId) => {
            setSelected([])
            if (jobId) setSubmittedJob(jobId)
            setMessage('批量任务已接收；关闭页面后仍会继续执行，进度和逐项结果会显示在这里。')
            window.dispatchEvent(new Event('s3-bulk-submitted'))
          }}
          target={submissionMode ? 'submissions' : 'works'}
        />
        {mode === 'needs_publish' ? (
          <button className="s3-button s3-button--danger" disabled={busy} onClick={() => void bulk('remove')} type="button">
            批量移除
          </button>
        ) : null}
        {mode === 'published' ? (
          <button className="s3-button s3-button--warning" disabled={busy} onClick={() => void bulk('hide')} type="button">
            批量隐藏
          </button>
        ) : null}
      </BulkBar>

      {active ? (
        <WorkDrawer
          activeJob={active.item.activeJob?.jobId ? active.item.activeJob : null}
          categories={categories}
          characters={characters}
          hasNext={active.index >= 0 && active.index < visible.length - 1}
          hasPrev={active.index > 0}
          item={active.kind === 'work' ? { kind: 'work', work: active.item as WorkDoc } : { kind: 'submission', submission: active.item as SubmissionDoc }}
          key={`${active.kind}:${active.item.id}`}
          onAddToTopic={(work) => setQuickAddWorks([work])}
          onClose={closeDrawer}
          onNavigate={navigate}
          onSaved={refresh}
        />
      ) : null}
      {quickAddWorks?.length ? (
        <CollectToTopic
          works={quickAddWorks}
          open
          onChanged={() => {
            refresh()
            setMessage('专题成员已更新；作品本身的上线状态未改变。')
          }}
          onClose={() => setQuickAddWorks(null)}
        />
      ) : null}
    </Gutter>
  )
}
