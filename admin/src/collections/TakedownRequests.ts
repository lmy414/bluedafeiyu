import type { CollectionConfig } from 'payload'

import { isAuthenticated, canReview } from '../lib/access'

export const TakedownRequests: CollectionConfig = {
  slug: 'takedown-requests',
  labels: { singular: '下架与更正申请', plural: '下架与更正申请' },
  admin: { useAsTitle: 'requestId', group: '投稿审核', defaultColumns: ['requestId', 'requestType', 'status', 'createdAt'] },
  access: { read: isAuthenticated, create: ({ req }) => !req.user || isAuthenticated({ req } as never), update: canReview, delete: ({ req }) => req.user?.role === 'owner' },
  fields: [
    { name: 'requestId', type: 'text', required: true, unique: true, index: true, label: '申请 ID' },
    { name: 'requestType', type: 'select', required: true, options: [{ label: '下架', value: 'takedown' }, { label: '署名更正', value: 'attribution' }, { label: '来源更正', value: 'source-correction' }, { label: '授权更正', value: 'license-correction' }], label: '申请类型' },
    { name: 'work', type: 'relationship', relationTo: 'works', label: '关联作品' },
    { name: 'requester', type: 'group', label: '申请人', fields: [{ name: 'name', type: 'text' }, { name: 'contact', type: 'text' }, { name: 'proof', type: 'textarea' }] },
    { name: 'status', type: 'select', required: true, defaultValue: 'received', options: [{ label: '已收到', value: 'received' }, { label: '处理中', value: 'investigating' }, { label: '通过', value: 'approved' }, { label: '拒绝', value: 'rejected' }, { label: '已完成', value: 'completed' }], label: '状态' },
    { name: 'decisionNote', type: 'textarea', label: '处理说明' },
    { name: 'processedAt', type: 'date', label: '处理时间' },
  ],
}


