import type { Endpoint, PayloadRequest } from 'payload'
import { json, requireOwnerOrBot } from '../lib/endpoint-auth'
import { consoleAuthors, consoleCounts, consoleCount, consoleList, parseConsoleQuery } from '../lib/console-list'

async function handle(req: PayloadRequest, view: 'list' | 'authors' | 'counts') {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  const query = parseConsoleQuery(new URL(req.url || 'http://localhost'))
  if (view === 'authors') return json({ authors: await consoleAuthors(req.payload, query) })
  if (view === 'counts')
    return json({ kind: query.kind, counts: await consoleCounts(req.payload, query), totalDocs: await consoleCount(req.payload, query) })
  return json(await consoleList(req.payload, query))
}

export const ConsoleEndpoints: Endpoint[] = [
  { path: '/console/list', method: 'get', handler: (req) => handle(req, 'list') },
  { path: '/console/authors', method: 'get', handler: (req) => handle(req, 'authors') },
  { path: '/console/counts', method: 'get', handler: (req) => handle(req, 'counts') },
]
