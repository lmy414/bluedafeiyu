'use client'

import { Gutter, useAuth } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

import { useAdminApi } from '../components/admin/api'
import { Modal } from '../components/admin/Modal'
import { PageHeader } from '../components/admin/PageHeader'

type BotUser = {
  displayName?: string
  email: string
  enableAPIKey?: boolean
  hasAPIKey?: boolean
  id: number | string
  role: string
  updatedAt?: string
}

function generateKey(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function BotsView() {
  const { user } = useAuth()
  const { get, mutate } = useAdminApi()
  const [bots, setBots] = useState<BotUser[]>([])
  const [newKey, setNewKey] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const result = await get<{ docs: BotUser[] }>('/users', {
        depth: 0,
        limit: 100,
        'where[role][equals]': 'bot',
      })
      setBots(result.docs || [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '机器人账号读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.role === 'owner') void load()
    else setLoading(false)
  }, [user])

  async function toggle(bot: BotUser) {
    setMessage('正在更新…')
    try {
      await mutate('/users/' + encodeURIComponent(String(bot.id)), 'PATCH', { enableAPIKey: !bot.enableAPIKey })
      setMessage(bot.enableAPIKey ? '机器人已停用。' : '机器人已启用。')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更新失败')
    }
  }

  async function reset(bot: BotUser) {
    const key = generateKey()
    setMessage('正在重置 API Key…')
    try {
      await mutate('/users/' + encodeURIComponent(String(bot.id)), 'PATCH', { apiKey: key, enableAPIKey: true })
      setNewKey(key)
      setMessage('API Key 已重置，旧 Key 立即失效。')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重置失败')
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(newKey)
    setMessage('API Key 已复制。')
  }

  if (user?.role !== 'owner') {
    return <Gutter className="s3-admin-page"><div className="s3-empty">仅站长可以管理机器人。</div></Gutter>
  }

  return (
    <Gutter className="s3-admin-page">
      <PageHeader description="机器人只能使用 API Key 调用，不能登录后台界面。" title="机器人" />
      {message ? <p className="s3-notice">{message}</p> : null}
      {loading ? <p className="s3-loading">正在读取机器人账号…</p> : null}
      <section className="s3-bot-grid">
        {bots.map((bot) => (
          <article className="s3-bot-card" key={String(bot.id)}>
            <div className="s3-bot-avatar">{(bot.displayName || bot.email).slice(0, 1).toUpperCase()}</div>
            <div className="s3-bot-info">
              <h2>{bot.displayName || bot.email}</h2>
              <p>{bot.email}</p>
              <p className={bot.enableAPIKey ? 's3-bot-state s3-bot-state--on' : 's3-bot-state'}>{bot.enableAPIKey ? '已启用' : '已停用'}</p>
              <small>{bot.hasAPIKey ? '已配置 API Key（不可回显）' : '尚未配置 API Key'}</small>
            </div>
            <div className="s3-bot-actions">
              <button className="s3-button s3-button--secondary" onClick={() => void toggle(bot)} type="button">{bot.enableAPIKey ? '停用' : '启用'}</button>
              <button className="s3-button s3-button--primary" onClick={() => void reset(bot)} type="button">重置 API Key</button>
            </div>
          </article>
        ))}
        {!loading && !bots.length ? <div className="s3-empty">尚未创建机器人账号。</div> : null}
      </section>

      <Modal confirmLabel="我已复制" onClose={() => setNewKey('')} onConfirm={() => setNewKey('')} open={Boolean(newKey)} title="新的 API Key">
        <p className="s3-danger-copy">请立即复制。关闭后后台不会再次显示该 Key。</p>
        <div className="s3-key-display"><code>{newKey}</code><button className="s3-button s3-button--secondary" onClick={() => void copy()} type="button">复制</button></div>
      </Modal>
    </Gutter>
  )
}
