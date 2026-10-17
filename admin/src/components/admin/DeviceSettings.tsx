'use client'
import React, { useEffect, useState } from 'react'
import { useAdminApi } from './api'
import { Modal } from './Modal'
export function DeviceSettings() {
  const { get, mutate } = useAdminApi()
  const [devices, setDevices] = useState<any[]>([]),
    [name, setName] = useState(''),
    [key, setKey] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const load = () =>
    get<{ docs: any[] }>('/automation/devices')
      .then((r) => setDevices(r.docs))
      .catch((e) => setMessage(e.message))
  useEffect(() => {
    void load()
  }, [get])
  async function create() {
    if (busy) return
    setBusy(true)
    try {
      const r = await mutate<any>('/automation/devices', 'POST', { name })
      setKey(r.apiKey)
      setName('')
      await load()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function update(device: any, rotate = false) {
    if (busy) return
    if (rotate && !window.confirm('轮换后旧密钥立即失效，请同步更新对应设备配置。')) return
    setBusy(true)
    try {
      const apiKey = rotate
        ? Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
            v.toString(16).padStart(2, '0'),
          ).join('')
        : undefined
      await mutate(
        `/users/${device.id}`,
        'PATCH',
        rotate ? { apiKey, enableAPIKey: true } : { enableAPIKey: !device.enableAPIKey },
      )
      if (apiKey) setKey(apiKey)
      await load()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="s3-panel">
      <div className="s3-panel-heading">
        <div>
          <h2>本地机器人</h2>
          <p className="s3-muted">独立身份，拥有与站长相同的全部管理权限。</p>
        </div>
      </div>
      <div className="s3-settings-capabilities">
        {[
          '上传与编辑作品',
          '人工收录及自动翻译',
          '创建专题与选择作品',
          '设置封面和顺序',
          '发布、隐藏与删除',
          '管理成员与设置',
        ].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="s3-form-grid">
        <label>
          设备名称
          <input
            value={name}
            disabled={busy}
            placeholder="例如：本地工作站"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="s3-page-actions">
          <button
            className="s3-button s3-button--primary"
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
          >
            创建本地站长身份
          </button>
        </div>
      </div>
      {message ? (
        <p role="status" className="s3-notice">
          {message}
        </p>
      ) : null}
      {devices.map((d) => (
        <article className="s3-panel" key={d.id}>
          <div className="s3-panel-heading">
            <div>
              <h3>{d.displayName}</h3>
              <span className="s3-muted">站长权限 · {d.enableAPIKey ? '已启用' : '已停用'}</span>
            </div>
            <div className="s3-page-actions">
              <button
                className="s3-button s3-button--ghost"
                type="button"
                disabled={busy}
                onClick={() => void update(d)}
              >
                {d.enableAPIKey ? '停用' : '启用'}
              </button>
              <button
                className="s3-button s3-button--secondary"
                type="button"
                disabled={busy}
                onClick={() => void update(d, true)}
              >
                轮换密钥
              </button>
            </div>
          </div>
        </article>
      ))}
      <details className="s3-form-section">
        <summary>本地接入方法</summary>
        <p>使用站点仓的 tools/admin-client.mjs。命令行使用设备配置，凭证仅保存在本地配置文件中。</p>
        <pre className="s3-log">
          node tools/admin-client.mjs me{'\n'}node tools/admin-client.mjs tasks
        </pre>
      </details>
      <Modal
        open={Boolean(key)}
        title="本地机器人密钥"
        confirmLabel="已保存"
        onClose={() => setKey('')}
        onConfirm={() => setKey('')}
      >
        <p>密钥只显示本次。将其保存到设备配置的 apiKey 字段。</p>
        <div className="s3-key-display">
          <code>{key}</code>
        </div>
        <button
          className="s3-button s3-button--secondary"
          type="button"
          onClick={() => void navigator.clipboard.writeText(key)}
        >
          复制密钥
        </button>
      </Modal>
    </section>
  )
}
