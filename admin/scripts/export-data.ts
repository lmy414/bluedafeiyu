import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPayload } from 'payload'

import config from '../src/payload.config'
import { SITE_DATA_FILES, compareSiteDataTexts, exportSiteData, writeSiteDataTexts } from '../src/lib/export-site-data'
import { buildPublishSnapshot } from '../src/lib/publish'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SITE_DIR = path.resolve(HERE, '..', '..')
const args = process.argv.slice(2)
const check = args.includes('--check')
const againstHead = args.includes('--against-head')
const snapshot = args.includes('--snapshot')
const outEquals = args.find((arg) => arg.startsWith('--out='))
const outIndex = args.indexOf('--out')
const outValue = outEquals ? outEquals.slice('--out='.length) : outIndex >= 0 ? args[outIndex + 1] : undefined
const outDir = path.resolve(outValue || SITE_DIR)

const payload = await getPayload({ config })
const texts = snapshot ? (await buildPublishSnapshot(payload, { runId: 'roundtrip' })).files : await exportSiteData(payload)

if (againstHead) {
  const mismatches: string[] = []
  for (const relativePath of SITE_DATA_FILES) {
    const current = execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: outDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (current !== texts[relativePath]) mismatches.push(relativePath)
  }
  console.log(JSON.stringify({ target: 'HEAD', mismatched: mismatches, matched: SITE_DATA_FILES.filter((file) => !mismatches.includes(file)) }, null, 2))
  process.exit(mismatches.length > 0 ? 1 : 0)
}

if (check) {
  const result = compareSiteDataTexts(outDir, texts)
  console.log(JSON.stringify({ target: outDir, ...result }, null, 2))
  process.exit(result.mismatched.length > 0 ? 1 : 0)
}

fs.mkdirSync(outDir, { recursive: true })
const result = writeSiteDataTexts(outDir, texts)
console.log(JSON.stringify({ target: outDir, ...result }, null, 2))
process.exit(0)
