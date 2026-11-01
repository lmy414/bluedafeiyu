'use client'

import React, { useEffect, useMemo, useState } from 'react'

import { APIError, useAdminApi } from './api'
import { formatDate } from './constants'
import { Modal } from './Modal'
import type { TopicDoc, WorkDoc } from './types'
import { relationID } from './types'
import { useCurrentTopic } from './useCurrentTopic'

type FailedItem = { error?: string; id: string }

type CollectResult = {
  added?: string[]
  already?: string[]
  alreadyAbsent?: string[]
  error?: string
  failed?: FailedItem[]
  kept?: FailedItem[]
  removed?: string[]
  skipped?: string[]
  topicId: string
  undoToken?: string
}

type QuickResult = {
  added?: string[]
  already?: string[]
  doc: TopicDoc
  failed?: FailedItem[]
  skipped?: string[]
  undoToken?: string
}

function generatedTopicId() {
  return `topic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function sameWork(topic: TopicDoc, work: WorkDoc) {
  return (topic.works || []).some((item) => {
    const id = String(relationID(item) || item)
    return id === String(work.id) || id === work.workId
  })
}

function mergeTopics(base: TopicDoc[], incoming: TopicDoc[]) {
  const map = new Map(base.map((topic) => [String(topic.id), topic]))
  for (const topic of incoming) map.set(String(topic.id), topic)
  return [...map.values()]
}

export function CollectToTopic({
  onChanged,
  onClose,
  open,
  works,
}: {
  onChanged: () => void
  onClose: () => void
  open: boolean
  works: WorkDoc[]
}) {
  const { get, mutate } = useAdminApi()
  const { current, setCurrent } = useCurrentTopic()
  const [recent, setRecent] = useState<TopicDoc[]>([])
  const [topics, setTopics] = useState<TopicDoc[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [page, setPage] = useState(1)
  const [totalDocs, setTotalDocs] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busyTopic, setBusyTopic] = useState('')
  const [results, setResults] = useState<Record<string, CollectResult>>({})
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const workIds = works.map((work) => work.workId)
  const count = workIds.length
  const selectionKey = [...workIds].sort().join(',')

  useEffect(() => {
    setResults({})
    setMessage('')
    setError('')
    setNotice('')
    setNewName('')
    setSearch('')
    setPage(1)
  }, [selectionKey])

  useEffect(() => {
    if (!open) return
    let live = true
    setLoading(true)
    void get<{ docs: TopicDoc[]; totalDocs?: number; totalPages?: number }>('/topics', {
      depth: 0,
      limit: 12,
      page: 1,
      sort: '-updatedAt',
    })
      .then((result) => {
        if (!live) return
        setRecent(result.docs || [])
        setTopics(result.docs || [])
        setTotalDocs(Number(result.totalDocs || result.docs?.length || 0))
        setTotalPages(Number(result.totalPages || 1))
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : '专题读取失败')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [get, open])

  useEffect(() => {
    if (!open) return
    const keyword = search.trim()
    if (!keyword) {
      setTopics(recent)
      setPage(1)
      setTotalPages(1)
      setTotalDocs(recent.length)
      setSearching(false)
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      setSearching(true)
      void get<{ docs: TopicDoc[]; totalDocs?: number; totalPages?: number }>('/topics', {
        depth: 0,
        limit: 20,
        page: 1,
        sort: '-updatedAt',
        'where[or][0][name][like]': keyword,
        'where[or][1][topicId][like]': keyword,
      })
        .then((result) => {
          if (!live) return
          setTopics(result.docs || [])
          setPage(1)
          setTotalDocs(Number(result.totalDocs || result.docs?.length || 0))
          setTotalPages(Number(result.totalPages || 1))
        })
        .catch((cause) => {
          if (live) setError(cause instanceof Error ? cause.message : '专题搜索失败')
        })
        .finally(() => {
          if (live) setSearching(false)
        })
    }, 300)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [get, open, recent, search])

  const selectedMembers = useMemo(() => {
    const map = new Map<string, number>()
    for (const topic of topics) {
      const result = results[topic.topicId]
      if (result) {
        map.set(topic.topicId, (result.added?.length || 0) + (result.already?.length || 0))
      } else {
        map.set(topic.topicId, works.filter((work) => sameWork(topic, work)).length)
      }
    }
    return map
  }, [results, topics, works])

  async function addTo(topic: TopicDoc) {
    if (busyTopic || creating) return
    setBusyTopic(topic.topicId)
    setError('')
    setNotice('')
    setMessage('')
    try {
      const result = await mutate<Omit<CollectResult, 'topicId'>>(
        `/topics/${encodeURIComponent(topic.topicId)}/works`,
        'POST',
        { workIds },
      )
      const previous = results[topic.topicId]
      const next: CollectResult = {
        ...result,
        added: [...new Set([...(previous?.added || []), ...(result.added || [])])],
        already: result.already || [],
        topicId: topic.topicId,
        undoToken: result.undoToken || previous?.undoToken,
      }
      setResults((currentResults) => ({ ...currentResults, [topic.topicId]: next }))
      setCurrent({ id: String(topic.id), name: topic.name, topicId: topic.topicId })
      setNotice(
        `「${topic.name}」新增 ${next.added?.length || 0} 件${
          next.already?.length ? `；${next.already.length} 件原已在专题` : ''
        }${next.skipped?.length ? `；跳过 ${next.skipped.length} 件` : ''}${
          next.failed?.length ? `；失败 ${next.failed.length} 件` : ''
        }。`,
      )
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加入专题失败')
    } finally {
      setBusyTopic('')
    }
  }

  async function undo(topic: TopicDoc) {
    const result = results[topic.topicId]
    if (!result?.added?.length || busyTopic) return
    if (!result.undoToken) {
      setError('服务器没有返回可撤销令牌，本次不能原地撤销。')
      return
    }
    setBusyTopic(topic.topicId)
    setError('')
    try {
      const response = await mutate<{
        alreadyAbsent?: string[]
        kept?: FailedItem[]
        removed?: string[]
      }>('/topics/membership/undo', 'POST', { undoToken: result.undoToken })
      const removed = response?.removed || []
      const alreadyAbsent = response?.alreadyAbsent || []
      const kept = response?.kept || []
      setResults((currentResults) => ({
        ...currentResults,
        [topic.topicId]: {
          ...result,
          added: [],
          alreadyAbsent,
          kept,
          removed,
          undoToken: undefined,
        },
      }))
      setNotice(
        kept.length
          ? `已撤销 ${removed.length} 件；${alreadyAbsent.length} 件已不在专题；${kept.length} 件保留（可能受封面保护），请查看原因。`
          : `已撤销 ${removed.length} 件${alreadyAbsent.length ? `；${alreadyAbsent.length} 件已不在专题` : ''}。`,
      )
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '撤销失败')
    } finally {
      setBusyTopic('')
    }
  }

  async function createAndCollect() {
    const name = newName.trim()
    if (!name) {
      setError('请先填写专题中文名称。')
      return
    }
    if (creating || busyTopic) return
    setCreating(true)
    setError('')
    setNotice('')
    try {
      let createdResult: QuickResult | null = null
      try {
        createdResult = await mutate<QuickResult>('/topics/quick', 'POST', {
          name,
          requestId: crypto.randomUUID(),
          workIds,
        })
      } catch (cause) {
        if (!(cause instanceof APIError) || cause.status !== 404) throw cause
        const fallback = await mutate<{ doc: TopicDoc }>('/topics', 'POST', {
          name,
          summary: '待补充简介',
          topicId: generatedTopicId(),
          status: 'draft',
          order: 0,
          works: works.map((work) => Number(work.id)),
        })
        createdResult = fallback?.doc ? { doc: fallback.doc } : null
      }
      const created = createdResult?.doc
      if (!created) throw new Error('新建专题未返回专题信息')
      const nextTopic: TopicDoc = {
        ...created,
        name: created.name || name,
        works: created.works || (works.map((work) => work.id) as TopicDoc['works']),
      }
      setRecent((items) => mergeTopics([nextTopic], items))
      setTopics((items) => mergeTopics([nextTopic], items))
      setResults((currentResults) => ({
        ...currentResults,
        [nextTopic.topicId]: {
          added: createdResult?.added?.length ? createdResult.added : workIds,
          already: createdResult?.already || [],
          failed: createdResult?.failed || [],
          skipped: createdResult?.skipped || [],
          topicId: nextTopic.topicId,
          undoToken: createdResult?.undoToken,
        },
      }))
      setCurrent({ id: String(nextTopic.id), name: nextTopic.name, topicId: nextTopic.topicId })
      setNewName('')
      setNotice(`已新建草稿「${nextTopic.name}」并收录 ${count} 件。中文简介和英日翻译可稍后补充。`)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '新建专题失败')
    } finally {
      setCreating(false)
    }
  }

  async function loadMore() {
    if (searching || loading || page >= totalPages) return
    setLoading(true)
    try {
      const keyword = search.trim()
      const params: Record<string, string | number> = {
        depth: 0,
        limit: 20,
        page: page + 1,
        sort: '-updatedAt',
      }
      if (keyword) {
        params['where[or][0][name][like]'] = keyword
        params['where[or][1][topicId][like]'] = keyword
      }
      const result = await get<{ docs: TopicDoc[]; totalPages?: number }>('/topics', params)
      setTopics((items) => mergeTopics(items, result.docs || []))
      setPage((value) => value + 1)
      if (result.totalPages) setTotalPages(result.totalPages)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载更多专题失败')
    } finally {
      setLoading(false)
    }
  }

  function rowResult(topic: TopicDoc) {
    const result = results[topic.topicId]
    if (!result) return null
    const added = result.added?.length || 0
    const already = result.already?.length || 0
    const removed = result.removed?.length || 0
    const kept = result.kept?.length || 0
    return (
      <div className="s3-collect-result" role="status">
        <span>
          {removed
            ? `已撤销 ${removed} 件`
            : added
              ? `已加入 ${added} 件`
              : already
                ? `已在专题 ${already} 件`
                : '服务器未新增成员'}
          {already && added ? ` · 原已在专题 ${already} 件` : ''}
          {result.failed?.length ? ` · 失败 ${result.failed.length} 件` : ''}
          {kept ? ` · 保留 ${kept} 件` : ''}
        </span>
        {added && result.undoToken ? (
          <button className="s3-text-button s3-text-button--danger" disabled={Boolean(busyTopic)} onClick={() => void undo(topic)} type="button">
            撤销本次新增
          </button>
        ) : null}
        {result.failed?.length || kept ? (
          <details>
            <summary>查看失败或保留项</summary>
            <ul>
              {(result.failed || []).map((item) => (
                <li key={`failed-${item.id}`}>
                  <code>{item.id}</code> {item.error || '加入失败'}
                </li>
              ))}
              {(result.kept || []).map((item) => (
                <li key={`kept-${item.id}`}>
                  <code>{item.id}</code> {item.error || '保留在专题'}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    )
  }

  return (
    <Modal
      actions={
        <button className="s3-button s3-button--ghost" onClick={onClose} type="button">
          完成
        </button>
      }
      onClose={onClose}
      open={open}
      showCancel={false}
      size="wide"
      title="加入专题"
    >
      <p className="s3-muted">已选 {count} 件作品；只建立专题关系，不改作品状态、审核结论或发布状态。</p>
      {current ? (
        <div className="s3-current-topic-hint">
          当前整理专题：<strong title={current.topicId}>{current.name}</strong>
        </div>
      ) : null}
      {notice ? <p className="s3-notice" role="status">{notice}</p> : null}
      {error ? <p className="s3-danger-copy" role="alert">{error}</p> : null}
      {message ? <p className="s3-muted">{message}</p> : null}
      <label className="s3-collect-search">
        <span className="s3-sr-only">搜索专题</span>
        <input onChange={(event) => setSearch(event.target.value)} placeholder="搜索专题名称" value={search} />
      </label>
      <div className="s3-collect-list" aria-busy={loading || searching}>
        {!search.trim() ? <p className="s3-eyebrow">最近专题</p> : <p className="s3-eyebrow">搜索结果</p>}
        {loading && !topics.length ? <p className="s3-muted">正在读取专题…</p> : null}
        {topics.map((topic) => {
          const memberCount = selectedMembers.get(topic.topicId) || 0
          const allMembers = memberCount === count && count > 0
          return (
            <div className={`s3-collect-row ${allMembers ? 'is-member' : ''}`} key={String(topic.id)}>
              <button
                className="s3-collect-topic"
                disabled={Boolean(busyTopic) || creating}
                onClick={() => void addTo(topic)}
                type="button"
              >
                <span>
                  <strong title={topic.topicId}>{topic.name}</strong>
                  <small>
                    {topic.status === 'active' ? '已上线' : '草稿'} · 更新{' '}
                    {formatDate(String((topic as TopicDoc & { updatedAt?: string }).updatedAt || ''))}
                  </small>
                </span>
                <span className={allMembers ? 's3-status s3-status--published' : 's3-status s3-status--pending'}>
                  {allMembers
                    ? '已在专题'
                    : busyTopic === topic.topicId
                      ? '正在提交…'
                      : memberCount
                        ? `加入（已有 ${memberCount}）`
                        : '加入'}
                </span>
              </button>
              {rowResult(topic)}
            </div>
          )
        })}
        {!loading && !searching && !topics.length ? <p className="s3-muted">没有匹配专题，可直接新建。</p> : null}
        {page < totalPages ? (
          <button className="s3-button s3-button--ghost" disabled={loading} onClick={() => void loadMore()} type="button">
            {loading ? '加载中…' : `加载更多专题（${page}/${totalPages}）`}
          </button>
        ) : null}
        {search.trim() && totalDocs ? <p className="s3-muted">服务端匹配 {totalDocs} 个专题</p> : null}
      </div>
      <section className="s3-collect-create">
        <p className="s3-eyebrow">新建并立即收录</p>
        <div>
          <input
            aria-label="新专题中文名称"
            onChange={(event) => setNewName(event.target.value)}
            placeholder="只填中文名称，后续补简介和翻译"
            value={newName}
          />
          <button className="s3-button s3-button--primary" disabled={creating || !newName.trim()} onClick={() => void createAndCollect()} type="button">
            {creating ? '正在创建…' : `新建草稿并收录 ${count} 件`}
          </button>
        </div>
        <p className="s3-muted">新建的是草稿专题；不会自动精选，也不会改变作品上线状态。</p>
      </section>
    </Modal>
  )
}
