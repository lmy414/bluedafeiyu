'use client'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Gutter } from '@payloadcms/ui'
import { useSearchParams } from 'next/navigation'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { useAdminApi } from '../components/admin/api'
import { CHANNELS, labelOf } from '../components/admin/constants'
import { JobProgress, useBulkJob } from '../components/admin/JobProgress'
import { PageHeader } from '../components/admin/PageHeader'
import { StatusBadge } from '../components/admin/StatusBadge'
import type { ListResponse, TopicAuthor, TopicDoc, WorkDoc } from '../components/admin/types'
import { relationID, workImageURL } from '../components/admin/types'

type ChannelDraft = {
  id?: string
  label: string
  platform: string
  url: string
}

type TopicDraft = {
  author: {
    bio: string
    channels: ChannelDraft[]
    name: string
    url: string
  }
  cover: string
  name: string
  nameEn: string
  nameJa: string
  order: number
  status: 'active' | 'draft'
  summary: string
  summaryEn: string
  summaryJa: string
  topicId: string
  works: string[]
}

type TopicTranslation = {
  translationError?: string | null
  translationJobId?: string | null
  translationSourceHash?: string | null
  translationState?: 'failed' | 'none' | 'queued' | 'ready' | 'running' | 'stale' | null
  translationUpdatedAt?: string | null
}

const TRANSLATION_LABELS: Record<string, string> = {
  failed: '翻译失败',
  none: '尚未翻译',
  queued: '翻译已排队',
  ready: '英日翻译已就绪',
  running: '正在生成翻译',
  stale: '中文已修改，译文可能过期',
}

type BackendAuthor = {
  bio: string | null
  channels: Array<{ id?: string; label?: string; platform: string; url: string }>
  name: string
  url: string | null
}

const EMPTY_DRAFT: TopicDraft = {
  author: { bio: '', channels: [], name: '', url: '' },
  cover: '',
  name: '',
  nameEn: '',
  nameJa: '',
  order: 0,
  status: 'draft',
  summary: '',
  summaryEn: '',
  summaryJa: '',
  topicId: '',
  works: [],
}

function asAuthor(value: TopicDoc['author']): TopicAuthor | undefined {
  return value && typeof value === 'object' ? value : undefined
}

function draftFromTopic(topic: TopicDoc): TopicDraft {
  const author = asAuthor(topic.author)
  return {
    author: {
      bio: author?.bio || '',
      channels: (author?.channels || []).map((channel) => ({
        ...(channel.id ? { id: String(channel.id) } : {}),
        label: channel.label || '',
        platform: channel.platform || '',
        url: channel.url || '',
      })),
      name: author?.name || '',
      url: author?.url || '',
    },
    cover: String(relationID(topic.cover) || ''),
    name: topic.name || '',
    nameEn: String((topic as TopicDoc & { nameEn?: string }).nameEn || ''),
    nameJa: String((topic as TopicDoc & { nameJa?: string }).nameJa || ''),
    order: Number(topic.order || 0),
    status: topic.status || 'draft',
    summary: topic.summary || '',
    summaryEn: String((topic as TopicDoc & { summaryEn?: string }).summaryEn || ''),
    summaryJa: String((topic as TopicDoc & { summaryJa?: string }).summaryJa || ''),
    topicId: topic.topicId || '',
    works: (topic.works || []).map((item) => String(relationID(item))).filter(Boolean),
  }
}

function SortableWork({
  cover,
  index,
  onCover,
  onMove,
  onRemove,
  work,
}: {
  cover: boolean
  index: number
  onCover: () => void
  onMove: (offset: number) => void
  onRemove: () => void
  work: WorkDoc
}) {
  const sortable = useSortable({ id: String(work.id) })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }
  return (
    <li
      className="s3-sortable-row"
      onKeyDown={(event) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
        event.preventDefault()
        onMove(event.key === 'ArrowUp' ? -1 : 1)
      }}
      ref={sortable.setNodeRef}
      style={style}
      tabIndex={0}
    >
      <button className="s3-drag-handle" type="button" {...sortable.attributes} {...sortable.listeners}>
        ↕
      </button>
      {workImageURL(work) ? <img alt="" src={workImageURL(work)} /> : <span className="s3-work-thumb-placeholder">图</span>}
      <div>
        <strong>{work.name}</strong>
        <small>
          {work.workId} · {formatLabel(work)}
        </small>
      </div>
      <div className="s3-sortable-actions">
        <button aria-label="上移" className="s3-cover-button" disabled={index === 0} onClick={() => onMove(-1)} type="button">
          ↑
        </button>
        <button aria-label="下移" className="s3-cover-button" onClick={() => onMove(1)} type="button">
          ↓
        </button>
        <button className={cover ? 's3-cover-button s3-cover-button--active' : 's3-cover-button'} onClick={onCover} type="button">
          {cover ? '当前封面' : '设为封面'}
        </button>
        <button className="s3-text-button s3-text-button--danger" onClick={onRemove} type="button">
          移除
        </button>
      </div>
    </li>
  )
}

function formatLabel(work: WorkDoc): string {
  const raw = String(work.format || '').toLowerCase()
  if (raw.includes('gif')) return 'GIF'
  if (raw) return raw.toUpperCase()
  return '格式未知'
}

function isHttpUrl(value: string): boolean {
  const raw = value.trim()
  if (!raw || /\s/.test(raw) || raw.includes('\\')) return false
  if (!/^https?:\/\/[^\s/?#\\]/.test(raw)) return false
  try {
    const parsed = new URL(raw)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

const NO_AUTHOR_CHANNELS = '作者型专题至少需要一个渠道作为首选联系方式。'

function validateAuthorDraft(author: TopicDraft['author']): string | null {
  const name = author.name.trim()
  const homepage = author.url.trim()
  const bio = author.bio.trim()
  const channels = author.channels
  if (!name && !homepage && !bio && !channels.length) return null
  if (!name) return '作者型专题必须填写作者名。'
  if (homepage && !isHttpUrl(homepage)) return '作者主页链接不是有效的 http/https 地址。'
  if (!channels.length) return NO_AUTHOR_CHANNELS
  for (const [index, channel] of channels.entries()) {
    const position = index + 1
    if (!channel.platform.trim()) return `渠道 ${position} 需要填写平台名。`
    const url = channel.url.trim()
    if (!url) return `渠道 ${position} 需要填写链接。`
    if (!isHttpUrl(url)) return `渠道 ${position} 的链接不是有效的 http/https 地址。`
  }
  return null
}

function authorPayload(author: TopicDraft['author']): BackendAuthor | null {
  const name = author.name.trim()
  const channels = author.channels
    .filter((channel) => channel.platform.trim() && channel.url.trim())
    .map((channel) => ({
      ...(channel.id ? { id: channel.id } : {}),
      label: channel.label.trim(),
      platform: channel.platform.trim(),
      url: channel.url.trim(),
    }))
  if (!name && !channels.length) return null
  const url = author.url.trim()
  const bio = author.bio.trim()
  return {
    url: url || null,
    bio: bio || null,
    name,
    channels,
  }
}

export function TopicsView() {
  const { get, mutate } = useAdminApi()
  const searchParams = useSearchParams()
  const requestedTopic = searchParams.get('topic') || ''
  const [topics, setTopics] = useState<TopicDoc[]>([])
  const [workCache, setWorkCache] = useState<Record<string, WorkDoc>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TopicDraft>(EMPTY_DRAFT)
  const [draftAtOpen, setDraftAtOpen] = useState(JSON.stringify(EMPTY_DRAFT))
  const [translationJobId, setTranslationJobId] = useState('')
  const [translationBusy, setTranslationBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<WorkDoc[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const dirty = JSON.stringify(draft) !== draftAtOpen
  const selectedTopic = topics.find((topic) => String(topic.id) === selectedId) as
    | (TopicDoc & TopicTranslation)
    | undefined
  const { job: translationJob } = useBulkJob(translationJobId)
  const translationDone = useRef('')
  const selectedWorks = draft.works.map((id) => workCache[id]).filter(Boolean) as WorkDoc[]

  useEffect(() => {
    if (!translationJobId || !translationJob) return
    if (!['succeeded', 'partial', 'failed', 'cancelled'].includes(translationJob.status)) return
    if (translationDone.current === translationJobId) return
    translationDone.current = translationJobId
    if (translationJob.status === 'succeeded') {
      setMessage('英日翻译已写入；可以展开检查并人工修改。')
      setError('')
    } else {
      setError(translationJob.agentError || '翻译任务失败，未覆盖已有中文或人工译文。')
    }
    void load(selectedId)
  }, [selectedId, translationJob, translationJobId])

  function remember(list: WorkDoc[], into: Record<string, WorkDoc> = {}) {
    for (const work of list) into[String(work.id)] = work
    return into
  }

  async function load(preferredId?: string | null) {
    setLoading(true)
    try {
      const topicResult = await get<ListResponse<TopicDoc>>('/topics', {
        depth: 2,
        limit: 1000,
        pagination: false,
        sort: 'order',
      })
      const nextTopics = topicResult.docs || []
      const cache: Record<string, WorkDoc> = {}
      for (const topic of nextTopics) {
        for (const item of topic.works || []) if (item && typeof item === 'object') remember([item as WorkDoc], cache)
        if (topic.cover && typeof topic.cover === 'object') remember([topic.cover as WorkDoc], cache)
      }
      setTopics(nextTopics)
      setWorkCache((current) => ({ ...current, ...cache }))
      const requested = preferredId || requestedTopic
      const requestedTopicDoc = requested
        ? nextTopics.find((topic) => String(topic.id) === requested || topic.topicId === requested)
        : undefined
      const nextID = requestedTopicDoc
        ? String(requestedTopicDoc.id)
        : selectedId && nextTopics.some((topic) => String(topic.id) === selectedId)
          ? selectedId
          : nextTopics[0]
            ? String(nextTopics[0].id)
            : null
      setSelectedId(nextID)
      const nextDraft = nextID ? draftFromTopic(nextTopics.find((topic) => String(topic.id) === nextID) as TopicDoc) : EMPTY_DRAFT
      setDraft(nextDraft)
      setDraftAtOpen(JSON.stringify(nextDraft))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '专题数据读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(requestedTopic || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!requestedTopic || !topics.length) return
    const topic = topics.find((item) => item.topicId === requestedTopic || String(item.id) === requestedTopic)
    if (topic && String(topic.id) !== selectedId) chooseTopic(topic)
    // chooseTopic 的未保存保护会在用户已有修改时询问。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTopic, topics.length])

  useEffect(() => {
    let live = true
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      void get<{ docs: WorkDoc[] }>('/console/list', {
        kind: 'works',
        keyword: search.trim(),
        sort: 'latest',
        page: 1,
        limit: 30,
      })
        .then((result) => {
          if (!live) return
          setSearchResults(result.docs || [])
          setWorkCache((current) => ({ ...current, ...remember(result.docs || []) }))
          setSearchLoading(false)
        })
        .catch((cause) => {
          if (!live) return
          setError(cause instanceof Error ? cause.message : '作品搜索失败')
          setSearchLoading(false)
        })
    }, 300)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [get, search])

  function chooseTopic(topic?: TopicDoc) {
    const nextID = topic ? String(topic.id) : null
    if (dirty && nextID !== selectedId) {
      if (!window.confirm('当前专题有未保存修改，切换后会丢失。继续切换？')) return
    }
    setSelectedId(nextID)
    const nextDraft = topic ? draftFromTopic(topic) : EMPTY_DRAFT
    setDraft(nextDraft)
    setDraftAtOpen(JSON.stringify(nextDraft))
    setMessage('')
    setError('')
    setSearch('')
    setTranslationJobId('')
    translationDone.current = ''
  }

  function toggleWork(work: WorkDoc) {
    const id = String(work.id)
    setWorkCache((current) => ({ ...current, [id]: work }))
    setDraft((current) => ({
      ...current,
      cover: current.cover || id,
      works: current.works.includes(id) ? current.works.filter((value) => value !== id) : [...current.works, id],
    }))
  }

  function moveWork(index: number, offset: number) {
    setDraft((current) => {
      const target = index + offset
      if (target < 0 || target >= current.works.length) return current
      return { ...current, works: arrayMove(current.works, index, target) }
    })
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = draft.works.indexOf(String(active.id))
    const newIndex = draft.works.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    setDraft({ ...draft, works: arrayMove(draft.works, oldIndex, newIndex) })
  }

  function updateAuthor(patch: Partial<TopicDraft['author']>) {
    setDraft((current) => ({ ...current, author: { ...current.author, ...patch } }))
  }

  function updateChannel(index: number, patch: Partial<ChannelDraft>) {
    setDraft((current) => ({
      ...current,
      author: {
        ...current.author,
        channels: current.author.channels.map((channel, i) => (i === index ? { ...channel, ...patch } : channel)),
      },
    }))
  }

  function addAuthorChannel() {
    setDraft((current) => ({
      ...current,
      author: { ...current.author, channels: [...current.author.channels, { label: '', platform: '', url: '' }] },
    }))
  }

  function removeAuthorChannel(index: number) {
    setDraft((current) => ({
      ...current,
      author: { ...current.author, channels: current.author.channels.filter((_, i) => i !== index) },
    }))
  }

  function moveAuthorChannel(index: number, offset: number) {
    setDraft((current) => {
      const target = index + offset
      const channels = current.author.channels
      if (target < 0 || target >= channels.length) return current
      return { ...current, author: { ...current.author, channels: arrayMove(channels, index, target) } }
    })
  }

  async function save(options: { quiet?: boolean } = {}): Promise<{ doc: TopicDoc; id: string } | null> {
    if (saving) return null
    setMessage('')
    setError('')
    if (!draft.name.trim()) {
      setError('中文名称不能为空；简介和翻译可以稍后补。')
      return null
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.topicId)) {
      setError('topicId 必须是 kebab-case。')
      return null
    }
    const authorError = validateAuthorDraft(draft.author)
    if (authorError) {
      setError(authorError)
      return null
    }
    setSaving(true)
    const data = {
      author: authorPayload(draft.author),
      cover: draft.cover ? Number(draft.cover) : undefined,
      name: draft.name,
      nameEn: draft.nameEn || undefined,
      nameJa: draft.nameJa || undefined,
      order: Number(draft.order) || 0,
      status: draft.status,
      summary: draft.summary,
      summaryEn: draft.summaryEn || undefined,
      summaryJa: draft.summaryJa || undefined,
      topicId: draft.topicId,
      works: draft.works.map(Number),
    }
    try {
      const result = selectedId
        ? await mutate<TopicDoc | { doc: TopicDoc }>(`/topics/${encodeURIComponent(selectedId)}`, 'PATCH', data)
        : await mutate<TopicDoc | { doc: TopicDoc }>('/topics', 'POST', data)
      const savedDoc = result && typeof result === 'object' && 'doc' in result ? result.doc : (result as TopicDoc)
      const savedId = savedDoc?.id ? String(savedDoc.id) : selectedId
      if (!options.quiet) setMessage('专题已保存并标记为待发布；公开站点要等发布成功后更新。')
      await load(savedId)
      return savedId ? { doc: savedDoc, id: savedId } : null
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '专题保存失败')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function generateTranslation() {
    if (translationBusy || saving) return
    if (!draft.name.trim()) {
      setError('先填写中文名称，再生成英日翻译。')
      return
    }
    if (!draft.summary.trim()) {
      setError('先补充中文简介，再生成英日翻译；简介可以稍后保存。')
      return
    }
    setTranslationBusy(true)
    setError('')
    setMessage('')
    try {
      if (!selectedId || dirty) {
        const saved = await save({ quiet: true })
        if (!saved) return
        setMessage('中文草稿已保存，正在提交翻译任务…')
      }
      const response = await mutate<{ job: { jobId: string }; sourceHash?: string }>(
        '/topics/translate',
        'POST',
        {
          draft: { name: draft.name, summary: draft.summary },
          requestId: crypto.randomUUID(),
          topicId: draft.topicId,
        },
      )
      setTranslationJobId(response.job.jobId)
      translationDone.current = ''
      setMessage(`翻译任务已接收（${response.job.jobId}）；英日译文完成前不会覆盖现有内容。`)
      if (selectedId) await load(selectedId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '翻译任务提交失败')
    } finally {
      setTranslationBusy(false)
    }
  }

  const topicIdFrozen = Boolean(selectedId)
  const authorChannels = draft.author.channels
  const orderedSelected = useMemo(() => selectedWorks, [selectedWorks])

  return (
    <Gutter className="s3-admin-page s3-topic-page">
      <PageHeader
        actions={
          <button className="s3-button s3-button--primary" disabled={loading} onClick={() => chooseTopic()} type="button">
            新建专题
          </button>
        }
        description="中文文案优先；英日翻译可折叠生成后人工校对。作品只能由站长人工关联。"
        title="专题"
      />
      {message ? <p className="s3-notice" role="status">{message}</p> : null}
      {error ? <p className="s3-danger-copy" role="alert">{error}</p> : null}
      <div className="s3-topic-layout">
        <aside className="s3-topic-list">
          <h2>专题列表</h2>
          <button
            className={selectedId === null ? 's3-topic-list-item s3-topic-list-item--active' : 's3-topic-list-item'}
            onClick={() => chooseTopic()}
            type="button"
          >
            <span className="s3-topic-list-cover s3-topic-list-cover--new">＋</span>
            <span><strong>新建专题</strong><small>从作品库选择内容</small></span>
          </button>
          {topics.map((topic) => {
            const cover = topic.cover && typeof topic.cover === 'object' ? (topic.cover as WorkDoc) : undefined
            return (
              <button
                className={String(topic.id) === selectedId ? 's3-topic-list-item s3-topic-list-item--active' : 's3-topic-list-item'}
                key={String(topic.id)}
                onClick={() => chooseTopic(topic)}
                type="button"
              >
                <span className="s3-topic-list-cover">{cover && workImageURL(cover) ? <img alt="" src={workImageURL(cover)} /> : '无'}</span>
                <span>
                  <strong>{topic.name}</strong>
                  <small>{topic.topicId} · {topic.works?.length || 0} 件</small>
                  <StatusBadge status={topic.status} />
                </span>
              </button>
            )
          })}
        </aside>

        <main className="s3-topic-editor">
          <section className="s3-panel" id="topic-basic">
            <div className="s3-panel-heading">
              <div>
                <p className="s3-eyebrow">第 1 步</p>
                <h2>基本信息</h2>
              </div>
              {dirty ? <span className="s3-status s3-status--draft">未保存修改</span> : <span className="s3-status s3-status--published">已保存</span>}
            </div>
            <div className="s3-form-grid">
              <label>
                专题 ID（创建后冻结）
                <input
                  disabled={topicIdFrozen}
                  onChange={(event) => setDraft({ ...draft, topicId: event.target.value })}
                  value={draft.topicId}
                />
                <small>{topicIdFrozen ? '已创建专题的 ID 只读，避免公开链接和导出数据漂移。' : '仅允许小写字母、数字和连字符。'}</small>
              </label>
              <label>
                状态
                <select onChange={(event) => setDraft({ ...draft, status: event.target.value as 'active' | 'draft' })} value={draft.status}>
                  <option value="draft">草稿</option>
                  <option value="active">上线</option>
                </select>
              </label>
              <label>
                排序
                <input onChange={(event) => setDraft({ ...draft, order: Number(event.target.value) })} type="number" value={draft.order} />
              </label>
              <label className="s3-form-span">
                中文名称<span className="s3-required">必填</span>
                <input onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} />
              </label>
              <label className="s3-form-span">
                中文简介
                <textarea onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder="可以先留空，保存草稿后再补" rows={4} value={draft.summary} />
              </label>
            </div>
            <details className="s3-translation-section">
              <summary>
                <span>英日翻译</span>
                <span className={`s3-status s3-status--${selectedTopic?.translationState || 'draft'}`}>
                  {TRANSLATION_LABELS[selectedTopic?.translationState || 'none'] || '翻译状态未记录'}
                </span>
              </summary>
              <div className="s3-translation-toolbar">
                <div>
                  <p className="s3-muted">
                    中文保存后生成英日译文；生成任务只改翻译字段，不改作品、封面、作者和专题 ID。
                    手动修改英日后，中文再次变化会使旧译文过期。
                  </p>
                  {selectedTopic?.translationState === 'stale' ? (
                    <p className="s3-danger-copy">中文已修改，现有英日译文可能过期，请更新翻译后再发布。</p>
                  ) : null}
                  {dirty && ['ready', 'stale'].includes(selectedTopic?.translationState || '') ? (
                    <p className="s3-notice">当前有未保存的中文修改；保存后请更新翻译，以免旧译文覆盖。</p>
                  ) : null}
                  {selectedTopic?.translationError ? <p className="s3-danger-copy">{selectedTopic.translationError}</p> : null}
                </div>
                <button
                  className="s3-button s3-button--secondary"
                  disabled={translationBusy || saving || !draft.name.trim() || !draft.summary.trim() || ['queued', 'running'].includes(translationJob?.status || '')}
                  onClick={() => void generateTranslation()}
                  type="button"
                >
                  {!draft.summary.trim()
                    ? '先补中文简介'
                    : translationBusy || translationJob?.status === 'queued'
                      ? '翻译已排队…'
                      : translationJob?.status === 'running'
                        ? '正在翻译…'
                        : ['ready', 'stale'].includes(selectedTopic?.translationState || '')
                          ? '更新英日翻译'
                          : '生成英日翻译'}
                </button>
              </div>
              {translationJobId ? (
                <JobProgress
                  job={translationJob || undefined}
                  jobId={translationJob ? undefined : translationJobId}
                  showLinks={false}
                />
              ) : null}
              <div className="s3-form-grid">
                <label className="s3-form-span">英文名称<input onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} value={draft.nameEn} /></label>
                <label className="s3-form-span">英文简介<textarea onChange={(event) => setDraft({ ...draft, summaryEn: event.target.value })} rows={4} value={draft.summaryEn} /></label>
                <label className="s3-form-span">日文名称<input onChange={(event) => setDraft({ ...draft, nameJa: event.target.value })} value={draft.nameJa} /></label>
                <label className="s3-form-span">日文简介<textarea onChange={(event) => setDraft({ ...draft, summaryJa: event.target.value })} rows={4} value={draft.summaryJa} /></label>
              </div>
            </details>
          </section>

          <section className="s3-panel" id="topic-works">
            <div className="s3-panel-heading">
              <div>
                <p className="s3-eyebrow">第 2 步</p>
                <h2>作品编排</h2>
              </div>
              <span className="s3-muted">已收录 {draft.works.length} 件</span>
            </div>
            <div className="s3-topic-works">
              <div className="s3-topic-picker">
                <div className="s3-panel-heading">
                  <h3>从作品库加入</h3>
                  <input onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、标签或 ID" value={search} />
                </div>
                <p className="s3-muted">可在全部作品中搜索名称、标签或 ID。</p>
                <div className="s3-topic-work-list" aria-busy={searchLoading}>
                  {searchResults.map((work) => (
                    <label className="s3-topic-work-item" key={String(work.id)}>
                      <input checked={draft.works.includes(String(work.id))} onChange={() => toggleWork(work)} type="checkbox" />
                      {workImageURL(work) ? <img alt="" src={workImageURL(work)} /> : <span className="s3-work-thumb-placeholder">图</span>}
                      <span>
                        <strong>{work.name}</strong>
                        <small>{labelOf(CHANNELS, work.channel)} · {work.workId} · {formatLabel(work)}</small>
                      </span>
                    </label>
                  ))}
                  {searchLoading ? <p className="s3-muted">正在搜索…</p> : null}
                  {!searchLoading && !searchResults.length ? <p className="s3-muted">没有匹配作品。</p> : null}
                </div>
              </div>
              <div className="s3-topic-selected">
                <div className="s3-panel-heading">
                  <h3>已收录作品</h3>
                  <span className="s3-muted">Alt + ↑/↓ 排序</span>
                </div>
                <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} sensors={sensors}>
                  <SortableContext items={draft.works} strategy={verticalListSortingStrategy}>
                    <ul className="s3-sortable-list">
                      {orderedSelected.map((work, index) => (
                        <SortableWork
                          cover={draft.cover === String(work.id)}
                          index={index}
                          key={String(work.id)}
                          onCover={() => setDraft({ ...draft, cover: String(work.id) })}
                          onMove={(offset) => moveWork(index, offset)}
                          onRemove={() =>
                            setDraft({
                              ...draft,
                              cover: draft.cover === String(work.id) ? '' : draft.cover,
                              works: draft.works.filter((id) => id !== String(work.id)),
                            })
                          }
                          work={work}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
                {!orderedSelected.length ? <p className="s3-empty">从左侧勾选作品后，可在这里排序、设封面。</p> : null}
              </div>
            </div>
          </section>

          <section className="s3-panel s3-author-block" id="topic-author">
            <div className="s3-panel-heading">
              <div>
                <p className="s3-eyebrow">第 3 步 · 选填</p>
                <h2>作者资料</h2>
              </div>
            </div>
            <p className="s3-muted">
              整组可留空。填写任意一项时，需要作者名和至少一个完整渠道；第一项为首选联系方式。
            </p>
            <div className="s3-form-grid">
              <label>
                作者名
                <input onChange={(event) => updateAuthor({ name: event.target.value })} placeholder="可留空；填写后为作者型专题必填" value={draft.author.name} />
              </label>
              <label>
                作者主页（选填）
                <input onChange={(event) => updateAuthor({ url: event.target.value })} placeholder="https://…" value={draft.author.url} />
              </label>
              <label className="s3-form-span">
                作者简介（选填）
                <textarea onChange={(event) => updateAuthor({ bio: event.target.value })} rows={3} value={draft.author.bio} />
              </label>
            </div>

            <div className="s3-author-channels">
              <div className="s3-panel-heading">
                <div>
                  <p className="s3-eyebrow">按列表顺序展示</p>
                  <h3>联系方式</h3>
                </div>
                <button className="s3-button s3-button--secondary" onClick={addAuthorChannel} type="button">
                  添加渠道
                </button>
              </div>
              {!authorChannels.length ? <p className="s3-empty">暂无渠道；作者型专题至少需要一项，第一项即首选联系方式。</p> : null}
              <ul className="s3-channel-list">
                {authorChannels.map((channel, index) => (
                  <li className={index === 0 ? 's3-channel-row s3-channel-row--primary' : 's3-channel-row'} key={channel.id || `channel-${index}`}>
                    <div className="s3-channel-head">
                      <span className={index === 0 ? 's3-status s3-status--active' : 's3-status'}>{index === 0 ? '首选联系方式' : `渠道 ${index + 1}`}</span>
                      <div className="s3-channel-actions">
                        <button className="s3-icon-button" disabled={index === 0} onClick={() => moveAuthorChannel(index, -1)} title="上移" type="button">↑</button>
                        <button className="s3-icon-button" disabled={index === authorChannels.length - 1} onClick={() => moveAuthorChannel(index, 1)} title="下移" type="button">↓</button>
                        <button className="s3-text-button s3-text-button--danger" onClick={() => removeAuthorChannel(index)} type="button">删除</button>
                      </div>
                    </div>
                    <div className="s3-form-grid">
                      <label>
                        平台
                        <input onChange={(event) => updateChannel(index, { platform: event.target.value })} placeholder="如 Bilibili" value={channel.platform} />
                      </label>
                      <label>
                        显示文本（选填）
                        <input onChange={(event) => updateChannel(index, { label: event.target.value })} placeholder="留空时显示平台名" value={channel.label} />
                      </label>
                      <label className="s3-form-span">
                        链接
                        <input onChange={(event) => updateChannel(index, { url: event.target.value })} placeholder="https://…" value={channel.url} />
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <div className="s3-save-bar" role="region" aria-label="保存专题">
            <div>
              <strong>{dirty ? '有未保存修改' : '当前修改已保存'}</strong>
              <span className="s3-muted">
                {selectedId ? `编辑 ${draft.topicId || '未命名专题'} · 保存后标记待发布` : '新建专题 · 保存后仍待发布'}
              </span>
            </div>
            <div className="s3-page-actions">
              <button
                className="s3-button s3-button--ghost"
                disabled={!dirty || saving}
                onClick={() => {
                  if (!dirty) return
                  if (!window.confirm('放弃未保存修改？')) return
                  setDraft(selectedTopic ? draftFromTopic(selectedTopic) : EMPTY_DRAFT)
                  setDraftAtOpen(JSON.stringify(selectedTopic ? draftFromTopic(selectedTopic) : EMPTY_DRAFT))
                  setError('')
                }}
                type="button"
              >
                放弃修改
              </button>
              <button className="s3-button s3-button--primary" disabled={saving || !dirty} onClick={() => void save()} type="button">
                {saving ? '保存中…' : '保存专题'}
              </button>
            </div>
          </div>
        </main>
      </div>
    </Gutter>
  )
}
