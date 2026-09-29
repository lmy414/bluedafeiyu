import type { CollectionConfig } from 'payload'

import { canDeleteContent, canPublish, canReadContent } from '../lib/access'
import { auditAfterChange, auditAfterDelete } from '../lib/audit'

export const PublishRuns: CollectionConfig = {
  slug: 'publish-runs',
  labels: { singular: '发布批次', plural: '发布批次' },
  admin: {
    useAsTitle: 'runId',
    group: '发布运维',
    defaultColumns: ['runId', 'trigger', 'status', 'requestedAt', 'startedAt', 'finishedAt'],
  },
  access: { read: canReadContent, create: canPublish, update: canPublish, delete: canDeleteContent },
  hooks: { afterChange: [auditAfterChange('publish-runs')], afterDelete: [auditAfterDelete('publish-runs')] },
  fields: [
    { name: 'runId', type: 'text', required: true, unique: true, index: true, label: '批次 ID', admin: { readOnly: true } },
    { name: 'trigger', type: 'select', required: true, defaultValue: 'manual', options: [{ label: '站长手动', value: 'manual' }, { label: '机器人', value: 'bot' }], label: '触发方式' },
    { name: 'mode', type: 'select', required: true, defaultValue: 'publish', options: [{ label: '预览', value: 'preview' }, { label: '正式发布', value: 'publish' }, { label: '回滚', value: 'rollback' }], label: '模式' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'queued',
      options: [
        { label: '排队中', value: 'queued' },
        { label: '执行中', value: 'in_progress' },
        { label: '成功', value: 'succeeded' },
        { label: '失败', value: 'failed' },
        { label: '已取消', value: 'cancelled' },
      ],
      label: '状态',
    },
    { name: 'requestedAt', type: 'date', label: '请求时间' },
    { name: 'requestedBy', type: 'relationship', relationTo: 'users', label: '发起人' },
    { name: 'works', type: 'relationship', relationTo: 'works', hasMany: true, label: '包含作品' },
    { name: 'plannedChanges', type: 'json', label: '计划变更' },
    { name: 'summary', type: 'json', label: '变更统计' },
    { name: 'step', type: 'text', label: '当前步骤' },
    { name: 'commits', type: 'json', label: '提交记录' },
    { name: 'releasePath', type: 'text', label: '发布目录' },
    { name: 'healthCheck', type: 'json', label: '健康检查' },
    { name: 'results', type: 'json', label: '执行结果' },
    { name: 'log', type: 'textarea', label: '执行日志' },
    { name: 'error', type: 'textarea', label: '错误信息' },
    { name: 'startedAt', type: 'date', label: '开始时间' },
    { name: 'finishedAt', type: 'date', label: '结束时间' },
  ],
}
