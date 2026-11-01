import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CollectToTopic } from '@/components/admin/CollectToTopic'

const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn() }))
vi.mock('@/components/admin/api', () => ({
  APIError: class APIError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
  useAdminApi: () => ({ ...api, apiRoute: '/cms-api' }),
}))

const works = [
  { id: 1, workId: 'work_one', name: '作品一', channel: 'web', status: 'published' },
  { id: 2, workId: 'work_two', name: '作品二', channel: 'web', status: 'published' },
] as never[]

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  api.get.mockResolvedValue({
    docs: [
      {
        id: 10,
        topicId: 'topic-a',
        name: '测试专题',
        status: 'draft',
        works: [1],
      },
    ],
    totalDocs: 1,
    totalPages: 1,
  })
  api.mutate.mockImplementation(async (path: string) => {
    if (path === '/topics/membership/undo')
      return {
        kept: [{ error: '是专题封面，不能通过本次撤销移除', id: 'work_one' }],
        removed: [],
        alreadyAbsent: ['work_two'],
      }
    return {
      added: ['work_two'],
      already: ['work_one'],
      failed: [],
      skipped: [],
      undoToken: 'undo-once',
    }
  })
})

afterEach(cleanup)

describe('专题快捷收录', () => {
  it('提交全部所选 workIds，由服务端判断已有成员，并显示真实撤销结果', async () => {
    render(
      React.createElement(CollectToTopic, {
        open: true,
        works,
        onChanged: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    const topicButton = await screen.findByRole('button', { name: /测试专题/ })
    fireEvent.click(topicButton)
    await waitFor(() => expect(api.mutate).toHaveBeenCalled())
    expect(api.mutate.mock.calls[0][0]).toBe('/topics/topic-a/works')
    expect(api.mutate.mock.calls[0][2]).toEqual({ workIds: ['work_one', 'work_two'] })
    await screen.findByText(/新增 1 件/)
    expect(screen.getByText(/1 件原已在专题/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '撤销本次新增' }))
    await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(2))
    expect(api.mutate.mock.calls[1][0]).toBe('/topics/membership/undo')
    expect(api.mutate.mock.calls[1][2]).toEqual({ undoToken: 'undo-once' })
    await screen.findByText(/已撤销 0 件/)
    expect(screen.getByText(/1 件保留/)).toBeDefined()
    expect(screen.queryByText(/已撤销 1 件/)).toBeNull()
  })

  it('换一批作品时不沿用上一批结果和撤销令牌', async () => {
    const view = render(
      React.createElement(CollectToTopic, {
        open: true,
        works,
        onChanged: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: /测试专题/ }))
    await screen.findByText(/新增 1 件/)
    view.rerender(
      React.createElement(CollectToTopic, {
        open: true,
        works: [{ id: 3, workId: 'work_three', name: '作品三', channel: 'web', status: 'published' }],
        onChanged: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    await waitFor(() => expect(screen.queryByText(/新增 1 件/)).toBeNull())
    expect(screen.queryByRole('button', { name: '撤销本次新增' })).toBeNull()
  })
})
