import type { CollectionConfig } from 'payload'

import { isOwner } from '../lib/access'

export const AuditEvents: CollectionConfig = {
  slug: 'audit-events',
  labels: { singular: '操作审计', plural: '操作审计' },
  admin: { useAsTitle: 'action', group: '系统', defaultColumns: ['action', 'actorType', 'targetType', 'createdAt'] },
  access: { read: isOwner, create: isOwner, update: () => false, delete: isOwner },
  fields: [
    { name: 'actorType', type: 'select', required: true, options: [{ label: '人工', value: 'human' }, { label: 'AI', value: 'ai' }, { label: '系统', value: 'system' }], label: '操作者类型' },
    { name: 'actor', type: 'relationship', relationTo: 'users', label: '操作者' },
    { name: 'action', type: 'text', required: true, label: '操作' },
    { name: 'targetType', type: 'text', required: true, label: '目标类型' },
    { name: 'targetId', type: 'text', required: true, label: '目标 ID' },
    { name: 'before', type: 'json', label: '修改前' },
    { name: 'after', type: 'json', label: '修改后' },
    { name: 'requestId', type: 'text', label: '请求 ID' },
    { name: 'ip', type: 'text', label: 'IP' },
  ],
}



