import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type WorkMetrics = { views: number; downloads: number }
export type AnalyticsSnapshot = {
  version: 1
  propertyId: string
  streamId: string
  startDate: string
  syncedAt: string
  works: Record<string, WorkMetrics>
  limited: boolean
  unassigned: number
}

type Env = Record<string, string | undefined>
type Report = {
  rowCount?: number
  dimensionHeaders?: { name: string }[]
  metricHeaders?: { name: string }[]
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]
  metadata?: { dataLossFromOtherRow?: boolean; subjectToThresholding?: boolean; samplingMetadatas?: unknown[] }
}

export function analyticsConfig(env: Env = process.env) {
  const propertyId = env.GA4_PROPERTY_ID || ''
  const credentialsFile = env.GOOGLE_APPLICATION_CREDENTIALS || ''
  const streamId = env.GA4_STREAM_ID || '15814452848'
  const startDate = env.GA4_START_DATE || '2026-10-03'
  if (propertyId && !/^\d+$/.test(propertyId)) throw new Error('GA4_PROPERTY_ID 必须是数字媒体资源 ID')
  if (!/^\d+$/.test(streamId)) throw new Error('GA4_STREAM_ID 必须是数字数据流 ID')
  const date = new Date(`${startDate}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== startDate) {
    throw new Error('GA4_START_DATE 必须是有效的 YYYY-MM-DD 日期')
  }
  return {
    propertyId, streamId, credentialsFile, startDate,
    configured: Boolean(propertyId && credentialsFile),
    cacheFile: path.resolve(env.GA4_CACHE_FILE || path.join(env.ADMIN_PUBLISH_REQUEST_DIR || 'run', 'analytics.json')),
  }
}

export async function readAnalytics(env: Env = process.env): Promise<AnalyticsSnapshot | null> {
  const cfg = analyticsConfig(env)
  try {
    const data = JSON.parse(await fs.readFile(cfg.cacheFile, 'utf8')) as AnalyticsSnapshot
    if (data.version !== 1 || data.propertyId !== cfg.propertyId || data.streamId !== cfg.streamId || data.startDate !== cfg.startDate || !data.syncedAt || !data.works) return null
    return data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('GA4 统计缓存读取失败，请重新同步')
  }
}

async function requestJSON(url: string, init: RequestInit, fetchImpl: typeof fetch) {
  let response: Response
  try { response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) }) }
  catch { throw new Error('GA4 请求超时或网络不可达') }
  if (!response.ok) {
    // Google 的原始错误可能包含配置和令牌；只给后台返回固定说明。
    throw new Error(`GA4 请求失败（HTTP ${response.status}），请检查 API、查看者权限及 work_id 自定义维度`)
  }
  return response.json()
}

export async function accessToken(credentialsFile: string, fetchImpl: typeof fetch): Promise<string> {
  let credentials: { type?: string; client_email?: string; private_key?: string }
  try { credentials = JSON.parse(await fs.readFile(credentialsFile, 'utf8')) }
  catch { throw new Error('GA4 服务账号文件无法读取') }
  if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) {
    throw new Error('GA4 需要有效的服务账号 JSON 文件')
  }
  const endpoint = 'https://oauth2.googleapis.com/token'
  const issued = Math.floor(Date.now() / 1000)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: endpoint, iat: issued, exp: issued + 3600,
  })}`
  let signature: string
  try { signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url') }
  catch { throw new Error('GA4 服务账号私钥格式无效') }
  const result = await requestJSON(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  }, fetchImpl)
  if (typeof result.access_token !== 'string') throw new Error('GA4 授权没有返回访问令牌')
  return result.access_token
}

export async function fetchWorkMetrics({ propertyId, streamId = '15814452848', startDate, token, fetchImpl = fetch }: {
  propertyId: string; streamId?: string; startDate: string; token: string; fetchImpl?: typeof fetch
}): Promise<Pick<AnalyticsSnapshot, 'works' | 'limited' | 'unassigned'>> {
  const works: Record<string, WorkMetrics> = Object.create(null)
  let offset = 0, limited = false, unassigned = 0
  for (;;) {
    const report = await requestJSON(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'customEvent:work_id' }, { name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: { andGroup: { expressions: [
          { filter: { fieldName: 'eventName', inListFilter: { values: ['work_view', 'work_download'] } } },
          { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: streamId } } },
        ] } },
        orderBys: [{ dimension: { dimensionName: 'customEvent:work_id' } }, { dimension: { dimensionName: 'eventName' } }],
        limit: '10000', offset: String(offset),
      }),
    }, fetchImpl) as Report
    if (report.dimensionHeaders?.map(x => x.name).join(',') !== 'customEvent:work_id,eventName' || report.metricHeaders?.[0]?.name !== 'eventCount') {
      throw new Error('GA4 返回的统计字段不匹配')
    }
    limited ||= Boolean(report.metadata?.dataLossFromOtherRow || report.metadata?.subjectToThresholding || report.metadata?.samplingMetadatas?.length)
    const rows = report.rows || []
    for (const row of rows) {
      const id = row.dimensionValues?.[0]?.value, event = row.dimensionValues?.[1]?.value
      const rawCount = row.metricValues?.[0]?.value
      const count = Number(rawCount)
      if (!/^\d+$/.test(rawCount || '') || !Number.isSafeInteger(count) || count < 0) throw new Error('GA4 返回无效的事件数量')
      if (event !== 'work_view' && event !== 'work_download') throw new Error('GA4 返回非作品统计事件')
      if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || id === '__proto__' || id === 'constructor') { unassigned += count; continue }
      const metrics = works[id] ||= { views: 0, downloads: 0 }
      metrics[event === 'work_view' ? 'views' : 'downloads'] += count
    }
    offset += rows.length
    if (offset >= (report.rowCount || 0)) break
    if (!rows.length || offset > 1_000_000) throw new Error('GA4 分页结果不完整，保留上次统计')
  }
  return { works, limited, unassigned }
}

const inFlight = new Map<string, Promise<AnalyticsSnapshot>>()

/** 覆盖整个统计区间，重复同步不会累计；失败不会覆盖已有缓存。 */
export async function syncAnalytics(env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<AnalyticsSnapshot> {
  const cfg = analyticsConfig(env)
  if (!cfg.configured) throw new Error('GA4 尚未配置媒体资源 ID 和服务账号文件')
  const active = inFlight.get(cfg.cacheFile)
  if (active) return active
  const pending = (async () => {
    const token = await accessToken(cfg.credentialsFile, fetchImpl)
    const metrics = await fetchWorkMetrics({ propertyId: cfg.propertyId, streamId: cfg.streamId, startDate: cfg.startDate, token, fetchImpl })
    const snapshot: AnalyticsSnapshot = { version: 1, propertyId: cfg.propertyId, streamId: cfg.streamId, startDate: cfg.startDate, syncedAt: new Date().toISOString(), ...metrics }
    await fs.mkdir(path.dirname(cfg.cacheFile), { recursive: true })
    const temporary = `${cfg.cacheFile}.${crypto.randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 })
      await fs.rename(temporary, cfg.cacheFile)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
    return snapshot
  })()
  inFlight.set(cfg.cacheFile, pending)
  try { return await pending } finally { inFlight.delete(cfg.cacheFile) }
}

export function publishedMetrics(snapshot: AnalyticsSnapshot | null, ids: string[]) {
  const works: Record<string, WorkMetrics> = Object.create(null)
  if (snapshot) for (const id of ids) works[id] = snapshot.works[id] || { views: 0, downloads: 0 }
  return {
    available: Boolean(snapshot), startDate: snapshot?.startDate || null, syncedAt: snapshot?.syncedAt || null,
    stale: snapshot ? Date.now() - Date.parse(snapshot.syncedAt) > 24 * 3600_000 : false,
    limited: Boolean(snapshot?.limited || snapshot?.unassigned), works,
    totals: Object.values(works).reduce((sum, item) => ({ views: sum.views + item.views, downloads: sum.downloads + item.downloads }), { views: 0, downloads: 0 }),
  }
}
