import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TopicsView } from '@/views/TopicsView'

const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn() }))
vi.mock('@/components/admin/api', () => ({ useAdminApi: () => api }))
vi.mock('@/components/admin/JobProgress', () => ({ JobProgress: () => null, useBulkJob: () => ({ job: null }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }))

const legacyTopic = {
  id: 1, topicId: 'legacy-topic', name: '旧专题', summary: '已有中文简介', status: 'active', works: [],
  translationState: 'none', nameEn: 'Existing name', summaryEn: 'Existing summary',
  nameJa: '既存の名前', summaryJa: '既存の紹介',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation(async (route: string) =>
    route === '/topics' ? { docs: [legacyTopic] } : { docs: [] },
  )
})
afterEach(cleanup)

describe('存量专题译文显示', () => {
  it('保留并标明已有译文，提示更新会替换，不把它们显示为尚未翻译', async () => {
    render(React.createElement(TopicsView))
    await screen.findByText('已有译文，来源未记录')
    expect(screen.queryByText('尚未翻译')).toBeNull()
    fireEvent.click(screen.getByText('英日翻译'))
    expect((screen.getByLabelText('英文名称') as HTMLInputElement).value).toBe('Existing name')
    expect((screen.getByLabelText('日文名称') as HTMLInputElement).value).toBe('既存の名前')
    expect(screen.getByRole('button', { name: '更新英日翻译' })).toBeDefined()
    expect(screen.getByText(/更新完成后会替换现有译文/)).toBeDefined()
    expect(api.mutate).not.toHaveBeenCalled()
  })

  it('没有任何译文时仍显示尚未翻译', async () => {
    api.get.mockImplementation(async (route: string) => route === '/topics'
      ? { docs: [{ ...legacyTopic, nameEn: '', summaryEn: '', nameJa: '', summaryJa: '' }] }
      : { docs: [] })
    render(React.createElement(TopicsView))
    await screen.findByText('尚未翻译')
    expect(screen.queryByText('已有译文，来源未记录')).toBeNull()
  })

  it('有真实排队状态时优先显示排队状态', async () => {
    api.get.mockImplementation(async (route: string) => route === '/topics'
      ? { docs: [{ ...legacyTopic, translationState: 'queued' }] }
      : { docs: [] })
    render(React.createElement(TopicsView))
    await screen.findByText('翻译已排队')
    expect(screen.queryByText('已有译文，来源未记录')).toBeNull()
  })
})
