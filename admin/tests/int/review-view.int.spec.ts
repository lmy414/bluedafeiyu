import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReviewView } from '@/views/ReviewView'

const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn(), mode: 'rejected' }))
vi.mock('@/components/admin/api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/components/admin/api')>(), useAdminApi: () => api }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams({ mode: api.mode }) }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }))
vi.mock('@/components/admin/WorkDrawer', () => ({ WorkDrawer: () => React.createElement('div', null, '详情抽屉') }))

const pending = { id: 1, submissionId: 'sub_manual', source: 'web', state: 'needs_manual', title: '尚待人工的投稿', fields: { character: 'deepseek' } }
const handled = { ...pending, id: 2, submissionId: 'sub_handled', title: '已人工处理的投稿', work: { id: 7, name: '已经收录的作品', status: 'pending' } }

beforeEach(() => {
  vi.clearAllMocks()
  api.mode = 'rejected'
  api.get.mockImplementation(async (path: string, params: Record<string, unknown>) => {
    if (path === '/submissions') return { docs: params['where[work][exists]'] ? [handled] : [pending] }
    return { docs: [] }
  })
})
afterEach(cleanup)

describe('人工审核入口与已处理记录', () => {
  it('审核列表继续读取后续页，不丢掉第 500 条后的人工投稿', async () => {
    api.get.mockImplementation(async (path: string, params: Record<string, unknown>) => {
      if (path === '/submissions') return params.page === 1
        ? { docs: [pending], hasNextPage: true }
        : { docs: [{ ...pending, id: 3, title: '后续页转人工条目' }], hasNextPage: false }
      return { docs: [] }
    })
    render(React.createElement(ReviewView))
    await screen.findByText('后续页转人工条目')
    expect(screen.getByText('尚待人工的投稿')).toBeDefined()
    expect(api.get.mock.calls.filter(([path]) => path === '/submissions')).toHaveLength(2)
  })

  it('首页 mode=rejected 深链接直接显示转人工条目，不先打开待发布', async () => {
    render(React.createElement(ReviewView))
    await screen.findByText('尚待人工的投稿')
    expect(screen.getByText('deepseek')).toBeDefined()
    expect(api.get.mock.calls.some(([path, params]) => path === '/submissions' && params['where[work][exists]'] === false)).toBe(true)
    expect(api.get.mock.calls.some(([path]) => path === '/works')).toBe(false)
  })

  it('已关联作品的 AI 记录可查询，不重复进入未处理人工列表', async () => {
    render(React.createElement(ReviewView))
    await screen.findByText('尚待人工的投稿')
    fireEvent.click(screen.getByRole('button', { name: '已处理的 AI 记录' }))
    await screen.findByText('已人工处理的投稿')
    await screen.findByText('已关联作品：已经收录的作品')
    await waitFor(() => expect(screen.queryByText('尚待人工的投稿')).toBeNull())
    expect(api.get.mock.calls.some(([path, params]) => path === '/submissions' && params['where[work][exists]'] === true)).toBe(true)
  })
})
