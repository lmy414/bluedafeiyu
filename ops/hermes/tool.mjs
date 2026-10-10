#!/usr/bin/env node
/** Fixed SSH bridge transport. Only local business APIs, never model endpoints. */
import { pathToFileURL } from 'node:url';
const ACTIONS = new Set(['list', 'rules', 'claim', 'get', 'image', 'draft', 'locale', 'validate', 'complete', 'release', 'sync']);
export async function runTool(input, env = process.env, fetchImpl = fetch) {
  if (!input || !ACTIONS.has(input.action) || !['submission', 'admin', 'requests'].includes(input.target)) throw new Error('Invalid tool action or target');
  const submission = input.target === 'submission';
  const base = submission ? (env.HERMES_REVIEW_API_URL || 'http://127.0.0.1:8790') : 'http://127.0.0.1:3100';
  const parsed = new URL(base);
  if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('Tool bridge only permits loopback business APIs');
  const token = submission ? env.HERMES_REVIEW_TOKEN : env.ADMIN_WORKER_TOKEN;
  if (!token) throw new Error('Tool bridge authentication is not configured');
  if (input.action === 'sync' && submission) throw new Error('sync only permits admin');
  const response = await fetchImpl(base.replace(/\/$/, '') + (submission ? '/api/v1/internal/agent' : input.target === 'requests' ? '/cms-api/request-agent' : input.action === 'sync' ? '/cms-api/submissions/sync' : '/cms-api/agent'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(input.target === 'requests' && env.SUBMISSION_GITHUB_TOKEN ? { 'X-GitHub-Read-Token': env.SUBMISSION_GITHUB_TOKEN } : {}) },
    body: JSON.stringify(input), signal: AbortSignal.timeout(60_000),
  });
  if (input.action === 'image' && response.ok && response.headers.get('content-type')?.startsWith('image/')) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 30 * 1024 * 1024) throw new Error('Image exceeds tool size limit');
    return { ok: true, mime: response.headers.get('content-type'), image: bytes.toString('base64') };
  }
  const value = await response.json();
  if (submission && ['complete', 'release'].includes(input.action) && response.ok) {
    try {
      const synced = await runTool({ target: 'admin', action: 'sync' }, env, fetchImpl);
      value.sync = { status: synced.status, errors: synced.errors || [] };
    } catch (error) { value.sync = { error: error.message }; }
  }
  return { ...value, status: response.status };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const chunks = []; let length = 0;
    for await (const chunk of process.stdin) { length += chunk.length; if (length > 128 * 1024) throw new Error('Tool input too large'); chunks.push(chunk); }
    const output = await runTool(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    process.stdout.write(JSON.stringify(output) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n'); process.exitCode = 1;
  }
}
