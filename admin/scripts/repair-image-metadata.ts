import 'dotenv/config'

import path from 'node:path'

import { getPayload } from 'payload'

import config from '../src/payload.config'
import { repairWorkImageMetadata } from '../src/lib/image-metadata-repair'

const args = process.argv.slice(2)
const write = args.includes('--write')
const limitArg = args.find((arg) => arg.startsWith('--limit='))
const contentArg = args.find((arg) => arg.startsWith('--content-dir='))
const workIds = args.filter((arg) => arg.startsWith('--work=')).map((arg) => arg.slice('--work='.length))
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined
const configuredContentDir = contentArg
  ? contentArg.slice('--content-dir='.length)
  : process.env.CONTENT_REPO_DIR || process.env.PUBLISH_CONTENT_DIR || process.env.CONTENT_DIR
if (!configuredContentDir) {
  console.error('必须显式指定内容仓：--content-dir=<绝对路径>，或配置 CONTENT_REPO_DIR / PUBLISH_CONTENT_DIR / CONTENT_DIR')
  process.exit(2)
}
const contentDir = path.resolve(configuredContentDir)

const payload = await getPayload({ config })
const report = await repairWorkImageMetadata(payload, { contentDir, limit, workIds, write })
console.log(JSON.stringify(report, null, 2))
process.exit(report.errors.length > 0 ? 1 : 0)
