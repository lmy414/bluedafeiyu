import type { CollectionConfig } from 'payload'
import { isOwner } from '../lib/access'
export const Creators: CollectionConfig = {
  slug: 'creators', lockDocuments: false,
  labels: { singular: 'Bilibili 作者登记', plural: 'Bilibili 作者登记' },
  admin: { group: '投稿审核', useAsTitle: 'name', defaultColumns: ['name', 'homepage', 'intro', 'status', 'lastSyncedAt', 'error'] },
  access: { read: isOwner, create: () => false, update: isOwner, delete: () => false },
  hooks: { beforeChange: [({ data, originalDoc, context }) => {
    if (originalDoc && !context?.skipNeedsPublish && ((data.intro !== undefined && data.intro !== originalDoc.intro) || (data.status !== undefined && data.status !== originalDoc.status && ['paused', 'active'].includes(originalDoc.status)))) data.needsPublish = true;
    return data;
  }] },
  fields: [
    { name: 'uid', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    { name: 'homepage', label: '登记主页', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'name', label: '平台作者名', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'intro', label: '一句话创作说明（本人声明）', type: 'textarea', required: true, maxLength: 200, admin: { readOnly: true } },
    { name: 'status', label: '同步状态', type: 'select', required: true, defaultValue: 'queued', index: true,
      options: [{ label: '等待下次更新', value: 'queued' }, { label: '持续同步', value: 'active' }, { label: '已暂停', value: 'paused' }] },
    { name: 'syncPage', type: 'number', defaultValue: 1, admin: { readOnly: true } },
    { name: 'syncLease', type: 'json', admin: { hidden: true } },
    { name: 'lastSyncedAt', label: '最近同步', type: 'date', admin: { readOnly: true } },
    { name: 'retryAt', type: 'date', label: '下次重试', admin: { readOnly: true } },
    { name: 'error', type: 'textarea', label: '同步问题', admin: { readOnly: true } },
    { name: 'needsPublish', type: 'checkbox', defaultValue: false, admin: { hidden: true } },
  ],
}
