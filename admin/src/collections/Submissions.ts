import type { CollectionConfig } from 'payload'

import { canDeleteContent, canManageContent, canReadContent } from '../lib/access'
import { auditAfterChange, auditAfterDelete } from '../lib/audit'
import { SubmissionsSyncEndpoint } from '../endpoints/dashboard'

export const Submissions: CollectionConfig = {
  slug: 'submissions',
  labels: { singular: '投稿审核', plural: '投稿审核' },
  admin: {
    useAsTitle: 'title',
    group: '投稿审核',
    defaultColumns: ['title', 'source', 'state', 'syncedAt', 'updatedAt'],
  },
  access: {
    read: canReadContent,
    create: canManageContent,
    update: canManageContent,
    delete: canDeleteContent,
  },
  endpoints: [SubmissionsSyncEndpoint],
  hooks: {
    afterChange: [auditAfterChange('submissions')],
    afterDelete: [auditAfterDelete('submissions')],
  },
  fields: [
    { name: 'title', type: 'text', required: true, label: '投稿标题', admin: { readOnly: true } },
    { name: 'submissionId', type: 'text', required: true, unique: true, index: true, label: '投稿 ID', admin: { readOnly: true } },
    {
      name: 'source',
      type: 'select',
      required: true,
      options: [
        { label: '网页', value: 'web' },
        { label: 'GitHub Issue', value: 'github-issue' },
        { label: 'QQ', value: 'qq' },
        { label: '人工导入', value: 'manual' },
      ],
      label: '来源',
      admin: { readOnly: true },
    },
    { name: 'sourceIds', type: 'array', label: '关联来源 ID', admin: { readOnly: true }, fields: [{ name: 'value', type: 'text', required: true }] },
    { name: 'sha256', type: 'text', index: true, label: 'SHA-256', admin: { readOnly: true } },
    { name: 'media', type: 'upload', relationTo: 'media', label: '预览图', admin: { readOnly: true } },
    { name: 'fields', type: 'json', label: '投稿字段', admin: { readOnly: true } },
    { name: 'editorial', type: 'json', label: '人工编辑草稿（不改原投稿或 AI 结论）', admin: { readOnly: true } },
    { name: 'review', type: 'json', label: 'AI 审核结果', admin: { readOnly: true } },
    {
      name: 'state',
      type: 'select',
      required: true,
      defaultValue: 'received',
      options: [
        { label: '已收到', value: 'received' },
        { label: '审核中', value: 'reviewing' },
        { label: 'AI 通过', value: 'auto_passed' },
        { label: 'AI 拒绝', value: 'auto_rejected' },
        { label: '待人工审核', value: 'needs_manual' },
        { label: '人工通过', value: 'approved' },
        { label: '人工拒绝', value: 'rejected' },
        { label: '待发布', value: 'ready_to_publish' },
        { label: '发布中', value: 'publishing' },
        { label: '已发布', value: 'published' },
        { label: '发布失败', value: 'publish_failed' },
      ],
      label: '状态',
      admin: { readOnly: true },
    },
    { name: 'stateHistory', type: 'json', label: '状态历史', admin: { readOnly: true } },
    { name: 'origin', type: 'json', label: '原始来源信息', admin: { readOnly: true } },
    { name: 'work', type: 'relationship', relationTo: 'works', label: '关联作品', admin: { readOnly: true } },
    { name: 'syncedAt', type: 'date', label: '同步时间', admin: { readOnly: true } },
    { name: 'queueVersion', type: 'text', label: '投稿服务版本摘要', admin: { hidden: true } },
  ],
}
