'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useState } from 'react'

const NAV_ITEMS = [
  { href: '/admin', label: '任务中心', match: '/admin' },
  { href: '/admin/library', label: '作品库', match: '/admin/library' },
  { href: '/admin/topics-board', label: '专题', match: '/admin/topics-board' },
  { href: '/admin/bots', label: '设置', match: '/admin/bots' },
]

export function AdminNav() {
  const pathname = usePathname()
  const [advanced, setAdvanced] = useState(pathname.startsWith('/admin/collections'))
  return (
    <div className="s3-nav-block" data-advanced={advanced}>
      <p className="s3-nav-heading">蓝色大肥鱼</p>
      <nav className="s3-nav-links" aria-label="后台主导航">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/admin' ? ['/admin', '/admin/review', '/admin/publish'].includes(pathname) : pathname.startsWith(item.match)
          return (
            <Link aria-current={active ? 'page' : undefined} className={`s3-nav-link ${active ? 's3-nav-link--active' : ''}`} href={item.href} key={item.href}>
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="s3-nav-divider" />
      <button className="s3-text-button" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? '收起高级管理' : '高级管理'}</button>
    </div>
  )
}
