import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewView } from '@/views/ReviewView'

const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn(), mode: 'rejected' }))
vi.mock('@/components/admin/api', async importOriginal => ({ ...await importOriginal<typeof import('@/components/admin/api')>(), useAdminApi: () => ({ ...api, apiRoute: 'review-test' }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams({ mode: api.mode }) }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }))
vi.mock('@/components/admin/WorkDrawer', () => ({ WorkDrawer: () => React.createElement('div', null, '详情抽屉') }))
vi.mock('@/components/admin/BulkTools', () => ({ BulkJobsPanel: () => null, BulkTools: () => React.createElement('div', null, '批量操作') }))
const pending = { id: 1, submissionId: 'sub_manual', source: 'web', state: 'needs_manual', title: '尚待人工的投稿', fields: { character: 'deepseek' } }
const handled = { ...pending, id: 2, submissionId: 'sub_handled', title: '已人工处理的投稿', work: { id: 7, name: '已经收录的作品', status: 'pending' } }
beforeEach(() => {
  vi.clearAllMocks(); api.mode = 'rejected'
  api.get.mockImplementation(async (path: string, params: Record<string, unknown>) => {
    if (path === '/console/list') return { docs: params.mode === 'reviewed' ? [handled] : [pending], totalDocs: 49, totalPages: 2, page: params.page }
    if (path === '/console/authors') return { authors: [] }
    return { docs: [] }
  })
})
afterEach(cleanup)

describe('人工审核服务端分页与多选', () => {
  it('只请求当前页，点击下一页才读取后续记录', async () => {
    render(React.createElement(ReviewView)); await screen.findByText('尚待人工的投稿')
    expect(api.get.mock.calls.filter(([path]) => path === '/console/list')).toHaveLength(1)
    expect(api.get.mock.calls.find(([path]) => path === '/console/list')![1]).toMatchObject({ page: 1, limit: 48 })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(api.get.mock.calls.filter(([path]) => path === '/console/list')).toHaveLength(2))
    expect(api.get.mock.calls.filter(([path]) => path === '/console/list')[1][1].page).toBe(2)
  })
  it('深链接直达转人工列表，支持多选且不拉取完整详情', async () => {
    render(React.createElement(ReviewView)); await screen.findByText('尚待人工的投稿')
    expect(api.get.mock.calls.find(([path]) => path === '/console/list')![1]).toMatchObject({ kind: 'submissions', mode: 'rejected' })
    expect(api.get.mock.calls.some(([path]) => path === '/submissions')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '选择本页' }))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('已选 1 项')).toBeDefined()
  })
  it('已关联记录独立查看；详情只有点开后才请求', async () => {
    api.get.mockImplementation(async (path: string, params: Record<string, unknown>) => {
      if (path === '/console/list') return { docs: params.mode === 'reviewed' ? [handled] : [pending], totalPages: 1 }
      if (path === '/console/authors') return { authors: [] }
      if (path === '/submissions/2') return handled
      return { docs: [] }
    })
    render(React.createElement(ReviewView)); await screen.findByText('尚待人工的投稿')
    fireEvent.click(screen.getByRole('button', { name: '已处理的 AI 记录' }))
    await screen.findByText('已人工处理的投稿')
    expect(screen.queryByText('尚待人工的投稿')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /已人工处理的投稿/ }))
    await screen.findByText('详情抽屉')
    expect(api.get.mock.calls.some(([path]) => path === '/submissions/2')).toBe(true)
  })
})
