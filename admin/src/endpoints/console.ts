import type { Endpoint, PayloadRequest } from 'payload'
import { json, requireOwnerOrBot } from '../lib/endpoint-auth'
import { consoleAuthors, consoleList, parseConsoleQuery } from '../lib/console-list'

async function handle(req: PayloadRequest, authors: boolean) {
  const denied = requireOwnerOrBot(req)
  if (denied) return denied
  const query = parseConsoleQuery(new URL(req.url || 'http://localhost'))
  return json(authors ? { authors: await consoleAuthors(req.payload, query) } : await consoleList(req.payload, query))
}

export const ConsoleEndpoints: Endpoint[] = [
  { path: '/console/list', method: 'get', handler: (req) => handle(req, false) },
  { path: '/console/authors', method: 'get', handler: (req) => handle(req, true) },
]
