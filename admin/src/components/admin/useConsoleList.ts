'use client'

import { useEffect, useState } from 'react'
import { type QueryValue, useAdminApi } from './api'
import type { CategoryDoc, CharacterDoc, ListResponse, TopicDoc } from './types'

type Vocabulary = { characters: CharacterDoc[]; categories: CategoryDoc[]; topics: TopicDoc[] }
const vocabCache = new Map<string, { at: number; pending: Promise<Vocabulary> }>()

export function useConsoleVocabulary() {
  const { get, apiRoute } = useAdminApi()
  const [vocab, setVocab] = useState<Vocabulary>({ characters: [], categories: [], topics: [] })
  useEffect(() => {
    let live = true
    let entry = vocabCache.get(apiRoute)
    if (!entry || Date.now() - entry.at > 60_000) {
      const pending = Promise.all([
        get<ListResponse<CharacterDoc>>('/characters', { depth: 0, limit: 1000, pagination: false }),
        get<ListResponse<CategoryDoc>>('/categories', { depth: 0, limit: 1000, pagination: false }),
        get<ListResponse<TopicDoc>>('/topics', {
          depth: 0,
          limit: 1000,
          pagination: false,
          'select[name]': true,
          'select[topicId]': true,
        }),
      ]).then(([c, t, topics]) => ({ characters: c.docs || [], categories: t.docs || [], topics: topics.docs || [] }))
      entry = { at: Date.now(), pending }
      vocabCache.set(apiRoute, entry)
    }
    const active = entry
    void active.pending
      .then((value) => {
        if (live) setVocab(value)
      })
      .catch(() => {
        if (vocabCache.get(apiRoute) === active) vocabCache.delete(apiRoute)
      })
    return () => {
      live = false
    }
  }, [apiRoute, get])
  return vocab
}

export function useConsoleList<T>(query: Record<string, QueryValue>) {
  const { get } = useAdminApi()
  const [data, setData] = useState<ListResponse<T> & { metricsAvailable?: boolean }>({ docs: [], totalDocs: 0, totalPages: 1 })
  const [authors, setAuthors] = useState<Array<{ value: string; count: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify(query)
  const { page: _page, author: _author, ...authorQuery } = query
  const authorKey = JSON.stringify(authorQuery)
  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    void get<typeof data>('/console/list', JSON.parse(key))
      .then((result) => {
        if (live) setData(result)
      })
      .catch((e) => {
        if (live) setError(e.message || '列表读取失败')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [get, key, revision])
  useEffect(() => {
    let live = true
    void get<{ authors: typeof authors }>('/console/authors', JSON.parse(authorKey))
      .then((result) => {
        if (live) setAuthors(result.authors || [])
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [get, authorKey, revision])
  return { data, authors, loading, error, refresh: () => setRevision((v) => v + 1) }
}
