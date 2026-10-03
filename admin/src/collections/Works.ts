import type { CollectionConfig } from 'payload'

import { canDeleteContent, canManageContent, canPublish, canReadContent } from '../lib/access'
import { auditAfterChange, auditAfterDelete } from '../lib/audit'
import { WorksBulkEndpoint } from '../endpoints/works-bulk'
import { submissionAttribution } from '../lib/attribution.mjs'

const ownerOnlyUpdate = ({ req }: any) => req.user?.role === 'owner' || req.context?.skipFieldAccess === true

const normalizeSubmitter = ({ data, originalDoc }: any) => {
  if (!data?.submitter) return data
  const who = { ...(originalDoc?.submitter || {}), ...data.submitter }
  const normalized = submissionAttribution({ credit: who.credit, creditName: who.credit ? who.name : undefined, creditUrl: who.credit ? who.url : undefined })
  return normalized ? { ...data, submitter: normalized } : data
}

const PUBLIC_FIELDS = ['name', 'description', 'commentary', 'character', 'categories', 'tags', 'status', 'submitter'] as const

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function changedPublicField(data: Record<string, unknown>, originalDoc: Record<string, unknown>): boolean {
  return PUBLIC_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data, field) && !sameValue(data[field], originalDoc[field]))
}

const beforeChangeNeedsPublish = ({ data, operation, originalDoc, req }: any) => {
  if (req.context?.skipNeedsPublish) return data
  const next = { ...data }
  if (operation === 'create') {
    next.needsPublish = next.needsPublish ?? true
    next.changeAction = next.changeAction ?? 'add'
    return next
  }
  if (changedPublicField(next, originalDoc || {})) {
    next.needsPublish = true
    if (next.status === 'hidden') next.changeAction = 'hide'
    else if (originalDoc?.status === 'hidden' && next.status === 'published') next.changeAction = 'restore'
    else if (next.status === 'removed') next.changeAction = 'remove'
    else if (next.status === 'deleted') next.changeAction = 'delete'
    else next.changeAction = next.changeAction || 'update'
  }
  return next
}

export const Works: CollectionConfig = {
  slug: 'works',
  labels: { singular: '作品', plural: '作品' },
  admin: {
    useAsTitle: 'name',
    group: '内容管理',
    defaultColumns: ['name', 'kind', 'channel', 'character', 'status', 'needsPublish', 'updatedAt'],
  },
  access: {
    read: canReadContent,
    create: canManageContent,
    update: canPublish,
    delete: canDeleteContent,
  },
  endpoints: [WorksBulkEndpoint],
  hooks: {
    beforeValidate: [normalizeSubmitter],
    beforeChange: [beforeChangeNeedsPublish],
    afterChange: [auditAfterChange('works')],
    afterDelete: [auditAfterDelete('works')],
  },
  fields: [
    { name: 'workId', type: 'text', required: true, unique: true, index: true, label: '稳定 ID' },
    { name: 'slug', type: 'text', unique: true, index: true, label: '固定 Slug', admin: { description: '新作品发布前可为空，由发布器生成后回写。' } },
    { name: 'name', type: 'text', required: true, label: '作品名' },
    { name: 'description', type: 'textarea', label: '说明' },
    { name: 'commentary', type: 'textarea', label: '详情页正文' },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'submission',
      options: [
        { label: '投稿', value: 'submission' },
        { label: '站长自用', value: 'owner-picks' },
        { label: '蓝色大肥鱼档案', value: 'blue-fish' },
      ],
      label: '作品板块',
    },
    {
      name: 'channel',
      type: 'select',
      required: true,
      defaultValue: 'manual',
      options: [
        { label: '网页', value: 'web' },
        { label: 'GitHub Issue', value: 'github-issue' },
        { label: 'QQ', value: 'qq' },
        { label: '人工', value: 'manual' },
        { label: '站长自用', value: 'owner' },
        { label: '蓝色大肥鱼档案', value: 'blue-fish' },
      ],
      label: '渠道',
    },
    { name: 'submissionId', type: 'text', index: true, label: '投稿队列 ID', admin: { readOnly: true } },
    { name: 'sha256', type: 'text', unique: true, index: true, label: 'SHA-256', admin: { readOnly: true } },
    { name: 'character', type: 'relationship', relationTo: 'characters', required: true, label: '角色' },
    { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true, label: '分类' },
    { name: 'tags', type: 'array', label: '标签', fields: [{ name: 'value', type: 'text', required: true }] },
    { name: 'preview', type: 'upload', relationTo: 'media', label: '预览图' },
    {
      name: 'legacyPaths',
      type: 'group',
      label: '公开路径',
      fields: [
        { name: 'path', type: 'text', label: '原图 path' },
        { name: 'thumbnailPath', type: 'text', label: '缩略图路径' },
        { name: 'fullPath', type: 'text', label: '大图路径' },
        { name: 'externalOriginalUrl', type: 'text', label: '外部原图' },
      ],
    },
    { name: 'format', type: 'text', label: '格式' },
    { name: 'mimeType', type: 'text', label: 'MIME' },
    { name: 'isAnimated', type: 'checkbox', label: '动画图片', defaultValue: false },
    { name: 'width', type: 'number', label: '宽' },
    { name: 'height', type: 'number', label: '高' },
    { name: 'fileSize', type: 'number', label: '文件大小' },
    { name: 'submitter', type: 'group', label: '投稿者署名（与作品来源独立）', fields: [
      { name: 'credit', type: 'select', label: '是否署名', options: [{ label: '不署名', value: 'anonymous' }, { label: '署名', value: 'named' }] },
      { name: 'name', type: 'text', label: '署名名字' },
      { name: 'url', type: 'text', label: '个人主页链接（可选）' },
      { name: 'github', type: 'text', label: 'GitHub 用户名（历史记录）' },
    ] },
    { name: 'origin', type: 'json', label: '来源信息' },
    { name: 'license', type: 'json', label: '授权信息' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      access: { update: ownerOnlyUpdate },
      options: [
        { label: '待发布', value: 'pending' },
        { label: '已发布', value: 'published' },
        { label: '已隐藏', value: 'hidden' },
        { label: '已移除', value: 'removed' },
        { label: '已删除', value: 'deleted' },
      ],
      label: '状态',
    },
    { name: 'needsPublish', type: 'checkbox', defaultValue: true, access: { update: ownerOnlyUpdate }, label: '待发布改动' },
    {
      name: 'changeAction',
      type: 'select',
      options: [
        { label: '新增', value: 'add' },
        { label: '修改', value: 'update' },
        { label: '隐藏', value: 'hide' },
        { label: '恢复', value: 'restore' },
        { label: '移除', value: 'remove' },
        { label: '删除', value: 'delete' },
      ],
      label: '本次变更',
      admin: { hidden: true },
    },
    { name: 'publishedAt', type: 'date', label: '首次发布时间' },
    { name: 'lastPublishedAt', type: 'date', label: '最后发布时间', admin: { readOnly: true } },
    { name: 'lastPublishRun', type: 'relationship', relationTo: 'publish-runs', label: '最后发布批次', admin: { readOnly: true } },
    { name: 'review', type: 'json', label: 'AI 审核结果', admin: { readOnly: true } },
    { name: 'legacySource', type: 'text', label: '迁移来源', admin: { readOnly: true } },
    { name: 'legacyOrder', type: 'number', label: '迁移顺序', admin: { readOnly: true } },
    { name: 'legacyData', type: 'json', label: '历史原始数据', admin: { readOnly: true } },
  ],
}
