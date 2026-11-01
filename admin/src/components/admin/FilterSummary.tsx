'use client'

import React, { useId, useState } from 'react'

export type ActiveFilter = {
  key: string
  label: string
  value: string
  onRemove: () => void
}

/**
 * 统一筛选外壳：条件可见、可逐个清除、移动端折叠，结果计数和分页范围放在同一行。
 */
export function FilterSummary({
  active,
  children,
  countLabel,
  loading,
  onClear,
  range,
}: {
  active: ActiveFilter[]
  children: React.ReactNode
  countLabel: string
  loading?: boolean
  onClear: () => void
  range: string
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <section className="s3-filter-shell" aria-label="筛选条件">
      <div className="s3-filter-mobile-bar">
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="s3-button s3-button--ghost"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          筛选{active.length ? ` · ${active.length}` : ''}
        </button>
        <span className="s3-muted">{countLabel}</span>
      </div>
      <div className={open ? 's3-filter-panel s3-filter-panel--open' : 's3-filter-panel'} id={panelId}>
        {children}
      </div>
      {active.length ? (
        <div className="s3-active-filters" aria-label="当前筛选条件">
          {active.map((item) => (
            <span className="s3-chip" key={item.key}>
              <span className="s3-chip-label">{item.label}</span>
              <span>{item.value}</span>
              <button aria-label={`清除${item.label}筛选`} onClick={item.onRemove} type="button">
                ×
              </button>
            </span>
          ))}
          <button className="s3-text-button" onClick={onClear} type="button">
            清除全部
          </button>
        </div>
      ) : null}
      <div className="s3-result-line" aria-live="polite">
        <span>
          {loading ? '正在读取…' : countLabel}
          {range ? <span className="s3-muted s3-range"> · {range}</span> : null}
        </span>
      </div>
    </section>
  )
}
