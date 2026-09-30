/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Endpoint, PayloadRequest } from 'payload'

import { authorOf, NO_AUTHOR } from '../components/admin/types'
import { json } from '../lib/endpoint-auth'

/** 后台作品查询的服务端作者筛选；前端列表仍可在已加载结果上即时组合其他筛选。 */
export const worksByAuthorHandler = async (req: PayloadRequest): Promise<Response> => {
  const role = (req.user as any)?.role
  if (role !== 'owner' && role !== 'bot') return json({ ok: false, error: 'unauthorized' }, 401)
  const url = new URL(req.url || 'http://localhost')
  const author = String(url.searchParams.get('author') || '').trim()
  const limitRaw = Number(url.searchParams.get('limit') || 5000)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 5000
  const where: Record<string, any> = {}
  const status = String(url.searchParams.get('status') || '').trim()
  const channel = String(url.searchParams.get('channel') || '').trim()
  if (status) where.status = { equals: status }
  if (channel) where.channel = { equals: channel }
  const result = await (req.payload as any).find({
    collection: 'works',
    depth: 2,
    limit: 5000,
    pagination: false,
    sort: '-updatedAt',
    where,
    overrideAccess: true,
  })
  const docs = author
    ? result.docs.filter((work: any) => author === NO_AUTHOR ? authorOf(work) === '' : authorOf(work) === author)
    : result.docs
  return json({ docs: docs.slice(0, limit), hasNextPage: docs.length > limit, totalDocs: docs.length, author: author || null })
}

export const WorksByAuthorEndpoint: Endpoint = {
  handler: worksByAuthorHandler,
  method: 'get',
  path: '/works/by-author',
}