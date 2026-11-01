'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'

type Mode = 'push' | 'replace'

/**
 * 列表筛选、页码和抽屉都写进 URL：刷新、前进后退、从任务中心直达都要保持同一视图。
 * 值等于默认值时从 URL 删除，避免地址栏堆满无意义参数。
 */
export function useUrlState(defaults: Record<string, string>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const defaultsKey = JSON.stringify(defaults)
  const values = useMemo(() => {
    const fallback = JSON.parse(defaultsKey) as Record<string, string>
    const next: Record<string, string> = {}
    for (const key of Object.keys(fallback)) next[key] = searchParams.get(key) ?? fallback[key]
    return next
    // searchParams identity changes on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, defaultsKey])

  const set = useCallback(
    (patch: Record<string, string | number | null | undefined>, options: { mode?: Mode; reset?: string[] } = {}) => {
      const fallback = JSON.parse(defaultsKey) as Record<string, string>
      const next = new URLSearchParams(searchParams.toString())
      for (const key of options.reset || []) next.delete(key)
      for (const [key, value] of Object.entries(patch)) {
        const text = value === null || value === undefined ? '' : String(value)
        if (!text || text === fallback[key]) next.delete(key)
        else next.set(key, text)
      }
      const query = next.toString()
      const href = `${pathname}${query ? `?${query}` : ''}`
      if (options.mode === 'push') router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [defaultsKey, pathname, router, searchParams],
  )

  return { values, set, searchParams, pathname }
}

export function pageRange(page: number, limit: number, totalDocs: number) {
  if (!totalDocs) return '0 条'
  const start = (page - 1) * limit + 1
  const end = Math.min(page * limit, totalDocs)
  return `${start}–${end} / 共 ${totalDocs}`
}
