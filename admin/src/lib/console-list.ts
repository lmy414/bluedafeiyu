/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payload } from 'payload'
import { readAnalytics } from './analytics'

export type ConsoleQuery = {
  kind: 'works' | 'submissions'
  state: string
  channel: string
  status: string
  character: string
  type: string
  format: string
  topic: string
  author: string
  keyword: string
  sort: string
  page: number
  limit: number
}

export const PROCESSING_STATES = [
  'needs_review',
  'blocked',
  'processing',
  'needs_publish',
  'published',
  'hidden',
  'removed',
  'deleted',
  'rejected',
  'unknown',
] as const
export type ProcessingState = (typeof PROCESSING_STATES)[number]

export function parseConsoleQuery(url: URL): ConsoleQuery {
  const p = url.searchParams
  const positive = (key: string, fallback: number, max: number) => {
    const n = Number(p.get(key))
    return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback
  }
  return {
    kind: p.get('kind') === 'submissions' ? 'submissions' : 'works',
    state: (PROCESSING_STATES as readonly string[]).includes(p.get('state') || '') ? p.get('state')! : '',
    channel: p.get('channel') || '',
    status: p.get('status') || '',
    character: p.get('character') || '',
    type: p.get('type') || '',
    format: ['gif', 'static', 'unknown'].includes(p.get('format') || '') ? p.get('format')! : '',
    topic: (p.get('topic') || '').trim().slice(0, 100),
    author: p.get('author') || '',
    keyword: (p.get('keyword') || '').trim().slice(0, 200),
    sort: ['popular', 'downloads'].includes(p.get('sort') || '') ? p.get('sort')! : 'latest',
    page: positive('page', 1, 100000),
    limit: positive('limit', 48, 100),
  }
}

const clean = (expr: string) => `trim(ltrim(trim(coalesce(${expr},'')),'@'))`
function authorSQL(alias: string, fields = 'NULL') {
  const author = clean(`json_extract(CASE WHEN json_valid(${alias}.origin) THEN ${alias}.origin ELSE '{}' END,'$.author')`)
  const submitter = `coalesce(nullif(${clean(`${alias}.submitter_name`)},''),nullif(${clean(`${alias}.submitter_github`)},''),nullif(${clean(`json_extract(${alias}.origin,'$.submitter')`)},''),${clean(`json_extract(${fields},'$.submitter')`)})`
  return `CASE WHEN ${author}<>'' AND lower(${author}) NOT IN ('本人','自己','我','原创','self') THEN ${author} ELSE ${submitter} END`
}
export const WORK_AUTHOR_SQL = authorSQL('w')
export const SUB_AUTHOR_SQL = `CASE WHEN s.work_id IS NOT NULL THEN ${WORK_AUTHOR_SQL} ELSE CASE WHEN ${clean("json_extract(s.origin,'$.author')")}<>'' AND lower(${clean("json_extract(s.origin,'$.author')")}) NOT IN ('本人','自己','我','原创','self') THEN ${clean("json_extract(s.origin,'$.author')")} ELSE coalesce(nullif(${clean("json_extract(s.origin,'$.submitter')")},''),${clean("json_extract(s.fields,'$.submitter')")}) END END`
export const SUB_CHARACTER_SQL = `coalesce(nullif(${clean("json_extract(s.editorial,'$.characterId')")},''),nullif(${clean("json_extract(s.fields,'$.characterId')")},''),nullif(${clean("json_extract(s.fields,'$.character')")},''),'')`

/** 原图格式优先级：format → mime → 原始路径扩展名；空字符串表示资料不足（unknown）。 */
export function workFormatSQL(alias = 'w') {
  const format = `lower(trim(coalesce(${alias}.format,'')))`
  const mime = `lower(trim(coalesce(${alias}.mime_type,'')))`
  const originalPath = `lower(coalesce(${alias}.legacy_paths_path,''))`
  return `CASE
    WHEN ${format} IN ('gif','image/gif') THEN 'gif'
    WHEN ${mime}='image/gif' THEN 'gif'
    WHEN ${format}<>'' THEN ${format}
    WHEN ${mime}<>'' THEN ${mime}
    WHEN ${originalPath} LIKE '%.gif' THEN 'gif'
    ELSE '' END`
}

/**
 * 投稿本身不持久化原图格式（media 是 webp 预览），只有关联作品已嗅探的原图字段可信。
 * 未关联作品的投稿一律 unknown，绝不用缩略图扩展名或 isAnimated 猜测。
 */
export const SUB_FORMAT_SQL = `CASE WHEN s.work_id IS NOT NULL THEN (${workFormatSQL('w')}) ELSE '' END`

/** 作品唯一派生处理状态。active job/异常优先于发布状态；待发布优先于目标状态。 */
export function workProcessingStateSQL(alias = 'w', jobAlias = 'aw') {
  return `CASE
    WHEN ${jobAlias}.job_id IS NOT NULL AND (
      ${jobAlias}.status IN ('failed','partial')
      OR ${jobAlias}.stage='blocked'
      OR (${jobAlias}.stage='retry' AND coalesce(${jobAlias}.retryAt,0)<=0)
    ) THEN 'blocked'
    WHEN ${jobAlias}.job_id IS NOT NULL AND ${jobAlias}.status IN ('queued','running') THEN 'processing'
    WHEN ${alias}.needs_publish=1 OR ${alias}.status='pending' THEN 'needs_publish'
    WHEN ${alias}.status='published' THEN 'published'
    WHEN ${alias}.status='hidden' THEN 'hidden'
    WHEN ${alias}.status='removed' THEN 'removed'
    WHEN ${alias}.status='deleted' THEN 'deleted'
    ELSE 'unknown' END`
}

/** 线上版本是正交事实：只认已上线或真实上线证据；pending 作品移除但从未上线不得声称有线上版本。 */
export function workLiveVersionSQL(alias = 'w') {
  return `CASE
    WHEN ${alias}.status='published' THEN 1
    WHEN ${alias}.needs_publish=1 AND ${alias}.status IN ('hidden','removed','deleted')
      AND (${alias}.published_at IS NOT NULL OR ${alias}.last_published_at IS NOT NULL OR ${alias}.last_publish_run_id IS NOT NULL) THEN 1
    ELSE 0 END`
}

/** 投稿与关联作品共用唯一状态；没有作品时按审核/加工生命周期判定。 */
export function submissionProcessingStateSQL() {
  const stage = `coalesce(json_extract(s.agent_progress,'$.stage'),'')`
  const retryAt = `coalesce(json_extract(s.agent_progress,'$.retryAt'),0)`
  return `CASE
    WHEN s.work_id IS NOT NULL THEN
      CASE WHEN w.id IS NULL THEN 'unknown' ELSE (${workProcessingStateSQL('w')}) END
    WHEN aj.job_id IS NOT NULL AND (
      aj.status IN ('failed','partial')
      OR aj.stage='blocked'
      OR (aj.stage='retry' AND coalesce(aj.retryAt,0)<=0)
    ) THEN 'blocked'
    WHEN aj.job_id IS NOT NULL AND aj.status IN ('queued','running') THEN 'processing'
    WHEN s.state='publish_failed' THEN 'blocked'
    WHEN aj.job_id IS NULL AND ${stage}='blocked' THEN 'blocked'
    WHEN aj.job_id IS NULL AND ${stage}='retry' AND ${retryAt}<=0 THEN 'blocked'
    WHEN aj.job_id IS NULL AND ${stage}='retry' THEN 'processing'
    WHEN s.state IN ('received','reviewing','auto_passed','approved','ready_to_publish','publishing') THEN 'processing'
    WHEN s.state IN ('auto_rejected','needs_manual') THEN 'needs_review'
    WHEN s.state='rejected' THEN 'rejected'
    WHEN s.state='published' THEN 'published'
    ELSE 'unknown' END`
}

const ACTIVE_SUBMISSION_JOB = `(SELECT * FROM (
    SELECT j.job_id,j.operation,j.status,j.cursor,json_array_length(j.ids) AS total,
      json_extract(j.options,'$.agent.stage') AS stage,
      json_extract(j.options,'$.agent.retryAt') AS retryAt,
      cast(item.value AS TEXT) AS sid,
      row_number() OVER (PARTITION BY cast(item.value AS TEXT) ORDER BY j.created_at DESC) AS rn
    FROM bulk_jobs j,json_each(j.ids) item
    WHERE j.target='submissions'
  ) WHERE rn=1)`
const ACTIVE_WORK_JOB = `(SELECT * FROM (
    SELECT j.job_id,j.operation,j.status,j.cursor,json_array_length(j.ids) AS total,
      json_extract(j.options,'$.agent.stage') AS stage,
      json_extract(j.options,'$.agent.retryAt') AS retryAt,
      cast(item.value AS TEXT) AS wid,
      row_number() OVER (PARTITION BY cast(item.value AS TEXT) ORDER BY j.created_at DESC) AS rn
    FROM bulk_jobs j,json_each(j.ids) item
    WHERE j.target='works'
  ) WHERE rn=1)`
const FROM = {
  works: `works w LEFT JOIN media m ON m.id=w.preview_id LEFT JOIN characters c ON c.id=w.character_id LEFT JOIN ${ACTIVE_WORK_JOB} aw ON aw.wid=w.work_id`,
  submissions: `submissions s LEFT JOIN works w ON w.id=s.work_id LEFT JOIN media m ON m.id=s.media_id LEFT JOIN ${ACTIVE_SUBMISSION_JOB} aj ON aj.sid=s.submission_id LEFT JOIN ${ACTIVE_WORK_JOB} aw ON aw.wid=w.work_id`,
}

export async function consoleRows(payload: Payload, statement: string, args: any[] = []) {
  const client = (payload.db as any).client
  if (!client?.execute) throw new Error('后台列表需要 SQLite 查询接口')
  return (await client.execute({ sql: statement, args })).rows as any[]
}

/** 当前动作归属；任务中心与审核列表共用同一条 CASE，保证同一投稿不会一处已处理、另一处仍待处理。 */
export function submissionActivitySQL() {
  const stage = `coalesce(json_extract(s.agent_progress,'$.stage'),'')`
  const retryAt = `coalesce(json_extract(s.agent_progress,'$.retryAt'),0)`
  return `CASE
    WHEN s.work_id IS NOT NULL THEN
      CASE
        WHEN w.id IS NULL THEN 'history'
        WHEN coalesce(w.needs_publish,0)=1 OR w.status='pending' THEN 'pending_publish'
        WHEN w.status='published' THEN 'published'
        ELSE 'history' END
    WHEN ${stage}='blocked' THEN 'intervene'
    WHEN s.state='publish_failed' THEN 'intervene'
    WHEN ${stage}='retry' AND ${retryAt}<=0 THEN 'intervene'
    WHEN aj.job_id IS NOT NULL AND aj.stage='blocked' THEN 'intervene'
    WHEN aj.job_id IS NOT NULL THEN 'processing'
    WHEN s.state IN ('auto_rejected','needs_manual') THEN 'decide'
    WHEN s.state='rejected' THEN 'rejected'
    WHEN ${stage}='retry' THEN 'processing'
    WHEN s.state IN ('received','reviewing','auto_passed','approved','ready_to_publish','publishing') THEN 'processing'
    ELSE 'history' END`
}

export const WORK_PUBLICATION_SQL = `CASE
  WHEN w.needs_publish=1 OR w.status='pending' THEN 'pending_publish'
  WHEN w.status='published' THEN 'published'
  ELSE w.status END`

const SUB_PUBLICATION_SQL = `CASE
  WHEN s.work_id IS NULL OR w.id IS NULL THEN 'none'
  WHEN coalesce(w.needs_publish,0)=1 OR w.status='pending' THEN 'pending_publish'
  WHEN w.status IN ('published','hidden','removed','deleted') THEN w.status
  ELSE 'none' END`

function typeFilter(alias: string, value: string) {
  if (value === 'unknown')
    return `NOT EXISTS(SELECT 1 FROM works_rels r JOIN categories item ON item.id=r.categories_id WHERE r.parent_id=${alias}.id AND r.path='categories')`
  return `EXISTS(SELECT 1 FROM works_rels r JOIN categories item ON item.id=r.categories_id WHERE r.parent_id=${alias}.id AND r.path='categories' AND item.category_id=?)`
}
function characterFilter(alias: string, value: string) {
  if (value === 'unknown')
    return `(${alias}.character_id IS NULL AND NOT EXISTS(SELECT 1 FROM works_rels r JOIN characters item ON item.id=r.characters_id WHERE r.parent_id=${alias}.id AND r.path='characters'))`
  return `EXISTS(SELECT 1 FROM works_rels r JOIN characters item ON item.id=r.characters_id WHERE r.parent_id=${alias}.id AND r.path='characters' AND item.character_id=?)`
}

function submissionCharacterValue() {
  return `coalesce(nullif(${clean("json_extract(s.editorial,'$.characterId')")},''),nullif(${clean("json_extract(s.fields,'$.characterId')")},''),nullif(${clean("json_extract(s.fields,'$.character')")},''))`
}
function submissionTypeExists(value: string) {
  const edited = `EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(s.editorial) THEN s.editorial ELSE '{}' END,'$.categoryIds') item WHERE item.value=?)`
  const reviewed = `EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(s.review) THEN s.review ELSE '{}' END,'$.content.categoryIds') item WHERE item.value=?)`
  const fields = `json_extract(s.fields,'$.categoryId')=?`
  return value === 'unknown'
    ? `NOT (${edited} OR ${reviewed} OR ${fields})`
    : `(${edited} OR ${reviewed} OR ${fields})`
}
function formatFilter(expr: string, value: string) {
  if (value === 'gif') return `(${expr})='gif'`
  if (value === 'static') return `(${expr})<>'' AND (${expr})<>'gif'`
  return `(${expr})=''`
}

function filters(q: ConsoleQuery, includeAuthor: boolean, skipMode = false) {
  const clauses: string[] = []
  const args: any[] = []
  const add = (clause: string, ...values: any[]) => {
    clauses.push(clause)
    for (const value of values) if (value !== undefined) args.push(value)
  }
  if (q.kind === 'works') {
    if (!skipMode) {
      if (q.state) add(`(${workProcessingStateSQL('w')})=?`, q.state)
      else if (q.status) add(`(${workProcessingStateSQL('w')})=?`, q.status)
    }
    if (q.topic === 'none')
      add("NOT EXISTS(SELECT 1 FROM topics_rels tr JOIN topics t ON t.id=tr.parent_id WHERE tr.works_id=w.id AND tr.path='works')")
    else if (q.topic)
      add("EXISTS(SELECT 1 FROM topics_rels tr JOIN topics t ON t.id=tr.parent_id WHERE tr.works_id=w.id AND tr.path='works' AND t.topic_id=?)", q.topic)
    if (q.channel && q.channel !== 'all') add('w.channel=?', q.channel)
    if (q.character) add(characterFilter('w', q.character), q.character === 'unknown' ? undefined : q.character)
    if (q.type) add(typeFilter('w', q.type), q.type === 'unknown' ? undefined : q.type)
    if (q.format) add(formatFilter(workFormatSQL('w'), q.format))
  } else {
    if (!skipMode) {
      if (q.state) add(`(${submissionProcessingStateSQL()})=?`, q.state)
    }
    if (q.channel && q.channel !== 'all') add('s.source=?', q.channel)
    if (q.character)
      add(
        q.character === 'unknown' ? `(${submissionCharacterValue()}) IS NULL OR (${submissionCharacterValue()})=''` : `(${submissionCharacterValue()})=?`,
        q.character === 'unknown' ? undefined : q.character,
      )
    if (q.type) {
      const expression = submissionTypeExists(q.type)
      const count = (expression.match(/\?/g) || []).length
      add(expression, ...Array.from({ length: count }, () => q.type))
    }
    if (q.format) add(formatFilter(SUB_FORMAT_SQL, q.format))
  }
  const author = q.kind === 'works' ? WORK_AUTHOR_SQL : SUB_AUTHOR_SQL
  if (includeAuthor && q.author) add(`(${author})=?`, q.author === '__none__' ? '' : q.author)
  if (q.keyword) {
    const search = `%${q.keyword.replace(/[\\%_]/g, '\\$&')}%`
    const names = q.kind === 'works' ? ['w.name', 'w.work_id', `(${author})`] : ['s.title', 's.submission_id', `(${author})`]
    const parts = names.map((x) => `lower(${x}) LIKE lower(?) ESCAPE '\\'`)
    args.push(...names.map(() => search))
    if (q.kind === 'works') {
      parts.push("EXISTS(SELECT 1 FROM works_tags t WHERE t._parent_id=w.id AND lower(t.value) LIKE lower(?) ESCAPE '\\')")
      args.push(search)
    }
    add(`(${parts.join(' OR ')})`)
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', args, alias: q.kind === 'works' ? 'w' : 's', author }
}

export async function consoleAuthors(payload: Payload, q: ConsoleQuery) {
  const f = filters(q, false)
  const rows = await consoleRows(
    payload,
    `SELECT (${f.author}) AS value,count(*) AS count FROM ${FROM[q.kind]} ${f.where} GROUP BY value ORDER BY count DESC,value`,
    f.args,
  )
  return rows.map((r) => ({ value: String(r.value || ''), count: Number(r.count) }))
}

export async function consoleCount(payload: Payload, q: ConsoleQuery) {
  const f = filters(q, true)
  const rows = await consoleRows(payload, `SELECT count(*) AS total FROM ${FROM[q.kind]} ${f.where}`, f.args)
  return Number(rows[0]?.total || 0)
}

export async function consoleCounts(payload: Payload, q: ConsoleQuery) {
  const f = filters(q, true, true)
  const expression = q.kind === 'works' ? workProcessingStateSQL('w') : submissionProcessingStateSQL()
  const rows = await consoleRows(
    payload,
    `SELECT (${expression}) AS processing_state,count(*) AS total FROM ${FROM[q.kind]} ${f.where} GROUP BY processing_state`,
    f.args,
  )
  const found: Record<string, number> = Object.fromEntries(rows.map((row) => [String(row.processing_state || 'unknown'), Number(row.total)]))
  const counts: Record<string, number> = {}
  let all = 0
  for (const state of PROCESSING_STATES) {
    counts[state] = Number(found[state] || 0)
    all += counts[state]
  }
  counts.all = all
  return counts
}

export async function consoleList(payload: Payload, q: ConsoleQuery) {
  const f = filters(q, true)
  const totalDocs = await consoleCount(payload, q)
  const totalPages = Math.max(1, Math.ceil(totalDocs / q.limit))
  const page = Math.min(q.page, totalPages)
  const snapshot = q.kind === 'works' ? await readAnalytics().catch(() => null) : null
  const metrics = JSON.stringify(snapshot?.works || {})
  const sortField = q.sort === 'downloads' ? 'downloads' : 'views'
  const rank =
    q.kind === 'works' && q.sort !== 'latest' && snapshot
      ? `coalesce((SELECT json_extract(j.value,'$.${sortField}') FROM json_each(?) j WHERE j.key=w.work_id),0) DESC,`
      : ''
  const args = [...f.args, ...(rank ? [metrics] : []), q.limit, (page - 1) * q.limit]
  const media = 'm.id AS mediaId,m.url AS mediaUrl,m.thumbnail_u_r_l AS thumbnailURL,m.sizes_thumbnail_url AS smallURL'
  const jobJSON = (alias: string) =>
    `CASE WHEN ${alias}.job_id IS NULL OR ${alias}.status NOT IN ('queued','running') THEN NULL ELSE json_object('jobId',${alias}.job_id,'operation',${alias}.operation,'status',${alias}.status,'cursor',${alias}.cursor,'total',${alias}.total) END`
  const submissionJobJSON = `CASE WHEN aj.job_id IS NOT NULL AND aj.status IN ('queued','running') THEN ${jobJSON('aj')} WHEN aw.job_id IS NOT NULL AND aw.status IN ('queued','running') THEN ${jobJSON('aw')} ELSE NULL END`
  const topicIds = `(SELECT json_group_array(t.topic_id) FROM topics_rels tr JOIN topics t ON t.id=tr.parent_id WHERE tr.works_id=w.id AND tr.path='works')`
  const projection =
    q.kind === 'works'
      ? `w.id,w.work_id AS workId,w.name,w.status,w.status AS sourceStatus,w.status AS targetStatus,w.channel,w.needs_publish AS needsPublish,w.last_publish_run_id AS lastPublishRun,w.last_published_at AS lastPublishedAt,w.format AS format,w.mime_type AS mimeType,w.is_animated AS isAnimated,(${workProcessingStateSQL('w')}) AS processingState,${WORK_PUBLICATION_SQL} AS publication,(${workLiveVersionSQL('w')}) AS liveVersion,${topicIds} AS topicIds,(${jobJSON('aw')}) AS activeJob,w.updated_at AS updatedAt,(${WORK_AUTHOR_SQL}) AS effectiveAuthor,c.id AS characterId,c.character_id AS characterKey,c.name AS characterName,${media},json_extract(w.review,'$.confidence') AS confidence,json_extract(w.review,'$.reason') AS reason,(SELECT json_group_array(json_object('id',cat.id,'categoryId',cat.category_id,'name',cat.name)) FROM works_rels r JOIN categories cat ON cat.id=r.categories_id WHERE r.parent_id=w.id AND r.path='categories') AS categories,(SELECT json_group_array(json_object('id',role.id,'characterId',role.character_id,'name',role.name)) FROM works_rels rr JOIN characters role ON role.id=rr.characters_id WHERE rr.parent_id=w.id AND rr.path='characters' ORDER BY rr."order") AS characters`
      : `s.id,s.submission_id AS submissionId,s.title,s.source,s.state,s.state AS sourceStatus,w.status AS targetStatus,(${submissionProcessingStateSQL()}) AS processingState,(${submissionActivitySQL()}) AS activity,${SUB_PUBLICATION_SQL} AS publication,(CASE WHEN s.work_id IS NOT NULL THEN (${workLiveVersionSQL('w')}) ELSE 0 END) AS liveVersion,${topicIds} AS topicIds,w.status AS workStatus,w.needs_publish AS workNeedsPublish,(${submissionJobJSON}) AS activeJob,json_extract(s.agent_progress,'$.stage') AS agentStage,json_extract(s.agent_progress,'$.lastError') AS agentError,s.updated_at AS updatedAt,(${SUB_AUTHOR_SQL}) AS effectiveAuthor,${SUB_CHARACTER_SQL} AS characterKey,${media},json_extract(s.review,'$.confidence') AS confidence,json_extract(s.review,'$.reason') AS reason,w.id AS workRecordId,w.work_id AS linkedKey,w.name AS workName`
  const rows = await consoleRows(
    payload,
    `SELECT ${projection} FROM ${FROM[q.kind]} ${f.where} ORDER BY ${rank}${f.alias}.${q.kind === 'works' ? 'updated_at' : 'created_at'} DESC,${f.alias}.id DESC LIMIT ? OFFSET ?`,
    args,
  )
  const parseJSON = (value: any) => {
    if (!value) return null
    if (typeof value === 'object') return value
    try {
      return JSON.parse(String(value))
    } catch {
      return null
    }
  }
  const docs = rows.map((r) => {
    const preview = r.mediaId ? { id: r.mediaId, url: r.mediaUrl, thumbnailURL: r.smallURL || r.thumbnailURL } : undefined
    const activeJob = parseJSON(r.activeJob)
    const shared = {
      id: r.id,
      updatedAt: r.updatedAt,
      effectiveAuthor: r.effectiveAuthor,
      review: { confidence: r.confidence, reason: r.reason },
    }
    return q.kind === 'works'
      ? {
          ...shared,
          workId: r.workId,
          name: r.name,
          status: r.status,
          channel: r.channel,
          format: r.format || null,
          mimeType: r.mimeType || null,
          isAnimated: Boolean(r.isAnimated),
          needsPublish: Boolean(r.needsPublish),
          processingState: r.processingState,
          sourceStatus: r.sourceStatus,
          targetStatus: r.targetStatus,
          topicIds: JSON.parse(r.topicIds || '[]'),
          publication: r.publication,
          liveVersion: Boolean(r.liveVersion),
          activeJob,
          lastPublishRun: r.lastPublishRun ?? null,
          lastPublishedAt: r.lastPublishedAt || null,
          preview,
          character: { id: r.characterId, characterId: r.characterKey, name: r.characterName },
          categories: JSON.parse(r.categories || '[]'),
          characters: JSON.parse(r.characters || '[]'),
          metrics: snapshot ? snapshot.works[r.workId] || { views: 0, downloads: 0 } : undefined,
        }
      : {
          ...shared,
          submissionId: r.submissionId,
          title: r.title,
          source: r.source,
          state: r.state,
          activity: r.activity,
          processingState: r.processingState,
          sourceStatus: r.sourceStatus,
          targetStatus: r.targetStatus || null,
          topicIds: JSON.parse(r.topicIds || '[]'),
          publication: r.publication,
          liveVersion: Boolean(r.liveVersion),
          workStatus: r.workStatus || null,
          workNeedsPublish: r.workNeedsPublish === null || r.workNeedsPublish === undefined ? null : Boolean(r.workNeedsPublish),
          activeJob,
          agentProgress: { stage: r.agentStage, lastError: r.agentError },
          media: preview,
          fields: { character: r.characterKey },
          work: r.workRecordId
            ? { id: r.workRecordId, workId: r.linkedKey, name: r.workName, status: r.workStatus }
            : undefined,
        }
  })
  return {
    docs,
    totalDocs,
    totalPages,
    page,
    limit: q.limit,
    hasNextPage: page < totalPages,
    metricsAvailable: Boolean(snapshot),
  }
}
