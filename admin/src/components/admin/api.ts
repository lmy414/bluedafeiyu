'use client'

import { useConfig } from '@payloadcms/ui'
import { useCallback } from 'react'

export class APIError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}

export type QueryValue = boolean | number | string | string[] | undefined

/** 按 Payload 页码读完整列表，不能把单页 limit 当成业务总量上限。 */
export async function getAllDocs<T>(
  get: <R>(path: string, params?: Record<string, QueryValue>) => Promise<R>,
  path: string,
  params: Record<string, QueryValue>,
): Promise<T[]> {
  const docs: T[] = []
  for (let page = 1; ; page += 1) {
    const result = await get<{ docs: T[]; hasNextPage?: boolean }>(path, { ...params, limit: 200, pagination: true, page })
    docs.push(...(result.docs || []))
    if (!result.hasNextPage) return docs
    if (!result.docs?.length) throw new Error('后台列表分页未前进')
  }
}

export function queryString(params: Record<string, QueryValue> = {}): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item)
    } else {
      query.set(key, String(value))
    }
  }
  const result = query.toString()
  return result ? `?${result}` : ''
}

export async function apiRequest<T>(
  apiRoute: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiRoute}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const data = (await response.json().catch(() => null)) as
    | { errors?: Array<{ message?: string }>; message?: string; error?: string }
    | T
    | null
  if (!response.ok) {
    const payload = data as { errors?: Array<{ message?: string }>; message?: string; error?: string } | null
    const message =
      payload?.errors?.[0]?.message || payload?.message || payload?.error || `请求失败（HTTP ${response.status}）`
    throw new APIError(message, response.status)
  }
  return data as T
}

export function useAdminApi() {
  const { config } = useConfig()
  const apiRoute = config.routes.api

  const get = useCallback(
    <T>(path: string, params?: Record<string, QueryValue>) =>
      apiRequest<T>(apiRoute, `${path}${queryString(params)}`),
    [apiRoute],
  )

  const mutate = useCallback(
    <T>(path: string, method: 'DELETE' | 'PATCH' | 'POST', body?: unknown) =>
      apiRequest<T>(apiRoute, path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        method,
      }),
    [apiRoute],
  )

  return { apiRoute, get, mutate }
}
