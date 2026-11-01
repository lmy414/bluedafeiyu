'use client'

import React, { useEffect, useId, useRef } from 'react'

export function Modal({
  actions,
  children,
  confirmLabel = '确认',
  danger,
  disabled,
  onClose,
  onConfirm,
  open,
  showCancel = true,
  size = 'default',
  title,
}: {
  actions?: React.ReactNode
  children: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  disabled?: boolean
  onClose: () => void
  onConfirm?: () => void
  open: boolean
  showCancel?: boolean
  size?: 'default' | 'wide'
  title: string
}) {
  const dialog = useRef<HTMLElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    Array.from(
      dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
      ) || [],
    )[0]?.focus()
    return () => {
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [open])
  if (!open) return null
  return (
    <div className="s3-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`s3-modal ${size === 'wide' ? 's3-modal--wide' : ''}`}
        ref={dialog}
        role="dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
          if (event.key !== 'Tab') return
          const nodes = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
            ) || [],
          )
          if (!nodes.length) return
          const first = nodes[0]
          const last = nodes[nodes.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="s3-modal-body">{children}</div>
        <div className="s3-modal-actions">
          {actions || (
            <>
              {showCancel ? (
                <button className="s3-button s3-button--ghost" onClick={onClose} type="button">
                  取消
                </button>
              ) : null}
              <button
                className={`s3-button ${danger ? 's3-button--danger' : 's3-button--primary'}`}
                disabled={disabled}
                onClick={onConfirm}
                type="button"
              >
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
