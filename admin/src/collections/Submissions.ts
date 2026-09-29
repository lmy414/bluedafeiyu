import type { CollectionConfig } from 'payload'

import { canManageContent, isAuthenticated, canReview } from '../lib/access'

export const Submissions: CollectionConfig = {
  slug: 'submissions',
  labels: { singular: '投稿审核', plural: '投稿审核' },
  admin: { useAsTitle: 'title', group: '投稿审核', defaultColumns: ['title', 'source', 'state', 'createdAt'] },
  access: { read: isAuthenticated, create: ({ req }) => !req.user || canManageContent({ req } as never), update: canReview, delete: ({ req }) => req.user?.role === 'owner' },
  fields: [
    { name: 'title', type: 'text', required: true, label: '投稿标题' },
    { name: 'submissionId', type: 'text', required: true, unique: true, index: true, label: '投稿 ID', admin: { readOnly: true } },
    { name: 'source', type: 'select', required: true, options: [{ label: '网页', value: 'web' }, { label: 'GitHub Issue', value: 'github-issue' }, { label: 'QQ', value: 'qq' }, { label: '飞书', value: 'feishu' }, { label: '人工导入', value: 'manual' }], label: '来源' },
    { name: 'sourceId', type: 'text', index: true, label: '来源 ID' },
    { name: 'sourceIds', type: 'array', label: '关联来源 ID', fields: [{ name: 'value', type: 'text' }] },
    { name: 'asset', type: 'upload', relationTo: 'media', required: true, label: '待审素材' },
    { name: 'sha256', type: 'text', required: true, unique: true, index: true, label: 'SHA-256', admin: { readOnly: true } },
    { name: 'format', type: 'text', label: '格式', admin: { readOnly: true } },
    { name: 'mime', type: 'text', label: 'MIME', admin: { readOnly: true } },
    { name: 'bytes', type: 'number', label: '字节数', admin: { readOnly: true } },
    { name: 'fields', type: 'group', label: '投稿字段', fields: [
      { name: 'name', type: 'text', label: '作品名' },
      { name: 'characterText', type: 'text', label: '投稿角色' },
      { name: 'description', type: 'textarea', label: '说明' },
      { name: 'tags', type: 'text', label: '标签（逗号分隔）' },
      { name: 'originType', type: 'text', label: '来源类型' },
      { name: 'originAuthor', type: 'text', label: '来源作者' },
      { name: 'originUrl', type: 'text', label: '来源链接' },
      { name: 'licenseType', type: 'text', label: '授权类型' },
      { name: 'licenseNote', type: 'textarea', label: '授权说明' },
    ] },
    { name: 'state', type: 'select', required: true, defaultValue: 'received', options: [{ label: '已收到', value: 'received' }, { label: '审核中', value: 'reviewing' }, { label: 'AI 通过', value: 'auto_passed' }, { label: 'AI 拒绝', value: 'auto_rejected' }, { label: '待人工审核', value: 'needs_manual' }, { label: '人工通过', value: 'approved' }, { label: '人工拒绝', value: 'rejected' }, { label: '待发布', value: 'ready_to_publish' }, { label: '发布中', value: 'publishing' }, { label: '已发布', value: 'published' }, { label: '发布失败', value: 'publish_failed' }], label: '状态' },
    { name: 'review', type: 'json', label: 'AI 审核结果' },
    { name: 'stateHistory', type: 'json', label: '状态历史' },
    { name: 'submitter', type: 'group', label: '投稿者', fields: [{ name: 'name', type: 'text' }, { name: 'github', type: 'text' }] },
    { name: 'origin', type: 'json', label: '原始来源信息' },
    { name: 'humanDecision', type: 'group', label: '人工决定', fields: [{ name: 'decision', type: 'select', options: [{ label: '通过', value: 'approved' }, { label: '拒绝', value: 'rejected' }] }, { name: 'reason', type: 'textarea' }, { name: 'actor', type: 'text' }, { name: 'at', type: 'date' }] },
  ],
}


