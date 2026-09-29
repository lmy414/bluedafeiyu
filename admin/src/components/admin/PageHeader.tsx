import React from 'react'

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
      {actions ? <div className="s3-page-actions">{actions}</div> : null}
    </header>
  )
}
