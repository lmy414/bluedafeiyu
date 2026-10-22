import crypto from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'
import { json, readJsonBody, requireOwnerOrBot, requireWorker } from '../lib/endpoint-auth'
import { registerCreator, videoAgent, syncVideoCreators } from '../lib/video-library.mjs'

async function register(req: PayloadRequest) {
  const header = req.headers.get('authorization') || ''
  const expected = process.env.SUBMISSION_ADMIN_TOKEN ? 'Bearer ' + process.env.SUBMISSION_ADMIN_TOKEN : ''
  if (!expected || header.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))) return json({ error: 'unauthorized' }, 401)
  try { return json(await registerCreator(req.payload, await readJsonBody(req), req), 202) }
  catch (error: any) { return json({ error: error.message }, error.status || 400) }
}
async function agent(req: PayloadRequest) {
  const denied = requireWorker(req)
  if (denied) return denied
  try {
    const result = await videoAgent(req.payload, await readJsonBody(req), req)
    if (result.bytes) return new Response(new Uint8Array(result.bytes), { headers: { 'Content-Type': result.mime, 'Cache-Control': 'no-store' } })
    return json(result)
  } catch (error: any) { return json({ error: error.message }, error.status || 502) }
}
async function sync(req: PayloadRequest) {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  return json({ ok: true, stats: await syncVideoCreators(req.payload, req) })
}
export const VideoEndpoints: Endpoint[] = [
  { path: '/video-registrations', method: 'post', handler: register },
  { path: '/video-agent', method: 'post', handler: agent },
  { path: '/videos/sync', method: 'post', handler: sync },
]
