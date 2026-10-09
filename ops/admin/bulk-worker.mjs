#!/usr/bin/env node
// 独立 systemd worker；只通过受鉴权接口执行任务，不依赖前端页面。
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function processOne(env = process.env, fetchImpl = fetch) {
  const base = String(env.ADMIN_API_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
  if (!env.ADMIN_WORKER_TOKEN) throw new Error('ADMIN_WORKER_TOKEN missing');
  const res = await fetchImpl(base + '/cms-api/bulk/process-next', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.ADMIN_WORKER_TOKEN },
    signal: AbortSignal.timeout(420000),
  });
  if (res.status === 409) return { busy: true };
  if (!res.ok) throw new Error('bulk worker HTTP ' + res.status);
  return res.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  while (!stopping) {
    try {
      const result = await processOne();
      if (result.job) console.log(JSON.stringify(result));
      if (result.idle || result.busy) await delay(5000);
    } catch (error) {
      // 不记录请求头、AI 原文或环境变量。
      console.error('[bulk-worker] ' + error.message);
      await delay(10000);
    }
  }
}
