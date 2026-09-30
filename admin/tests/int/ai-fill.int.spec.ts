// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { authorDescription, isPlaceholderDescription, missingFields, suggestFill } from '@/lib/ai-fill'
import { authorOf } from '@/components/admin/types'

const vocabulary = { categories: [{ categoryId: 'meme' }, { categoryId: 'comic' }] }

async function png(width = 40, height = 20): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#3a7cd8' } }).png().toBuffer()
}

describe('ai-fill 缺失字段判断', () => {
  it('占位说明视同缺失，人工写过的不算缺失', () => {
    expect(isPlaceholderDescription('首批收录自蓝色大肥鱼档案馆的公开清单；单条原作者与授权信息待补充')).toBe(true)
    expect(isPlaceholderDescription('GitHub Issue #7 多图投稿，原投稿未逐张命名。')).toBe(true)
    expect(isPlaceholderDescription('')).toBe(true)
    expect(isPlaceholderDescription('蓝发鲸鱼娘穿女仆装')).toBe(false)
    const work = { name: 'x', description: '已写', commentary: '', tags: [{ value: 'a' }], categories: [1], width: 0, height: 10 }
    expect(missingFields(work)).toEqual(['commentary', 'dimensions'])
  })

  it('作者原始说明优先于 AI，占位句不算作者说明', () => {
    expect(authorDescription({}, { fields: { description: 'GitHub Issue #7 多图投稿，原投稿未逐张命名。' } })).toBe('')
    expect(authorDescription({}, { fields: { description: '作者写的说明' } })).toBe('作者写的说明')
  })
})

describe('suggestFill', () => {
  it('有作者原文时说明用原文，点评单独由 AI 生成', async () => {
    const calls: string[] = []
    const { suggestion, errors } = await suggestFill(
      { authorText: '作者原文', characterName: 'DeepSeek娘', fields: ['description', 'commentary', 'dimensions'], image: await png(), name: '图', vocabulary },
      async ({ user }) => { calls.push(user); return '{"commentary":"哼，这张还行。"}' },
    )
    expect(errors).toEqual([])
    expect(suggestion).toMatchObject({ description: '作者原文', descriptionSource: 'author', commentary: '哼，这张还行。', width: 40, height: 20 })
    expect(calls[0]).toContain('需要输出的字段：commentary')
    expect(calls[0]).not.toContain('description,')
  })

  it('没有作者原文时让 AI 看图描述；非法值、越界分类被丢弃', async () => {
    const { suggestion, errors } = await suggestFill(
      { authorText: '', characterName: '', fields: ['description', 'commentary', 'tags', 'categories'], image: await png(), name: '', vocabulary },
      async () => '```json\n{"description":"两格漫画，鲸鱼娘点了按钮。","commentary":"<script>x</script>","tags":["按钮","按钮",""],"categoryIds":["nope"]}\n```',
    )
    expect(suggestion.description).toBe('两格漫画，鲸鱼娘点了按钮。')
    expect(suggestion.descriptionSource).toBe('ai')
    expect(suggestion.commentary).toBeUndefined()
    expect(suggestion.tags).toEqual(['按钮'])
    expect(suggestion.categoryIds).toBeUndefined()
    expect(errors).toEqual(expect.arrayContaining(['commentary 不合法或为空', 'categoryIds 不在分类词表内']))
  })

  it('说明和点评一样时丢弃点评', async () => {
    const { suggestion } = await suggestFill(
      { authorText: '', characterName: '', fields: ['description', 'commentary'], image: await png(), name: '', vocabulary },
      async () => '{"description":"同一句","commentary":"同一句"}',
    )
    expect(suggestion.description).toBe('同一句')
    expect(suggestion.commentary).toBeUndefined()
  })
})

describe('authorOf', () => {
  it('来源作者优先，「本人」回落到投稿者，去掉 @', () => {
    expect(authorOf({ origin: { author: '@MX1951' }, submitter: { name: 'x' } })).toBe('MX1951')
    expect(authorOf({ origin: { author: '本人' }, submitter: { name: 'duyingg' } })).toBe('duyingg')
    expect(authorOf({ origin: {}, submitter: null })).toBe('')
  })
})