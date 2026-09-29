import path from 'node:path'

import type { CollectionConfig } from 'payload'

import { canDeleteContent, canManageContent, canReadContent } from '../lib/access'
import { auditAfterChange, auditAfterDelete } from '../lib/audit'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: '素材库', plural: '素材库' },
  admin: {
    useAsTitle: 'filename',
    group: '内容管理',
    defaultColumns: ['filename', 'mimeType', 'filesize', 'mediaRole', 'createdAt'],
  },
  access: {
    read: canReadContent,
    create: canManageContent,
    update: canManageContent,
    delete: canDeleteContent,
  },
  hooks: { afterChange: [auditAfterChange('media')], afterDelete: [auditAfterDelete('media')] },
  upload: {
    staticDir: process.env.MEDIA_DIR || path.resolve(process.cwd(), 'media'),
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/apng'],
    adminThumbnail: 'thumbnailURL',
    focalPoint: true,
    imageSizes: [
      { name: 'thumbnail', width: 480, height: 480, position: 'centre' },
    ],
  },
  fields: [
    { name: 'alt', type: 'text', required: true, label: '替代文本' },
    { name: 'sha256', type: 'text', unique: true, index: true, label: 'SHA-256', admin: { readOnly: true } },
    {
      name: 'mediaRole',
      type: 'select',
      required: true,
      defaultValue: 'original',
      options: [
        { label: '原图', value: 'original' },
        { label: '大图', value: 'large' },
        { label: '预览图', value: 'preview' },
        { label: '附件', value: 'attachment' },
      ],
      label: '素材用途',
    },
    {
      name: 'storageKind',
      type: 'select',
      required: true,
      defaultValue: 'payload-private',
      options: [
        { label: '后台私有存储', value: 'payload-private' },
        { label: '内容仓', value: 'content-repository' },
        { label: '外部来源', value: 'external' },
      ],
      label: '存储来源',
    },
    { name: 'externalUrl', type: 'text', label: '外部地址' },
    { name: 'sourcePath', type: 'text', label: '来源路径' },
    { name: 'isAnimated', type: 'checkbox', defaultValue: false, label: '动画图片', admin: { readOnly: true } },
  ],
}
