import type { CollectionConfig } from 'payload'

export const BulkJobs: CollectionConfig = {
  slug: 'bulk-jobs',
  lockDocuments: false,
  labels: { singular: '批量任务', plural: '批量任务' },
  admin: { useAsTitle: 'jobId', group: '系统', defaultColumns: ['jobId', 'operation', 'status', 'cursor', 'updatedAt'] },
  access: {
    read: ({ req }) => req.user?.role === 'owner',
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'jobId', type: 'text', unique: true, index: true, required: true },
    { name: 'operation', type: 'select', required: true, options: ['write-fields', 'ai-fill', 'translate', 'manual-include'] },
    { name: 'target', type: 'select', required: true, options: ['works', 'submissions'] },
    {
      name: 'status',
      type: 'select',
      index: true,
      required: true,
      defaultValue: 'queued',
      options: ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'],
    },
    { name: 'ids', type: 'json', required: true },
    { name: 'options', type: 'json' },
    { name: 'results', type: 'json' },
    { name: 'cursor', type: 'number', defaultValue: 0, required: true },
    { name: 'requestedBy', type: 'relationship', relationTo: 'users', required: true },
    { name: 'finishedAt', type: 'date' },
  ],
}
