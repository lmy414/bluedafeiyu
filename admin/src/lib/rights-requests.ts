/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { draftOf, loadVocabulary } from './bulk-jobs'
import { sourceHash, validateI18n } from './localization.mjs'
import { safeHomepage } from './attribution.mjs'
import { rightsIssueSnapshot } from './rights-contract.mjs'

export const RIGHTS_REPO = 'lmy414/ai-girl-stickers'
export const rightsFail = (message: string, status = 422) =>
  Object.assign(new Error(message), { status })
export const rightsHash = (value: any) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const rightsVersion = (work: any) =>
  rightsHash({
    updatedAt: work.updatedAt,
    origin: work.origin,
    license: work.license,
    status: work.status,
    legacyData: work.legacyData,
  })
export function isRightsIssue(issue: any) {
  return (
    !issue.pull_request &&
    issue.state === 'open' &&
    !/^\[(?:bug|feature|投稿)\]/i.test(issue.title || '') &&
    (issue.labels || []).some(
      (label: any) => (typeof label === 'string' ? label : label.name) === 'takedown',
    )
  )
}
export function issueSnapshot(issue: any, comments: any[] = []) {
  return rightsIssueSnapshot(issue, comments)
}
export function requestText(issue: any) {
  // Only the requester's own words authorize a change. Other comments are evidence, never instructions.
  return [
    issue.body,
    ...(issue.comments || []).filter((c: any) => c.login === issue.login).map((c: any) => c.body),
  ].join('\n')
}
export function matchRequestedWork(issue: any, works: any[]) {
  const tokens = new Set<string>()
  for (const raw of requestText(issue).match(/https?:\/\/[^\s<>"）]+/g) || []) {
    try {
      const url = new URL(raw)
      if (!['xn--pssy23gqgbz2d718b.com', 'dafeiyu.dshregistry.xyz'].includes(url.hostname)) continue
      const slug = url.pathname.match(
        /\/(?:works|owner-picks|blue-fish)\/([a-zA-Z0-9_-]+)\.html$/,
      )?.[1]
      const id = url.hash.match(/^#\/work\/([a-zA-Z0-9_-]+)$/)?.[1]
      if (slug) tokens.add(slug)
      if (id) tokens.add(id)
    } catch {
      /* Invalid URLs cannot select works. */
    }
  }
  const matches = works.filter((w) => tokens.has(w.workId) || tokens.has(w.slug))
  return matches.length === 1 ? matches[0] : null
}
export async function githubRead(route: string, token: string, fetchImpl = fetch): Promise<any> {
  const response = await fetchImpl(`https://api.github.com/repos/${RIGHTS_REPO}/${route}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dafeiyu-rights-agent',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw rightsFail(`读取 GitHub 请求失败：HTTP ${response.status}`, 502)
  return response.json()
}
export async function readRightsIssue(number: number, token: string) {
  const issue = await githubRead(`issues/${number}`, token)
  const comments: any[] = []
  for (let page = 1; page <= 10; page++) {
    const batch = await githubRead(`issues/${number}/comments?per_page=100&page=${page}`, token)
    comments.push(...batch)
    if (batch.length < 100) return { issue, snapshot: issueSnapshot(issue, comments) }
  }
  throw rightsFail('Issue 评论过多，需人工复核')
}
export async function rightsDraft(payload: any, work: any) {
  const draft: any = {
    ...draftOf(work, 'works', await loadVocabulary(payload)),
    submitter: work.submitter,
  }
  let i18n = work.legacyData?.i18n
  if (!i18n) {
    try {
      const file = path.join(
        process.env.ADMIN_SITE_SOURCE_DIR || '/srv/apps/dafeiyu/source',
        'data/work-localizations.json',
      )
      i18n = JSON.parse(await fs.readFile(file, 'utf8')).works[work.workId]
    } catch {
      /* Missing translation stays explicit; removal does not need new prose. */
    }
  }
  if (i18n?.sourceHash === sourceHash(draft)) draft.i18n = i18n
  return draft
}
export function validateRightsDecision(
  decision: any,
  record: any,
  work: any,
  original: any,
  originalLogin: string,
) {
  if (
    !decision ||
    !['apply', 'manual'].includes(decision.verdict) ||
    typeof decision.reason !== 'string' ||
    !decision.reason.trim() ||
    decision.reason.length > 1000
  )
    throw rightsFail('verdict 和 reason 非法')
  if (
    Object.keys(decision).some(
      (k) => !['verdict', 'reason', 'requestType', 'patch', 'quote'].includes(k),
    )
  )
    throw rightsFail('申请决定含未知字段')
  if (decision.verdict === 'manual') return { decision, draft: original }
  if (!work || work.status !== 'published' || work.needsPublish)
    throw rightsFail('作品必须唯一匹配且已发布，没有其他待发布更改', 409)
  if (
    !['attribution', 'source-correction', 'license-correction', 'takedown'].includes(
      decision.requestType,
    )
  )
    throw rightsFail('不支持的申请类型')
  const text = requestText(record.issueData)
  if (
    typeof decision.quote !== 'string' ||
    !decision.quote.trim() ||
    !text.includes(decision.quote)
  )
    throw rightsFail('quote 必须引用申请人的原文')
  const owner = record.issueData.login.toLowerCase() === 'lmy414'
  const sameSubmitter =
    Boolean(originalLogin) && originalLogin.toLowerCase() === record.issueData.login.toLowerCase()
  if (
    ['takedown', 'license-correction', 'source-correction'].includes(decision.requestType) &&
    !owner &&
    !sameSubmitter
  )
    throw rightsFail('该操作需要原投稿账号或站长；其他权属证明请提交 manual')
  const patch = decision.patch || {}
  const field = (
    {
      attribution: 'author',
      'source-correction': 'url',
      'license-correction': 'licenseNote',
      takedown: null,
    } as any
  )[decision.requestType]
  if (Object.keys(patch).some((k) => k !== field) || (field && Object.keys(patch).length !== 1))
    throw rightsFail('每次仅修改该诉求对应字段；下架不接受额外字段')
  const draft = structuredClone(original)
  if (field) {
    const value = patch[field]
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > (field === 'licenseNote' ? 2000 : field === 'url' ? 2048 : 120) ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001f\u007f]|<\/?[A-Za-z!]|(?:javascript|data|vbscript)\s*:/i.test(
        value,
      )
    )
      throw rightsFail('更正内容非法')
    if (!text.includes(value)) throw rightsFail('更正内容必须逐字出现在申请人原文中')
    if (field === 'author') {
      if (/[\r\n\t]/.test(value)) throw rightsFail('作者名不能换行')
      if (value.length > 120) throw rightsFail('作者名超过 120 字')
      if (work.origin?.author && work.origin.author !== value && !owner && !sameSubmitter)
        throw rightsFail('已有作者与申请冲突，请提交 manual')
      if (
        !owner &&
        !sameSubmitter &&
        (!record.issueData.body.includes('### 你与这张图的关系') ||
          !/- \[x\] 我确认上述请求真实/.test(record.issueData.body))
      )
        throw rightsFail('补充原作者署名需要完整关系说明及确认；否则提交 manual')
      draft.origin = { ...draft.origin, author: value }
    } else if (field === 'url') {
      if (!/^https?:\/\/[^\s/?#\\]/.test(value) || value.includes('\\') || !safeHomepage(value))
        throw rightsFail('来源仅接受有效 http/https URL')
      draft.origin = { ...draft.origin, url: value }
    } else {
      // Preserve the permission type. Quote the claimant instead of inventing a CC version or ownership.
      draft.license = { ...draft.license, note: `授权说明照录：${value}` }
      if (draft.i18n) draft.i18n = { sourceHash: sourceHash(draft) }
    }
  }
  return { decision, draft }
}
export function validateRightsReady(progress: any) {
  if (!progress.decision) throw rightsFail('请先保存申请决定')
  if (progress.decision.verdict === 'manual' || progress.decision.requestType === 'takedown') return
  if (progress.draft.i18n?.sourceHash !== sourceHash(progress.draft))
    throw rightsFail('译文缺失或过期')
  validateI18n(progress.draft.i18n, progress.draft)
}
export function checkRightsLocale(content: any, language: string, progress: any) {
  const old = progress.original.i18n?.[language]
  if (old)
    for (const key of Object.keys(old)) {
      if (
        !['originNote', 'licenseNote'].includes(key) &&
        !isDeepStrictEqual(old[key], content[key])
      )
        throw rightsFail(`更正任务不能改写 ${language}.${key}`)
      if (key === 'originNote' && !isDeepStrictEqual(old[key], content[key]))
        throw rightsFail('本轮没有修改来源备注，不能重写译文')
      if (
        key === 'licenseNote' &&
        progress.decision.requestType !== 'license-correction' &&
        !isDeepStrictEqual(old[key], content[key])
      )
        throw rightsFail('本轮没有修改授权备注，不能重写译文')
    }
}
export async function queueRightsReplies(payload: any) {
  const rows = await payload.find({
    collection: 'takedown-requests',
    where: { status: { equals: 'approved' } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const directory = path.resolve(
    process.env.ADMIN_ISSUE_REPLY_DIR ||
      path.join(
        process.env.ADMIN_PUBLISH_REQUEST_DIR || '/srv/apps/dafeiyu-admin/run',
        'issue-replies',
      ),
  )
  let queued = 0
  for (const record of rows.docs) {
    const p = record.agentProgress
    if (!p || !['awaiting_publish', 'reply_queued'].includes(p.stage) || !record.work) continue
    const work = await payload.findByID({
      collection: 'works',
      id: typeof record.work === 'object' ? record.work.id : record.work,
      depth: 0,
      overrideAccess: true,
    })
    if (
      work.needsPublish ||
      work.status !== (p.decision.requestType === 'takedown' ? 'removed' : 'published')
    )
      continue
    if (
      !isDeepStrictEqual(work.origin, p.draft.origin) ||
      !isDeepStrictEqual(work.license || {}, p.draft.license || {})
    )
      continue
    const name = `${record.requestId}.json`
    await fs.mkdir(directory, { recursive: true, mode: 0o770 })
    if (await fs.stat(path.join(directory, name)).catch(() => null)) continue
    const publicOrigin = { ...work.origin }
    if (work.submitter?.credit === 'anonymous') delete publicOrigin.submitter
    const expected = {
      workId: work.workId,
      slug: work.slug,
      status: work.status,
      origin: publicOrigin,
      license: work.license || {},
      sourceHash: sourceHash(p.draft),
      kind: work.kind,
    }
    const body =
      work.status === 'removed'
        ? '已将该作品从公开站下架，作品页面与公开列表已核验。原始投稿和处理记录保留。如需进一步清除原图或个人信息，请继续说明具体范围。'
        : '已按申请原文更新作品的署名、来源或授权备注，简体、繁体、英文和日文页面已核验。'
    const target = path.join(directory, name),
      temp = target + '.tmp'
    await fs.writeFile(
      temp,
      JSON.stringify({
        schema: 'issue-reply/2',
        requestId: record.requestId,
        issue: record.issueData.number,
        issueHash: rightsHash(record.issueData),
        expected,
        body,
        close: true,
        stateReason: 'completed',
      }) + '\n',
      { mode: 0o660 },
    )
    await payload.update({
      collection: 'takedown-requests',
      id: record.id,
      data: { agentProgress: { ...p, stage: 'reply_queued', expected } },
      overrideAccess: true,
    })
    await fs.rename(temp, target)
    queued++
  }
  return queued
}
