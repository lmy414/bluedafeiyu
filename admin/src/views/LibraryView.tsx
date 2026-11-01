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
import { Modal } from '../components/admin/Modal'
import { PageHeader } from '../components/admin/PageHeader'
import { Pagination } from '../components/admin/Pagination'
import { WorkCard } from '../components/admin/WorkCard'
import { WorkDrawer } from '../components/admin/WorkDrawer'
import { CHANNELS, labelOf } from '../components/admin/constants'
import { useConsoleCounts, useConsoleList, useConsoleVocabulary } from '../components/admin/useConsoleList'
import { NO_AUTHOR, type WorkDoc } from '../components/admin/types'
import { useUrlState } from '../components/admin/useUrlState'

type LibraryStatus =
  | 'all'
  | 'blocked'
  | 'deleted'
  | 'hidden'
  | 'needs_publish'
  | 'needs_review'
  | 'processing'
  | 'published'
  | 'removed'
type BulkResponse = {
  affected?: string[]
  errors?: string[]
  failed?: string[]
  results?: Array<{ id: string; status: string }>
  skipped?: string[]
  workIds?: string[]
}

const STATUS_TABS: Array<{ label: string; value: LibraryStatus }> = [
  { label: '全部作品', value: 'all' },
  { label: '待判断', value: 'needs_review' },
  { label: '处理中', value: 'processing' },
  { label: '待发布改动', value: 'needs_publish' },
  { label: '已上线', value: 'published' },
  { label: '异常', value: 'blocked' },
  { label: '已隐藏', value: 'hidden' },
  { label: '已移除', value: 'removed' },
  { label: '已删除', value: 'deleted' },
]

const FORMAT_OPTIONS = [
  { label: '全部格式', value: '' },
  { label: 'GIF（原图格式）', value: 'gif' },
  { label: '非 GIF 图片', value: 'static' },
  { label: '格式未知', value: 'unknown' },
]

export function LibraryView() {
  const { get, mutate } = useAdminApi()
  const { values, set } = useUrlState({
    author: '',
    channel: '',
    character: '',
    format: '',
    keyword: '',
    page: '1',
    sort: 'latest',
    status: 'all',
    topic: '',
    type: '',
    work: '',
  })
  const requestedState = values.status === 'pending_publish' ? 'needs_publish' : values.status
  const statusKey = (STATUS_TABS.some((tab) => tab.value === requestedState) ? requestedState : 'all') as LibraryStatus
  const page = Math.max(1, Number(values.page) || 1)
  const { characters, categories, topics } = useConsoleVocabulary()
  const [activeWork, setActiveWork] = useState<WorkDoc | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [submittedJob, setSubmittedJob] = useState('')
  const [modal, setModal] = useState<'category' | 'delete' | null>(null)
  const [chosenCategories, setChosenCategories] = useState<string[]>([])
  const [quickAddWorks, setQuickAddWorks] = useState<WorkDoc[] | null>(null)
  const [deleteText, setDeleteText] = useState('')
  const [keywordInput, setKeywordInput] = useState(values.keyword)
  const limit = 48

  const query = {
    kind: 'works',
    state: statusKey === 'all' ? '' : statusKey,
    channel: values.channel,
    author: values.author,
    character: values.character,
    type: values.type,
    format: values.format,
    keyword: values.keyword,
    sort: values.sort,
    topic: values.topic,
    page,
    limit,
  }
  const { data, authors, loading, refresh } = useConsoleList<WorkDoc>(query)
  const counts = useConsoleCounts({
    kind: 'works',
    channel: values.channel,
    author: values.author,
    character: values.character,
    type: values.type,
    format: values.format,
    keyword: values.keyword,
    topic: values.topic,
  })
  const visible = data.docs
  const selectedWorks = visible.filter((work) => selected.includes(work.workId))
  const activeJobByWork = useMemo(() => {
    const map = new Map<string, NonNullable<WorkDoc['activeJob']>>()
    for (const work of visible) {
      if (work.activeJob?.jobId) map.set(work.workId, work.activeJob)
    }
    return map
  }, [visible])

  useEffect(() => {
    setKeywordInput(values.keyword)
  }, [values.keyword])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (keywordInput === values.keyword) return
      set({ keyword: keywordInput, page: 1, work: '' })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [keywordInput, set, values.keyword])

  useEffect(() => {
    setSelected((current) => current.filter((id) => visible.some((work) => work.workId === id)))
  }, [visible])

  useEffect(() => {
    if (!values.work) {
      setActiveWork(null)
      return
    }
    let live = true
    async function load() {
      try {
        let work: WorkDoc
        if (/^\d+$/.test(values.work)) work = await get<WorkDoc>(`/works/${values.work}`, { depth: 2 })
        else {
          const found = await get<{ docs: WorkDoc[] }>('/works', {
            'where[workId][equals]': values.work,
            depth: 2,
            limit: 1,
            pagination: false,
          })
          if (!found.docs[0]) throw new Error('作品不存在或已被删除')
          work = found.docs[0]
        }
        if (live) setActiveWork(work)
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : '作品读取失败')
      }
    }
    void load()
    return () => {
      live = false
    }
  }, [get, values.work])

  function toggle(id: string) {
    if (activeJobByWork.has(id)) {
      setMessage('这件作品已有后台任务在执行，完成前不能重复提交。')
      return
    }
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  function openWork(work: WorkDoc) {
    setActiveWork(work)
    set({ work: String(work.id) }, { mode: 'push' })
  }

  function closeDrawer() {
    setActiveWork(null)
    set({ work: '' })
  }

  function parseBulkResult(result: BulkResponse) {
    const results = result.results || []
    const failed = result.failed?.length ? result.failed : results.filter((item) => item.status === 'failed').map((item) => item.id)
    const skipped = result.skipped || results.filter((item) => item.status === 'skipped').map((item) => item.id)
    const affected = result.affected?.length || result.workIds?.length || results.filter((item) => item.status === 'succeeded').length
    return { affected, failed, skipped }
  }

  async function bulk(action: 'add-to-topic' | 'delete' | 'hide' | 'restore' | 'set-categories', extra: Record<string, unknown> = {}) {
    if (!selected.length || busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await mutate<BulkResponse>('/works/bulk', 'POST', { action, ids: selected, ...extra })
      const parsed = parseBulkResult(result)
      setSelected(parsed.failed)
      setModal(null)
      setDeleteText('')
      refresh()
      const suffix =
        action === 'set-categories'
          ? '已修改的内容会标记为待发布，发布成功后才上线。'
          : action === 'delete'
            ? '删除会在发布成功后生效。'
            : action === 'hide'
              ? '隐藏会在发布成功后生效。'
              : action === 'restore'
                ? '恢复会在发布成功后生效。'
                : '专题关系已在后台保存，发布成功后公开站点才更新。'
      setMessage(
        `已处理 ${parsed.affected} 项${parsed.skipped.length ? `，跳过 ${parsed.skipped.length} 项` : ''}${parsed.failed.length ? `，失败 ${parsed.failed.length} 项（已保留选择）` : ''}。${suffix}`,
      )
      if (result.errors?.length) setError(result.errors.join('；'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量操作失败')
      setMessage('')
    } finally {
      setBusy(false)
    }
  }

  const countFor = (status: LibraryStatus) => {
    if (!counts) return undefined
    return counts[status]
  }

  const activeFilters: ActiveFilter[] = []
  if (values.channel) activeFilters.push({ key: 'channel', label: '渠道', value: labelOf(CHANNELS, values.channel), onRemove: () => set({ channel: '', page: 1, work: '' }) })
  if (values.author) activeFilters.push({ key: 'author', label: '作者', value: values.author === NO_AUTHOR ? '未署名' : values.author, onRemove: () => set({ author: '', page: 1 }) })
  if (values.character) activeFilters.push({ key: 'character', label: '角色', value: characters.find((item) => String(item.characterId) === values.character)?.name || values.character, onRemove: () => set({ character: '', page: 1 }) })
  if (values.type) activeFilters.push({ key: 'type', label: '类型', value: categories.find((item) => String(item.categoryId) === values.type)?.name || values.type, onRemove: () => set({ type: '', page: 1 }) })
  if (values.format) activeFilters.push({ key: 'format', label: '格式', value: FORMAT_OPTIONS.find((item) => item.value === values.format)?.label || values.format, onRemove: () => set({ format: '', page: 1 }) })
  if (values.topic) activeFilters.push({
    key: 'topic',
    label: '专题',
    value: values.topic === 'none' ? '未进任何专题' : topics.find((item) => item.topicId === values.topic)?.name || values.topic,
    onRemove: () => set({ topic: '', page: 1 }),
  })
  if (values.keyword) activeFilters.push({ key: 'keyword', label: '关键词', value: values.keyword, onRemove: () => { setKeywordInput(''); set({ keyword: '', page: 1 }) } })

  return (
    <Gutter className="s3-admin-page s3-workspace">
      <PageHeader description="按处理状态和专题归属筛选全量作品；修改后先进入待发布，不会直接上线。" title="作品库" />
      <CurrentTopicBar topics={topics} />
      <div className="s3-segmented s3-status-tabs" role="tablist" aria-label="作品状态">
        {STATUS_TABS.map((tab) => (
          <button
            aria-pressed={statusKey === tab.value}
            key={tab.value}
            onClick={() => set({ status: tab.value, page: 1, work: '' })}
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
        countLabel={`共 ${data.totalDocs || 0} 件作品`}
        loading={loading}
        onClear={() => {
          setKeywordInput('')
          set({ author: '', channel: '', character: '', format: '', keyword: '', page: 1, topic: '', type: '', work: '' })
        }}
        range={data.totalDocs ? `第 ${page} 页 / 共 ${data.totalPages || 1} 页` : ''}
      >
        <label>
          排序
          <select onChange={(event) => set({ sort: event.target.value, page: 1 })} value={values.sort}>
            <option value="latest">最近修改</option>
            <option disabled={!data.metricsAvailable} value="popular">
              热度（浏览量）
            </option>
            <option disabled={!data.metricsAvailable} value="downloads">
              下载量
            </option>
          </select>
        </label>
        <label>
          渠道
          <select onChange={(event) => set({ channel: event.target.value, page: 1, work: '' })} value={values.channel}>
            <option value="">全部渠道</option>
            {CHANNELS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          角色
          <select onChange={(event) => set({ character: event.target.value, page: 1, work: '' })} value={values.character}>
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
          <select onChange={(event) => set({ type: event.target.value, page: 1, work: '' })} value={values.type}>
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
          <select onChange={(event) => set({ format: event.target.value, page: 1, work: '' })} value={values.format}>
            {FORMAT_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          专题
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
        <label>
          作者
          <select onChange={(event) => set({ author: event.target.value, page: 1, work: '' })} value={values.author}>
            <option value="">全部作者</option>
            {authors.map((item) => (
              <option key={item.value || NO_AUTHOR} value={item.value || NO_AUTHOR}>
                {item.value || '未署名'}（{item.count}）
              </option>
            ))}
          </select>
        </label>
        <label className="s3-search-field">
          关键词
          <input onChange={(event) => setKeywordInput(event.target.value)} placeholder="名称、标签、作者或 ID" value={keywordInput} />
        </label>
      </FilterSummary>

      {message ? <p className="s3-notice" role="status">{message}</p> : null}
      {error ? <p className="s3-danger-copy" role="alert">{error}</p> : null}
      {submittedJob ? <JobProgress jobId={submittedJob} onClose={() => setSubmittedJob('')} /> : null}
      {loading && !visible.length ? <p className="s3-loading">正在读取作品库…</p> : null}
      {!loading && !visible.length ? (
        <div className="s3-empty s3-empty--action">
          <h3>没有符合条件的作品</h3>
          <p>清除筛选或换一个状态。</p>
          <button className="s3-button s3-button--secondary" onClick={() => { setKeywordInput(''); set({ author: '', channel: '', character: '', format: '', keyword: '', page: 1, type: '', status: 'all' }) }} type="button">
            清除全部筛选
          </button>
        </div>
      ) : null}
      <div className="s3-result-toolbar">
        <span className="s3-muted">已选 {selected.length} 件</span>
        <div className="s3-page-actions">
          <button className="s3-text-button" onClick={() => setSelected((current) => [...new Set([...current, ...visible.filter((work) => !work.activeJob).map((work) => work.workId)])])} type="button">
            选择本页
          </button>
          <button className="s3-text-button" onClick={() => setSelected([])} type="button">
            清空选择
          </button>
        </div>
      </div>
      <section aria-busy={loading} className="s3-card-grid">
        {visible.map((work) => (
          <WorkCard
            key={String(work.id)}
            metrics={work.metrics}
            onAddToTopic={() => setQuickAddWorks([work])}
            onOpen={() => openWork(work)}
            onSelect={() => toggle(work.workId)}
            selected={selected.includes(work.workId)}
            work={work}
          />
        ))}
      </section>
      <Pagination
        limit={limit}
        page={data.page || page}
        setPage={(next) => set({ page: next, work: '' })}
        totalDocs={data.totalDocs}
        totalPages={data.totalPages || 1}
      />
      <BulkBar count={selected.length}>
        <BulkTools
          categories={categories}
          characters={characters}
          ids={selected}
          onSubmitted={(jobId) => {
            setSelected([])
            if (jobId) setSubmittedJob(jobId)
            setMessage('批量任务已接收；进度和逐项结果会显示在这里，关闭页面后仍会继续执行。')
            window.dispatchEvent(new Event('s3-bulk-submitted'))
          }}
          target="works"
        />
        <button className="s3-button s3-button--secondary" onClick={() => { setChosenCategories([]); setModal('category') }} type="button">
          改分类
        </button>
        <button className="s3-button s3-button--warning" onClick={() => void bulk('hide')} type="button">
          隐藏
        </button>
        <button className="s3-button s3-button--secondary" onClick={() => void bulk('restore')} type="button">
          恢复
        </button>
        <button className="s3-button s3-button--secondary" onClick={() => setQuickAddWorks(selectedWorks)} type="button">
          加入专题
        </button>
        <button className="s3-button s3-button--danger" onClick={() => setModal('delete')} type="button">
          删除
        </button>
      </BulkBar>

      {activeWork ? (
        <WorkDrawer
          activeJob={activeWork.activeJob?.jobId ? activeWork.activeJob : null}
          categories={categories}
          characters={characters}
          item={{ kind: 'work', work: activeWork }}
          key={String(activeWork.id)}
          onAddToTopic={(work) => setQuickAddWorks([work])}
          onClose={closeDrawer}
          onSaved={refresh}
        />
      ) : null}

      <Modal
        confirmLabel="保存分类"
        disabled={!chosenCategories.length || busy}
        onClose={() => setModal(null)}
        onConfirm={() => void bulk('set-categories', { categoryIds: chosenCategories })}
        open={modal === 'category'}
        title="批量修改分类"
      >
        <p>已选 {selected.length} 件。每张图只能保留一个类型；保存后标记为待发布。</p>
        <div className="s3-check-grid">
          {categories.map((category) => {
            const stableId = category.categoryId || String(category.id)
            return (
              <label className="s3-check" key={String(category.id)}>
                <input checked={chosenCategories.includes(stableId)} name="bulk-work-type" onChange={() => setChosenCategories([stableId])} type="radio" />
                {category.name || category.categoryId}
              </label>
            )
          })}
        </div>
      </Modal>

      <Modal
        confirmLabel="确认删除"
        danger
        disabled={deleteText !== '删除' || busy}
        onClose={() => {
          setModal(null)
          setDeleteText('')
        }}
        onConfirm={() => {
          if (deleteText === '删除') void bulk('delete', { confirm: 'DELETE' })
        }}
        open={modal === 'delete'}
        title="彻底删除作品"
      >
        <p className="s3-danger-copy">删除会在下一次发布成功后彻底移除作品和图片，不可恢复。</p>
        <label>
          请输入「删除」两个字以确认
          <input onChange={(event) => setDeleteText(event.target.value)} value={deleteText} />
        </label>
      </Modal>
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
