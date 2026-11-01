import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PublishView } from '@/views/PublishView'

const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn() }))
vi.mock('@/components/admin/api', () => ({ useAdminApi: () => api, getAllDocs: async () => [] }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation(async (route: string) => route === '/publish/plan' ? {
    added: [], updated: [], hidden: [], restored: [], deleted: [], topics: [],
    videos: [
      { id: 12, kind: 'video', name: '待核对视频' },
      { id: 12, kind: 'creator', name: '待核对作者' },
    ],
    summary: { contents: 2 }, pendingRun: null,
  } : { docs: [] })
})
afterEach(cleanup)

describe('发布清单核对入口', () => {
  it('即使视频和作者的 ID 相同，也分别链接到对应详情且不会触发发布', async () => {
    render(React.createElement(PublishView))
    const video = await screen.findByText('待核对视频')
    const creator = screen.getByText('待核对作者')
    const videoRow = video.closest('.s3-plan-item') as HTMLElement
    const creatorRow = creator.closest('.s3-plan-item') as HTMLElement
    expect(within(videoRow).getByRole('link', { name: '核对' }).getAttribute('href')).toBe('/admin/collections/videos/12')
    expect(within(creatorRow).getByRole('link', { name: '核对' }).getAttribute('href')).toBe('/admin/collections/creators/12')
    expect(api.mutate).not.toHaveBeenCalled()
  })
})
