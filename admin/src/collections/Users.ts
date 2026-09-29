import type { CollectionConfig } from 'payload'

import { isOwner } from '../lib/access'
import { auditAfterChange, auditAfterDelete } from '../lib/audit'

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: '后台用户', plural: '后台用户' },
  admin: {
    useAsTitle: 'email',
    group: '系统',
    defaultColumns: ['email', 'displayName', 'role', 'hasAPIKey', 'updatedAt'],
  },
  auth: {
    useAPIKey: true,
  },
  access: {
    admin: ({ req }) => req.user?.role === 'owner',
    read: isOwner,
    create: isOwner,
    update: isOwner,
    delete: isOwner,
  },
  hooks: {
    afterChange: [auditAfterChange('users')],
    afterDelete: [auditAfterDelete('users')],
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'owner',
      options: [
        { label: '站长', value: 'owner' },
        { label: '机器人', value: 'bot' },
      ],
      label: '角色',
      admin: { description: '机器人只能使用 API Key，不能登录后台界面。' },
    },
    {
      name: 'displayName',
      type: 'text',
      label: '显示名称',
      admin: { description: '审计记录中的操作者名称。' },
    },
  ],
}
