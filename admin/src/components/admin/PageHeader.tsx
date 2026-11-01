import Link from 'next/link'
import React from 'react'

export function PageHeader({
  actions,
  description,
  eyebrow = '蓝色大肥鱼 · 运营工作台',
  title,
}: {
  actions?: React.ReactNode
  description?: string
  eyebrow?: string
  title: string
}) {
  return (
    <header className="s3-page-header">
      <div className="s3-page-heading">
        <p className="s3-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="s3-page-description">{description}</p> : null}
      </div>
      <div className="s3-page-actions">
        {actions}
        {title !== '任务中心' ? (
          <Link className="s3-button s3-button--ghost" href="/admin">
            返回任务中心
          </Link>
        ) : null}
      </div>
    </header>
  )
}
