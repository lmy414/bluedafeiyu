// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { authorDescription, isPlaceholderDescription, missingFields } from '@/lib/ai-fill'
import { authorOf } from '@/components/admin/types'

describe('Hermes 字段检查不调用模型', () => {
  it('识别空字段和占位说明，保留作者说明', () => {
    expect(isPlaceholderDescription('首批收录自蓝色大肥鱼档案馆的公开清单；单条原作者与授权信息待补充')).toBe(true)
    expect(missingFields({ name: '图', description: '已有说明', commentary: '', tags: [{ value: '标签' }], categories: [1], width: 0, height: 10 })).toEqual(['commentary', 'dimensions'])
    expect(authorDescription({}, { fields: { description: '作者说明' } })).toBe('作者说明')
    expect(authorDescription({}, { fields: { description: 'GitHub Issue #7 多图投稿，原投稿未逐张命名。' } })).toBe('')
  })
  it('作者展示规则不变', () => {
    expect(authorOf({ origin: { author: '@MX1951' }, submitter: { name: 'x' } })).toBe('MX1951')
    expect(authorOf({ origin: { author: '本人' }, submitter: { name: 'duyingg' } })).toBe('duyingg')
  })
})
