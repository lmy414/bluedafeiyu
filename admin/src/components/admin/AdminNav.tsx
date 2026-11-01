'use client'

import { useNav } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useState } from 'react'

const NAV_ITEMS = [
  { href: '/admin', label: '任务中心', exact: true, hint: '现在需要谁做什么' },
  { href: '/admin/review', label: '投稿审核', hint: '看图判断人工收录' },
  { href: '/admin/library', label: '作品库', hint: '筛选、修改与批量处理' },
  { href: '/admin/topics-board', label: '专题', hint: '三语文案与作品编排' },
  { href: '/admin/publish', label: '发布', hint: '核对变更并提交批次' },
]

const STORAGE_KEY = 's3-nav-open-v3'

export function AdminNav() {
  const pathname = usePathname()
  const { navOpen, setNavOpen } = useNav()
  const [advanced, setAdvanced] = useState(pathname.startsWith('/admin/collections'))
  const [desktop, setDesktop] = useState(false)
  const [navReady, setNavReady] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const sync = () => setDesktop(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  // Payload 只在窄屏保存折叠偏好。桌面端统一在这里记住站长最后一次选择。
  useEffect(() => {
    if (!desktop) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(STORAGE_KEY)
    } catch {
      stored = null
    }
    if (stored === '0') {
      setNavOpen(false)
      setNavReady(true)
      return
    }
    // Payload 在 ≤1440px 首次水合时会把侧栏收回；这里在初始窗口内重新展开，
    // 连续稳定后才写入偏好。用户之后主动点击折叠仍会生效。
    let attempts = 0
    let stable = 0
    setNavOpen(true)
    const timer = window.setInterval(() => {
      attempts += 1
      if (document.querySelector('aside.nav--nav-open')) stable += 1
      else {
        stable = 0
        setNavOpen(true)
      }
      if (stable >= 5 || attempts >= 20) {
        window.clearInterval(timer)
        setNavReady(true)
      }
    }, 80)
    return () => window.clearInterval(timer)
  }, [desktop, setNavOpen])

  useEffect(() => {
    if (!desktop || !navReady) return
    try {
      window.localStorage.setItem(STORAGE_KEY, navOpen ? '1' : '0')
    } catch {
      // 隐私模式禁用 localStorage 时保持当前页状态即可。
    }
  }, [desktop, navOpen, navReady])

  return (
    <div className="s3-nav-block" data-advanced={advanced}>
      <p className="s3-nav-heading">运营工作台</p>
      <nav className="s3-nav-links" aria-label="后台主导航">
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={`s3-nav-link ${active ? 's3-nav-link--active' : ''}`}
              href={item.href}
              key={item.href}
              title={item.hint}
            >
              <span className="s3-nav-link-label">{item.label}</span>
              <span className="s3-nav-link-hint">{item.hint}</span>
            </Link>
          )
        })}
      </nav>
      <div className="s3-nav-divider" />
      <Link
        aria-current={pathname.startsWith('/admin/bots') ? 'page' : undefined}
        className={`s3-nav-link s3-nav-link--muted ${pathname.startsWith('/admin/bots') ? 's3-nav-link--active' : ''}`}
        href="/admin/bots"
      >
        <span className="s3-nav-link-label">设置</span>
        <span className="s3-nav-link-hint">身份、密钥与机器人</span>
      </Link>
      <button
        aria-expanded={advanced}
        className="s3-text-button s3-advanced-toggle"
        onClick={() => setAdvanced(!advanced)}
        type="button"
      >
        {advanced ? '收起高级管理' : '高级管理'}
      </button>
    </div>
  )
}
