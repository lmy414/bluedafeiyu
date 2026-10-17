import React from 'react'
import Link from 'next/link'

export function PageHeader({
  actions,
  description,
  title,
}: {
  actions?: React.ReactNode
  description?: string
  title: string
}) {
  return (
    <header className="s3-page-header">
      <div>
        <p className="s3-eyebrow">蓝色大肥鱼 · 运营后台</p>
        <h1>{title}</h1>
        {description ? <p className="s3-muted">{description}</p> : null}
      </div>
      <div className="s3-page-actions">
        {actions}
        {title !== '\u4efb\u52a1\u4e2d\u5fc3' ? (
          <Link className="s3-button s3-button--ghost" href="/admin">
            任务中心
          </Link>
        ) : null}
      </div>
    </header>
  )
}
