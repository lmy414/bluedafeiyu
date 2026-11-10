// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PayloadRequest } from 'payload'
import { expect, it, vi } from 'vitest'

vi.mock('@/lib/publish', () => ({ buildPublishPlan: async () => ({ summary: {} }), applyPublishStatus: vi.fn(), buildPublishSnapshot: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/rights-requests', () => ({ queueRightsReplies: vi.fn() }))
import { PublishEndpoints } from '@/endpoints/publish'

it('concurrent requests cannot replace the accepted publish request', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-admission-'))
  const old = process.env.ADMIN_PUBLISH_REQUEST_DIR
  process.env.ADMIN_PUBLISH_REQUEST_DIR = dir
  const create = vi.fn(async ({ data }: { data: { runId: string } }) => ({ ...data, id: data.runId }))
  const update = vi.fn(async (_args: Record<string, unknown>) => ({}))
  const req = { user: { role: 'owner', id: 1 }, payload: {
    find: async () => ({ docs: [] }), create, update,
  } } as unknown as PayloadRequest
  try {
    const handler = PublishEndpoints.find(endpoint => endpoint.path === '/publish/request')!.handler
    const replies = await Promise.all([handler(req), handler(req)])
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409])
    const accepted = await replies.find(reply => reply.status === 200)!.json()
    const request = JSON.parse(await fs.readFile(path.join(dir, 'publish.request'), 'utf8'))
    expect(request.runId).toBe(accepted.runId)
    expect(create).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toMatchObject({ data: { status: 'failed' } })
    expect(update.mock.calls[0][0]).not.toMatchObject({ id: accepted.runId })
  } finally {
    if (old === undefined) delete process.env.ADMIN_PUBLISH_REQUEST_DIR
    else process.env.ADMIN_PUBLISH_REQUEST_DIR = old
    await fs.rm(dir, { recursive: true, force: true })
  }
})
