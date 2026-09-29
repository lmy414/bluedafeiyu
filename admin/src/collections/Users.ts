import type { CollectionConfig } from 'payload'

import { isAuthenticated, isOwner } from '../lib/access'

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: '后台用户', plural: '后台用户' },
  admin: {
    useAsTitle: 'email',
    group: '系统',
    defaultColumns: ['email', 'role', 'updatedAt'],
  },
  auth: true,
  access: {
    read: isAuthenticated,
    create: isOwner,
    update: ({ req }) => req.user?.role === 'owner' || req.user?.id === req.routeParams?.id,
    delete: isOwner,
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'reviewer',
      options: [
        { label: '所有者', value: 'owner' },
        { label: '编辑者', value: 'editor' },
        { label: '审核者', value: 'reviewer' },
        { label: '发布者', value: 'publisher' },
        { label: 'AI 服务账号', value: 'ai-agent' },
      ],
      admin: { description: '控制后台菜单和业务操作权限；AI 服务账号不应获得登录后台的权限。' },
    },
    {
      name: 'displayName',
      type: 'text',
      label: '显示名称',
    },
    {
      name: 'isServiceAccount',
      type: 'checkbox',
      label: '服务账号',
      defaultValue: false,
      admin: { description: '给 AI 或自动化使用的账号；后续接入 API Key 时使用。' },
    },
  ],
}


