import Link from 'next/link'
import React from 'react'

export function TaskLink({
  id,
  children = '查看任务进度',
}: {
  id?: string
  children?: React.ReactNode
}) {
  return (
    <Link
      className="s3-button s3-button--secondary"
      href={id ? `/admin?task=${encodeURIComponent(id)}&view=all` : '/admin'}
    >
      {children}
    </Link>
  )
}
