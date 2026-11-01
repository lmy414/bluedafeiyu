// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { migrations } from '@/migrations'

let root: string
let dbPath: string
let payload: any
const oldEnv = { ...process.env }

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dafeiyu-topic-migration-'))
  dbPath = path.join(root, 'admin.db')
  process.env.MEDIA_DIR = path.join(root, 'media')
  const sqlite = new DatabaseSync(dbPath)
  sqlite.exec('PRAGMA foreign_keys=ON')
  const db = {
    run: async (statement: any) => {
      const text = statement.queryChunks.map((chunk: any) => chunk.value?.join('') || '').join('')
      if (/^\s*SELECT\b/i.test(text)) return { rows: sqlite.prepare(text).all() }
      sqlite.exec(text)
      return { rows: [] }
    },
  }
  for (const migration of migrations.slice(0, -1)) await migration.up({ db } as any)
  sqlite.exec(`
    INSERT INTO characters (id, character_id, name) VALUES (1, 'deepseek', 'DeepSeek');
    INSERT INTO works (id, work_id, name, character_id) VALUES (1, 'legacy-work', 'Legacy work', 1);
    INSERT INTO topics (id, topic_id, name, summary, cover_id, author_name, author_bio)
      VALUES (1, 'legacy-topic', '已有专题', '原有简介', 1, '作者', '原有介绍');
    INSERT INTO topics_author_channels (_order, _parent_id, id, platform, url)
      VALUES (1, 1, 'legacy-channel', 'website', 'https://example.com');
    INSERT INTO topics_rels (id, "order", parent_id, path, works_id)
      VALUES (1, 1, 1, 'works', 1);
  `)
  // Payload executes each migration in a transaction, as this test does.
  sqlite.exec('BEGIN IMMEDIATE')
  await migrations.at(-1)!.up({ db } as any)
  sqlite.exec('COMMIT')
  sqlite.close()

  process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, '/')}`
  process.env.PAYLOAD_SECRET = 'isolated-topic-migration-test-secret'
  process.env.PAYLOAD_SCHEMA_PUSH = 'false'
  const { default: config } = await import('@/payload.config')
  payload = await getPayload({ config })
}, 30000)

afterAll(async () => {
  await payload?.destroy()
  await payload?.db?.client?.close()
  Object.assign(process.env, oldEnv)
  if (root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('dafeiyu-topic-migration-'))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}, 30000)

describe('existing production topic schema upgrade', () => {
  it('preserves topic content, cover, author channels and members', async () => {
    const topic = await payload.findByID({ collection: 'topics', id: 1, overrideAccess: true, depth: 1 })
    expect(topic).toMatchObject({ topicId: 'legacy-topic', summary: '原有简介', translationState: 'none', translationRevision: 0 })
    expect(topic.author).toMatchObject({ name: '作者', bio: '原有介绍' })
    expect(topic.author.channels[0].url).toBe('https://example.com')
    expect(topic.cover.workId).toBe('legacy-work')
    expect(topic.works[0].workId).toBe('legacy-work')
  })

  it('creates and edits drafts without a summary against the old NOT NULL column', async () => {
    const topic = await payload.create({
      collection: 'topics', data: { topicId: 'empty-summary', name: '新专题', status: 'draft' },
      overrideAccess: true, context: { audit: false },
    })
    const changed = await payload.update({
      collection: 'topics', id: topic.id, data: { summary: null },
      overrideAccess: true, context: { audit: false },
    })
    expect(changed.summary || '').toBe('')
    const sqlite = new DatabaseSync(dbPath, { readOnly: true })
    const saved = sqlite.prepare('SELECT summary FROM topics WHERE id = ?').get(topic.id)
    expect(saved?.summary).toBe('')
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    sqlite.close()
  })
})
