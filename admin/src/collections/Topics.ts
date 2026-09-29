import type { CollectionConfig } from 'payload'

import { canDeleteContent, canManageContent, canReadContent } from '../lib/access'
import { auditAfterChange, auditAfterDelete } from '../lib/audit'

const topicIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const beforeChangeTopic = ({ data, operation, originalDoc, req }: any) => {
  const next = { ...data }
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
