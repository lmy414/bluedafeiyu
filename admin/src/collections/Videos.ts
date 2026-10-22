import type { CollectionConfig } from 'payload'
import { isOwner } from '../lib/access'
export const Videos: CollectionConfig = {
  slug: 'videos', lockDocuments: false,
  labels: { singular: '视频审核', plural: '视频审核' },
  admin: { group: '投稿审核', useAsTitle: 'title', defaultColumns: ['title', 'creator', 'status', 'updatedAt'] },
  access: { read: isOwner, create: () => false, update: isOwner, delete: () => false },
  hooks: { beforeChange: [({ data, originalDoc, context }) => {
    if (data.status === 'approved' && originalDoc?.status !== 'approved' && !context?.videoAgent) throw new Error('视频必须通过后台 AI 审核');
    if (originalDoc && !context?.skipNeedsPublish && data.status && data.status !== originalDoc.status && (originalDoc.status === 'approved' || data.status === 'hidden')) data.needsPublish = true;
    return data;
  }] },
  fields: [
    { name: 'bvid', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    { name: 'creator', label: '登记作者', type: 'relationship', relationTo: 'creators', required: true, index: true, admin: { readOnly: true } },
    { name: 'title', label: '视频标题', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'source', label: '平台信息与审核证据', type: 'json', required: true, admin: { readOnly: true } },
    { name: 'status', label: '审核状态', type: 'select', required: true, defaultValue: 'queued', index: true,
      options: [{ label: '待 AI 审核', value: 'queued' }, { label: 'AI 审核中', value: 'reviewing' }, { label: 'AI 已通过', value: 'approved' }, { label: '非收录内容', value: 'rejected' }, { label: '证据不足，待复核', value: 'manual' }, { label: '已下架', value: 'hidden' }] },
    { name: 'review', label: 'AI 判断与理由', type: 'json', admin: { readOnly: true } },
    { name: 'lease', type: 'json', admin: { hidden: true } },
    { name: 'needsPublish', type: 'checkbox', defaultValue: false, admin: { hidden: true } },
  ],
}
