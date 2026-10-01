import type { CollectionConfig } from 'payload'

import { TopicsUpsertEndpoint } from '../endpoints/topics-upsert'
import { canDeleteContent, canManageContent, canReadContent } from '../lib/access'
import { auditAfterChange, auditAfterDelete } from '../lib/audit'

const topicIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 作者主页 / 渠道链接只允许 http、https；其余（javascript:、data: 等）一律拒绝。
 * 字面量前缀 + URL 解析双重校验：先要求 `http://` 或 `https://` 且其后的 authority
 * 以非空、非 `/?#\`、非空白字符开头（挡掉 `https://`、`https:///x`、反斜杠这类
 * new URL 会偷偷规范化的写法），再解析并核对协议与主机名。
 */
function isHttpUrl(value: string): boolean {
  const raw = value.trim()
  if (!raw || /\s/.test(raw) || raw.includes('\\')) return false
  if (!/^https?:\/\/[^\s/?#\\]/.test(raw)) return false
  try {
    const parsed = new URL(raw)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

type RawChannel = { label?: unknown; platform?: unknown; url?: unknown }

/**
 * 渠道行校验（作者分组校验里逐条调用）：platform 与 url 必填，url 限 http/https。
 * 放在分组校验内而不是数组字段自身的 validate，避免 Payload 在数组校验失败时
 * 仍把「未填完的空行」写进库。
 */
function validateChannelRow(raw: unknown, position: number): string | true {
  const channel = (raw || {}) as RawChannel
  if (!asText(channel.platform)) return `渠道 ${position} 需要填写平台名`
  const url = asText(channel.url)
  if (!url) return `渠道 ${position} 需要填写链接`
  if (!isHttpUrl(url)) return `渠道 ${position} 的链接不是有效的 http/https 地址`
  return true
}

/**
 * channels 的 beforeValidate 归一：补行 id，保证数组行身份稳定、顺序可追踪。
 * 非数组一律原样返回（数组字段自己的钩子保持原行为），需要「折成 []」的调用方
 * 自己再包一层——数组字段遇到 null 会直接抛错，所以分组钩子必须先把 null 变数组。
 * 空行也保留 —— 本地校验依赖这条空行报错，不能在这里把它丢掉。
 */
function normalizeChannelRows(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((row: unknown) => {
    const channel = row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as Record<string, unknown>) } : {}
    if (!channel.id) channel.id = crypto.randomUUID()
    return channel
  })
}

const beforeValidateChannels = ({ value }: any) => normalizeChannelRows(value)

/**
 * 作者分组的字段级 beforeValidate。Payload 3 的 UPDATE 流程先跑字段 beforeValidate、
 * 再跑集合 beforeValidate，而 group 又把 null 当成 object 继续遍历子字段，
 * 于是 PATCH { author: null } 会在遍历时读到 null 而崩（Cannot read properties of null）。
 * 这里在遍历发生之前做两件事：把上一版文档里的 null 作者折成空分组（否则遍历子字段
 * 读 previousValue 同样会崩），并把本次显式 null 归一成带显式 null 子字段、channels: [] 的
 * 分组，从而不仅能安全落库，也把旧值真正清空。
 * 只在 data 确实带 author 键时接管本次 data：局部更新没有这个键，必须原样放过，
 * 否则会把已有专题的作者信息清掉。
 */
const beforeValidateAuthor = ({ value, data, previousSiblingDoc }: any) => {
  // Payload 的 group 遍历用 `typeof x !== 'object'` 决定是否补 {}，而 typeof null === 'object'，
  // 所以原文档里 author 为 null 时 siblingDoc 会保持 null，遍历子字段读 previousValue 时
  // 会抛「Cannot read properties of null」。把原文档上的 null 归一成空分组即可安全通过，
  // 这一步只动上一版文档、不碰本次 data，对任何更新都无副作用。
  if (previousSiblingDoc && typeof previousSiblingDoc === 'object' && previousSiblingDoc.author === null) {
    previousSiblingDoc.author = {}
  }
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'author')) return undefined
  const author = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
  // 显式 null 的渠道折成 []（数组字段对 null 会抛错）；只是省略 channels 就交给
  // Payload 自己的 fallback 去沿用旧行，不能在这里顺手清空。
  if (author.channels === null) author.channels = []
  if (Array.isArray(author.channels)) author.channels = normalizeChannelRows(author.channels)
  if (!isEmptyAuthor(author)) return author
  // 分组全空：给出显式清空形态（null 子字段 + 空数组），保证 PATCH 把旧值置空。
  return { name: null, url: null, bio: null, channels: [] }
}

/**
 * 作者分组：整体可留空（普通专题）；只要填了任意一项，就必须满足
 * name 非空、至少一个完整渠道——channels 数组第一项即首选联系方式。
 */
function validateAuthor(value: unknown): string | true {
  if (value === null || value === undefined) return true
  if (typeof value !== 'object' || Array.isArray(value)) return '作者信息格式不正确'
  const author = value as { bio?: unknown; channels?: unknown; name?: unknown; url?: unknown }
  const name = asText(author.name)
  const homepage = asText(author.url)
  const bio = asText(author.bio)
  const channels = Array.isArray(author.channels) ? author.channels : []
  // 分组全空：不启动作者版式，按普通专题处理。
  if (!name && !homepage && !bio && channels.length === 0) return true
  if (!name) return '作者型专题必须填写作者名'
  if (homepage && !isHttpUrl(homepage)) return '作者主页链接不是有效的 http/https 地址'
  if (!channels.length) return '作者型专题至少需要一个渠道作为首选联系方式'
  for (const [index, raw] of channels.entries()) {
    const result = validateChannelRow(raw, index + 1)
    if (result !== true) return result
  }
  return true
}

/**
 * 作者分组是否等于「什么都没填」。调用方需保证 channels 已是数组：
 * 数组字段对 null 会直接抛错，所以形状归一必须先于这个判断。
 */
function isEmptyAuthor(author: { bio?: unknown; channels?: unknown; name?: unknown; url?: unknown }): boolean {
  const channels = Array.isArray(author.channels) ? author.channels : []
  return !asText(author.name) && !asText(author.url) && !asText(author.bio) && channels.length === 0
}

const beforeChangeTopic = ({ data, operation, originalDoc, req }: any) => {
  const next = { ...data }
  // 只在本批次确实带了 author 键时接管它。真正的「省略 author」判断在字段级
  // beforeValidateAuthor 里（那时 data 还没被 Payload 的 fallback 注入过）；
  // 这里只做兜底，保证落库形态一定是「子字段显式值 + channels 数组」，
  // 局部更新（发布回写、批量改作品）沿用旧作者时不会被改脏。
  if (Object.prototype.hasOwnProperty.call(data, 'author')) {
    // 1) channels 形状归一：数组字段对 null 会抛错（不是「清空」），
    //    必须先把它变成数组，才能安全地走后面的清空逻辑。
    const author = next.author && typeof next.author === 'object' && !Array.isArray(next.author) ? next.author : {}
    const authorWithChannels = { ...author, channels: Array.isArray(author.channels) ? author.channels : [] }
    // 2) Payload 会把 null 的命名分组改写成 {}，而 {} 在写库时子字段一律跳过，
    //    于是「清空作者」会留下旧的 author_name/author_url/author_bio。这里兜底补成
    //    显式 null，保证确实把原值置空（channels 用空数组清掉渠道行）。
    //    正常路径上字段级 beforeValidateAuthor 已先归一过一次，这里防其它写入路径漏掉。
    next.author = isEmptyAuthor(authorWithChannels)
      ? { name: null, url: null, bio: null, channels: [] }
      : authorWithChannels
  }
  if (!req.context?.skipNeedsPublish) {
    next.needsPublish = operation === 'create' ? (next.needsPublish ?? true) : true
  }
  if (originalDoc?.status === 'active' && next.topicId && next.topicId !== originalDoc.topicId) {
    throw new Error('专题上线后 topicId 不能修改')
  }
  return next
}

export const Topics: CollectionConfig = {
  slug: 'topics',
  labels: { singular: '专题', plural: '专题' },
  admin: {
    useAsTitle: 'name',
    group: '内容管理',
    defaultColumns: ['name', 'topicId', 'status', 'order', 'needsPublish', 'updatedAt'],
  },
  access: {
    read: canReadContent,
    create: canManageContent,
    update: canManageContent,
    delete: canDeleteContent,
  },
  endpoints: [TopicsUpsertEndpoint],
  hooks: {
    beforeChange: [beforeChangeTopic],
    afterChange: [auditAfterChange('topics')],
    afterDelete: [auditAfterDelete('topics')],
  },
  fields: [
    {
      name: 'topicId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: '稳定 ID',
      validate: (value: unknown) => (typeof value === 'string' && topicIdPattern.test(value) ? true : 'topicId 必须是 kebab-case'),
    },
    { name: 'name', type: 'text', required: true, label: '名称' },
    { name: 'summary', type: 'textarea', required: true, label: '简介' },
    { name: 'nameEn', type: 'text', label: '英文名称' },
    { name: 'summaryEn', type: 'textarea', label: '英文简介' },
    { name: 'nameJa', type: 'text', label: '日文名称' },
    { name: 'summaryJa', type: 'textarea', label: '日文简介' },
    { name: 'cover', type: 'relationship', relationTo: 'works', label: '封面作品' },
    { name: 'works', type: 'relationship', relationTo: 'works', hasMany: true, label: '收录作品' },
    {
      name: 'author',
      type: 'group',
      label: '来源作者',
      admin: {
        description: '整组可留空；填写任意一项即视为作者型专题，此时作者名与首选渠道（渠道第一项）为必需。',
      },
      validate: validateAuthor,
      // 字段级 beforeValidate 先于集合 beforeValidate 运行，null → 显式清空形态必须在这里完成。
      hooks: { beforeValidate: [beforeValidateAuthor] },
      fields: [
        { name: 'name', type: 'text', label: '作者名', admin: { description: '作者型专题必填；可留空表示普通专题。' } },
        // 字段名保持 url（与前端快照 / 导出的 record.author.url 一致）。
        { name: 'url', type: 'text', label: '作者主页', admin: { description: '选填，仅支持 http/https 链接。' } },
        { name: 'bio', type: 'textarea', label: '作者简介', admin: { description: '选填。' } },
        {
          name: 'channels',
          type: 'array',
          label: '联系方式',
          admin: { description: '可增删、上下移动；按列表顺序展示，第一项为首选联系方式。' },
          // 校验钩子发生在落库之前：未填完的渠道行在这里就被拦下，
          // 不会出现「先把空行写进库、报错后行还留着」。
          hooks: { beforeValidate: [beforeValidateChannels] },
          fields: [
            {
              name: 'platform',
              type: 'text',
              required: true,
              label: '平台',
              admin: { description: '必填，如 Bilibili、Pixiv、微博。' },
              validate: (value: unknown) => (asText(value) ? true : '平台必填'),
            },
            { name: 'label', type: 'text', label: '显示文本', admin: { description: '选填，留空时显示平台名。' } },
            {
              name: 'url',
              type: 'text',
              required: true,
              label: '链接',
              admin: { description: '必填，仅支持 http/https 链接。' },
              validate: (value: unknown) => {
                const url = asText(value)
                if (!url) return '链接必填'
                return isHttpUrl(url) ? true : '链接不是有效的 http/https 地址'
              },
            },
          ],
        },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: '草稿', value: 'draft' },
        { label: '上线', value: 'active' },
      ],
      label: '状态',
    },
    { name: 'order', type: 'number', required: true, defaultValue: 0, label: '排序' },
    { name: 'needsPublish', type: 'checkbox', defaultValue: true, label: '待发布改动' },
    { name: 'lastPublishedAt', type: 'date', label: '最后发布时间', admin: { readOnly: true } },
    { name: 'lastPublishRun', type: 'relationship', relationTo: 'publish-runs', label: '最后发布批次', admin: { readOnly: true } },
  ],
}
