import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fixtureI18n } from '../../../tools/localization/test-fixture.mjs'
import { WorkDrawer } from '@/components/admin/WorkDrawer'

const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn() }))
vi.mock('@/components/admin/api', () => ({ useAdminApi: () => ({ ...api, apiRoute: '/cms-api' }) }))

const content = { name: '已核对的名称', description: '已核对的画面', commentary: '已核对的点评', tags: ['探头'], characterId: 'deepseek', categoryIds: ['illustration'] }
const i18n = { sourceHash: 'server-generated-digest', ...fixtureI18n(content.tags) }
const props = {
  categories: [{ id: 2, categoryId: 'illustration', name: '插画' }],
  characters: [{ id: 1, characterId: 'deepseek', name: 'DeepSeek' }],
  item: { kind: 'submission' as const, submission: { id: 3, submissionId: 'sub_manual', source: 'web', state: 'needs_manual', title: '复审投稿', review: { verdict: 'manual', content } } },
  onClose: vi.fn(), onSaved: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ docs: [] })
  api.mutate.mockImplementation(async (path: string) => path === '/ai-fill' ? { suggestion: { i18n }, errors: [] } : { ok: true })
})
afterEach(cleanup)

describe('人工收录的多语言流程', () => {
  it('先生成当前内容的译文，再将中文和译文一起提交', async () => {
    render(React.createElement(WorkDrawer, props))
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
    expect(api.mutate.mock.calls.map(([path]) => path)).toEqual(['/ai-fill', '/works/bulk'])
    expect(api.mutate.mock.calls[0][2]).toMatchObject({ fields: ['i18n'], draft: content, submissionId: 'sub_manual' })
    expect(api.mutate.mock.calls[1][2].content).toEqual({ ...content, i18n })
  })

  it('保留已经生成的译文；中文修改后重新生成', async () => {
    render(React.createElement(WorkDrawer, props))
    fireEvent.click(screen.getByRole('button', { name: 'AI 补全与翻译' }))
    await screen.findByText(/Hermes 已生成建议及英日版本/)
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '修改后的名称' } })
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
    expect(api.mutate.mock.calls.map(([path]) => path)).toEqual(['/ai-fill', '/ai-fill', '/works/bulk'])
    expect(api.mutate.mock.calls[1][2].draft.name).toBe('修改后的名称')
    expect(api.mutate.mock.calls[2][2].content.name).toBe('修改后的名称')
  })

  it('当前中文未修改时复用已生成的译文', async () => {
    render(React.createElement(WorkDrawer, props))
    fireEvent.click(screen.getByRole('button', { name: 'AI 补全与翻译' }))
    await screen.findByText(/Hermes 已生成建议及英日版本/)
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce())
    expect(api.mutate.mock.calls.map(([path]) => path)).toEqual(['/ai-fill', '/works/bulk'])
    expect(api.mutate.mock.calls[1][2].content.i18n).toEqual(i18n)
  })

  it('翻译失败时不创建待发布作品', async () => {
    api.mutate.mockRejectedValueOnce(new Error('翻译服务暂时不可用'))
    render(React.createElement(WorkDrawer, props))
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    await screen.findByText('翻译服务暂时不可用')
    expect(api.mutate).toHaveBeenCalledOnce()
    expect(props.onSaved).not.toHaveBeenCalled()
  })

  it('生成期间修改中文时停止收录，保留当前编辑', async () => {
    let resolveTranslation!: (value: unknown) => void
    api.mutate.mockImplementationOnce(() => new Promise((resolve) => { resolveTranslation = resolve }))
    render(React.createElement(WorkDrawer, props))
    fireEvent.click(screen.getByRole('button', { name: '人工收录' }))
    await screen.findByText('正在为当前内容生成英文和日文版本…')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '生成期间的新名称' } })
    resolveTranslation({ suggestion: { i18n } })
    await screen.findByText('生成期间内容已修改，请核对后重新人工收录。')
    expect(api.mutate).toHaveBeenCalledOnce()
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('生成期间的新名称')
    expect(props.onSaved).not.toHaveBeenCalled()
  })
})
