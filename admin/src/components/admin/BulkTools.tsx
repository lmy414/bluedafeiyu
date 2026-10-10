'use client'

import React, { useEffect, useState } from 'react'
import { useAdminApi } from './api'
import { Modal } from './Modal'
import type { CategoryDoc, CharacterDoc } from './types'

type Operation = 'write-fields' | 'ai-fill' | 'translate' | 'manual-include'
type Job = {
  jobId: string
  operation: Operation
  status: string
  cursor: number
  total: number
  succeeded: number
  skipped: number
  failed: number
  agentStage?: string
  agentError?: string
  results?: Array<{ id: string; status: string; message: string }>
}
const LABELS = {
  'write-fields': '批量写字段',
  'ai-fill': 'AI 批量补写',
  translate: '批量翻译',
  'manual-include': '批量人工收录',
}
const STATES: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  succeeded: '完成',
  partial: '部分失败',
  failed: '失败',
  cancelled: '已取消',
}

export function BulkTools({
  ids,
  target,
  characters,
  categories,
  onSubmitted,
}: {
  ids: string[]
  target: 'works' | 'submissions'
  characters: CharacterDoc[]
  categories: CategoryDoc[]
  onSubmitted: () => void
}) {
  const { mutate } = useAdminApi()
  const [operation, setOperation] = useState<Operation | null>(null)
  const [enabled, setEnabled] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [force, setForce] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [requestId, setRequestId] = useState('')
  function open(op: Operation) {
    setOperation(op)
    setConfirmed(false)
    setForce(false)
    setMessage('')
    setRequestId(crypto.randomUUID())
  }
  async function submit() {
    if (!operation || sending) return
    if (!ids.length || ids.length > 200) {
      setMessage('每批请选择 1～200 条')
      return
    }
    if (!confirmed) {
      setMessage('请勾选确认后提交')
      return
    }
    const patch = Object.fromEntries(
      enabled.map((key) => [
        key,
        key === 'tags'
          ? (values[key] || '')
              .split(/[,，\n]/)
              .map((x) => x.trim())
              .filter(Boolean)
          : key === 'categoryIds'
            ? [values[key] || '']
            : values[key] || '',
      ]),
    )
    if (operation === 'write-fields' && !enabled.length) {
      setMessage('请选择要写入的字段')
      return
    }
    setSending(true)
    try {
      await mutate('/bulk/request', 'POST', {
        operation,
        target,
        ids,
        patch,
        requestId,
        force,
        confirm: operation === 'manual-include' ? 'MANUAL_INCLUDE' : force ? 'OVERWRITE' : 'WRITE',
      })
      setOperation(null)
      onSubmitted()
      window.dispatchEvent(new Event('s3-bulk-submitted'))
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setSending(false)
    }
  }
  return (
    <>
      <button className="s3-button" onClick={() => open('write-fields')} type="button">
        批量写字段
      </button>
      <button className="s3-button" onClick={() => open('ai-fill')} type="button">
        AI 批量补写
      </button>
      <button className="s3-button" onClick={() => open('translate')} type="button">
        批量翻译
      </button>
      {target === 'submissions' ? (
        <button
          className="s3-button s3-button--warning"
          onClick={() => open('manual-include')}
          type="button"
        >
          批量人工收录
        </button>
      ) : null}
      <Modal
        open={Boolean(operation)}
        title={operation ? LABELS[operation] : ''}
        confirmLabel={sending ? '提交中…' : '提交后台任务'}
        onClose={() => {
          if (!sending) setOperation(null)
        }}
        onConfirm={() => void submit()}
      >
        <p>
          已选择 {ids.length} 条。任务由服务器独立执行，关闭页面不会停止，结果保留在“批量任务”。
        </p>
        {operation === 'write-fields' ? (
          <>
            <p>
              只修改勾选的字段，所选条目使用同一值。未勾选字段保留原值；稳定
              ID、Slug、原图、来源和授权不可批量修改。
            </p>
            {(
              ['name', 'description', 'commentary', 'tags', 'characterId', 'categoryIds'] as const
            ).map((key) => (
              <div key={key}>
                <label className="s3-check">
                  <input
                    type="checkbox"
                    checked={enabled.includes(key)}
                    onChange={(event) =>
                      setEnabled((current) =>
                        event.target.checked ? [...current, key] : current.filter((k) => k !== key),
                      )
                    }
                  />
                  {
                    {
                      name: '名称',
                      description: '说明',
                      commentary: '点评',
                      tags: '标签',
                      characterId: '角色',
                      categoryIds: '类型',
                    }[key]
                  }
                </label>
                {enabled.includes(key) ? (
                  key === 'characterId' || key === 'categoryIds' ? (
                    <select
                      aria-label={'批量' + (key === 'characterId' ? '角色' : '类型')}
                      value={values[key] || ''}
                      onChange={(event) => setValues({ ...values, [key]: event.target.value })}
                    >
                      <option value="">请选择</option>
                      {(key === 'characterId' ? characters : categories).map((item) => (
                        <option
                          key={String(item.id)}
                          value={
                            'characterId' in item
                              ? item.characterId
                              : (item as CategoryDoc).categoryId
                          }
                        >
                          {item.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      aria-label={
                        '批量' +
                        { name: '名称', description: '说明', commentary: '点评', tags: '标签' }[key]
                      }
                      value={values[key] || ''}
                      onChange={(event) => setValues({ ...values, [key]: event.target.value })}
                    />
                  )
                ) : null}
              </div>
            ))}
          </>
        ) : null}
        {operation === 'ai-fill' ? (
          <p>按每张图片分别补写缺失字段，不覆盖已有内容；同时生成英日版本。不会自动收录或发布。</p>
        ) : null}
        {operation === 'translate' ? (
          <>
            <p>按当前中文生成英文和日文。有效译文默认跳过，中文发生变化后会重新生成。</p>
            <label className="s3-check">
              <input checked={force} onChange={(e) => setForce(e.target.checked)} type="checkbox" />
              重新生成并覆盖已有译文
            </label>
          </>
        ) : null}
        {operation === 'manual-include' ? (
          <p className="s3-danger-copy">
            所选条目可能包含 AI
            拒绝内容。必须逐张看图确认合规。字段、有效译文或预览缺失的条目会失败；成功条目只进入待发布，原
            AI 结论保留。
          </p>
        ) : null}
        <label className="s3-check">
          <input
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            type="checkbox"
          />
          {operation === 'manual-include'
            ? '我已逐张复核所选图片，确认合规并同意人工收录'
            : '我已确认所选条目和本次修改范围'}
        </label>
        {message ? (
          <p role="alert" className="s3-danger-copy">
            {message}
          </p>
        ) : null}
      </Modal>
    </>
  )
}

export function BulkJobsPanel({ onCompleted }: { onCompleted: () => void }) {
  const { get, mutate } = useAdminApi()
  const [jobs, setJobs] = useState<Job[]>([])
  const [detail, setDetail] = useState<Job | null>(null)
  const [message, setMessage] = useState('')
  const completed = React.useRef(new Set<string>())
  const callback = React.useRef(onCompleted)
  callback.current = onCompleted
  useEffect(() => {
    let live = true
    const load = () => {
      void get<{ jobs: Job[] }>('/bulk/jobs')
        .then((result) => {
          if (!live) return
          for (const job of result.jobs || [])
            if (!['queued', 'running'].includes(job.status) && !completed.current.has(job.jobId)) {
              completed.current.add(job.jobId)
              callback.current()
            }
          setJobs(result.jobs || [])
        })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, 5000)
    window.addEventListener('s3-bulk-submitted', load)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('s3-bulk-submitted', load)
    }
  }, [get])
  async function action(path: string, jobId: string) {
    try {
      await mutate(path, 'POST', { jobId })
      window.dispatchEvent(new Event('s3-bulk-submitted'))
      setMessage('请求已提交')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }
  return (
    <section className="s3-panel s3-job-panel">
      <h2>批量任务</h2>
      <p className="s3-muted">
        服务器独立执行，关闭页面后继续。刷新或重新登录仍可查看最近 10 个任务。
      </p>
      {message ? <p className="s3-notice">{message}</p> : null}
      {!jobs.length ? (
        <p className="s3-muted">暂无批量任务。</p>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li key={job.jobId}>
              <span>
                {LABELS[job.operation]} ·{' '}
                {job.agentStage === 'blocked' ? '技术问题暂挂' : STATES[job.status] || job.status} ·{' '}
                {job.cursor}/{job.total} · 成功 {job.succeeded}
                ，跳过 {job.skipped}，失败 {job.failed}
              </span>
              <button
                className="s3-text-button"
                onClick={() => {
                  void get<{ job: Job }>('/bulk/jobs', { jobId: job.jobId }).then((r) =>
                    setDetail(r.job),
                  )
                }}
                type="button"
              >
                查看结果
              </button>
              {job.agentStage === 'blocked' ? (
                <button
                  className="s3-text-button"
                  onClick={() => void action('/bulk/retry', job.jobId)}
                  type="button"
                >
                  重试暂挂项
                </button>
              ) : null}
              {job.agentError ? <span className="s3-muted">{job.agentError}</span> : null}
              {['queued', 'running'].includes(job.status) ? (
                <button
                  className="s3-text-button"
                  onClick={() => void action('/bulk/cancel', job.jobId)}
                  type="button"
                >
                  取消剩余项
                </button>
              ) : job.failed ? (
                <button
                  className="s3-text-button"
                  onClick={() => void action('/bulk/retry', job.jobId)}
                  type="button"
                >
                  重试失败项
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {detail ? (
        <Modal
          open
          title="批量任务结果"
          confirmLabel="关闭"
          onClose={() => setDetail(null)}
          onConfirm={() => setDetail(null)}
        >
          <p>{detail.jobId}</p>
          <ul>
            {(detail.results || []).map((r, i) => (
              <li key={r.id + i}>
                <code>{r.id}</code> · {r.status}：{r.message}
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </section>
  )
}
