import type { CollectionConfig } from 'payload'

import { canDeleteContent, canManageContent, canReadContent } from '../lib/access'
import { auditAfterChange, auditAfterDelete } from '../lib/audit'

export const Characters: CollectionConfig = {
  slug: 'characters',
  labels: { singular: '角色', plural: '角色' },
  admin: { useAsTitle: 'name', group: '内容管理', defaultColumns: ['name', 'characterId', 'status', 'inSubmissionForm'] },
  access: { read: canReadContent, create: canManageContent, update: canManageContent, delete: canDeleteContent },
  hooks: { afterChange: [auditAfterChange('characters')], afterDelete: [auditAfterDelete('characters')] },
  fields: [
    { name: 'characterId', type: 'text', required: true, unique: true, index: true, label: '稳定 ID' },
    { name: 'name', type: 'text', required: true, label: '名称' },
    { name: 'aliases', type: 'array', label: '别名', fields: [{ name: 'value', type: 'text', required: true }] },
    { name: 'status', type: 'select', required: true, defaultValue: 'active', options: [{ label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }], label: '状态' },
    { name: 'inSubmissionForm', type: 'checkbox', defaultValue: true, label: '显示在投稿表单' },
    { name: 'legacyOrder', type: 'number', label: '迁移顺序', admin: { readOnly: true } },
    { name: 'legacyData', type: 'json', label: '历史原始数据', admin: { readOnly: true } },
  ],
}
