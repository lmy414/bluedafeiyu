'use client'
import React, { useState } from 'react'
import { useAdminApi } from './api'
import { useConsoleVocabulary } from './useConsoleList'
import { TaskLink } from './TaskLink'
export function UploadPanel({ onUploaded }: { onUploaded: (id: string) => void }) {
  const { mutate } = useAdminApi(),
    { characters, categories } = useConsoleVocabulary()
  const [file, setFile] = useState<File | null>(null),
    [name, setName] = useState(''),
    [character, setCharacter] = useState(''),
    [category, setCategory] = useState(''),
    [include, setInclude] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [requestId] = useState(() => crypto.randomUUID())
  async function upload() {
    if (!file || busy) return
    if (file.size > 16 * 1024 * 1024) {
      setError('图片不能超过 16 MiB')
      return
    }
    setBusy(true)
    setError('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const r = await mutate<any>('/automation/upload', 'POST', {
        name: name.trim() || file.name,
        character,
        categoryId: category,
        dataBase64: btoa(binary),
        include,
        requestId,
      })
      onUploaded(r.job?.jobId || '')
      window.dispatchEvent(new Event('s3-bulk-submitted'))
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="s3-panel s3-upload-panel">
      <h2>上传作品</h2>
      <p className="s3-muted">
        原图进入私有投稿队列；同图会自动去重。选中人工收录后，文案与英日翻译自动准备。
      </p>
      <div className="s3-form-grid">
        <label>
          图片
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/apng"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <label>
          作品名称
          <input
            value={name}
            disabled={busy}
            placeholder="默认使用文件名"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          角色
          <select disabled={busy} value={character} onChange={(e) => setCharacter(e.target.value)}>
            <option value="">选择角色</option>
            {characters.map((c) => (
              <option key={c.id} value={c.characterId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          作品类型
          <select disabled={busy} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">选择类型</option>
            {categories.map((c) => (
              <option key={c.id} value={c.categoryId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="s3-check">
        <input
          type="checkbox"
          checked={include}
          disabled={busy}
          onChange={(e) => setInclude(e.target.checked)}
        />
        我已看图复核，上传后直接人工收录并自动补全文案和翻译
      </label>
      {error ? (
        <p className="s3-danger-copy" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="s3-button s3-button--primary"
        disabled={busy || !file || !character || !category}
        onClick={() => void upload()}
      >
        {busy ? '上传中…' : '上传作品'}
      </button>
    </section>
  )
}
