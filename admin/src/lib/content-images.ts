/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs/promises'
import path from 'node:path'

export async function readMedia(payload: any, media: unknown): Promise<Buffer | null> {
  const id = media && typeof media === 'object' ? (media as any).id : media
  if (id === null || id === undefined || id === '') return null
  const doc =
    typeof media === 'object' && (media as any).filename
      ? media
      : await payload.findByID({ collection: 'media', id, depth: 0, overrideAccess: true }).catch(() => null)
  const filename = String(doc?.filename || '')
  if (!filename || filename.includes('/') || filename.includes('\\')) return null
  return fs
    .readFile(path.join(path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), 'media')), filename))
    .catch(() => null)
}

export async function readOriginal(url: unknown): Promise<Buffer | null> {
  const max = 30 * 1024 * 1024
  try {
    const parsed = new URL(String(url || ''))
    // 服务端不请求任意外部地址，防止原图链接变成 SSRF。
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null
    if (!['raw.githubusercontent.com', 'github.com'].includes(parsed.hostname)) return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    const target =
      parsed.hostname === 'github.com' && parts[2] === 'blob'
        ? `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join('/')}`
        : parsed.href
    const response = await fetch(target, { signal: AbortSignal.timeout(30_000), redirect: 'error' })
    if (
      !response.ok ||
      !response.headers.get('content-type')?.startsWith('image/') ||
      Number(response.headers.get('content-length')) > max
    )
      return null
    if (!response.body) return null
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > max) {
          await reader.cancel()
          return null
        }
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks)
  } catch {
    return null
  }
}
