import type { CollectionConfig } from 'payload'

import { canManageContent, isAuthenticated, canPublish } from '../lib/access'

const textField = (name: string, label: string, required = false) => ({ name, type: 'text' as const, label, required })

export const Works: CollectionConfig = {
  slug: 'works',
  labels: { singular: '作品', plural: '作品' },
  admin: { useAsTitle: 'name', group: '内容管理', defaultColumns: ['name', 'kind', 'character', 'status', 'preview', 'updatedAt'] },
  access: { read: isAuthenticated, create: canManageContent, update: canManageContent, delete: canPublish },
  fields: [
    { name: 'workId', type: 'text', required: true, unique: true, index: true, label: '稳定 ID' },
    { name: 'slug', type: 'text', required: true, unique: true, index: true, label: '固定 Slug' },
    textField('name', '作品名', true),
    { name: 'description', type: 'textarea', label: '说明' },
    { name: 'commentary', type: 'textarea', label: '详情页正文' },
    { name: 'kind', type: 'select', required: true, defaultValue: 'submission', options: [{ label: '投稿', value: 'submission' }, { label: '站长自用', value: 'owner-picks' }, { label: '蓝色大肥鱼档案', value: 'blue-fish' }], label: '作品板块' },
    { name: 'character', type: 'relationship', relationTo: 'characters', required: true, label: '角色' },
    { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true, label: '分类' },
    { name: 'tags', type: 'array', label: '标签', fields: [{ name: 'value', type: 'text', required: true }] },
    { name: 'original', type: 'upload', relationTo: 'media', label: '原图（历史数据可缺省）' },
    { name: 'preview', type: 'upload', relationTo: 'media', label: '预览图' },
    { name: 'large', type: 'upload', relationTo: 'media', label: '大图' },
    { name: 'legacyPaths', type: 'group', label: '旧站路径', fields: [{ name: 'path', type: 'text' }, { name: 'thumbnailPath', type: 'text' }, { name: 'fullPath', type: 'text' }, { name: 'externalOriginalUrl', type: 'text' }] },
    { name: 'submitter', type: 'group', label: '投稿者', fields: [{ name: 'name', type: 'text' }, { name: 'github', type: 'text' }] },
    { name: 'origin', type: 'json', label: '来源信息' },
    { name: 'license', type: 'json', label: '授权信息' },
    { name: 'status', type: 'select', required: true, defaultValue: 'draft', options: [{ label: '草稿', value: 'draft' }, { label: '已审核', value: 'approved' }, { label: '待发布', value: 'ready_to_publish' }, { label: '发布中', value: 'publishing' }, { label: '已发布', value: 'published' }, { label: '下架', value: 'unpublished' }], label: '发布状态' },
    { name: 'publishedAt', type: 'date', label: '发布时间' },
    { name: 'legacySource', type: 'text', label: '迁移来源', admin: { readOnly: true } },
    { name: 'legacyData', type: 'json', label: '历史原始数据' },
  ],
}



