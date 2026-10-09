'use client'

import { Gutter } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

import { useAdminApi } from '../components/admin/api'
import { useConsoleList, useConsoleVocabulary } from '../components/admin/useConsoleList'
import { BulkJobsPanel, BulkTools } from '../components/admin/BulkTools'
import { BulkBar } from '../components/admin/BulkBar'
import { CHANNELS, WORK_STATUSES } from '../components/admin/constants'
import { Modal } from '../components/admin/Modal'
import { PageHeader } from '../components/admin/PageHeader'
import { Pagination } from '../components/admin/Pagination'
import { WorkCard } from '../components/admin/WorkCard'
import type { WorkDoc } from '../components/admin/types'
import { NO_AUTHOR } from '../components/admin/types'

export function LibraryView() {
  const { mutate } = useAdminApi()
  const { characters, categories, topics } = useConsoleVocabulary()
  const [channel, setChannel] = useState('')
  const [characterId, setCharacterId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('')
  const [author, setAuthor] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [message, setMessage] = useState('')
  const [modal, setModal] = useState<'category' | 'delete' | 'topic' | null>(null)
  const [chosenCategories, setChosenCategories] = useState<string[]>([])
  const [topicId, setTopicId] = useState('')
  const [deleteText, setDeleteText] = useState('')
  const [sort, setSort] = useState('latest')
  const [search, setSearch] = useState('')
  useEffect(() => { const timer = setTimeout(() => setSearch(keyword), 300); return () => clearTimeout(timer) }, [keyword])
  const { data, authors, loading, error, refresh } = useConsoleList<WorkDoc>({ kind: 'works', channel, status, author, character: characterId, category: categoryId, keyword: search, sort, page, limit: 48 })
  const totalPages = data.totalPages || 1
  const visible = data.docs
  useEffect(() => { if (data.page && data.page !== page) setPage(data.page) }, [data.page])

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  async function bulk(action: 'add-to-topic' | 'delete' | 'hide' | 'restore' | 'set-categories', extra: Record<string, unknown> = {}) {
    if (!selected.length) return
    setMessage('正在处理…')
    try {
      await mutate('/works/bulk', 'POST', { action, ids: selected, ...extra })
      setSelected([])
      setModal(null)
      setDeleteText('')
      refresh()
      setMessage('批量操作已完成。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量操作失败')
    }
  }

  useEffect(() => { setPage(1); setSelected([]) }, [author, categoryId, channel, characterId, search, sort, status])

  return (
    <Gutter className="s3-admin-page">
      <PageHeader description="统一筛选、搜索并批量维护后台作品。" title="作品库" />
      <section className="s3-filter-panel">
        <label>排序<select value={sort} onChange={event => setSort(event.target.value)}>
          <option value="latest">最近修改</option>
          <option value="popular" disabled={!data.metricsAvailable}>热度（浏览量）</option>
          <option value="downloads" disabled={!data.metricsAvailable}>下载量</option>
        </select></label>
        <label>
          渠道
          <select onChange={(event) => setChannel(event.target.value)} value={channel}>
            <option value="">全部渠道</option>
            {CHANNELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          角色
          <select onChange={(event) => setCharacterId(event.target.value)} value={characterId}>
            <option value="">全部角色</option>
            {characters.map((item) => <option key={String(item.id)} value={String(item.id)}>{item.name || item.characterId}</option>)}
          </select>
        </label>
        <label>
          分类
          <select onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
            <option value="">全部分类</option>
            {categories.map((item) => <option key={String(item.id)} value={String(item.id)}>{item.name || item.categoryId}</option>)}
          </select>
        </label>
        <label>
          状态
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="">全部状态</option>
            {WORK_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
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
        <label className="s3-search-field">
          搜索
          <input onChange={(event) => setKeyword(event.target.value)} placeholder="名称、标签、作者或 ID" value={keyword} />
        </label>
      </section>
      <div className="s3-result-line">
        <span>共 {data.totalDocs || 0} 件作品</span>
        <div>
          <button className="s3-text-button" onClick={() => setSelected(current => [...new Set([...current, ...visible.map(work => work.workId)])])} type="button">选择本页</button>
          <button className="s3-text-button" onClick={() => setSelected([])} type="button">清空选择</button>
        </div>
      </div>
      {message || error ? <p className="s3-notice">{message || error}</p> : null}
      {loading ? <p className="s3-loading">正在读取作品库…</p> : null}
      {!loading && !visible.length ? <div className="s3-empty">没有符合条件的作品。</div> : null}
      <section className="s3-card-grid">
        {visible.map((work) => (
          <WorkCard
            key={String(work.id)}
            metrics={work.metrics}
            onOpen={() => toggle(work.workId)}
            onSelect={() => toggle(work.workId)}
            selected={selected.includes(work.workId)}
            work={work}
          />
        ))}
      </section>
      <Pagination page={page} setPage={setPage} totalPages={totalPages} />
      <BulkBar count={selected.length}>
        <BulkTools ids={selected} target="works" characters={characters} categories={categories} onSubmitted={() => { setSelected([]); setMessage('后台任务已提交，关闭页面也会继续执行。') }} />
        <button className="s3-button s3-button--secondary" onClick={() => { setChosenCategories([]); setModal('category') }} type="button">改分类</button>
        <button className="s3-button s3-button--warning" onClick={() => void bulk('hide')} type="button">隐藏</button>
        <button className="s3-button s3-button--secondary" onClick={() => void bulk('restore')} type="button">恢复</button>
        <button className="s3-button s3-button--secondary" onClick={() => { setTopicId(topics[0]?.topicId || ''); setModal('topic') }} type="button">加入专题</button>
        <button className="s3-button s3-button--danger" onClick={() => setModal('delete')} type="button">删除</button>
      </BulkBar>

      <BulkJobsPanel onCompleted={refresh} />
      <Modal confirmLabel="保存分类" onClose={() => setModal(null)} onConfirm={() => void bulk('set-categories', { categoryIds: chosenCategories })} open={modal === 'category'} title="批量修改分类">
        <div className="s3-check-grid">
          {categories.map((category) => {
            const stableId = category.categoryId || String(category.id)
            return (
              <label className="s3-check" key={String(category.id)}>
                <input checked={chosenCategories.includes(stableId)} onChange={() => setChosenCategories([stableId])} name="bulk-work-type" type="radio" />
                {category.name || category.categoryId}
              </label>
            )
          })}
        </div>
      </Modal>

      <Modal confirmLabel="加入专题" onClose={() => setModal(null)} onConfirm={() => void bulk('add-to-topic', { topicId })} open={modal === 'topic'} title="加入专题">
        <label>
          选择专题
          <select onChange={(event) => setTopicId(event.target.value)} value={topicId}>
            {topics.map((topic) => <option key={String(topic.id)} value={topic.topicId}>{topic.name}（{topic.topicId}）</option>)}
          </select>
        </label>
      </Modal>

      <Modal confirmLabel="确认删除" danger onClose={() => { setModal(null); setDeleteText('') }} onConfirm={() => { if (deleteText === '删除') void bulk('delete', { confirm: 'DELETE' }) }} open={modal === 'delete'} title="彻底删除作品">
        <p className="s3-danger-copy">删除会在下次发布时彻底移除作品和图片，不可恢复。</p>
        <label>
          请输入「删除」两个字以确认
          <input onChange={(event) => setDeleteText(event.target.value)} value={deleteText} />
        </label>
        <button className="s3-button s3-button--danger" disabled={deleteText !== '删除'} onClick={() => void bulk('delete', { confirm: 'DELETE' })} type="button">我确认删除</button>
      </Modal>
    </Gutter>
  )
}
