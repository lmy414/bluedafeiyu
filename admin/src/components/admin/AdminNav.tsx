'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React from 'react'

const NAV_ITEMS = [
  { href: '/admin', label: '概览', match: '/admin' },
  { href: '/admin/review', label: '投稿审核', match: '/admin/review' },
  { href: '/admin/library', label: '作品库', match: '/admin/library' },
  { href: '/admin/topics-board', label: '专题', match: '/admin/topics-board' },
  { href: '/admin/publish', label: '发布', match: '/admin/publish' },
  { href: '/admin/bots', label: '机器人', match: '/admin/bots' },
]

export function AdminNav() {
  const pathname = usePathname()
  return (
    <div className="s3-nav-block">
      <p className="s3-nav-heading">业务导航</p>
      <nav className="s3-nav-links">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.match)
          return (
            <Link className={`s3-nav-link ${active ? 's3-nav-link--active' : ''}`} href={item.href} key={item.href}>
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="s3-nav-divider" />
      <p className="s3-nav-heading s3-nav-heading--muted">高级入口</p>
    </div>
  )
}
