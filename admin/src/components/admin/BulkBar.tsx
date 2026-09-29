import React from 'react'

export function BulkBar({ children, count }: { children: React.ReactNode; count: number }) {
  if (!count) return null
  return (
    <div className="s3-bulk-bar" role="region" aria-label="批量操作">
      <strong>已选 {count} 项</strong>
      <div className="s3-bulk-actions">{children}</div>
    </div>
  )
}
