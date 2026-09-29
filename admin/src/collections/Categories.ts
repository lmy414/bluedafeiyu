import type { CollectionConfig } from 'payload'

import { canManageContent, isAuthenticated } from '../lib/access'

export const Categories: CollectionConfig = {
  slug: 'categories',
  labels: { singular: '分类', plural: '分类' },
  admin: { useAsTitle: 'name', group: '内容管理', defaultColumns: ['name', 'categoryId', 'status'] },
  access: { read: isAuthenticated, create: canManageContent, update: canManageContent, delete: ({ req }) => req.user?.role === 'owner' },
  fields: [
    { name: 'categoryId', type: 'text', required: true, unique: true, index: true, label: '稳定 ID' },
    { name: 'name', type: 'text', required: true, label: '名称' },
    { name: 'description', type: 'textarea', label: '描述' },
    { name: 'status', type: 'select', required: true, defaultValue: 'active', options: [{ label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }], label: '状态' },
  ],
}

