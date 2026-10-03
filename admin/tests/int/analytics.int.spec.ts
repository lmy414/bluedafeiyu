import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { analyticsConfig, fetchWorkMetrics, publishedMetrics, readAnalytics, syncAnalytics } from '../../src/lib/analytics'
import { AnalyticsEndpoints } from '../../src/endpoints/analytics'

const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))) })

function report(rows: Array<[string, string, number]>, rowCount = rows.length) {
  return { dimensionHeaders: [{ name: 'customEvent:work_id' }, { name: 'eventName' }], metricHeaders: [{ name: 'eventCount' }], rowCount,
    rows: rows.map(([id, name, value]) => ({ dimensionValues: [{ value: id }, { value: name }], metricValues: [{ value: String(value) }] })) }
}
const response = (body: unknown, status = 200) => Response.json(body, { status })

describe('GA4 作品统计', () => {
  it('用作品 ID 聚合两类事件，跟踪无法归属的数量', async () => {
    const fetchImpl = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.dimensionFilter.andGroup.expressions[0].filter.inListFilter.values).toEqual(['work_view', 'work_download'])
      expect(body.dimensionFilter.andGroup.expressions[1].filter.stringFilter.value).toBe('15814452848')
      expect(body.dateRanges).toEqual([{ startDate: '2026-10-03', endDate: 'today' }])
      return response(report([['sticker_a', 'work_view', 20], ['sticker_a', 'work_download', 3], ['(not set)', 'work_view', 2]]))
    }) as typeof fetch
    const data = await fetchWorkMetrics({ propertyId: '553936531', startDate: '2026-10-03', token: 'fake', fetchImpl })
    expect(data.works.sticker_a).toEqual({ views: 20, downloads: 3 })
    expect(data.unassigned).toBe(2)
  })

  it('处理分页、空报表和 GA4 汇总限制', async () => {
    let calls = 0
    const data = await fetchWorkMetrics({ propertyId: '1', startDate: '2026-10-03', token: 'fake', fetchImpl: (async (_url: unknown, init: RequestInit) => {
      expect(JSON.parse(init.body as string).offset).toBe(String(calls))
      return response({ ...report([[calls++ ? 'b' : 'a', 'work_view', 1]], 2), metadata: { dataLossFromOtherRow: true } })
    }) as typeof fetch })
    expect(Object.keys(data.works)).toEqual(['a', 'b']); expect(data.limited).toBe(true)
    const empty = await fetchWorkMetrics({ propertyId: '1', startDate: '2026-10-03', token: 'fake', fetchImpl: (async () => response(report([]))) as typeof fetch })
    expect(empty.works).toEqual({})
  })

  it('拒绝不完整分页和非法计数，不接受污染键', async () => {
    const base = { propertyId: '1', startDate: '2026-10-03', token: 'fake' }
    await expect(fetchWorkMetrics({ ...base, fetchImpl: (async () => response(report([], 2))) as typeof fetch })).rejects.toThrow('分页结果不完整')
    await expect(fetchWorkMetrics({ ...base, fetchImpl: (async () => response(report([['a', 'work_view', -1]]))) as typeof fetch })).rejects.toThrow('无效的事件数量')
    const data = await fetchWorkMetrics({ ...base, fetchImpl: (async () => response(report([['__proto__', 'work_view', 8]]))) as typeof fetch })
    expect(data.unassigned).toBe(8); expect(Object.keys(data.works)).toEqual([])
  })

  it('校验数字媒体资源 ID、有效日期和配置缺失', async () => {
    expect(() => analyticsConfig({ GA4_PROPERTY_ID: 'G-ABC' })).toThrow('数字')
    expect(() => analyticsConfig({ GA4_START_DATE: '2026-02-30' })).toThrow('日期')
    expect(analyticsConfig({}).configured).toBe(false)
    await expect(syncAnalytics({})).rejects.toThrow('尚未配置')
  })

  it('同步重复执行不累计，授权失败保留缓存，不泄漏原始错误', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ga4-stats-')); folders.push(dir)
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const credentialsFile = path.join(dir, 'service-account.json')
    await fs.writeFile(credentialsFile, JSON.stringify({ type: 'service_account', client_email: 'test@example.test', private_key: privateKey.export({ format: 'pem', type: 'pkcs8' }) }))
    const env = { GA4_PROPERTY_ID: '1', GOOGLE_APPLICATION_CREDENTIALS: credentialsFile, GA4_CACHE_FILE: path.join(dir, 'cache.json') }
    const fetchImpl = (async (url: unknown) => String(url).includes('oauth2.') ? response({ access_token: 'fake' }) : response(report([['a', 'work_view', 7]]))) as typeof fetch
    await syncAnalytics(env, fetchImpl); await syncAnalytics(env, fetchImpl)
    expect((await readAnalytics(env))?.works.a.views).toBe(7)
    const before = await fs.readFile(env.GA4_CACHE_FILE, 'utf8')
    await expect(syncAnalytics(env, (async () => response({ error: 'secret-private-data' }, 403)) as typeof fetch)).rejects.toThrow('HTTP 403')
    expect(await fs.readFile(env.GA4_CACHE_FILE, 'utf8')).toBe(before)
    expect(await readAnalytics({ ...env, GA4_PROPERTY_ID: '2' })).toBeNull()
  })

  it('公开数据过滤下架作品，不把未同步显示成零', () => {
    const empty = publishedMetrics(null, ['a'])
    expect(empty.available).toBe(false); expect(empty.works).toEqual({})
    const data = publishedMetrics({ version: 1, propertyId: '1', streamId: '15814452848', startDate: '2026-10-03', syncedAt: new Date().toISOString(), limited: false, unassigned: 0, works: { a: { views: 10, downloads: 4 }, removed: { views: 999, downloads: 100 } } }, ['a', 'b'])
    expect(data.works.removed).toBeUndefined(); expect(data.works.b).toEqual({ views: 0, downloads: 0 })
    expect(data.totals).toEqual({ views: 10, downloads: 4 })
  })

  it('未登录不能查看后台或同步；公开接口不能触发同步', async () => {
    const read = AnalyticsEndpoints.find(item => item.path === '/analytics')!
    const sync = AnalyticsEndpoints.find(item => item.path === '/analytics/sync')!
    const request = { headers: new Headers(), user: null } as Parameters<typeof read.handler>[0]
    expect((await read.handler(request)).status).toBe(401)
    expect([401, 503]).toContain((await sync.handler(request)).status)
    expect(AnalyticsEndpoints.filter(item => item.path === '/analytics/public').map(item => item.method)).toEqual(['get'])
  })
})
