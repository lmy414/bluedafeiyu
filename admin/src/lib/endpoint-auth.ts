import crypto from 'node:crypto'

import type { PayloadRequest } from 'payload'

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function requireWorker(req: PayloadRequest): null | Response {
  const expected = process.env.ADMIN_WORKER_TOKEN || ''
  if (!expected) return json({ ok: false, error: 'worker token not configured' }, 503)
  const header = req.headers.get('authorization') || ''
  const prefix = 'Bearer '
  if (!header.startsWith(prefix) || !safeEqual(header.slice(prefix.length), expected)) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  return null
}

export function requireOwnerOrBot(req: PayloadRequest): null | Response {
  const role = (req.user as { role?: string } | null)?.role
  if (role === 'owner' || role === 'bot') return null
  return json({ ok: false, error: 'unauthorized' }, 401)
}

export async function readJsonBody<T = Record<string, unknown>>(req: PayloadRequest): Promise<T> {
  return (typeof req.json === 'function' ? await req.json() : {}) as T
}
