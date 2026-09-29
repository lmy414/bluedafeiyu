#!/usr/bin/env node
/*
 * ops/admin/publish-worker.mjs —— 后台发布请求执行器
 *
 * 由 dafeiyu-admin-publish.path 在 publish.request 出现时拉起，也可以由维护者手动执行：
 *   node ops/admin/publish-worker.mjs --run <runId>
 *
 * 发布内容不在本文件里生成。后台先通过 /cms-api/publish/snapshot 给出数据文件和原图清单，
 * 本文件再按 submissionId 从投稿服务管理口取原图，校验后写内容仓；原图不经过后台媒体目录。
 *
 * 安全边界：
 *   - 只通过 HTTP 访问后台；ADMIN_WORKER_TOKEN 只放在 Authorization 头里，不写日志；
 *   - 所有仓库路径先 resolve，再校验仍在目标仓库内；
 *   - 站点仓只允许 6 个快照 data 文件和 blue-fish-ids.json；
 *   - 内容仓只允许 dist/submissions/originals|previews|large/ 下的文件；
 *   - 提交逐个列路径，禁止 git add -A / git add .。
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  acquirePublishLock,
  ensureRepoClean,
  markPublished,
  readLatestUnfinishedJournal,
  resolvePublishConfig,
  runDeploy,
  runToolchain,
  writeJournal,
} from '../publish-batch.mjs';

export const WORKER_SCHEMA = 'admin-publish/1';
export const SNAPSHOT_SITE_FILES = [
  'data/works.json',
  'data/owner-picks.json',
  'data/characters.json',
  'data/categories.json',
  'data/topics.json',
  'data/blue-fish-editorial.json',
];
export const SITE_ALLOWLIST = [...SNAPSHOT_SITE_FILES, 'data/blue-fish-ids.json'];
export const CONTENT_ALLOW_PREFIXES = [
  'dist/submissions/originals/',
  'dist/submissions/previews/',
  'dist/submissions/large/',
];
const ORIGINAL_ALLOW_PREFIXES = ['dist/submissions/originals/'];
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.apng']);
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SUBMISSION_ID_RE = /^sub_[A-Za-z0-9_]+$/;

function logLine(log, message) {
  log(String(message));
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function assertSafeRelative(value, label) {
  const rel = String(value ?? '');
  if (!rel || rel.includes('\0') || rel.includes('\\') || path.posix.isAbsolute(rel)) {
    throw new Error(`${label} 不是仓库内相对路径：${rel}`);
  }
  const normalized = path.posix.normalize(rel);
  if (normalized !== rel || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} 含越界路径：${rel}`);
  }
  for (const part of rel.split('/')) {
    if (!part || part === '.' || part === '..') throw new Error(`${label} 路径不合法：${rel}`);
  }
  return rel;
}

function assertNoSymlink(repo, rel, label) {
  let current = path.resolve(repo);
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw new Error(`${label} 无法检查路径 ${rel}：${error.message}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`${label} 不能经过符号链接：${rel}`);
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`${label} 的父路径不是目录：${rel}`);
  }
}

function assertAllowedRelative(value, label, prefixes) {
  const rel = assertSafeRelative(value, label);
  if (prefixes && !prefixes.some((prefix) => rel === prefix || rel.startsWith(prefix))) {
    throw new Error(`${label} 不在允许前缀内：${rel}`);
  }
  return rel;
}

function repoPath(repo, value, label, prefixes = null) {
  const rel = assertAllowedRelative(value, label, prefixes);
  const abs = path.resolve(repo, ...rel.split('/'));
  if (!isInside(repo, abs)) throw new Error(`${label} 越出仓库：${rel}`);
  assertNoSymlink(repo, rel, label);
  return { rel, abs };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function normalizeImageExt(value) {
  let ext = String(value ?? '').trim().toLowerCase();
  if (ext && !ext.startsWith('.')) ext = `.${ext}`;
  return ext === '.jpeg' ? '.jpg' : ext;
}

function targetImageExt(rel) {
  const ext = path.posix.extname(rel).toLowerCase();
  return ext === '.jpeg' ? '.jpg' : ext;
}

function defaultSummary() {
  return { added: 0, updated: 0, hidden: 0, restored: 0, deleted: 0, topics: 0 };
}

function normalizeSummary(value) {
  const summary = { ...defaultSummary() };
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    throw new Error('snapshot.summary 必须是对象');
  }
  for (const key of Object.keys(summary)) {
    if (value?.[key] === undefined) continue;
    const number = Number(value[key]);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error(`snapshot.summary.${key} 必须是非负整数`);
    summary[key] = number;
  }
  return summary;
}

function parseArgs(argv = []) {
  let runId = null;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (arg === '--run' || arg === '--run-id') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) throw new Error(`${arg} 缺 runId`);
      runId = argv[++i];
      continue;
    }
    if (arg.startsWith('--run=')) { runId = arg.slice('--run='.length); continue; }
    throw new Error(`无法识别的参数：${arg}`);
  }
  if (runId && !RUN_ID_RE.test(runId)) throw new Error(`runId 不合法：${runId}`);
  return { runId, help };
}

function validateRunId(value, label = 'runId') {
  const runId = String(value ?? '').trim();
  if (!RUN_ID_RE.test(runId)) throw new Error(`${label} 不合法：${runId || '(空)'}`);
  return runId;
}

function apiUrl(base, pathname) {
  return new URL(pathname, base).toString();
}

function timeoutSignal(ms) {
  return typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

function defaultExec(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

function runCmd(exec, command, args, options = {}) {
  const result = exec(command, args, options);
  if (result?.error) throw new Error(`${command} 启动失败：${result.error.message}`);
  if (result?.status !== 0) {
    const tail = String(result?.stderr || result?.stdout || '').trim().split('\n').slice(-5).join(' | ');
    throw new Error(`${command} ${args.join(' ')} 退出码 ${result?.status}${tail ? `：${tail}` : ''}`);
  }
  return result;
}

function gitCmd(exec, dir, args, options = {}) {
  return runCmd(exec, 'git', ['-C', dir, ...args], options);
}

function readJsonFile(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} 读不到或不是 JSON：${file}（${error.message}）`);
  }
}

function validateSnapshot(snapshot, expectedRunId) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('snapshot 必须是对象');
  if (validateRunId(snapshot.runId, 'snapshot.runId') !== expectedRunId) throw new Error('snapshot.runId 与请求不一致');
  if (!snapshot.files || typeof snapshot.files !== 'object' || Array.isArray(snapshot.files)) throw new Error('snapshot.files 必须是对象');
  const extra = Object.keys(snapshot.files).filter((key) => !SNAPSHOT_SITE_FILES.includes(key));
  if (extra.length) throw new Error(`snapshot.files 含不允许的文件：${extra.join(', ')}`);
  for (const rel of SNAPSHOT_SITE_FILES) {
    if (typeof snapshot.files[rel] !== 'string') throw new Error(`snapshot.files 缺少文本文件：${rel}`);
  }
  if (!Array.isArray(snapshot.originals)) throw new Error('snapshot.originals 必须是数组');
  if (!Array.isArray(snapshot.deletions)) throw new Error('snapshot.deletions 必须是数组');
  const originals = snapshot.originals.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`snapshot.originals[${index}] 必须是对象`);
    const workId = String(item.workId ?? '').trim();
    const digest = String(item.sha256 ?? '').trim().toLowerCase();
    const targetPath = assertSafeRelative(item.targetPath, `snapshot.originals[${index}].targetPath`);
    const submissionId = String(item.submissionId ?? "").trim();
    if (!workId) throw new Error(`snapshot.originals[${index}].workId 为空`);
    if (!SUBMISSION_ID_RE.test(submissionId)) throw new Error(`snapshot.originals[${index}].submissionId 不合法：${submissionId}`);
    if (Object.prototype.hasOwnProperty.call(item, 'downloadPath')) throw new Error(`snapshot.originals[${index}] 不再允许 downloadPath`);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`snapshot.originals[${index}].sha256 不合法`);
    if (!IMAGE_EXTENSIONS.has(normalizeImageExt(item.ext))) throw new Error(`snapshot.originals[${index}].ext 不支持：${item.ext}`);
    if (normalizeImageExt(item.ext) !== targetImageExt(targetPath)) throw new Error(`snapshot.originals[${index}] 扩展名与 targetPath 不一致`);
    assertAllowedRelative(targetPath, `snapshot.originals[${index}].targetPath`, ORIGINAL_ALLOW_PREFIXES);
    return { ...item, workId, sha256: digest, submissionId, targetPath };
  });
  const deletions = snapshot.deletions.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`snapshot.deletions[${index}] 必须是对象`);
    if (!Array.isArray(item.contentPaths)) throw new Error(`snapshot.deletions[${index}].contentPaths 必须是数组`);
    const contentPaths = item.contentPaths.map((rel, pathIndex) => {
      const safe = assertSafeRelative(rel, `snapshot.deletions[${index}].contentPaths[${pathIndex}]`);
      assertAllowedRelative(safe, `snapshot.deletions[${index}].contentPaths[${pathIndex}]`, CONTENT_ALLOW_PREFIXES);
      return safe;
    });
    return { ...item, contentPaths };
  });
  return { ...snapshot, files: { ...snapshot.files }, originals, deletions, summary: normalizeSummary(snapshot.summary) };
}

export function resolveWorkerConfig(env = process.env) {
  if (!env.INTAKE_ROOT) throw new Error('必须指定 INTAKE_ROOT');
  const contentDir = env.PUBLISH_CONTENT_DIR || env.CONTENT_DIR;
  const siteDir = env.PUBLISH_SITE_DIR || env.SOURCE_DIR;
  if (!contentDir) throw new Error('必须指定 PUBLISH_CONTENT_DIR 或 CONTENT_DIR');
  if (!siteDir) throw new Error('必须指定 PUBLISH_SITE_DIR 或 SOURCE_DIR');
  const baseBranch = env.PUBLISH_BRANCH || env.BRANCH || 'main';
  const base = resolvePublishConfig({
    env: { ...env, PUBLISH_SITE_DIR: siteDir, PUBLISH_CONTENT_DIR: contentDir, PUBLISH_BRANCH: baseBranch },
    overrides: { siteDir, contentDir, root: env.INTAKE_ROOT },
  });
  const originalBaseUrl = String(env.PUBLISH_ORIGINAL_BASE_URL || 'https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main').replace(/\/+$/, '');
  if (!/^https:\/\/[^\s]+$/.test(originalBaseUrl)) throw new Error(`PUBLISH_ORIGINAL_BASE_URL 必须是 https 地址：${originalBaseUrl}`);
  const apiUrl = String(env.ADMIN_API_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
  const token = String(env.ADMIN_WORKER_TOKEN || '');
  if (!token) throw new Error('必须指定 ADMIN_WORKER_TOKEN');
  const submissionApiUrl = String(env.SUBMISSION_ADMIN_API_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
  const submissionToken = String(env.SUBMISSION_ADMIN_TOKEN || '');
  if (!submissionToken) throw new Error('必须指定 SUBMISSION_ADMIN_TOKEN');
  return {
    ...base,
    originalBaseUrl,
    apiUrl,
    token,
    submissionApiUrl,
    submissionToken,
    requestDir: path.resolve(env.ADMIN_PUBLISH_REQUEST_DIR || '/srv/apps/dafeiyu-admin/run'),
    siteBranch: baseBranch,
    contentBranch: env.CONTENT_BRANCH || baseBranch,
    remote: env.PUBLISH_REMOTE || 'origin',
    buildCheck: true, // 后台发布必须做一次完整构建校验；这里不沿用旧批处理的 dry-run 开关。
    deployRoot: env.PUBLISH_DEPLOY_ROOT || env.DEPLOY_ROOT || '',
    deployCmd: env.PUBLISH_DEPLOY_CMD || '',
    deployRunner: env.PUBLISH_DEPLOY_RUNNER || '',
    healthUrl: env.HEALTH_URL || env.ADMIN_SITE_URL || '',
    siteAllowlist: [...SITE_ALLOWLIST],
    contentAllowPrefixes: [...CONTENT_ALLOW_PREFIXES],
    workDir: path.join(base.intake.root, 'work'),
    httpTimeoutMs: Number(env.ADMIN_PUBLISH_HTTP_TIMEOUT_MS || 30000),
  };
}

function takeRequest({ requestDir, runId: requestedRunId = null, log = () => {} }) {
  fs.mkdirSync(requestDir, { recursive: true, mode: 0o700 });
  const requestFile = path.join(requestDir, 'publish.request');
  if (!fs.existsSync(requestFile)) {
    if (!requestedRunId) throw new Error(`请求文件不存在：${requestFile}`);
    const taken = path.join(requestDir, `publish.request.${requestedRunId}.taken`);
    if (fs.existsSync(taken)) return { skipped: true, runId: requestedRunId, reason: 'already_taken' };
    const manualRequest = { runId: requestedRunId, requestedAt: new Date().toISOString(), actor: 'manual', synthetic: true };
    fs.writeFileSync(taken, `${JSON.stringify(manualRequest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    logLine(log, `没有请求文件，按手动 runId 接管：${requestedRunId}`);
    return { skipped: false, runId: requestedRunId, request: manualRequest, requestFile: null, takenPath: taken };
  }
  const request = readJsonFile(requestFile, '发布请求');
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('发布请求必须是对象');
  const runId = validateRunId(request.runId);
  if (requestedRunId && requestedRunId !== runId) throw new Error(`--run ${requestedRunId} 与请求 runId ${runId} 不一致`);
  const taken = path.join(requestDir, `publish.request.${runId}.taken`);
  if (fs.existsSync(taken)) throw new Error(`请求已存在 taken 文件，拒绝重复触发：${taken}`);
  try {
    fs.renameSync(requestFile, taken);
  } catch (error) {
    if (error.code === 'ENOENT' && fs.existsSync(taken)) return { skipped: true, runId, reason: 'already_taken' };
    throw error;
  }
  logLine(log, `已接管请求 ${runId}，原文件改名为 ${taken}`);
  return { skipped: false, runId, request: { ...request, runId }, requestFile, takenPath: taken };
}
function workerHeaders(cfg, extra = {}) {
  return { Authorization: `Bearer ${cfg.token}`, ...extra };
}

async function fetchJson(fetchImpl, url, options, timeoutMs) {
  const response = await fetchImpl(url, { ...options, signal: timeoutSignal(timeoutMs) });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const detail = typeof data === 'object' && data ? (data.error || data.message || '') : data;
    throw new Error(`${options?.method || 'GET'} ${new URL(url).pathname} HTTP ${response.status}${detail ? `：${detail}` : ''}`);
  }
  return data;
}

async function postRunStatus(cfg, runId, body, fetchImpl) {
  return fetchJson(fetchImpl, apiUrl(cfg.apiUrl, `/cms-api/publish/runs/${encodeURIComponent(runId)}/status`), {
    method: 'POST',
    headers: workerHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }, cfg.httpTimeoutMs);
}

async function fetchSnapshot(cfg, runId, fetchImpl) {
  const url = new URL(apiUrl(cfg.apiUrl, '/cms-api/publish/snapshot'));
  url.searchParams.set('runId', runId);
  const snapshot = await fetchJson(fetchImpl, url.toString(), { headers: workerHeaders(cfg) }, cfg.httpTimeoutMs);
  return validateSnapshot(snapshot, runId);
}

function submissionRawUrl(cfg, submissionId) {
  if (!SUBMISSION_ID_RE.test(submissionId)) throw new Error(`submissionId 不合法：${submissionId}`);
  const base = new URL(cfg.submissionApiUrl);
  const target = new URL(`/api/v1/items/${submissionId}/raw`, `${cfg.submissionApiUrl}/`);
  if (target.origin !== base.origin) throw new Error(`投稿原图地址不能跨域：${submissionId}`);
  const match = target.pathname.match(/^\/api\/v1\/items\/([^/]+)\/raw$/);
  if (!match || !SUBMISSION_ID_RE.test(match[1])) throw new Error(`投稿原图地址不在允许路径内：${target.pathname}`);
  return target.toString();
}

function submissionReleaseUrl(cfg, submissionId) {
  if (!SUBMISSION_ID_RE.test(submissionId)) throw new Error(`submissionId 不合法：${submissionId}`);
  const base = new URL(cfg.submissionApiUrl);
  const target = new URL(`/api/v1/items/${submissionId}/release-original`, `${cfg.submissionApiUrl}/`);
  if (target.origin !== base.origin) throw new Error(`投稿释放地址不能跨域：${submissionId}`);
  const match = target.pathname.match(/^\/api\/v1\/items\/([^/]+)\/release-original$/);
  if (!match || !SUBMISSION_ID_RE.test(match[1])) throw new Error(`投稿释放地址不在允许路径内：${target.pathname}`);
  return target.toString();
}

function originalRawUrl(cfg, targetPath) {
  return `${cfg.originalBaseUrl}/${String(targetPath).replace(/^\/+/, '')}`;
}

export async function releasePublishedOriginals(cfg, snapshot, { fetchImpl, log = () => {} } = {}) {
  for (const item of snapshot.originals) {
    const rawUrl = originalRawUrl(cfg, item.targetPath);
    try {
      const response = await fetchImpl(rawUrl, { method: 'HEAD', signal: timeoutSignal(cfg.httpTimeoutMs) });
      if (!response.ok) throw new Error(`HEAD ${new URL(rawUrl).pathname} HTTP ${response.status}`);
    } catch (error) {
      logLine(log, `警告：原图 Raw 不可访问，跳过释放 ${item.submissionId}：${errorMessage(error)}`);
      continue;
    }
    try {
      await fetchJson(fetchImpl, submissionReleaseUrl(cfg, item.submissionId), {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.submissionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'published', rawUrl }),
      }, cfg.httpTimeoutMs);
      logLine(log, `已通知投稿服务释放原图：${item.submissionId}`);
    } catch (error) {
      logLine(log, `警告：通知投稿服务释放原图失败（不影响发布）：${item.submissionId}：${errorMessage(error)}`);
    }
  }
}

function writeIfChanged(file, text) {
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (previous === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return true;
}

export function writeSiteSnapshotFiles(cfg, files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('snapshot.files 必须是对象');
  const keys = Object.keys(files);
  const missing = SNAPSHOT_SITE_FILES.filter((rel) => !keys.includes(rel));
  const extra = keys.filter((rel) => !SNAPSHOT_SITE_FILES.includes(rel));
  if (missing.length || extra.length) throw new Error(`snapshot.files 白名单不匹配：缺少 ${missing.join(', ') || '无'}；多出 ${extra.join(', ') || '无'}`);
  const written = [];
  for (const rel of SNAPSHOT_SITE_FILES) {
    if (typeof files[rel] !== 'string') throw new Error(`snapshot.files.${rel} 必须是文本`);
    const { abs } = repoPath(cfg.siteDir, rel, `snapshot.files.${rel}`);
    if (writeIfChanged(abs, files[rel])) written.push(rel);
  }
  return written;
}

export async function downloadOriginals(cfg, snapshot, { fetchImpl, log = () => {} } = {}) {
  const written = [];
  for (const item of snapshot.originals) {
    const { abs, rel } = repoPath(cfg.contentDir, item.targetPath, `原图 targetPath ${item.targetPath}`, ORIGINAL_ALLOW_PREFIXES);
    if (fs.existsSync(abs)) {
      if (sha256File(abs) === item.sha256) {
        logLine(log, `原图已存在且哈希一致，跳过：${rel}`);
        continue;
      }
      throw new Error(`目标原图已存在且内容不同：${rel}`);
    }
    const url = submissionRawUrl(cfg, item.submissionId);
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${cfg.submissionToken}` }, signal: timeoutSignal(cfg.httpTimeoutMs) });
    if (!response.ok) throw new Error(`读取投稿原图 HTTP ${response.status}：${item.submissionId}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (sha256(buffer) !== item.sha256) throw new Error(`原图 sha256 不匹配：${rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const temp = `${abs}.part-${process.pid}`;
    fs.writeFileSync(temp, buffer, { mode: 0o600 });
    fs.renameSync(temp, abs);
    written.push(rel);
    logLine(log, `写入原图：${rel}`);
  }
  return written;
}

export function deleteContentPaths(cfg, deletions) {
  const removed = [];
  const missing = [];
  for (const item of deletions) {
    for (const rel of item.contentPaths) {
      const { abs } = repoPath(cfg.contentDir, rel, `删除路径 ${rel}`, CONTENT_ALLOW_PREFIXES);
      let stat;
      try {
        stat = fs.lstatSync(abs);
      } catch (error) {
        if (error.code === 'ENOENT') { missing.push(rel); continue; }
        throw error;
      }
      if (stat.isDirectory()) throw new Error(`删除路径是目录，拒绝处理：${rel}`);
      fs.rmSync(abs, { force: true });
      removed.push(rel);
    }
  }
  return { removed, missing };
}

function readManifest(file) {
  const value = readJsonFile(file, path.basename(file));
  if (!Array.isArray(value)) throw new Error(`${path.basename(file)} 顶层必须是数组`);
  return value;
}

function recordId(record) {
  return String(record?.workId ?? record?.id ?? '').trim();
}

export function collectPublishResults(cfg, snapshot) {
  const records = [
    ...readManifest(path.join(cfg.siteDataDir, 'works.json')),
    ...readManifest(path.join(cfg.siteDataDir, 'owner-picks.json')),
  ];
  const byId = new Map();
  for (const record of records) {
    const id = recordId(record);
    if (id) byId.set(id, record);
  }
  const seen = new Set();
  const results = [];
  for (const item of snapshot.originals) {
    if (seen.has(item.workId)) continue;
    const record = byId.get(item.workId);
    if (!record) throw new Error(`快照作品在最终清单中找不到：${item.workId}`);
    seen.add(item.workId);
    results.push({
      workId: item.workId,
      slug: record.slug ?? null,
      path: record.path ?? null,
      thumbnailPath: record.thumbnailPath ?? null,
      fullPath: record.fullPath ?? null,
      width: record.width ?? null,
      height: record.height ?? null,
      fileSize: record.fileSize ?? record.bytes ?? null,
      format: record.format ?? null,
      mimeType: record.mimeType ?? null,
    });
  }
  return results;
}

function parsePorcelainZ(output) {
  const parts = String(output || '').split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part || part.length < 3) continue;
    const xy = part.slice(0, 2);
    const rel = part.slice(3);
    entries.push({ xy, rel });
    if (xy[0] === 'R' || xy[0] === 'C') i += 1;
  }
  return entries;
}

function isAllowedPath(cfg, repoKey, rel) {
  if (repoKey === 'site') return cfg.siteAllowlist.includes(rel);
  return cfg.contentAllowPrefixes.some((prefix) => rel.startsWith(prefix));
}

export function discoverRepoChanges(cfg, exec, repoKey) {
  const dir = repoKey === 'site' ? cfg.siteDir : cfg.contentDir;
  const out = gitCmd(exec, dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout || '';
  const changes = [];
  for (const entry of parsePorcelainZ(out)) {
    const rel = assertSafeRelative(entry.rel, `${repoKey} git status`);
    if (entry.xy.includes('R') || entry.xy.includes('C')) throw new Error(`${repoKey} 工作树不允许重命名/复制：${rel}`);
    if (!isAllowedPath(cfg, repoKey, rel)) throw new Error(`${repoKey} 工作树出现白名单外改动：${rel}`);
    changes.push({ path: rel, deleted: entry.xy.includes('D') });
  }
  const unique = [...new Map(changes.map((item) => [`${item.deleted ? 'D' : 'M'}:${item.path}`, item])).values()];
  return { files: unique.map((item) => item.path), changes: unique };
}

function refreshJournalFiles(cfg, exec, journal) {
  try {
    const site = discoverRepoChanges({ ...cfg, branch: cfg.siteBranch }, exec, 'site');
    const content = discoverRepoChanges({ ...cfg, branch: cfg.contentBranch }, exec, 'content');
    journal.files = {
      site: site.files.length ? site.files : [...SITE_ALLOWLIST],
      content: content.files.length ? content.files : journal.files.content,
    };
  } catch {
    // 保留旧 journal 的受控路径；刷新失败不能覆盖原始错误。
  }
}

function stagedAndCommit(cfg, exec, repoKey, changes, message) {
  if (changes.length === 0) return null;
  const dir = repoKey === 'site' ? cfg.siteDir : cfg.contentDir;
  for (const item of changes) {
    assertSafeRelative(item.path, `${repoKey} 提交路径`);
    if (item.deleted) {
      gitCmd(exec, dir, ['rm', '--cached', '--ignore-unmatch', '--', item.path]);
    } else {
      gitCmd(exec, dir, ['add', '--', item.path]);
    }
  }
  const staged = (gitCmd(exec, dir, ['diff', '--cached', '--name-only']).stdout || '').trim();
  if (!staged) return null;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: cfg.gitName,
    GIT_AUTHOR_EMAIL: cfg.gitEmail,
    GIT_COMMITTER_NAME: cfg.gitName,
    GIT_COMMITTER_EMAIL: cfg.gitEmail,
  };
  gitCmd(exec, dir, ['commit', '-m', message], { env });
  return (gitCmd(exec, dir, ['rev-parse', 'HEAD']).stdout || '').trim() || null;
}

function pushRepo(cfg, exec, repoKey) {
  const dir = repoKey === 'site' ? cfg.siteDir : cfg.contentDir;
  const branch = repoKey === 'site' ? cfg.siteBranch : cfg.contentBranch;
  gitCmd(exec, dir, ['push', cfg.remote, `HEAD:${branch}`]);
}

function currentReleasePath(cfg) {
  if (!cfg.deployRoot) return null;
  const current = path.join(cfg.deployRoot, 'current');
  if (!fs.existsSync(current)) return null;
  try {
    const real = fs.realpathSync(current);
    return isInside(cfg.deployRoot, real) ? real : null;
  } catch {
    return null;
  }
}

function markSnapshotPublished(cfg, snapshot, runId, atIso) {
  for (const item of snapshot.originals) {
    const meta = path.join(cfg.intake.metaDir, `${item.sha256}.json`);
    if (!fs.existsSync(meta)) continue;
    markPublished(cfg, item.sha256, runId, atIso);
  }
}

function runIssueReconcile(cfg, exec, env, log) {
  const script = path.join(cfg.siteDir, 'ops', 'issue-reconcile.mjs');
  if (!fs.existsSync(script)) {
    logLine(log, '提示：找不到 ops/issue-reconcile.mjs，跳过 Issue 对账');
    return;
  }
  const result = exec(cfg.node, [script], {
    cwd: cfg.siteDir,
    env: { ...process.env, ...env, INTAKE_ROOT: cfg.intake.root, PUBLISH_SITE_DIR: cfg.siteDir },
  });
  if (result?.error) {
    logLine(log, `警告：Issue 对账启动失败（不影响发布）：${result.error.message}`);
    return;
  }
  if (result?.status !== 0) {
    const tail = String(result?.stderr || result?.stdout || '').trim().split('\n').slice(-2).join(' | ');
    logLine(log, `警告：Issue 对账失败（不影响发布）：${tail || `退出码 ${result?.status}`}`);
  }
}

function journalBase(cfg, runId, startedAt, snapshot = null) {
  const contentPaths = snapshot
    ? [...snapshot.originals.map((item) => item.targetPath), ...snapshot.deletions.flatMap((item) => item.contentPaths)]
    : [];
  return {
    schema: WORKER_SCHEMA,
    batchId: runId,
    runId,
    startedAt,
    status: 'in_progress',
    step: 'init',
    files: { site: [...SITE_ALLOWLIST], content: [...new Set(contentPaths)] },
    commits: { site: null, content: null },
    pushed: false,
    deployed: false,
    releasePath: null,
    error: null,
  };
}

function writeWorkerJournal(cfg, journal) {
  return writeJournal(cfg, { ...journal, batchId: journal.runId });
}

function writeFallbackJournal(requestDir, journal) {
  const dir = path.join(requestDir, 'runs');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${journal.runId || 'unknown'}.json`);
  fs.writeFileSync(file, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return file;
}

export async function processPublishRequest({ request, env = process.env, deps = {} } = {}) {
  const runId = validateRunId(request?.runId);
  const log = deps.log || ((message) => process.stderr.write(`[admin-publish] ${message}\n`));
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const exec = deps.exec || defaultExec;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 没有可用的 fetch');

  const result = {
    runId,
    status: 'failed',
    step: 'init',
    summary: defaultSummary(),
    commits: { site: null, content: null },
    releasePath: null,
    healthCheck: null,
    results: [],
    log: '',
    error: null,
    journalPath: null,
  };
  const startedAt = new Date().toISOString();
  let cfg = null;
  let lock = null;
  let journal = null;
  let step = 'init';

  try {
    cfg = resolveWorkerConfig(env);
    const siteCfg = { ...cfg, branch: cfg.siteBranch };
    const contentCfg = { ...cfg, branch: cfg.contentBranch };

    step = 'lock';
    lock = await acquirePublishLock(cfg.intake, { staleMs: cfg.staleLockMs });

    step = 'status';
    await postRunStatus(cfg, runId, { status: 'in_progress', step: 'preflight', log: '开始后台发布' }, fetchImpl);

    step = 'preflight';
    const previousJournal = readLatestUnfinishedJournal(cfg);
    await ensureRepoClean(siteCfg, exec, 'site', previousJournal, log);
    await ensureRepoClean(contentCfg, exec, 'content', previousJournal, log);

    step = 'snapshot';
    const snapshot = await fetchSnapshot(cfg, runId, fetchImpl);
    result.summary = snapshot.summary;
    journal = journalBase(cfg, runId, startedAt, snapshot);
    journal.step = step;
    journal.path = writeWorkerJournal(cfg, journal);
    result.journalPath = journal.path;

    step = 'download';
    journal.step = step;
    await downloadOriginals(cfg, snapshot, { fetchImpl, log });

    step = 'delete';
    journal.step = step;
    const deleted = deleteContentPaths(cfg, snapshot.deletions);
    if (deleted.removed.length) logLine(log, `删除内容文件：${deleted.removed.join(', ')}`);

    step = 'write-site';
    journal.step = step;
    const siteWritten = writeSiteSnapshotFiles(cfg, snapshot.files);
    if (siteWritten.length) logLine(log, `写入站点清单：${siteWritten.join(', ')}`);

    step = 'toolchain';
    journal.step = step;
    fs.mkdirSync(cfg.workDir, { recursive: true, mode: 0o700 });
    try {
      await runToolchain(siteCfg, exec, cfg.workDir);
    } catch (error) {
      refreshJournalFiles(cfg, exec, journal);
      throw error;
    }
    refreshJournalFiles(cfg, exec, journal);

    step = 'results';
    journal.step = step;
    result.results = collectPublishResults(cfg, snapshot);

    step = 'discover';
    journal.step = step;
    const siteChanges = discoverRepoChanges(siteCfg, exec, 'site');
    const contentChanges = discoverRepoChanges(contentCfg, exec, 'content');
    journal.files = {
      site: siteChanges.files.length ? siteChanges.files : [...SITE_ALLOWLIST],
      content: contentChanges.files.length ? contentChanges.files : journal.files.content,
    };

    if (siteChanges.files.length === 0 && contentChanges.files.length === 0) {
      result.status = 'succeeded';
      result.step = 'noop';
      result.log = '无变更';
      logLine(log, '无变更');
      markSnapshotPublished(cfg, snapshot, runId, new Date().toISOString());
      if (deps.runIssueReconcile !== false) {
        try {
          (deps.runIssueReconcile || ((c, e, en, l) => runIssueReconcile(c, e, en, l)))(cfg, exec, env, log);
        } catch (error) {
          logLine(log, `警告：Issue 对账异常（不影响发布）：${errorMessage(error)}`);
        }
      }
      result.releasePath = currentReleasePath(cfg);
      result.healthCheck = { ok: true, noop: true, url: cfg.healthUrl || null };
      await postRunStatus(cfg, runId, {
        status: 'succeeded',
        step: 'done',
        log: '无变更',
        commits: result.commits,
        releasePath: result.releasePath,
        healthCheck: result.healthCheck,
        results: { works: result.results },
      }, fetchImpl);
      journal.status = 'succeeded';
      journal.step = 'done';
      journal.releasePath = result.releasePath;
      journal.path = writeWorkerJournal(cfg, journal);
      result.journalPath = journal.path;
      return result;
    }

    step = 'commit';
    journal.step = step;
    const message = `feat: 后台发布 ${runId}（新增 ${result.summary.added}、修改 ${result.summary.updated}、隐藏 ${result.summary.hidden}、删除 ${result.summary.deleted}、专题 ${result.summary.topics}）`;
    result.commits.content = stagedAndCommit(contentCfg, exec, 'content', contentChanges.changes, message);
    result.commits.site = stagedAndCommit(siteCfg, exec, 'site', siteChanges.changes, message);
    journal.commits = result.commits;

    step = 'push';
    journal.step = step;
    pushRepo(contentCfg, exec, 'content');
    pushRepo(siteCfg, exec, 'site');
    journal.pushed = true;

    step = 'release';
    journal.step = step;
    await releasePublishedOriginals(cfg, snapshot, { fetchImpl, log });

    step = 'deploy';
    journal.step = step;
    await runDeploy(siteCfg, exec, log);
    result.releasePath = currentReleasePath(cfg);
    result.healthCheck = { ok: true, url: cfg.healthUrl || null };
    journal.deployed = true;
    journal.releasePath = result.releasePath;

    step = 'mark';
    journal.step = step;
    markSnapshotPublished(cfg, snapshot, runId, new Date().toISOString());

    step = 'issue-reconcile';
    journal.step = step;
    if (deps.runIssueReconcile !== false) {
      try {
        (deps.runIssueReconcile || ((c, e, en, l) => runIssueReconcile(c, e, en, l)))(cfg, exec, env, log);
      } catch (error) {
        logLine(log, `警告：Issue 对账异常（不影响发布）：${errorMessage(error)}`);
      }
    }

    step = 'status';
    await postRunStatus(cfg, runId, {
      status: 'succeeded',
      step: 'done',
      log: `发布完成，内容提交 ${result.commits.content || '-'}，站点提交 ${result.commits.site || '-'}`,
      commits: result.commits,
      releasePath: result.releasePath,
      healthCheck: result.healthCheck,
      results: { works: result.results },
    }, fetchImpl);

    result.status = 'succeeded';
    result.step = 'done';
    journal.status = 'succeeded';
    journal.step = 'done';
    journal.path = writeWorkerJournal(cfg, journal);
    result.journalPath = journal.path;
    return result;
  } catch (error) {
    const message = errorMessage(error);
    result.status = 'failed';
    result.step = step;
    result.error = message;
    if (cfg) {
      try {
        await postRunStatus(cfg, runId, {
          status: 'failed',
          step,
          error: message,
          log: '发布失败',
          commits: result.commits,
        }, fetchImpl);
      } catch (statusError) {
        logLine(log, `警告：失败状态回写也失败：${errorMessage(statusError)}`);
      }
      const failedJournal = journal || journalBase(cfg, runId, startedAt, null);
      failedJournal.status = 'failed';
      failedJournal.step = step;
      failedJournal.error = message;
      failedJournal.commits = result.commits;
      failedJournal.releasePath = result.releasePath;
      try {
        failedJournal.path = writeWorkerJournal(cfg, failedJournal);
        result.journalPath = failedJournal.path;
      } catch (journalError) {
        logLine(log, `警告：写批次日志失败：${errorMessage(journalError)}`);
        try {
          result.journalPath = writeFallbackJournal(cfg.requestDir, failedJournal);
        } catch { /* 尽力保留原始错误 */ }
      }
    } else {
      try {
        result.journalPath = writeFallbackJournal(path.resolve(env.ADMIN_PUBLISH_REQUEST_DIR || '/srv/apps/dafeiyu-admin/run'), {
          ...journalBase({}, runId, startedAt, null),
          status: 'failed',
          step,
          error: message,
        });
      } catch { /* 尽力保留原始错误 */ }
    }
    logLine(log, `失败：${message}`);
    return result;
  } finally {
    if (lock) {
      try { await lock(); } catch { /* 释放锁失败不覆盖发布结果 */ }
    }
  }
}

export const runWorker = processPublishRequest;

export function resultForOutput(result) {
  return {
    runId: result.runId ?? null,
    status: result.status,
    summary: result.summary || defaultSummary(),
    commits: result.commits || { site: null, content: null },
    releasePath: result.releasePath ?? null,
    error: result.error ?? null,
  };
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(resultForOutput(result))}\n`);
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const env = deps.env || process.env;
  const log = deps.log || ((message) => process.stderr.write(`[admin-publish] ${message}\n`));
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    printResult({ runId: null, status: 'failed', summary: defaultSummary(), commits: { site: null, content: null }, releasePath: null, error: errorMessage(error) });
    return 1;
  }
  if (args.help) {
    process.stdout.write('用法：node ops/admin/publish-worker.mjs --run <runId>\n');
    return 0;
  }

  let taken;
  try {
    taken = takeRequest({
      requestDir: path.resolve(env.ADMIN_PUBLISH_REQUEST_DIR || '/srv/apps/dafeiyu-admin/run'),
      runId: args.runId,
      log,
    });
  } catch (error) {
    printResult({ runId: args.runId, status: 'failed', summary: defaultSummary(), commits: { site: null, content: null }, releasePath: null, error: errorMessage(error) });
    return 1;
  }
  if (taken.skipped) {
    printResult({ runId: taken.runId, status: 'skipped', summary: defaultSummary(), commits: { site: null, content: null }, releasePath: null, error: null });
    return 0;
  }

  const result = await processPublishRequest({ request: taken.request, env, deps: { ...deps, log } });
  printResult(result);
  return result.status === 'failed' ? 1 : 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`[admin-publish] 错误：${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
