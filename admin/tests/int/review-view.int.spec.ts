import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewView } from '@/views/ReviewView'
import type * as AdminApiModule from '@/components/admin/api'

const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn(), mode: 'decide', submission: '' }))
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('@/components/admin/api', async importOriginal => {
  const actual = await importOriginal<typeof AdminApiModule>()
  return { ...actual, useAdminApi: () => ({ ...api, apiRoute: 'review-test' }) }
})
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/review',
  useRouter: () => nav,
  useSearchParams: () =>
    new URLSearchParams({ mode: api.mode, ...(api.submission ? { submission: api.submission } : {}) }),
}))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }))
vi.mock('@/components/admin/WorkDrawer', () => ({ WorkDrawer: () => React.createElement('div', null, '详情抽屉') }))
vi.mock('@/components/admin/BulkTools', () => ({ BulkJobsPanel: () => null, BulkTools: () => React.createElement('div', null, '批量操作') }))
const pending = { id: 1, submissionId: 'sub_manual', source: 'web', state: 'needs_manual', title: '尚待人工的投稿', fields: { character: 'deepseek' } }
const handled = { ...pending, id: 2, submissionId: 'sub_handled', title: '已人工处理的投稿', work: { id: 7, name: '已经收录的作品', status: 'pending' } }
beforeEach(() => {
  vi.clearAllMocks(); api.mode = 'decide'; api.submission = ''
  api.get.mockImplementation(async (path: string, params: Record<string, unknown>) => {
    if (path === '/console/list') return { docs: params.mode === 'history' ? [handled] : [pending], totalDocs: 49, totalPages: 2, page: params.page }
    if (path === '/console/authors') return { authors: [] }
    return { docs: [] }
  })
})
afterEach(cleanup)

describe('人工审核服务端分页与多选', () => {
  it('只请求当前页，下一页通过 URL 状态推进', async () => {
    render(React.createElement(ReviewView)); await screen.findByText('尚待人工的投稿')
    expect(api.get.mock.calls.filter(([path]) => path === '/console/list')).toHaveLength(1)
    expect(api.get.mock.calls.find(([path]) => path === '/console/list')![1]).toMatchObject({ page: 1, limit: 48 })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(nav.replace).toHaveBeenCalled())
    expect(nav.replace.mock.calls.at(-1)![0]).toContain('page=2')
  })
  it('深链接直达需要判断列表，支持多选且不拉取完整详情', async () => {
    render(React.createElement(ReviewView)); await screen.findByText('尚待人工的投稿')
    expect(api.get.mock.calls.find(([path]) => path === '/console/list')![1]).toMatchObject({
      kind: 'submissions',
      state: 'needs_review',
    })
    expect(api.get.mock.calls.some(([path]) => path === '/submissions')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '选择本页' }))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('已选 1 项')).toBeDefined()
  })
  it('历史记录深链接按业务投稿 ID 解析详情', async () => {
    api.mode = 'history'
    api.submission = 'sub_handled'
    api.get.mockImplementation(async (path: string, params: Record<string, unknown>) => {
      if (path === '/console/list') return { docs: params.mode === 'history' ? [handled] : [pending], totalDocs: 1, totalPages: 1, page: 1 }
      if (path === '/console/authors') return { authors: [] }
      if (path === '/submissions' && params['where[submissionId][equals]'] === 'sub_handled')
        return { docs: [handled] }
      return { docs: [] }
    })
    render(React.createElement(ReviewView)); await screen.findByText('已人工处理的投稿')
    expect(screen.queryByText('尚待人工的投稿')).toBeNull()
    await screen.findByText('详情抽屉')
    expect(
      api.get.mock.calls.some(
        ([path, params]) =>
          path === '/submissions' && params['where[submissionId][equals]'] === 'sub_handled',
      ),
    ).toBe(true)
  })
})
