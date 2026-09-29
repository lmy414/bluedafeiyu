import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../src/payload.config'
import { syncSubmissions } from '../src/lib/sync-submissions'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find((arg) => arg.startsWith('--limit='))
const sourceArg = args.find((arg) => arg.startsWith('--source='))
const stateArg = args.find((arg) => arg.startsWith('--state='))
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined

const payload = await getPayload({ config })
const stats = await syncSubmissions(payload, {
  dryRun,
  limit,
  source: sourceArg ? sourceArg.slice('--source='.length) : undefined,
  state: stateArg ? stateArg.slice('--state='.length) : undefined,
})
console.log(JSON.stringify(stats, null, 2))
process.exit(stats.errors.length > 0 ? 1 : 0)
