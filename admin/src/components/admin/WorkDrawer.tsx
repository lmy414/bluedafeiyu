'use client'

import React, { useEffect, useMemo, useState } from 'react'

import { useAdminApi } from './api'
import { CHANNELS, SUBMISSION_STATES, formatDate, labelOf } from './constants'
import { StatusBadge } from './StatusBadge'
import type { CategoryDoc, CharacterDoc, MediaDoc, SubmissionDoc, WorkDoc } from './types'
import { asObject, relationID } from './types'

type DrawerItem =
  | { kind: 'submission'; submission: SubmissionDoc }
  | { kind: 'work'; work: WorkDoc }

type AuditEvent = {
  action?: string
  actorName?: string
  createdAt?: string
  id: string | number
}

function fullImageURL(work: WorkDoc): string | undefined {
  const media = asObject<MediaDoc>(work.large) || asObject<MediaDoc>(work.original) || asObject<MediaDoc>(work.preview)
  return media?.url || media?.thumbnailURL || media?.sizes?.thumbnail?.url
}

function submissionImage(submission: SubmissionDoc): string | undefined {
  const media = asObject<MediaDoc>(submission.media)
  return media?.url || media?.thumbnailURL || media?.sizes?.thumbnail?.url
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
  const [form, setForm] = useState(() => ({
    categories: work && Array.isArray(work.categories) ? work.categories.map((value) => String(relationID(value))) : [],
    character: work ? String(relationID(work.character) || '') : '',
    commentary: work?.commentary || '',
    description: work?.description || '',
    name: work?.name || '',
    tags: work?.tags?.map((tag) => tag.value).join(', ') || '',
  }))
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!work) return
    void get<{ docs: AuditEvent[] }>('/audit-events', {
      depth: 0,
      limit: 20,
      sort: '-createdAt',
      'where[targetId][equals]': work.workId,
    }).then((result) => setEvents(result.docs || []))
  }, [get, work])

  const review = work?.review || submission?.review
  const image = work ? fullImageURL(work) : submission ? submissionImage(submission) : undefined
  const title = work?.name || submission?.title || '未命名投稿'
  const history = useMemo(() => {
    if (submission && Array.isArray(submission.stateHistory)) {
      return submission.stateHistory.map((entry, index) => ({
        id: `submission-${index}`,
        label: `${String(entry.from || '开始')} → ${String(entry.to || '未知')}`,
        note: String(entry.reason || entry.actor || ''),
        time: String(entry.at || ''),
      }))
    }
    return events.map((event) => ({
      id: event.id,
      label: event.action || '记录',
      note: event.actorName || '',
      time: event.createdAt || '',
    }))
  }, [events, submission])

  async function save() {
    if (!work) return
    setSaving(true)
    setMessage('')
    try {
      await mutate(`/works/${encodeURIComponent(String(work.id))}`, 'PATCH', {
        categories: form.categories.map(Number),
        character: form.character ? Number(form.character) : undefined,
        commentary: form.commentary,
        description: form.description,
        name: form.name,
        tags: form.tags
          .split(/[,，\n]/)
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => ({ value })),
      })
      setMessage('保存成功，已标记为待发布。')
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="s3-drawer-backdrop" role="presentation">
      <aside aria-label="作品详情" className="s3-drawer">
        <header className="s3-drawer-header">
          <div>
            <p className="s3-eyebrow">{work ? '作品审核' : '投稿详情'}</p>
            <h2>{title}</h2>
          </div>
          <button aria-label="关闭" className="s3-icon-button" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <div className="s3-drawer-scroll">
          <div className="s3-drawer-image">
            {image ? <img alt={title} src={image} /> : <span>暂无预览图</span>}
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
              <button className="s3-button s3-button--primary" disabled={saving} onClick={() => void save()} type="button">
                {saving ? '保存中…' : '保存修改'}
              </button>
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
              <h3>投稿原始字段</h3>
              <pre>{JSON.stringify(submission.fields || {}, null, 2)}</pre>
              <p className="s3-muted">状态：{SUBMISSION_STATES[submission.state] || submission.state}</p>
            </section>
          ) : null}

          <section className="s3-form-section">
            <h3>状态历史</h3>
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
