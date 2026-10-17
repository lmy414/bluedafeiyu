import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkDrawer } from '@/components/admin/WorkDrawer'
const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn() }))
vi.mock('@/components/admin/api', () => ({ useAdminApi: () => ({ ...api, apiRoute: '/cms-api' }) }))
const content = {
  name: '人工名称',
  description: '人工说明',
  commentary: '人工点评',
  tags: ['探头'],
  characterId: 'deepseek',
  characterIds: ['deepseek'],
  categoryIds: ['illustration'],
}
const props = {
  categories: [{ id: 2, categoryId: 'illustration', name: '插画' }],
  characters: [{ id: 1, characterId: 'deepseek', name: 'DeepSeek' }],
  item: {
    kind: 'submission' as const,
    submission: {
      id: 3,
      submissionId: 'sub_manual',
      source: 'web',
      state: 'needs_manual',
      title: '复审投稿',
      review: { verdict: 'manual', content },
    },
  },
  onClose: vi.fn(),
  onSaved: vi.fn(),
}
beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ docs: [] })
  api.mutate.mockResolvedValue({ job: { jobId: 'test-job' } })
})
afterEach(cleanup)
describe('统一人工收录与编辑任务', () => {
  it('首次直达时等待词表，加载后恢复已有角色和类型', async () => {
    const view = render(
      React.createElement(WorkDrawer, { ...props, categories: [], characters: [] }),
    )
    expect(screen.getByText('正在读取编辑选项…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '人工收录' })).toBeNull()
    view.rerender(React.createElement(WorkDrawer, props))
    expect((screen.getByRole('checkbox', { name: 'DeepSeek' }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByRole('radio', { name: '插画' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('人工名称')
  })

  it('一次收录提交持久任务，保留人工草稿，移除单独翻译入口', async () => {
    render(React.createElement(WorkDrawer, props))
    expect(screen.queryByRole('button', { name: 'AI 补全与翻译' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    await screen.findByText(/人工收录任务已提交/)
    expect(api.mutate).toHaveBeenCalledOnce()
    expect(api.mutate.mock.calls[0][2]).toMatchObject({
      operation: 'manual-include',
      target: 'submissions',
      ids: ['sub_manual'],
      confirm: 'MANUAL_INCLUDE',
      drafts: { sub_manual: content },
    })
    expect(screen.getByRole('link', { name: '查看收录与翻译任务' }).getAttribute('href')).toContain(
      'task=test-job',
    )
    expect(screen.getByRole('button', { name: '任务已提交' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[1])
    expect(props.onClose).toHaveBeenCalledOnce()
  })
  it('保留多角色，修改作品同时准备译文', async () => {
    render(
      React.createElement(WorkDrawer, {
        ...props,
        characters: [...props.characters, { id: 4, characterId: 'claude', name: 'Claude' }],
        item: {
          kind: 'work',
          work: {
            id: 9,
            workId: 'fixed',
            name: '双角色',
            channel: 'web',
            status: 'published',
            character: 1,
            characters: [1],
            categories: [2],
          },
        },
      }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Claude' }))
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await screen.findByText(/修改任务已提交/)
    expect(api.mutate.mock.calls[0][2]).toMatchObject({
      operation: 'ai-fill',
      target: 'works',
      drafts: { fixed: { characterId: 'deepseek', characterIds: ['deepseek', 'claude'] } },
    })
  })
  it('请求失败可以重试，相同内容复用幂等编号', async () => {
    api.mutate.mockRejectedValueOnce(new Error('网络中断'))
    render(React.createElement(WorkDrawer, props))
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    await screen.findByText('网络中断')
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    await screen.findByText(/人工收录任务已提交/)
    expect(api.mutate.mock.calls[0][2].requestId).toBe(api.mutate.mock.calls[1][2].requestId)
  })
  it('缺少角色不发请求，继续保留人工编辑', async () => {
    render(React.createElement(WorkDrawer, props))
    fireEvent.click(screen.getByRole('checkbox', { name: 'DeepSeek' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '尚未提交的名称' } })
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    await screen.findByText('请至少选择一个角色。')
    expect(api.mutate).not.toHaveBeenCalled()
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('尚未提交的名称')
  })
  it('正在提交时禁用重复提交', async () => {
    let complete!: (r: unknown) => void
    api.mutate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          complete = r
        }),
    )
    render(React.createElement(WorkDrawer, props))
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    expect(screen.getByRole('button', { name: '提交中…' }).hasAttribute('disabled')).toBe(true)
    complete({ job: { jobId: 'durable' } })
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
  })
})
