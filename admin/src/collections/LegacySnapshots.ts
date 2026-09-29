import type { CollectionConfig } from 'payload'

import { isOwner } from '../lib/access'
import { auditAfterChange, auditAfterDelete } from '../lib/audit'

/** 保存不能由普通内容集合表达的导入原文，例如 blue-fish 编辑叠加层。 */
export const LegacySnapshots: CollectionConfig = {
  slug: 'legacy-snapshots',
  labels: { singular: '迁移快照', plural: '迁移快照' },
  admin: { useAsTitle: 'key', group: '系统', hidden: true },
  access: { read: isOwner, create: isOwner, update: isOwner, delete: isOwner },
  hooks: { afterChange: [auditAfterChange('legacy-snapshots')], afterDelete: [auditAfterDelete('legacy-snapshots')] },
  fields: [
    { name: 'key', type: 'text', required: true, unique: true, index: true, label: '键' },
    { name: 'text', type: 'textarea', required: true, maxLength: 1_000_000, label: '原文' },
    { name: 'eol', type: 'select', required: true, defaultValue: 'crlf', options: [{ label: 'LF', value: 'lf' }, { label: 'CRLF', value: 'crlf' }], label: '换行' },
  ],
}
