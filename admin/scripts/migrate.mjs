import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig, getPayload } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'

process.env.NODE_ENV = process.env.NODE_ENV || 'production'
process.env.PAYLOAD_MIGRATING = 'true'

const releaseRoot = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(process.env.ADMIN_MIGRATION_DIR || path.join(releaseRoot, 'migrations'))
const databaseURL = process.env.DATABASE_URL
const secret = process.env.PAYLOAD_SECRET

if (!databaseURL) {
  throw new Error('DATABASE_URL is required to run admin migrations')
}
if (!secret) {
  throw new Error('PAYLOAD_SECRET is required to run admin migrations')
}

const config = await buildConfig({
  secret,
  db: sqliteAdapter({
    client: {
      url: databaseURL,
    },
    migrationDir,
    push: false,
  }),
  collections: [],
})

const payload = await getPayload({ config, disableOnInit: true })

try {
  await payload.db.migrate()
  console.log(`[admin-migrate] migrations complete: ${migrationDir}`)
} finally {
  await payload.destroy()
}
