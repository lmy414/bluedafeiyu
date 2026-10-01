'use client'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Gutter } from '@payloadcms/ui'
import React, { useEffect, useMemo, useState } from 'react'

import { useAdminApi } from '../components/admin/api'
import { CHANNELS, labelOf } from '../components/admin/constants'
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
  onCover,
  onRemove,
  work,
}: {
  cover: boolean
  onCover: () => void
  onRemove: () => void
  work: WorkDoc
}) {
  const sortable = useSortable({ id: String(work.id) })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }
  return (
    <li className="s3-sortable-row" ref={sortable.setNodeRef} style={style}>
      <button className="s3-drag-handle" type="button" {...sortable.attributes} {...sortable.listeners}>↕</button>
      {workImageURL(work) ? <img alt="" src={workImageURL(work)} /> : <span className="s3-work-thumb-placeholder">图</span>}
      <div>
        <strong>{work.name}</strong>
        <small>{work.workId}</small>
      </div>
      <button className={cover ? 's3-cover-button s3-cover-button--active' : 's3-cover-button'} onClick={onCover} type="button">{cover ? '当前封面' : '设为封面'}</button>
      <button className="s3-text-button s3-text-button--danger" onClick={onRemove} type="button">移除</button>
    </li>
  )
}

/**
 * 与服务端 isHttpUrl 对齐：先要求字面量 `http://` / `https://` 且 authority 以非空、
 * 非 `/?#\`、非空白字符开头（挡掉 `https://`、`https:///x`、反斜杠这些 new URL 会
 * 偷偷规范化的写法），再解析核对协议与主机名。
 */
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
  // 分组全空视为普通专题，不启动作者版式。
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

/**
 * 后端 author 分组：字段名与集合一致；返回 null 表示应清空（PATCH 时发送 null 而非省略）。
 * 作者仍存在时 url / bio 显式发送（空串发 null），否则 PATCH 省略字段会保留旧值。
 */
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
  const [topics, setTopics] = useState<TopicDoc[]>([])
  const [works, setWorks] = useState<WorkDoc[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TopicDraft>(EMPTY_DRAFT)
  const [language, setLanguage] = useState<'zh' | 'en' | 'ja'>('zh')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  async function load(preferredId?: string | null) {
    setLoading(true)
    try {
      const [topicResult, workResult] = await Promise.all([
        get<ListResponse<TopicDoc>>('/topics', { depth: 2, limit: 1000, pagination: false, sort: 'order' }),
        get<ListResponse<WorkDoc>>('/works', { depth: 1, limit: 3000, pagination: false, sort: '-updatedAt' }),
      ])
      const nextTopics = topicResult.docs || []
      setTopics(nextTopics)
      setWorks(workResult.docs || [])
      const nextID = preferredId && nextTopics.some((topic) => String(topic.id) === preferredId) ? preferredId : nextTopics[0] ? String(nextTopics[0].id) : null
      setSelectedId(nextID)
      setDraft(nextID ? draftFromTopic(nextTopics.find((topic) => String(topic.id) === nextID) as TopicDoc) : EMPTY_DRAFT)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '专题数据读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const selectedTopic = topics.find((topic) => String(topic.id) === selectedId)
  const selectedWorks = draft.works.map((id) => works.find((work) => String(work.id) === id)).filter(Boolean) as WorkDoc[]
  const searchResults = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return works
      .filter((work) => !needle || [work.name, work.workId, ...(work.tags || []).map((tag) => tag.value)].join(' ').toLowerCase().includes(needle))
      .slice(0, 120)
  }, [search, works])

  function chooseTopic(topic?: TopicDoc) {
    setSelectedId(topic ? String(topic.id) : null)
    setDraft(topic ? draftFromTopic(topic) : EMPTY_DRAFT)
    setMessage('')
  }

  function toggleWork(id: string) {
    setDraft((current) => ({
      ...current,
      cover: current.cover || id,
      works: current.works.includes(id) ? current.works.filter((value) => value !== id) : [...current.works, id],
    }))
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

  async function save() {
    if (!draft.name.trim() || !draft.summary.trim()) {
      setMessage('中文名称和简介为必填项。')
      return
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.topicId)) {
      setMessage('topicId 必须是 kebab-case。')
      return
    }
    const authorError = validateAuthorDraft(draft.author)
    if (authorError) {
      setMessage(authorError)
      return
    }
    setMessage('正在保存…')
    const data = {
      // 新建与 PATCH 都发送 author；清空时发 null，确保服务端确实移除原值。
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
      if (selectedId) {
        await mutate('/topics/' + encodeURIComponent(selectedId), 'PATCH', data)
      } else {
        await mutate('/topics', 'POST', data)
      }
      setMessage('专题已保存，并标记为待发布。')
      await load(selectedId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '专题保存失败')
    }
  }

  const authorChannels = draft.author.channels

  return (
    <Gutter className="s3-admin-page">
      <PageHeader
        actions={<button className="s3-button s3-button--primary" disabled={loading} onClick={() => chooseTopic()} type="button">新建专题</button>}
        description="管理专题三语文案、封面、收录顺序与上线状态。"
        title="专题"
      />
      {message ? <p className="s3-notice">{message}</p> : null}
      <div className="s3-topic-layout">
        <aside className="s3-topic-list">
          <h2>专题列表</h2>
          <button className={selectedId === null ? 's3-topic-list-item s3-topic-list-item--active' : 's3-topic-list-item'} onClick={() => chooseTopic()} type="button">
            <span className="s3-topic-list-cover s3-topic-list-cover--new">＋</span>
            <span><strong>新建专题</strong><small>从作品库选择内容</small></span>
          </button>
          {topics.map((topic) => {
            const cover = asWork(topic.cover)
            return (
              <button className={String(topic.id) === selectedId ? 's3-topic-list-item s3-topic-list-item--active' : 's3-topic-list-item'} key={String(topic.id)} onClick={() => chooseTopic(topic)} type="button">
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
          <section className="s3-panel">
            <div className="s3-language-tabs">
              <button className={language === 'zh' ? 's3-subtab s3-subtab--active' : 's3-subtab'} onClick={() => setLanguage('zh')} type="button">中文</button>
              <button className={language === 'en' ? 's3-subtab s3-subtab--active' : 's3-subtab'} onClick={() => setLanguage('en')} type="button">英文</button>
              <button className={language === 'ja' ? 's3-subtab s3-subtab--active' : 's3-subtab'} onClick={() => setLanguage('ja')} type="button">日文</button>
            </div>
            <div className="s3-form-grid">
              <label>
                topicId
                <input disabled={Boolean(selectedTopic?.status === 'active')} onChange={(event) => setDraft({ ...draft, topicId: event.target.value })} value={draft.topicId} />
                <small>上线后只读；仅允许小写字母、数字和连字符。</small>
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
              {language === 'zh' ? (
                <>
                  <label className="s3-form-span">中文名称<input onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label>
                  <label className="s3-form-span">中文简介<textarea onChange={(event) => setDraft({ ...draft, summary: event.target.value })} rows={4} value={draft.summary} /></label>
                </>
              ) : null}
              {language === 'en' ? (
                <>
                  <label className="s3-form-span">英文名称<input onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} value={draft.nameEn} /></label>
                  <label className="s3-form-span">英文简介<textarea onChange={(event) => setDraft({ ...draft, summaryEn: event.target.value })} rows={4} value={draft.summaryEn} /></label>
                </>
              ) : null}
              {language === 'ja' ? (
                <>
                  <label className="s3-form-span">日文名称<input onChange={(event) => setDraft({ ...draft, nameJa: event.target.value })} value={draft.nameJa} /></label>
                  <label className="s3-form-span">日文简介<textarea onChange={(event) => setDraft({ ...draft, summaryJa: event.target.value })} rows={4} value={draft.summaryJa} /></label>
                </>
              ) : null}
            </div>

            <div className="s3-form-section s3-author-block">
              <div className="s3-panel-heading">
                <div>
                  <p className="s3-eyebrow">选填 · 与语言无关</p>
                  <h2>来源作者</h2>
                </div>
              </div>
              <p className="s3-muted">
                整组可留空，留空时专题按普通版式展示。只要填写任意一项，就需要填写作者名，并至少保留一个完整渠道；
                渠道按列表顺序展示，第一项为首选联系方式，可添加、删除、上下移动。
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
                  <button className="s3-button s3-button--secondary" onClick={addAuthorChannel} type="button">添加渠道</button>
                </div>
                {!authorChannels.length ? (
                  <p className="s3-empty">暂无渠道；作者型专题至少需要一项，第一项即首选联系方式。</p>
                ) : null}
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
            </div>

            <button className="s3-button s3-button--primary" onClick={() => void save()} type="button">保存专题</button>
          </section>

          <section className="s3-topic-works">
            <div className="s3-panel s3-topic-picker">
              <div className="s3-panel-heading">
                <div><p className="s3-eyebrow">左侧</p><h2>从作品库加入</h2></div>
                <input onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、标签或 ID" value={search} />
              </div>
              <div className="s3-topic-work-list">
                {searchResults.map((work) => (
                  <label className="s3-topic-work-item" key={String(work.id)}>
                    <input checked={draft.works.includes(String(work.id))} onChange={() => toggleWork(String(work.id))} type="checkbox" />
                    {workImageURL(work) ? <img alt="" src={workImageURL(work)} /> : <span className="s3-work-thumb-placeholder">图</span>}
                    <span><strong>{work.name}</strong><small>{labelOf(CHANNELS, work.channel)} · {work.workId}</small></span>
                  </label>
                ))}
              </div>
            </div>
            <div className="s3-panel s3-topic-selected">
              <div className="s3-panel-heading"><div><p className="s3-eyebrow">右侧</p><h2>已收录作品</h2></div><span>{draft.works.length} 件</span></div>
              <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} sensors={sensors}>
                <SortableContext items={draft.works} strategy={verticalListSortingStrategy}>
                  <ul className="s3-sortable-list">
                    {selectedWorks.map((work) => (
                      <SortableWork
                        cover={draft.cover === String(work.id)}
                        key={String(work.id)}
                        onCover={() => setDraft({ ...draft, cover: String(work.id) })}
                        onRemove={() => setDraft({ ...draft, cover: draft.cover === String(work.id) ? '' : draft.cover, works: draft.works.filter((id) => id !== String(work.id)) })}
                        work={work}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              {!selectedWorks.length ? <p className="s3-empty">从左侧勾选作品后，可在这里拖动排序。</p> : null}
            </div>
          </section>
        </main>
      </div>
    </Gutter>
  )
}

function asWork(value: TopicDoc['cover']): WorkDoc | undefined {
  return value && typeof value === 'object' ? value as WorkDoc : undefined
}
