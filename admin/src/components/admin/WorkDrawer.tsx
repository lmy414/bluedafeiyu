'use client'

import React, { useEffect, useMemo, useState } from 'react'

import { useAdminApi } from './api'
import { CHANNELS, SUBMISSION_STATES, formatDate, labelOf } from './constants'
import { StatusBadge } from './StatusBadge'
import type { CategoryDoc, CharacterDoc, MediaDoc, SubmissionDoc, WorkDoc } from './types'
import { asObject, relationID, workOriginalURL } from './types'

type DrawerItem =
  | { kind: 'submission'; submission: SubmissionDoc }
  | { kind: 'work'; work: WorkDoc }

type AuditEvent = {
  action?: string
  actorName?: string
  createdAt?: string
  id: string | number
}

type FormState = {
  categories: string[]
  character: string
  commentary: string
  description: string
  name: string
  tags: string
}

type IssueReplyStateReason = 'completed' | 'not_planned'

const ISSUE_REPLY_REJECTED_TEMPLATE = '感谢投稿！这张图暂时不收录，原因：'
const ISSUE_REPLY_ACCEPTED_TEMPLATE = '已收录到「蓝色大肥鱼」，谢谢投稿！'

function initialIssueReplyBody(submission?: SubmissionDoc): string {
  if (submission?.state !== 'auto_rejected') return ''
  const reason = submission.review?.reason
  return `未通过审核（AI 审核）：${typeof reason === 'string' ? reason : ''}`
}

function initialIssueReplyStateReason(submission?: SubmissionDoc): IssueReplyStateReason {
  return submission && ['auto_rejected', 'rejected'].includes(submission.state) ? 'not_planned' : 'completed'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
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
      categories: Array.isArray(work.categories) ? work.categories.map((value) => String(relationID(value))) : [],
      character: String(relationID(work.character) || ''),
      commentary: work.commentary || '',
      description: work.description || '',
      name: work.name || '',
      tags: work.tags?.map((tag) => tag.value).join(', ') || '',
    }
  }

  const submission = item.submission
  const reviewContent = record(submission.review?.content)
  const source = Object.keys(reviewContent).length ? reviewContent : record(submission.fields)
  const rawCategories = Array.isArray(source.categoryIds) ? source.categoryIds : []
  const categoryIds = rawCategories
    .map((value) => {
      const raw = String(value)
      return categories.find((category) => String(category.id) === raw || String(category.categoryId) === raw)?.id
    })
    .filter((value): value is NonNullable<typeof value> => value !== undefined && value !== null)
    .map(String)
  const rawCharacter = String(source.characterId || source.character || '')
  const character = rawCharacter
    ? characters.find((item) => String(item.id) === rawCharacter || String(item.characterId) === rawCharacter)?.id
    : undefined

  return {
    categories: categoryIds,
    character: character === undefined || character === null ? '' : String(character),
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
  const { apiRoute, get, mutate } = useAdminApi()
  const submission = item.kind === 'submission' ? item.submission : undefined
  const work = item.kind === 'work' ? item.work : asObject<WorkDoc>(submission?.work)
  const [form, setForm] = useState<FormState>(() => initialForm(item, categories, characters))
  const [localizedSuggestion,setLocalizedSuggestion]=useState<Record<string,unknown>|null>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [replyBody, setReplyBody] = useState(() => initialIssueReplyBody(submission))
  const [closeIssue, setCloseIssue] = useState(true)
  const [replyStateReason, setReplyStateReason] = useState<IssueReplyStateReason>(() => initialIssueReplyStateReason(submission))
  const [replying, setReplying] = useState(false)
  const [replyMessage, setReplyMessage] = useState('')
  const [replyError, setReplyError] = useState('')

  const auditTarget = work?.workId || submission?.submissionId
  useEffect(() => {
    if (!auditTarget) return
    void get<{ docs: AuditEvent[] }>('/audit-events', {
      depth: 0,
      limit: 20,
      sort: '-createdAt',
      'where[targetId][equals]': auditTarget,
    }).then((result) => setEvents(result.docs || []))
  }, [auditTarget, get])

  const review = work?.review || submission?.review
  const image = work ? fullImageURL(work) : submission ? submissionImage(submission) : undefined
  const originalURL = work ? workOriginalURL(work) : undefined
  const title = work?.name || submission?.title || '未命名投稿'
  const origin = record(submission?.origin)
  const issue = typeof origin.issue === 'number' && Number.isSafeInteger(origin.issue) && origin.issue > 0
    ? origin.issue
    : undefined
  const issueUrl = typeof origin.issueUrl === 'string' ? origin.issueUrl : ''
  const reviewContentPresent = Boolean(submission && Object.keys(record(submission.review?.content)).length)
  const history = useMemo(() => {
    const stateHistory = submission && Array.isArray(submission.stateHistory)
      ? submission.stateHistory.map((entry, index) => ({
        id: `submission-${index}`,
        label: `${String(entry.from || '开始')} → ${String(entry.to || '未知')}`,
        note: String(entry.reason || entry.actor || ''),
        time: String(entry.at || ''),
      }))
      : []
    const auditHistory = events.map((event) => ({
      id: event.id,
      label: event.action || '记录',
      note: event.actorName || '',
      time: event.createdAt || '',
    }))
    return [...stateHistory, ...auditHistory]
  }, [events, submission])

  function parsedTags(): string[] {
    return form.tags
      .split(/[,，\n]/)
      .map((value) => value.trim())
      .filter(Boolean)
  }

  async function save() {
    if (!work) return
    setSaving(true)
    setMessage('')
    try {
      await mutate(`/works/${encodeURIComponent(String(work.id))}`, 'PATCH', {
        ...(localizedSuggestion?{legacyData:{...(work.legacyData||{}),i18n:localizedSuggestion}}:{}),
        categories: form.categories.map(Number),
        character: form.character ? Number(form.character) : undefined,
        commentary: form.commentary,
        description: form.description,
        name: form.name,
        tags: parsedTags().map((value) => ({ value })),
      })
      setMessage('保存成功，已标记为待发布。')
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const [filling, setFilling] = useState(false)

  /** 只补当前表单里为空的字段；结果填进表单，仍需人工点保存/收录。 */
  async function aiFill() {
    const blankFields: string[] = []
    if (!form.name.trim()) blankFields.push('name')
    if (!form.description.trim() || /^首批收录自蓝色大肥鱼档案馆|原投稿未逐张命名/.test(form.description.trim())) blankFields.push('description')
    if (!form.commentary.trim()) blankFields.push('commentary')
    if (!parsedTags().length) blankFields.push('tags')
    if (!form.categories.length) blankFields.push('categories')
    if (!blankFields.length) blankFields.push('i18n')
    setFilling(true)
    setMessage('AI 正在撰写中文、英文和日文…')
    try {
      const result = await mutate<{ errors?: string[]; suggestion: Record<string, any> }>('/ai-fill', 'POST', {
        fields: blankFields,
        draft:{name:form.name,description:form.description,commentary:form.commentary,tags:parsedTags(),characterId:characters.find(c=>String(c.id)===form.character)?.characterId||'other',categoryIds:categories.filter(c=>form.categories.includes(String(c.id))).map(c=>c.categoryId)},
        ...(work ? { workId: work.workId } : { submissionId: submission?.submissionId }),
      })
      const s = result.suggestion || {}
      if(s.i18n)setLocalizedSuggestion(s.i18n)
      const categoryIds = Array.isArray(s.categoryIds)
        ? categories.filter((item) => s.categoryIds.includes(String(item.categoryId))).map((item) => String(item.id))
        : []
      setForm((current) => ({
        ...current,
        name: current.name.trim() ? current.name : s.name || current.name,
        description: blankFields.includes('description') && s.description ? s.description : current.description,
        commentary: current.commentary.trim() ? current.commentary : s.commentary || current.commentary,
        tags: current.tags.trim() ? current.tags : Array.isArray(s.tags) ? s.tags.join(', ') : current.tags,
        categories: current.categories.length ? current.categories : categoryIds,
      }))
      const source = s.descriptionSource === 'author' ? '（说明取自作者原文）' : ''
      const warn = result.errors?.length ? `；未补上：${result.errors.join('、')}` : ''
      setMessage(`已生成 AI 建议及英日版本${source}，请核对后保存${warn}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI 补全失败')
    } finally {
      setFilling(false)
    }
  }
  async function manualInclude() {
    if (!submission) return
    const character = characters.find((item) => String(item.id) === form.character)
    const selectedCategories = form.categories
      .map((id) => categories.find((item) => String(item.id) === id))
      .filter((item): item is CategoryDoc => Boolean(item))
    const content = {
      name: form.name.trim(),
      description: form.description.trim(),
      commentary: form.commentary.trim(),
      characterId: character?.characterId ? String(character.characterId) : '',
      categoryIds: selectedCategories
        .map((item) => String(item.categoryId || ''))
        .filter(Boolean),
      tags: parsedTags(),
    }

    setSaving(true)
    setMessage('')
    try {
      await mutate('/works/bulk', 'POST', {
        action: 'manual-include',
        confirm: 'MANUAL_INCLUDE',
        content,
        submissionId: submission.submissionId,
      })
      setMessage('人工收录成功，已进入待发布；原始 AI 结论、状态未改写，操作已写入审计。')
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '人工收录失败')
    } finally {
      setSaving(false)
    }
  }

  async function replyToIssue() {
    if (!submission || !issue) return
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
      <aside aria-label="作品详情" className="s3-drawer">
        <header className="s3-drawer-header">
          <div>
            <p className="s3-eyebrow">{work ? '作品审核' : '人工复审'}</p>
            <h2>{title}</h2>
          </div>
          <button aria-label="关闭" className="s3-icon-button" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <div className="s3-drawer-scroll">
          <div className="s3-drawer-image">
            {image ? <img alt={title} src={image} /> : <span>暂无预览图</span>}
            {originalURL ? <a className="s3-muted" href={originalURL} rel="noreferrer" target="_blank">查看原图</a> : null}
          </div>

          {work ? (
            <section className="s3-form-section">
              <h3>编辑作品</h3>
              <label>
                名称
                <input onChange={(event) => setForm({ ...form, name: event.target.value })} value={form.name} />
              </label>
              <label>
                说明
                <textarea onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} value={form.description} />
              </label>
              <label>
                详情正文
                <textarea onChange={(event) => setForm({ ...form, commentary: event.target.value })} rows={6} value={form.commentary} />
              </label>
              <label>
                角色
                <select onChange={(event) => setForm({ ...form, character: event.target.value })} value={form.character}>
                  <option value="">未设置</option>
                  {characters.map((character) => (
                    <option key={String(character.id)} value={String(character.id)}>
                      {character.name || character.characterId}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>分类（多选）</legend>
                <div className="s3-check-grid">
                  {categories.map((category) => {
                    const id = String(category.id)
                    return (
                      <label className="s3-check" key={id}>
                        <input
                          checked={form.categories.includes(id)}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              categories: event.target.checked
                                ? [...form.categories, id]
                                : form.categories.filter((value) => value !== id),
                            })
                          }
                          type="checkbox"
                        />
                        {category.name || category.categoryId}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              <label>
                标签（逗号分隔）
                <input onChange={(event) => setForm({ ...form, tags: event.target.value })} value={form.tags} />
              </label>
              <div className="s3-bulk-actions">
                <button className="s3-button s3-button--secondary" disabled={filling || saving} onClick={() => void aiFill()} type="button">
                  {filling ? 'AI 补全中…' : 'AI 补全与翻译'}
                </button>
                <button className="s3-button s3-button--primary" disabled={saving || filling} onClick={() => void save()} type="button">
                  {saving ? '保存中…' : '保存修改'}
                </button>
              </div>
              {message ? <p className="s3-notice">{message}</p> : null}
            </section>
          ) : null}

          <section className="s3-form-section">
            <h3>AI 审核理由</h3>
            <p className="s3-rationale">{String(review?.reason || review?.summary || '未记录 AI 理由')}</p>
            <dl className="s3-detail-list">
              <div><dt>结论</dt><dd>{String(review?.verdict || '未记录')}</dd></div>
              <div><dt>置信度</dt><dd>{typeof review?.confidence === 'number' ? `${Math.round(review.confidence * 100)}%` : '未记录'}</dd></div>
              <div><dt>模型</dt><dd>{String(review?.model || '未记录')}</dd></div>
              <div><dt>渠道</dt><dd>{labelOf(CHANNELS, work?.channel || submission?.source)}</dd></div>
            </dl>
          </section>

          {submission ? (
            <section className="s3-form-section">
              <h3>人工复审收录</h3>
              <p className="s3-muted">
                {reviewContentPresent
                  ? 'AI 已给出内容草案。请逐项核对后主动收录；原始 AI 结论不会改写。'
                  : 'AI 未保留可用内容。可以点「AI 补全与翻译」让 AI 看图填写，核对后再收录。'}
              </p>
              <label>
                名称
                <input onChange={(event) => setForm({ ...form, name: event.target.value })} value={form.name} />
              </label>
              <label>
                说明
                <textarea onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} value={form.description} />
              </label>
              <label>
                详情正文
                <textarea onChange={(event) => setForm({ ...form, commentary: event.target.value })} rows={6} value={form.commentary} />
              </label>
              <label>
                角色
                <select onChange={(event) => setForm({ ...form, character: event.target.value })} value={form.character}>
                  <option value="">未设置</option>
                  {characters.map((character) => (
                    <option key={String(character.id)} value={String(character.id)}>
                      {character.name || character.characterId}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>分类（多选）</legend>
                <div className="s3-check-grid">
                  {categories.map((category) => {
                    const id = String(category.id)
                    return (
                      <label className="s3-check" key={id}>
                        <input
                          checked={form.categories.includes(id)}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              categories: event.target.checked
                                ? [...form.categories, id]
                                : form.categories.filter((value) => value !== id),
                            })
                          }
                          type="checkbox"
                        />
                        {category.name || category.categoryId}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              <label>
                标签（逗号分隔）
                <input onChange={(event) => setForm({ ...form, tags: event.target.value })} value={form.tags} />
              </label>
              <div className="s3-bulk-actions">
                <button className="s3-button s3-button--secondary" disabled={filling || saving} onClick={() => void aiFill()} type="button">
                  {filling ? 'AI 补全中…' : 'AI 补全与翻译'}
                </button>
                <button className="s3-button s3-button--primary" disabled={saving || filling} onClick={() => void manualInclude()} type="button">
                  {saving ? '处理中…' : '人工收录'}
                </button>
              </div>
              {message ? <p className="s3-notice">{message}</p> : null}
            </section>
          ) : null}

          {submission && submission.source === 'github-issue' && issue ? (
            <section className="s3-form-section">
              <h3>回复 GitHub Issue</h3>
              <p className="s3-muted">
                Issue：{issueUrl ? <a href={issueUrl} rel="noreferrer" target="_blank">#{issue}</a> : `#${issue}`}
              </p>
              <label>
                回复内容
                <textarea onChange={(event) => setReplyBody(event.target.value)} rows={5} value={replyBody} />
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
                <input checked={closeIssue} onChange={(event) => setCloseIssue(event.target.checked)} type="checkbox" />
                同时关闭 Issue
              </label>
              <button className="s3-button s3-button--primary" disabled={replying} onClick={() => void replyToIssue()} type="button">
                {replying ? '发送中…' : '发送回复'}
              </button>
              {replyMessage ? <p className="s3-notice">{replyMessage}</p> : null}
              {replyError ? <p className="s3-danger-copy">{replyError}</p> : null}
            </section>
          ) : null}

          {submission ? (
            <section className="s3-form-section">
              <h3>投稿原始字段</h3>
              <pre>{JSON.stringify(submission.fields || {}, null, 2)}</pre>
              <p className="s3-muted">状态：{SUBMISSION_STATES[submission.state] || submission.state}</p>
            </section>
          ) : null}

          <section className="s3-form-section">
            <h3>状态与审计历史</h3>
            {history.length ? (
              <ol className="s3-history">
                {history.map((entry) => (
                  <li key={String(entry.id)}>
                    <StatusBadge text={entry.label} />
                    <span>{formatDate(entry.time)}</span>
                    {entry.note ? <p>{entry.note}</p> : null}
                  </li>
                ))}
              </ol>
            ) : <p className="s3-muted">暂无状态历史。</p>}
          </section>
        </div>
        <footer className="s3-drawer-footer">
          <span className="s3-muted">API：{apiRoute}</span>
          <button className="s3-button s3-button--ghost" onClick={onClose} type="button">关闭</button>
        </footer>
      </aside>
    </div>
  )
}
