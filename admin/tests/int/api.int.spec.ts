import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
let root = ''

describe('API', () => {
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'bluedafeiyu-api-'))
    process.env.DATABASE_URL = `file:${path.join(root, 'api.db').replace(/\\/g, '/')}`
    process.env.PAYLOAD_SECRET = 'api-test-secret'
    process.env.PAYLOAD_SCHEMA_PUSH = 'true'
    process.env.MEDIA_DIR = path.join(root, 'media')
    process.env.ADMIN_PUBLISH_REQUEST_DIR = path.join(root, 'run')
    // The config reads DATABASE_URL at module load, so import it only after the
    // isolated test database env is set; a static import would touch admin.db.
    const { default: config } = await import('@/payload.config')
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    await payload?.destroy()
    const client = (payload as any)?.db?.client
    if (client && typeof client.close === 'function') client.close()
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('fetches users', async () => {
    const users = await payload.find({
      collection: 'users',
    })
    expect(users).toBeDefined()
  })
})
