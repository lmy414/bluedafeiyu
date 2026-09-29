import React from 'react'

import { STATUS_LABELS } from './constants'

export function StatusBadge({ status, text }: { status?: string; text?: string }) {
  return <span className={`s3-status s3-status--${status || 'unknown'}`}>{text || STATUS_LABELS[status || ''] || status || '未知'}</span>
}
