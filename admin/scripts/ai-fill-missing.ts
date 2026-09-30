import 'dotenv/config'

type MissingItem = { kind?: string; missing: string[]; status?: string; workId: string }
type Json = Record<string, any>

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const value = (name: string): string | undefined => {
  const item = args.find((arg) => arg.startsWith(`${name}=`))
  return item ? item.slice(name.length + 1) : undefined
}

const baseUrl = String(process.env.AI_FILL_API_URL || process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '')
const token = String(process.env.ADMIN_WORKER_TOKEN || '').trim()
const dryRun = flag('--dry-run')
const limit = Number(value('--limit') || 5000)
const kind = value('--kind')
const status = value('--status')
if (!token) throw new Error('缺少 ADMIN_WORKER_TOKEN；批量补全必须通过后台执行器令牌')

async function request(path: string, init: RequestInit = {}): Promise<Json> {
  const response = await fetch(`${baseUrl}/cms-api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
  })
  const body = await response.json().catch(() => ({})) as Json
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}：${body.error || body.message || '请求失败'}`)
  return body
}

const missing = await request('/ai-fill/missing')
let items = (Array.isArray(missing.items) ? missing.items : []) as MissingItem[]
if (kind) items = items.filter((item) => item.kind === kind)
if (status) items = items.filter((item) => item.status === status)
items = items.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 5000)

console.log(JSON.stringify({ baseUrl, dryRun, totalMissing: missing.total, selected: items.length }, null, 2))
let applied = 0
let skipped = 0
let failed = 0
for (const [index, item] of items.entries()) {
  try {
    if (dryRun) {
      console.log(`[${index + 1}/${items.length}] ${item.workId}：${item.missing.join(',')}`)
      skipped += 1
      continue
    }
    const result = await request('/ai-fill', {
      method: 'POST',
      body: JSON.stringify({ apply: true, fields: item.missing, workId: item.workId }),
    })
    if (result.applied) applied += 1
    else skipped += 1
    console.log(`[${index + 1}/${items.length}] ${item.workId}：${result.applied ? '已写入' : '未写入'}${result.errors?.length ? `；${result.errors.join('、')}` : ''}`)
  } catch (error) {
    failed += 1
    console.error(`[${index + 1}/${items.length}] ${item.workId}：${error instanceof Error ? error.message : String(error)}`)
  }
}
console.log(JSON.stringify({ applied, skipped, failed }, null, 2))
if (failed) process.exitCode = 1