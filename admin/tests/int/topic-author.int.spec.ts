// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// 纯数据测试：只覆盖专题作者字段的导出与校验钩子，不碰数据库。
// buildSiteDataTexts 是同步纯函数；Topics 的字段配置与钩子函数可直接取出调用。
// SQLite 的真实写库 / 持久化不在本文件的覆盖范围内。
import { describe, expect, it } from 'vitest'

import { Topics } from '@/collections/Topics'
import { buildSiteDataTexts } from '@/lib/export-site-data'

const authorField: any = (Topics.fields as any[]).find((field) => field.name === 'author')
const channelsField: any = (authorField.fields as any[]).find((field) => field.name === 'channels')

function topicDoc(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    cover: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    name: '示例专题',
    order: 0,
    status: 'active',
    summary: '示例简介',
    topicId: 'example-topic',
    updatedAt: '2026-10-01T00:00:00.000Z',
    works: [],
    ...overrides,
  }
}

/** 导出并解析 data/topics.json，省掉每个用例重复的三行。 */
function exportTopics(topics: any[]): any[] {
  const texts = buildSiteDataTexts({ categories: [], characters: [], topics, works: [] })
  return JSON.parse(texts['data/topics.json'])
}

describe('buildSiteDataTexts 专题作者导出', () => {
  it('普通专题不加 author 键，字段顺序与原来一致', () => {
    const exported = exportTopics([topicDoc()])
    expect(exported).toHaveLength(1)
    expect(exported[0]).not.toHaveProperty('author')
    expect(Object.keys(exported[0])).toEqual([
      'id',
      'name',
      'summary',
      'coverWorkId',
      'status',
      'order',
      'createdAt',
      'updatedAt',
      'workIds',
    ])
  })

  it('draft 专题不导出，author 也不会漏出来', () => {
    const exported = exportTopics([
      topicDoc({ author: { channels: [{ platform: 'Bilibili', url: 'https://space.bilibili.com/1' }], name: '猫鲸' }, status: 'draft' }),
    ])
    expect(exported).toEqual([])
  })

  it('作者合法时按渠道顺序导出，第一项即首选联系方式', () => {
    const [topic] = exportTopics([
      topicDoc({
        author: {
          bio: '画师，主要画 AI 娘',
          channels: [
            { label: '小电视', platform: 'Bilibili', url: 'https://space.bilibili.com/1' },
            { platform: 'Pixiv', url: 'https://www.pixiv.net/users/2' },
          ],
          name: '猫鲸',
          url: 'https://example.com/me',
        },
      }),
    ])
    expect(topic.author).toEqual({
      bio: '画师，主要画 AI 娘',
      channels: [
        { label: '小电视', platform: 'Bilibili', url: 'https://space.bilibili.com/1' },
        { platform: 'Pixiv', url: 'https://www.pixiv.net/users/2' },
      ],
      name: '猫鲸',
      url: 'https://example.com/me',
    })
    expect(topic.author.channels[0].platform).toBe('Bilibili')
  })

  it('可选的作者主页与简介缺省时不占键位，渠道 label 留空也不导出', () => {
    const [topic] = exportTopics([
      topicDoc({
        author: {
          channels: [{ label: '   ', platform: 'Bilibili', url: 'https://space.bilibili.com/1' }],
          name: '猫鲸',
        },
      }),
    ])
    expect(topic.author).toEqual({
      channels: [{ platform: 'Bilibili', url: 'https://space.bilibili.com/1' }],
      name: '猫鲸',
    })
  })

  it('作者名或首选渠道不完整时抛错，错误里带 topicId', () => {
    const cases: Array<{ author: Record<string, any>; why: RegExp }> = [
      { author: { channels: [{ platform: 'Bilibili', url: 'https://space.bilibili.com/1' }] }, why: /缺少作者名/ },
      { author: { name: '猫鲸' }, why: /缺少首选渠道/ },
      { author: { channels: [{ platform: '', url: 'https://space.bilibili.com/1' }], name: '猫鲸' }, why: /缺 platform/ },
      { author: { channels: [{ platform: 'Bilibili', url: '' }], name: '猫鲸' }, why: /缺 url/ },
    ]
    for (const { author, why } of cases) {
      expect(() => exportTopics([topicDoc({ author, topicId: 'broken-topic' })])).toThrow(
        new RegExp(`专题 broken-topic.*${why.source}`),
      )
    }
  })

  it('危险 scheme 与无主机 URL 一律拒绝，且错误里带 topicId', () => {
    // https:///x 与反斜杠写法都会被 new URL 偷偷规范化，必须在字面量前缀阶段就挡掉。
    const badUrls = [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'https://',
      'https:///x',
      'https:\\example.com/x',
      'https://example.com\\path',
      'ftp://example.com/x',
      'https://a b.com',
    ]
    for (const url of badUrls) {
      expect(() =>
        exportTopics([
          topicDoc({
            author: { channels: [{ platform: 'Bilibili', url }], name: '猫鲸' },
            topicId: 'bad-url-topic',
          }),
        ]),
      ).toThrow(/专题 bad-url-topic/)
    }
    // 作者主页同样只放行 http/https，且必须有主机名。
    expect(() =>
      exportTopics([
        topicDoc({
          author: { channels: [{ platform: 'Bilibili', url: 'https://space.bilibili.com/1' }], name: '猫鲸', url: 'javascript:alert(1)' },
          topicId: 'bad-home-topic',
        }),
      ]),
    ).toThrow(/专题 bad-home-topic.*作者主页/)
  })
})

describe('Topics 作者分组校验钩子（字段配置层面，不落库）', () => {
  const validate = authorField.validate as (value: unknown) => string | true

  it('整组留空视为普通专题，不启动作者版式', () => {
    expect(validate(undefined)).toBe(true)
    expect(validate(null)).toBe(true)
    expect(validate({})).toBe(true)
    expect(validate({ bio: '   ', channels: [], name: '', url: '' })).toBe(true)
  })

  it('填了任意一项就要求作者名与首选渠道', () => {
    expect(validate({ name: '猫鲸' })).toContain('至少需要一个渠道')
    expect(validate({ channels: [{ platform: 'Bilibili', url: 'https://space.bilibili.com/1' }] })).toContain('作者名')
  })

  it('渠道行与作者主页只接受 http/https，逐条报错', () => {
    expect(validate({ channels: [{ platform: 'Bilibili', url: 'https://space.bilibili.com/1' }], name: '猫鲸' })).toBe(true)
    expect(validate({ channels: [{ platform: 'Bilibili', url: 'https://' }], name: '猫鲸' })).toContain('渠道 1')
    expect(validate({ channels: [], name: '猫鲸', url: 'https://' })).toContain('作者主页')
  })

  it('无主机与反斜杠畸形 URL 同样被字段校验挡下', () => {
    // https:///x 这类写法 new URL 会解析成 https://x，只能靠前缀正则拦；反斜杠会被
    // 浏览器/new URL 当成路径分隔符，也一律拒绝。
    const badUrls = ['https:///x', 'https:\\example.com/x', 'https://example.com\\path', 'https:///']
    for (const url of badUrls) {
      expect(validate({ channels: [{ platform: 'Bilibili', url }], name: '猫鲸' })).toContain('渠道 1')
      expect(validate({ channels: [], name: '猫鲸', url })).toContain('作者主页')
    }
    // 带路径的 https 与 IPv6 字面量主机都是合法正例。
    expect(validate({ channels: [{ platform: 'Bilibili', url: 'https://example.com/path' }], name: '猫鲸' })).toBe(true)
    expect(validate({ channels: [{ platform: 'Bilibili', url: 'http://[::1]:5000/' }], name: '猫鲸' })).toBe(true)
  })

  it('channels 数组的字段名与必填标记冻结', () => {
    expect(authorField.type).toBe('group')
    expect(channelsField.type).toBe('array')
    expect(channelsField.fields.map((field: any) => field.name)).toEqual(['platform', 'label', 'url'])
    expect(channelsField.fields.find((field: any) => field.name === 'platform').required).toBe(true)
    expect(channelsField.fields.find((field: any) => field.name === 'url').required).toBe(true)
    expect(channelsField.fields.find((field: any) => field.name === 'label').required).toBeFalsy()
  })

  it('渠道行 beforeValidate 补 id 且保留空行（空行留给分组校验报错）', () => {
    const beforeValidate = channelsField.hooks.beforeValidate[0] as (args: any) => any
    const rows = beforeValidate({ value: [{ platform: 'Bilibili', url: 'https://space.bilibili.com/1' }, {}] })
    expect(rows).toHaveLength(2)
    expect(typeof rows[0].id).toBe('string')
    expect(rows[0].id.length).toBeGreaterThan(0)
    expect(typeof rows[1].id).toBe('string')
    expect(beforeValidate({ value: null })).toBeNull()
  })
})

describe('Topics 作者分组字段级 beforeValidate（钩子形态，不落库）', () => {
  const beforeValidate = authorField.hooks.beforeValidate[0] as (args: any) => any
  // previousSiblingDoc 必须给对象（Payload 用 typeof 判断，null 会被当成 object 继续遍历而崩）。
  const run = (data: Record<string, any>, previousSiblingDoc: Record<string, any> = {}) =>
    beforeValidate({ value: data.author, data, previousSiblingDoc })

  it('本次 data 显式带 author 时，整组清空归一成 null 子字段 + 空渠道', () => {
    const data = { author: null }
    expect(run(data)).toEqual({ bio: null, channels: [], name: null, url: null })
    expect(run({ author: {} })).toEqual({ bio: null, channels: [], name: null, url: null })
    expect(run({ author: { bio: '  ', channels: [], name: '', url: '' } })).toEqual({
      bio: null,
      channels: [],
      name: null,
      url: null,
    })
  })

  it('本次 data 没有 author 键时返回 undefined，不强制清空已有作者', () => {
    expect(run({ order: 3 })).toBeUndefined()
    // 上一版文档里的 null 作者被折成空分组，避免子字段遍历 previousValue 时崩。
    const original: Record<string, any> = { author: null, topicId: 'example-topic' }
    expect(run({ order: 3 }, original)).toBeUndefined()
    expect(original.author).toEqual({})
  })

  it('channels: null 归一成 []，缺省 channels 不强塞', () => {
    expect(run({ author: { channels: null, name: '猫鲸' } }).channels).toEqual([])
    const kept = run({ author: { name: '猫鲸' } })
    expect(Object.prototype.hasOwnProperty.call(kept, 'channels')).toBe(false)
    expect(kept.name).toBe('猫鲸')
  })

  it('有内容的渠道行补 id，顺序与取值不变', () => {
    const channel = { platform: 'Bilibili', url: 'https://space.bilibili.com/1' }
    const result = run({ author: { channels: [channel], name: '猫鲸' } })
    expect(result.channels).toHaveLength(1)
    expect(result.channels[0]).toMatchObject(channel)
    expect(typeof result.channels[0].id).toBe('string')
    expect(result.channels[0].id.length).toBeGreaterThan(0)
  })
})

describe('Topics beforeChange 作者形状归一（前置钩子形态，不落库）', () => {
  const beforeChange = ((Topics.hooks?.beforeChange as any) || [])[0] as (args: any) => any
  const run = (data: Record<string, any>) => beforeChange({ data, operation: 'update', originalDoc: {}, req: { context: {} } })

  it('局部更新不带 author 键时原样放过，不清空已有作者', () => {
    const result = run({ order: 3 })
    expect(Object.prototype.hasOwnProperty.call(result, 'author')).toBe(false)
    expect(result.order).toBe(3)
  })

  it('整组清空改写成显式 null，确保 PATCH 把旧值置空', () => {
    expect(run({ author: {} }).author).toEqual({ bio: null, channels: [], name: null, url: null })
    expect(run({ author: null }).author).toEqual({ bio: null, channels: [], name: null, url: null })
    expect(run({ author: { bio: '', channels: [], name: '', url: '' } }).author).toEqual({ bio: null, channels: [], name: null, url: null })
  })

  it('有内容的作者分组保留字段，channels 归一成数组', () => {
    const channel = { platform: 'Bilibili', url: 'https://space.bilibili.com/1' }
    const result = run({ author: { channels: [channel], name: '猫鲸' } })
    expect(result.author.name).toBe('猫鲸')
    expect(result.author.channels).toEqual([channel])
  })
})
