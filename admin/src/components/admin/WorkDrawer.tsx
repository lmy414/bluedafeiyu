'use client'

import Link from 'next/link'
import React, { useEffect, useRef, useState } from 'react'

import { useAdminApi } from './api'
import { CHANNELS, formatDate, labelOf } from './constants'
import type { CategoryDoc, CharacterDoc, MediaDoc, SubmissionDoc, WorkDoc } from './types'
import { asObject, relationID, workOriginalURL } from './types'

type DrawerItem =
  { kind: 'submission'; submission: SubmissionDoc } | { kind: 'work'; work: WorkDoc }

type AuditEvent = {
  action?: string
  actorName?: string
  createdAt?: string
  id: string | number
}

type FormState = {
  categories: string[]
  character: string
  characters: string[]
  commentary: string
  description: string
  name: string
  tags: string
}

type IssueReplyStateReason = 'completed' | 'not_planned'

function draftContent(form: FormState, categories: CategoryDoc[], characters: CharacterDoc[]) {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    commentary: form.commentary.trim(),
    characterId: characters.find((item) => String(item.id) === form.character)?.characterId || '',
    characterIds: form.characters
      .map((id) => characters.find((item) => String(item.id) === id)?.characterId)
      .filter(Boolean),
    categoryIds: categories
      .filter((item) => form.categories.includes(String(item.id)))
      .map((item) => String(item.categoryId || ''))
      .filter(Boolean),
    tags: form.tags
      .split(/[,，\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
  }
}

const ISSUE_REPLY_REJECTED_TEMPLATE = '感谢投稿！这张图暂时不收录，原因：'
const ISSUE_REPLY_ACCEPTED_TEMPLATE = '已收录到「蓝色大肥鱼」，谢谢投稿！'

function initialIssueReplyBody(submission?: SubmissionDoc): string {
  if (submission?.state !== 'auto_rejected') return ''
  const reason = submission.review?.reason
  return `未通过审核（AI 审核）：${typeof reason === 'string' ? reason : ''}`
}

function initialIssueReplyStateReason(submission?: SubmissionDoc): IssueReplyStateReason {
  return submission && ['auto_rejected', 'rejected'].includes(submission.state)
    ? 'not_planned'
    : 'completed'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function fullImageURL(work: WorkDoc): string | undefined {
  const media = asObject<MediaDoc>(work.preview)
  return media?.url || media?.thumbnailURL || media?.sizes?.thumbnail?.url
}

function submissionImage(submission: SubmissionDoc): string | undefined {
  const media = asObject<MediaDoc>(submission.media)
  return media?.thumbnailURL || media?.sizes?.thumbnail?.url || media?.url
}

function initialForm(
  item: DrawerItem,
  categories: CategoryDoc[],
  characters: CharacterDoc[],
): FormState {
  if (item.kind === 'work') {
    const work = item.work
    return {
      categories: Array.isArray(work.categories)
        ? work.categories.map((value) => String(relationID(value)))
        : [],
      character: String(relationID(work.character) || ''),
      characters: (work.characters?.length ? work.characters : [work.character])
        .map((value) => String(relationID(value) || ''))
        .filter(Boolean),
      commentary: work.commentary || '',
      description: work.description || '',
      name: work.name || '',
      tags: work.tags?.map((tag) => tag.value).join(', ') || '',
    }
  }

  const submission = item.submission
  const reviewContent = record(submission.review?.content)
  const source = { ...record(submission.fields), ...reviewContent, ...record(submission.editorial) }
  const rawCategories = Array.isArray(source.categoryIds)
    ? source.categoryIds
    : submission.fields?.categoryId
      ? [submission.fields.categoryId]
      : []
  const categoryIds = rawCategories
    .map((value) => {
      const raw = String(value)
      return categories.find(
        (category) => String(category.id) === raw || String(category.categoryId) === raw,
      )?.id
    })
    .filter((value): value is NonNullable<typeof value> => value !== undefined && value !== null)
    .map(String)
  const rawCharacter = String(source.characterId || source.character || '')
  const character = rawCharacter
    ? characters.find(
        (item) => String(item.id) === rawCharacter || String(item.characterId) === rawCharacter,
      )?.id
    : undefined

  return {
    categories: categoryIds,
    character: character === undefined || character === null ? '' : String(character),
    characters: (Array.isArray(source.characterIds) && source.characterIds.length
      ? source.characterIds
      : [rawCharacter]
    )
      .map(
        (raw) =>
          characters.find((item) => String(item.id) === String(raw) || item.characterId === raw)
            ?.id,
      )
      .filter((id) => id != null)
      .map(String),
    commentary: typeof source.commentary === 'string' ? source.commentary : '',
    description: typeof source.description === 'string' ? source.description : '',
    name: typeof source.name === 'string' ? source.name : '',
    tags: Array.isArray(source.tags) ? source.tags.map(String).join(', ') : '',
  }
}

export function WorkDrawer({
  categories,
  characters,
  item,
  onClose,
  onSaved,
}: {
  categories: CategoryDoc[]
  characters: CharacterDoc[]
  item: DrawerItem
  onClose: () => void
  onSaved: () => void
}) {
  const { get, mutate } = useAdminApi()
  const submission = item.kind === 'submission' ? item.submission : undefined
  const work = item.kind === 'work' ? item.work : asObject<WorkDoc>(submission?.work)
  const [form, setForm] = useState(() => initialForm(item, categories, characters))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [task, setTask] = useState('')
  const [submitted, setSubmitted] = useState('')
  const requestKeys = useRef(new Map<string, string>())
  const formKey = JSON.stringify(form)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [replyBody, setReplyBody] = useState(() => initialIssueReplyBody(submission))
  const [closeIssue, setCloseIssue] = useState(true)
  const [replyStateReason, setReplyStateReason] = useState<IssueReplyStateReason>(() =>
    initialIssueReplyStateReason(submission),
  )
  const [replying, setReplying] = useState(false)
  const [replyMessage, setReplyMessage] = useState('')
  const [replyError, setReplyError] = useState('')
  const image = work ? fullImageURL(work) : submission ? submissionImage(submission) : undefined
  const title = work?.name || submission?.title || '未命名投稿'
  const review = submission?.review || work?.review
  const origin = record(submission?.origin || work?.origin)
  const issue =
    typeof origin.issue === 'number' && Number.isSafeInteger(origin.issue) && origin.issue > 0
      ? origin.issue
      : undefined
  const issueUrl = typeof origin.issueUrl === 'string' ? origin.issueUrl : ''
  const originalURL = work ? workOriginalURL(work) : undefined
  const canInclude =
    submission && !submission.work && ['auto_rejected', 'needs_manual'].includes(submission.state)
  const editable = Boolean(work || canInclude)
  const formAtOpen = useRef(formKey)
  const section = useRef<HTMLElement>(null)
  const close = () => {
    if (saving) return
    if (
      formKey !== formAtOpen.current &&
      submitted !== formKey &&
      !window.confirm('当前编辑尚未提交，确认关闭？')
    )
      return
    onClose()
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    section.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      document.body.style.overflow = oldOverflow
      previous?.focus()
    }
  }, [])
  useEffect(() => {
    const target = work?.workId || submission?.submissionId
    if (target)
      void get<{ docs: AuditEvent[] }>('/audit-events', {
        limit: 20,
        sort: '-createdAt',
        'where[targetId][equals]': target,
      })
        .then((r) => setEvents(r.docs || []))
        .catch(() => {})
  }, [get, work?.workId, submission?.submissionId])
  async function submit() {
    if (saving || submitted === formKey) return
    if (!form.characters.length) {
      setMessage('请至少选择一个角色。')
      return
    }
    if (form.categories.length !== 1) {
      setMessage('请选择一个作品类型。')
      return
    }
    const id = work?.workId || submission!.submissionId
    const key = `${id}:${formKey}`
    if (!requestKeys.current.has(key)) requestKeys.current.set(key, crypto.randomUUID())
    setSaving(true)
    setMessage('')
    try {
      const response = await mutate<{ job: { jobId: string } }>('/bulk/request', 'POST', {
        operation: work ? 'ai-fill' : 'manual-include',
        target: work ? 'works' : 'submissions',
        ids: [id],
        drafts: { [id]: draftContent(form, categories, characters) },
        confirm: work ? 'WRITE' : 'MANUAL_INCLUDE',
        requestId: requestKeys.current.get(key),
      })
      setTask(response.job.jobId)
      setSubmitted(formKey)
      setMessage(
        work
          ? '修改任务已提交，文案校验和翻译会自动完成。'
          : '人工收录任务已提交，补全文案、英日翻译和校验将自动完成，然后进入待发布。',
      )
      window.dispatchEvent(new Event('s3-bulk-submitted'))
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败，请重试')
    } finally {
      setSaving(false)
    }
  }
  async function replyToIssue() {
    if (!submission || !issue || replying) return
    setReplying(true)
    setReplyMessage('')
    setReplyError('')
    try {
      await mutate('/issue-reply', 'POST', {
        body: replyBody,
        close: closeIssue,
        stateReason: replyStateReason,
        submissionId: submission.submissionId,
      })
      setReplyMessage('已提交，约 1 分钟内回复到 GitHub 并发送飞书通知')
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : '发送失败')
    } finally {
      setReplying(false)
    }
  }
  return (
    <div className="s3-drawer-backdrop" role="presentation">
      <aside
        ref={section}
        role="dialog"
        aria-modal="true"
        aria-label="作品详情"
        className="s3-drawer s3-review-editor"
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
          if (event.key === 'Tab') {
            const nodes = section.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary',
            )
            if (!nodes?.length) return
            const first = nodes[0],
              last = nodes[nodes.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first.focus()
            }
          }
        }}
      >
        <header className="s3-drawer-header">
          <div>
            <p className="s3-eyebrow">{work ? '编辑作品' : '看图审核'}</p>
            <h2>{title}</h2>
          </div>
          <button className="s3-icon-button" type="button" aria-label="关闭" onClick={close}>
            ×
          </button>
        </header>
        <div className="s3-review-layout">
          <div className="s3-review-image-pane">
            <div className="s3-drawer-image">
              {image ? <img alt={title} src={image} /> : <span>暂无预览图</span>}
            </div>
            {originalURL ? (
              <a
                className="s3-button s3-button--ghost"
                href={originalURL}
                target="_blank"
                rel="noreferrer"
              >
                查看原图
              </a>
            ) : null}
            <p className="s3-muted">{labelOf(CHANNELS, work?.channel || submission?.source)}</p>
            <section className="s3-review-reason">
              <h3>AI 审核理由</h3>
              <p>{String(review?.reason || review?.summary || '未记录，请核对图片与来源。')}</p>
            </section>
            <p className="s3-muted">
              作者：{String(origin.author || '未注明')} · 授权信息请核对来源记录
            </p>
          </div>
          <div className="s3-drawer-scroll s3-review-form-pane">
            {editable ? (
              <section className="s3-form-section">
                <h3>{work ? '编辑作品' : '人工复审收录'}</h3>
                <p className="s3-muted">
                  核对角色和作品类型，确认后自动补齐必要文案与英日译文。人工填写的内容会保留。
                </p>
                <label>
                  名称
                  <input
                    value={form.name}
                    disabled={saving}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label>
                  说明
                  <textarea
                    rows={3}
                    value={form.description}
                    disabled={saving}
                    placeholder="留空时自动补齐"
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </label>
                <label>
                  详情正文
                  <textarea
                    rows={5}
                    value={form.commentary}
                    disabled={saving}
                    placeholder="留空时自动补齐"
                    onChange={(e) => setForm({ ...form, commentary: e.target.value })}
                  />
                </label>
                <fieldset>
                  <legend>角色（至少一项）</legend>
                  <div className="s3-check-grid">
                    {characters.map((c) => {
                      const id = String(c.id)
                      return (
                        <label className="s3-check" key={id}>
                          <input
                            type="checkbox"
                            disabled={saving}
                            checked={form.characters.includes(id)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...form.characters, id]
                                : form.characters.filter((v) => v !== id)
                              setForm({
                                ...form,
                                characters: next,
                                character: next.includes(form.character)
                                  ? form.character
                                  : next[0] || '',
                              })
                            }}
                          />
                          {c.name || c.characterId}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>作品类型（单选）</legend>
                  <div className="s3-check-grid">
                    {categories.map((c) => {
                      const id = String(c.id)
                      return (
                        <label className="s3-check" key={id}>
                          <input
                            type="radio"
                            name="work-type"
                            disabled={saving}
                            checked={form.categories.includes(id)}
                            onChange={() => setForm({ ...form, categories: [id] })}
                          />
                          {c.name || c.categoryId}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <label>
                  标签（逗号分隔）
                  <input
                    disabled={saving}
                    value={form.tags}
                    onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  />
                </label>
              </section>
            ) : (
              <p className="s3-notice">
                {submission?.work
                  ? '这条投稿已关联作品，可在作品库查看。'
                  : '这条投稿由系统处理中，任务中心会更新进度。'}
              </p>
            )}
            {message ? (
              <p className="s3-notice" role="status">
                {message}
              </p>
            ) : null}
            {task ? (
              <Link
                className="s3-button s3-button--secondary"
                href={`/admin?view=all&task=${encodeURIComponent(task)}`}
              >
                查看收录与翻译任务
              </Link>
            ) : null}
            <details className="s3-form-section">
              <summary>来源、原始字段与操作历史</summary>
              <pre className="s3-log">
                {JSON.stringify(submission?.origin || work?.origin || {}, null, 2)}
              </pre>
              {submission ? (
                <pre className="s3-log">{JSON.stringify(submission.fields || {}, null, 2)}</pre>
              ) : null}
              <ul>
                {events.map((e) => (
                  <li key={e.id}>
                    {e.action} · {e.actorName} · {formatDate(e.createdAt)}
                  </li>
                ))}
              </ul>
            </details>
            {submission && submission.source === 'github-issue' && issue ? (
              <section className="s3-form-section">
                <h3>回复 GitHub Issue</h3>
                <p className="s3-muted">
                  Issue：
                  {issueUrl ? (
                    <a href={issueUrl} rel="noreferrer" target="_blank">
                      #{issue}
                    </a>
                  ) : (
                    `#${issue}`
                  )}
                </p>
                <label>
                  回复内容
                  <textarea
                    onChange={(event) => setReplyBody(event.target.value)}
                    rows={5}
                    value={replyBody}
                  />
                </label>
                <div className="s3-bulk-actions">
                  <button
                    className="s3-button s3-button--ghost"
                    onClick={() => setReplyBody(ISSUE_REPLY_REJECTED_TEMPLATE)}
                    type="button"
                  >
                    不收录模板
                  </button>
                  <button
                    className="s3-button s3-button--ghost"
                    onClick={() => setReplyBody(ISSUE_REPLY_ACCEPTED_TEMPLATE)}
                    type="button"
                  >
                    已收录模板
                  </button>
                </div>
                <fieldset>
                  <legend>关闭方式</legend>
                  <div className="s3-check-grid">
                    <label className="s3-check">
                      <input
                        checked={replyStateReason === 'not_planned'}
                        name="issue-reply-state-reason"
                        onChange={() => setReplyStateReason('not_planned')}
                        type="radio"
                      />
                      未收录（not_planned）
                    </label>
                    <label className="s3-check">
                      <input
                        checked={replyStateReason === 'completed'}
                        name="issue-reply-state-reason"
                        onChange={() => setReplyStateReason('completed')}
                        type="radio"
                      />
                      已完成（completed）
                    </label>
                  </div>
                </fieldset>
                <label className="s3-check">
                  <input
                    checked={closeIssue}
                    onChange={(event) => setCloseIssue(event.target.checked)}
                    type="checkbox"
                  />
                  同时关闭 Issue
                </label>
                <button
                  className="s3-button s3-button--primary"
                  disabled={replying}
                  onClick={() => void replyToIssue()}
                  type="button"
                >
                  {replying ? '发送中…' : '发送回复'}
                </button>
                {replyMessage ? <p className="s3-notice">{replyMessage}</p> : null}
                {replyError ? <p className="s3-danger-copy">{replyError}</p> : null}
              </section>
            ) : null}
          </div>
        </div>
        <footer className="s3-drawer-footer">
          <span className="s3-muted">
            {task ? '任务已保存，关闭页面后继续' : '收录完成后等待发布'}
          </span>
          <div className="s3-page-actions">
            <button
              className="s3-button s3-button--ghost"
              type="button"
              disabled={saving}
              onClick={close}
            >
              关闭
            </button>
            {editable ? (
              <button
                className="s3-button s3-button--primary"
                type="button"
                disabled={saving || submitted === formKey}
                onClick={() => void submit()}
              >
                {saving
                  ? '提交中…'
                  : submitted === formKey
                    ? '任务已提交'
                    : work
                      ? '保存修改'
                      : '人工收录'}
              </button>
            ) : null}
          </div>
        </footer>
      </aside>
    </div>
  )
}
