import type { CollectionConfig } from 'payload'

import { isAuthenticated, canPublish } from '../lib/access'

export const PublishRuns: CollectionConfig = {
  slug: 'publish-runs',
  labels: { singular: '发布批次', plural: '发布批次' },
  admin: { useAsTitle: 'runId', group: '发布运维', defaultColumns: ['runId', 'trigger', 'status', 'startedAt', 'finishedAt'] },
  access: { read: isAuthenticated, create: canPublish, update: canPublish, delete: ({ req }) => req.user?.role === 'owner' },
  fields: [
    { name: 'runId', type: 'text', required: true, unique: true, index: true, label: '批次 ID', admin: { readOnly: true } },
    { name: 'trigger', type: 'select', required: true, options: [{ label: '手动', value: 'manual' }, { label: '定时', value: 'scheduled' }, { label: 'AI 申请', value: 'ai' }], label: '触发方式' },
    { name: 'mode', type: 'select', required: true, defaultValue: 'preview', options: [{ label: '预览', value: 'preview' }, { label: '正式发布', value: 'publish' }, { label: '回滚', value: 'rollback' }], label: '模式' },
    { name: 'status', type: 'select', required: true, defaultValue: 'queued', options: [{ label: '排队中', value: 'queued' }, { label: '执行中', value: 'in_progress' }, { label: '成功', value: 'succeeded' }, { label: '失败', value: 'failed' }, { label: '已取消', value: 'cancelled' }], label: '状态' },
    { name: 'works', type: 'relationship', relationTo: 'works', hasMany: true, label: '包含作品' },
    { name: 'plannedChanges', type: 'json', label: '计划变更' },
    { name: 'step', type: 'text', label: '当前步骤' },
    { name: 'releasePath', type: 'text', label: '发布目录' },
    { name: 'healthCheck', type: 'json', label: '健康检查' },
    { name: 'log', type: 'textarea', label: '执行日志' },
    { name: 'error', type: 'textarea', label: '错误信息' },
    { name: 'startedAt', type: 'date', label: '开始时间' },
    { name: 'finishedAt', type: 'date', label: '结束时间' },
    { name: 'actor', type: 'relationship', relationTo: 'users', label: '发起人' },
  ],
}



