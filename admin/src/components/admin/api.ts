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

type QueryValue = boolean | number | string | string[] | undefined

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
    | { errors?: Array<{ message?: string }>; message?: string }
    | T
    | null
  if (!response.ok) {
    const payload = data as { errors?: Array<{ message?: string }>; message?: string } | null
    const message =
      payload?.errors?.[0]?.message || payload?.message || `请求失败（HTTP ${response.status}）`
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
