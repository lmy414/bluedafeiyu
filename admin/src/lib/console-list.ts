/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payload } from 'payload'
import { readAnalytics } from './analytics'

export type ConsoleQuery = {
  kind: 'works' | 'submissions'
  mode: string
  channel: string
  status: string
  character: string
  category: string
  author: string
  keyword: string
  sort: string
  page: number
  limit: number
}

export function parseConsoleQuery(url: URL): ConsoleQuery {
  const p = url.searchParams
  const positive = (key: string, fallback: number, max: number) => {
    const n = Number(p.get(key))
    return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback
  }
  return {
    kind: p.get('kind') === 'submissions' ? 'submissions' : 'works',
    mode: p.get('mode') || '',
    channel: p.get('channel') || '',
    status: p.get('status') || '',
    character: p.get('character') || '',
    category: p.get('category') || '',
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
const WORK_AUTHOR = authorSQL('w')
const SUB_AUTHOR = `CASE WHEN s.work_id IS NOT NULL THEN ${WORK_AUTHOR} ELSE CASE WHEN ${clean("json_extract(s.origin,'$.author')")}<>'' AND lower(${clean("json_extract(s.origin,'$.author')")}) NOT IN ('本人','自己','我','原创','self') THEN ${clean("json_extract(s.origin,'$.author')")} ELSE coalesce(nullif(${clean("json_extract(s.origin,'$.submitter')")},''),${clean("json_extract(s.fields,'$.submitter')")}) END END`
const FROM = {
  works: 'works w LEFT JOIN media m ON m.id=w.preview_id LEFT JOIN characters c ON c.id=w.character_id',
  submissions: 'submissions s LEFT JOIN works w ON w.id=s.work_id LEFT JOIN media m ON m.id=s.media_id',
}

export async function consoleRows(payload: Payload, statement: string, args: any[] = []) {
  const client = (payload.db as any).client
  if (!client?.execute) throw new Error('后台列表需要 SQLite 查询接口')
  return (await client.execute({ sql: statement, args })).rows as any[]
}

function filters(q: ConsoleQuery, includeAuthor: boolean) {
  const clauses: string[] = []
  const args: any[] = []
  const add = (clause: string, value?: any) => {
    clauses.push(clause)
    if (value !== undefined) args.push(value)
  }
  const alias = q.kind === 'works' ? 'w' : 's'
  if (q.kind === 'works') {
    if (q.status || ['pending', 'published'].includes(q.mode)) add('w.status=?', q.status || q.mode)
    if (q.channel && q.channel !== 'all') add('w.channel=?', q.channel)
    if (q.character) add('w.character_id=?', q.character)
    if (q.category)
      add("EXISTS(SELECT 1 FROM works_rels r WHERE r.parent_id=w.id AND r.path='categories' AND r.categories_id=?)", q.category)
  } else {
    add(q.mode === 'processing' ? "s.state IN ('received','reviewing')" : "s.state IN ('auto_rejected','needs_manual')")
    add(q.mode === 'reviewed' ? 's.work_id IS NOT NULL' : 's.work_id IS NULL')
    if (q.channel && q.channel !== 'all') add('s.source=?', q.channel)
  }
  const author = q.kind === 'works' ? WORK_AUTHOR : SUB_AUTHOR
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
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', args, alias, author }
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

export async function consoleList(payload: Payload, q: ConsoleQuery) {
  const f = filters(q, true)
  const count = await consoleRows(payload, `SELECT count(*) AS total FROM ${FROM[q.kind]} ${f.where}`, f.args)
  const totalDocs = Number(count[0].total)
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
  const projection =
    q.kind === 'works'
      ? `w.id,w.work_id AS workId,w.name,w.status,w.channel,w.updated_at AS updatedAt,(${WORK_AUTHOR}) AS effectiveAuthor,c.id AS characterId,c.character_id AS characterKey,c.name AS characterName,${media},json_extract(w.review,'$.confidence') AS confidence,json_extract(w.review,'$.reason') AS reason,(SELECT json_group_array(json_object('id',cat.id,'categoryId',cat.category_id,'name',cat.name)) FROM works_rels r JOIN categories cat ON cat.id=r.categories_id WHERE r.parent_id=w.id AND r.path='categories') AS categories`
      : `s.id,s.submission_id AS submissionId,s.title,s.source,s.state,json_extract(s.agent_progress,'$.stage') AS agentStage,json_extract(s.agent_progress,'$.lastError') AS agentError,s.updated_at AS updatedAt,(${SUB_AUTHOR}) AS effectiveAuthor,coalesce(json_extract(s.editorial,'$.characterId'),json_extract(s.fields,'$.characterId'),json_extract(s.fields,'$.character')) AS characterKey,${media},json_extract(s.review,'$.confidence') AS confidence,json_extract(s.review,'$.reason') AS reason,w.id AS workId,w.work_id AS linkedKey,w.name AS workName,w.status AS workStatus`
  const rows = await consoleRows(
    payload,
    `SELECT ${projection} FROM ${FROM[q.kind]} ${f.where} ORDER BY ${rank}${f.alias}.${q.kind === 'works' ? 'updated_at' : 'created_at'} DESC,${f.alias}.id DESC LIMIT ? OFFSET ?`,
    args,
  )
  const docs = rows.map((r) => {
    const preview = r.mediaId ? { id: r.mediaId, url: r.mediaUrl, thumbnailURL: r.smallURL || r.thumbnailURL } : undefined
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
          preview,
          character: { id: r.characterId, characterId: r.characterKey, name: r.characterName },
          categories: JSON.parse(r.categories || '[]'),
          metrics: snapshot ? snapshot.works[r.workId] || { views: 0, downloads: 0 } : undefined,
        }
      : {
          ...shared,
          submissionId: r.submissionId,
          title: r.title,
          source: r.source,
          state: r.state,
          agentProgress: { stage: r.agentStage, lastError: r.agentError },
          media: preview,
          fields: { character: r.characterKey },
          work: r.workId ? { id: r.workId, workId: r.linkedKey, name: r.workName, status: r.workStatus } : undefined,
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
