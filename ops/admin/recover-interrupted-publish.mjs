#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { acquirePublishLock, writeJournal } from '../publish-batch.mjs';

const MINIMUM_AGE_MS = 65 * 60 * 1000; // systemd 的发布上限为 60 分钟，另留 5 分钟。
const RUN_ID = /^[A-Za-z0-9._-]{1,128}$/;

function workerInactive() {
  const result = spawnSync('systemctl', ['show', 'dafeiyu-admin-publish.service', '--property=ActiveState', '--value'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('无法确认发布执行器状态，拒绝恢复');
  return ['inactive', 'failed'].includes(result.stdout.trim());
}

function ownerAlive(file, processAlive) {
  if (!fs.existsSync(file)) return false;
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0) throw new Error('发布锁缺少有效 PID，拒绝恢复');
  return processAlive(lock.pid);
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

export async function recoverInterruptedPublishes({ env = process.env, apply = false, deps = {} } = {}) {
  const root = env.INTAKE_ROOT;
  const botKey = env.ADMIN_BOT_API_KEY;
  const workerToken = env.ADMIN_WORKER_TOKEN;
  if (!root || !botKey || !workerToken) throw new Error('恢复检查需要 INTAKE_ROOT、ADMIN_BOT_API_KEY 和 ADMIN_WORKER_TOKEN');
  const requestDir = path.resolve(env.ADMIN_PUBLISH_REQUEST_DIR || '/srv/apps/dafeiyu-admin/run');
  const intake = { root: path.resolve(root), logDir: path.join(path.resolve(root), 'logs') };
  const lockFile = path.join(intake.logDir, 'publish.lock');
  const inactive = deps.workerInactive || workerInactive;
  const alive = deps.processAlive || processAlive;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const now = deps.now || Date.now;
  const api = String(env.ADMIN_API_URL || 'http://127.0.0.1:3100');
  const idle = () => inactive() && !ownerAlive(lockFile, alive) && !fs.existsSync(path.join(requestDir, 'publish.request'));
  if (!idle()) return [];
  async function request(route, options = {}) {
    const response = await fetchImpl(new URL(route, api), { ...options, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`恢复发布 HTTP ${response.status}`);
    return response.json();
  }
  const query = new URLSearchParams({ 'where[status][in]': 'queued,in_progress', limit: '100', depth: '0' });
  const payload = await request(`/cms-api/publish-runs?${query}`, { headers: { Authorization: `users API-Key ${botKey}` } });
  if (!Array.isArray(payload.docs) || payload.hasNextPage) throw new Error('未完整读取发布批次，拒绝恢复');
  const candidates = payload.docs.filter(run => {
    const at = Date.parse(run.startedAt || run.requestedAt);
    return ['queued', 'in_progress'].includes(run.status) && RUN_ID.test(run.runId || '') && Number.isFinite(at) && now() - at > MINIMUM_AGE_MS;
  });
  if (!apply || candidates.length === 0) return candidates.map(run => run.runId);
  // 同时持有正式发布锁，并再次核对服务状态，避免误回收仍在运行的发布。
  const unlock = await acquirePublishLock(intake, { staleMs: MINIMUM_AGE_MS });
  try {
    if (!inactive() || fs.existsSync(path.join(requestDir, 'publish.request'))) return [];
    const recovered = [];
    for (const run of candidates) {
      const error = '发布执行器已退出，批次超过 65 分钟仍未结束；保留待发布作品，由下一批重试';
      await request(`/cms-api/publish/runs/${encodeURIComponent(run.runId)}/status`, {
        method: 'POST', headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'failed', step: 'interrupted', error, log: '回收中断批次，保留原提交与待发布状态' }),
      });
      const journalFile = path.join(intake.root, 'batches', `${run.runId}.json`);
      if (fs.existsSync(journalFile)) {
        const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
        if (journal.runId !== run.runId) throw new Error('批次日志与 runId 不一致');
        writeJournal({ intake }, { ...journal, batchId: run.runId, status: 'failed', step: 'interrupted', error });
      }
      recovered.push(run.runId);
    }
    return recovered;
  } finally { await unlock(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('用法：recover-interrupted-publish.mjs [--apply]');
    const runs = await recoverInterruptedPublishes({ apply: process.argv.includes('--apply') });
    if (runs.length) process.stderr.write(`[publish-recovery] ${process.argv.includes('--apply') ? '已回收' : '待回收'}：${runs.join(', ')}\n`);
  } catch (error) { process.stderr.write(`[publish-recovery] ${error.message}\n`); process.exitCode = 1; }
}
