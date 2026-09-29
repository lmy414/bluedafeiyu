'use client'

import React from 'react'

export function Modal({
  children,
  confirmLabel = '确认',
  danger,
  onClose,
  onConfirm,
  open,
  title,
}: {
  children: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  onClose: () => void
  onConfirm: () => void
  open: boolean
  title: string
}) {
  if (!open) return null
  return (
    <div className="s3-modal-backdrop" role="presentation">
      <section aria-modal="true" className="s3-modal" role="dialog">
        <h2>{title}</h2>
        <div className="s3-modal-body">{children}</div>
        <div className="s3-modal-actions">
          <button className="s3-button s3-button--ghost" onClick={onClose} type="button">
            取消
          </button>
          <button
            className={`s3-button ${danger ? 's3-button--danger' : 's3-button--primary'}`}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
