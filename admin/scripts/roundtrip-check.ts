import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = path.resolve(HERE, '..')
const SITE_DIR = path.resolve(ADMIN_DIR, '..')
const TMP_ROOT = path.resolve(SITE_DIR, '..', 'tmp')
const keep = process.argv.includes('--keep') || process.env.ROUNDTRIP_KEEP === '1'
const workDir = path.join(TMP_ROOT, `bluedafeiyu-roundtrip-${Date.now()}`)
const dbPath = path.join(workDir, 'admin.db')
const mediaDir = path.join(workDir, 'media')
fs.mkdirSync(mediaDir, { recursive: true })

if (!workDir.startsWith(TMP_ROOT + path.sep)) throw new Error('临时目录越界')
const env = {
  ...process.env,
  DATABASE_URL: `file:${dbPath.replace(/\\/g, '/')}`,
  MEDIA_DIR: mediaDir,
}
const tsxCli = path.join(ADMIN_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs')
let passed = false
try {
  console.log(`[roundtrip] 临时库：${dbPath}`)
  execFileSync(process.execPath, [tsxCli, 'scripts/import-legacy.ts'], { cwd: ADMIN_DIR, env, stdio: 'inherit' })
  execFileSync(process.execPath, [tsxCli, 'scripts/export-data.ts', '--against-head', '--out', SITE_DIR], { cwd: ADMIN_DIR, env, stdio: 'inherit' })
  execFileSync(process.execPath, [tsxCli, 'scripts/export-data.ts', '--snapshot', '--against-head', '--out', SITE_DIR], { cwd: ADMIN_DIR, env, stdio: 'inherit' })
  passed = true
  console.log('[roundtrip] 六个文件与 git HEAD 逐字节一致')
} finally {
  if (passed && !keep && workDir.startsWith(TMP_ROOT + path.sep)) {
    fs.rmSync(workDir, { recursive: true, force: true })
  } else {
    console.log(`[roundtrip] 保留临时目录：${workDir}`)
  }
}
