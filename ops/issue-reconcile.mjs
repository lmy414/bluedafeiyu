#!/usr/bin/env node
// GitHub 投稿 Issue 对账：按投稿队列判定每个附件的收录 / 拒绝状态，必要时回复并关闭。
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { rightsComments, rightsIssueHash, rightsIssueSnapshot, verifyRightsPublication, acknowledgeRightsReply, reportRightsConflict } from './rights-publication.mjs';

export const REPO = 'lmy414/ai-girl-stickers';
export const SITE = 'https://xn--pssy23gqgbz2d718b.com';
export const MARKER = '<!-- dafeiyu-published -->';
export const DEFAULT_ADMIN_API_URL = 'http://127.0.0.1:8788';
export const DEFAULT_REPLY_DIR = '/srv/apps/dafeiyu-admin/run/issue-replies';
const META_DIR = process.env.INTAKE_ROOT ? path.join(process.env.INTAKE_ROOT, 'meta') : '/srv/apps/dafeiyu/intake/meta';
const WORKS_FILE = process.env.PUBLISH_SITE_DIR ? path.join(process.env.PUBLISH_SITE_DIR, 'data', 'works.json') : '/srv/apps/dafeiyu/source/data/works.json';
const API = 'https://api.github.com';
const ATTACHMENT_URL = /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+/g;
const ISSUE_URL = /^https:\/\/github\.com\/lmy414\/ai-girl-stickers\/issues\/(\d+)$/;
const ID_PATTERN = /^sticker_[0-9a-f]{24}$/;
const HOUR_MS = 60 * 60 * 1000;

function validWork(work, digest) {
  return work?.status === 'published'
    && work.sha256 === digest
    && work.id === `sticker_${digest.slice(0, 24)}`
    && ID_PATTERN.test(work.id)
    && /^[a-z0-9-]+$/.test(String(work.slug || ''));
}

export function publishedIssueGroups(meta, works) {
  const bySha = new Map(works.filter((w) => w?.status === 'published' && typeof w.sha256 === 'string')
    .map((w) => [w.sha256, w]));
  const groups = new Map();
  for (const m of meta) {
    if (m?.status !== 'published' || m.source !== 'github-issue') continue;
    const issueNo = Number(m.origin?.issue);
    const url = String(m.origin?.issueUrl || '');
    if (!Number.isSafeInteger(issueNo) || issueNo < 1 || url !== `https://github.com/${REPO}/issues/${issueNo}`) continue;
    if (!ISSUE_URL.test(url) || !/^[a-f0-9]{64}$/.test(String(m.sha256 || ''))) continue;
    const work = bySha.get(m.sha256);
    if (!validWork(work, m.sha256)) continue;
    const group = groups.get(issueNo) || [];
    group.push({ digest: m.sha256, slug: work.slug });
    groups.set(issueNo, group);
  }
  return groups;
}

export function commentFor(works) {
  const links = [...new Set(works.map((w) => `${SITE}/works/${w.slug}.html`))];
  return `已收录到「蓝色大肥鱼」，谢谢投稿！\n\n${links.map((u) => `- 作品页面：${u}`).join('\n')}\n\n${MARKER}`;
}

function commentForResults(published, rejected) {
  const lines = [];
  const links = [...new Set(published.map((w) => `${SITE}/works/${w.slug}.html`))];
  if (links.length) {
    lines.push('已收录到「蓝色大肥鱼」，谢谢投稿！', '');
    lines.push(...links.map((url) => `- 作品页面：${url}`));
  }
  if (rejected.length) {
    if (lines.length) lines.push('');
    lines.push(...rejected.map((entry) => entry.position
      ? `第 ${entry.position} 张未通过（${entry.label}）：${entry.reason}`
      : `未通过（${entry.label}）：${entry.reason}`));
  }
  lines.push('', MARKER);
  return lines.join('\n');
}

function tokenFromGh() {
  const token = execFileSync('/usr/bin/gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (!token) throw new Error('GitHub 授权不可用');
  return token;
}

function timeoutSignal(ms) {
  return typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

function attachmentUrls(body) {
  return [...new Set(String(body || '').match(ATTACHMENT_URL) || [])];
}

function assetIdOf(url) {
  try {
    const match = new URL(String(url)).pathname.match(/\/user-attachments\/assets\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function matchingItem(items, issueNo, attachmentUrl) {
  const assetId = assetIdOf(attachmentUrl);
  if (!assetId) return null;
  const sourcePrefix = `github:${REPO}#${issueNo}:`;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if ((item.sourceIds || []).some((sourceId) => String(sourceId).startsWith(sourcePrefix)
      && String(sourceId).slice(sourcePrefix.length) === assetId)) return item;
    const originIssue = Number(item.origin?.issue);
    if (assetIdOf(item.origin?.assetUrl) === assetId && (!Number.isSafeInteger(originIssue) || originIssue === issueNo)) return item;
  }
  return null;
}

function reasonText(value, fallback = '未通过审核') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function rejectionOf(item) {
  if (item?.state === 'auto_rejected') {
    return { label: 'AI 审核', reason: reasonText(item.review?.reason) };
  }
  if (item?.state === 'rejected') {
    const history = Array.isArray(item.stateHistory) ? item.stateHistory : [];
    const last = [...history].reverse().find((entry) => entry?.to === 'rejected');
    return { label: '人工审核', reason: reasonText(last?.reason) };
  }
  return null;
}

async function evaluateAttachment({ item, metaBySha, worksBySha, checkPage, log }) {
  const digest = String(item?.sha256 || '');
  const metaEntry = metaBySha.get(digest);
  if (metaEntry?.status === 'published' && metaEntry.source === 'github-issue' && /^[a-f0-9]{64}$/.test(digest)) {
    const work = worksBySha.get(digest);
    if (validWork(work, digest)) {
      let online = false;
      try {
        online = Boolean(await checkPage(`${SITE}/works/${work.slug}.html`));
      } catch (error) {
        log(`作品页检查失败：${error.message}`);
      }
      if (online) return { kind: 'published', digest, slug: work.slug };
    }
  }
  const rejected = rejectionOf(item);
  if (rejected) return { kind: 'rejected', ...rejected };
  return { kind: 'pending' };
}

function notifierAdapter(notify) {
  if (!notify) return null;
  if (typeof notify === 'function') return { send: notify };
  if (typeof notify.send === 'function') return notify;
  throw new Error('notify 必须是函数或带 send 的对象');
}

export async function reconcile({
  meta,
  works,
  request,
  checkPage,
  fetchItems,
  notify,
  now = Date.now,
  log = console.error,
}) {
  if (typeof request !== 'function') throw new Error('缺少 GitHub 请求器');
  if (typeof fetchItems !== 'function') throw new Error('缺少投稿队列读取器');
  const items = await fetchItems();
  if (!Array.isArray(items)) throw new Error('投稿队列返回格式错误');
  const issues = await request(`/repos/${REPO}/issues?state=open&labels=sticker-submission&per_page=100`);
  if (!Array.isArray(issues)) throw new Error('GitHub Issue 列表格式错误');

  const metaBySha = new Map(meta.map((entry) => [entry?.sha256, entry]));
  const worksBySha = new Map(works.map((entry) => [entry?.sha256, entry]));
  const notifier = notifierAdapter(notify);
  const candidates = issues
    .filter((issue) => !issue.pull_request && issue.state === 'open' && issue.labels?.some((label) => label.name === 'sticker-submission'))
    .sort((a, b) => Number(a.number) - Number(b.number));
  const summary = { candidates: candidates.length, commented: 0, closed: 0, skipped: 0, rejected: 0, failed: [] };

  for (const issue of candidates) {
    const number = Number(issue.number);
    try {
      if (!Number.isSafeInteger(number) || number < 1) throw new Error('Issue 编号无效');
      const urls = attachmentUrls(issue.body);
      let rejected = [];
      if (urls.length === 0) {
        const createdAt = Date.parse(String(issue.created_at || issue.createdAt || ''));
        if (!Number.isFinite(createdAt) || now() - createdAt <= HOUR_MS) {
          summary.skipped++;
          continue;
        }
        rejected = [{ position: null, label: '系统检查', reason: '未检测到图片附件（可能上传失败），请重新发起投稿并确认图片上传完成。' }];
      }

      const published = [];
      let pending = false;
      if (urls.length > 0) {
        for (const [index, url] of urls.entries()) {
          const item = matchingItem(items, number, url);
          const decision = await evaluateAttachment({
            item,
            metaBySha,
            worksBySha,
            checkPage: typeof checkPage === 'function' ? checkPage : async () => false,
            log,
          });
          if (decision.kind === 'pending') {
            pending = true;
            break;
          }
          if (decision.kind === 'published') published.push(decision);
          if (decision.kind === 'rejected') rejected.push({ position: index + 1, label: decision.label, reason: decision.reason });
        }
      }
      if (pending) {
        summary.skipped++;
        continue;
      }

      const comments = await request(`/repos/${REPO}/issues/${number}/comments?per_page=100`);
      if (!Array.isArray(comments) || comments.length >= 100) throw new Error('评论列表无法完整核验，留待重试');
      const alreadyCommented = comments.some((comment) => comment.user?.login === 'lmy414' && comment.body?.includes(MARKER));
      if (!alreadyCommented) {
        await request(`/repos/${REPO}/issues/${number}/comments`, {
          method: 'POST',
          body: { body: commentForResults(published, rejected) },
        });
        summary.commented++;
      }
      if (issue.state === 'open') {
        await request(`/repos/${REPO}/issues/${number}`, {
          method: 'PATCH',
          body: { state: 'closed', state_reason: published.length ? 'completed' : 'not_planned' },
        });
        summary.closed++;
        if (notifier) {
          const issueUrl = String(issue.html_url || `https://github.com/${REPO}/issues/${number}`);
          try {
            await notifier.send(`🐙 GitHub Issue #${number} 已回复并关闭｜收录 ${published.length}｜未通过 ${rejected.length}\n${issueUrl}`);
          } catch (error) {
            log(`Issue #${number} 飞书通知失败：${error.message}`);
          }
        }
      }
      summary.rejected += rejected.length;
    } catch (error) {
      summary.failed.push({ issue: number, error: error.message });
      log(`Issue #${number} 对账失败：${error.message}`);
    }
  }
  return summary;
}

export async function fetchQueueItems({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = String(env.SUBMISSION_ADMIN_TOKEN || '');
  if (!token) throw new Error('必须指定 SUBMISSION_ADMIN_TOKEN');
  const base = String(env.SUBMISSION_ADMIN_API_URL || DEFAULT_ADMIN_API_URL).replace(/\/+$/, '');
  const url = `${base}/api/v1/items?source=github-issue&limit=1000`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: timeoutSignal(20000),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!response.ok) {
    const detail = data && typeof data === 'object' ? (data.error || data.message || '') : '';
    throw new Error(`投稿队列 GET HTTP ${response.status}${detail ? `：${detail}` : ''}`);
  }
  if (!Array.isArray(data?.items)) throw new Error('投稿队列响应缺少 items');
  return data.items;
}

export function createGithubRequest(token, fetchImpl = globalThis.fetch) {
  return async function request(route, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${API}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dafeiyu-issue-reconcile',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: timeoutSignal(20000),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${route.split('?')[0]} HTTP ${response.status}`);
    return response.json();
  };
}

function validateReplyRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求必须是 JSON 对象');
  if (!['issue-reply/1', 'issue-reply/2'].includes(value.schema)) throw new Error('schema 必须是 issue-reply/1 或 issue-reply/2');
  if (value.schema === 'issue-reply/2' && (!/^github-rights-[1-9][0-9]*$/.test(value.requestId || '') ||
    value.requestId !== `github-rights-${value.issue}` || !value.expected || !/^[a-zA-Z0-9_-]+$/.test(value.expected.slug || '') ||
    !['published', 'removed'].includes(value.expected.status) || !/^[a-f0-9]{64}$/.test(value.issueHash || ''))) throw new Error('署名删除回复的验证条件非法');
  if (!Number.isSafeInteger(value.issue) || value.issue < 1) throw new Error('issue 必须是正整数');
  if (typeof value.body !== 'string' || value.body.trim() === '') throw new Error('body 不能为空');
  if ([...value.body].length > 5000) throw new Error('body 超过 5000 字');
  if (typeof value.close !== 'boolean') throw new Error('close 必须是布尔值');
  if (value.stateReason !== 'completed' && value.stateReason !== 'not_planned') {
    throw new Error('stateReason 必须是 completed 或 not_planned');
  }
}

async function uniqueDestination(directory, fileName) {
  const parsed = path.parse(fileName);
  for (let index = 0; ; index += 1) {
    const suffix = index === 0 ? '' : `-${index}`;
    const candidate = path.join(directory, `${parsed.name}${suffix}${parsed.ext}`);
    if (!(await fs.stat(candidate).catch(() => null))) return candidate;
  }
}

async function moveReplyFile(file, directory, subdirectory) {
  const targetDir = path.join(directory, subdirectory);
  await fs.mkdir(targetDir, { recursive: true });
  const target = await uniqueDestination(targetDir, path.basename(file));
  await fs.rename(file, target);
  return target;
}

async function failReplyFile(file, directory, error) {
  const target = await moveReplyFile(file, directory, 'failed');
  await fs.writeFile(`${target}.error`, `${error.message}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function processReplies({ dir, request, notify, log = console.error, env = process.env, verifyRights = verifyRightsPublication, acknowledge = acknowledgeRightsReply } = {}) {
  if (typeof request !== 'function') throw new Error('缺少 GitHub 请求器');
  const directory = dir || String(env.ADMIN_ISSUE_REPLY_DIR || DEFAULT_REPLY_DIR);
  const names = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  const notifier = notifierAdapter(notify);
  const summary = { total: names.length, replied: 0, closed: 0, invalid: 0, failed: [] };

  for (const name of names) {
    const file = path.join(directory, name);
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(file, 'utf8'));
      validateReplyRequest(payload);
    } catch (error) {
      await failReplyFile(file, directory, error);
      summary.invalid++;
      log(`Issue 回复请求 ${name} 校验失败：${error.message}`);
      continue;
    }


    try {
      const issue = await request(`/repos/${REPO}/issues/${payload.issue}`);
      const labels = Array.isArray(issue.labels) ? issue.labels : [];
      if (payload.schema === 'issue-reply/2') {
        if (issue.pull_request || !labels.some(label => label.name === 'takedown') || /^\[(?:bug|feature|投稿)\]/i.test(issue.title || '')) throw new Error('目标不是有效的署名删除申请');
        const comments = await rightsComments(request, payload.issue);
        if (rightsIssueHash(rightsIssueSnapshot(issue, comments)) !== payload.issueHash) throw new Error('申请原文或评论已修改，需要重新核验');
        await verifyRights(payload);
        const marker = `<!-- dafeiyu-rights:${payload.requestId} -->`;
        let comment = comments.find(c => c.user?.login === 'lmy414' && c.body?.includes(marker));
        if (!comment) comment = await request(`/repos/${REPO}/issues/${payload.issue}/comments`, { method: 'POST', body: { body: `${payload.body}\n\n${marker}` } });
        if (issue.state !== 'closed') await request(`/repos/${REPO}/issues/${payload.issue}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
        await acknowledge(payload, comment.html_url, env);
        summary.closed++;
      } else {
      if (issue.pull_request || !labels.some((label) => label.name === 'sticker-submission')) {
        throw new Error('目标 Issue 不带 sticker-submission 标签');
      }
      await request(`/repos/${REPO}/issues/${payload.issue}/comments`, {
        method: 'POST',
        body: { body: `${payload.body.trimEnd()}\n\n${MARKER}` },
      });
      if (payload.close) {
        await request(`/repos/${REPO}/issues/${payload.issue}`, {
          method: 'PATCH',
          body: { state: 'closed', state_reason: payload.stateReason },
        });
        summary.closed++;
      }
      }
    } catch (error) {
      if (error.message === '目标 Issue 不带 sticker-submission 标签') {
        await failReplyFile(file, directory, error);
        summary.invalid++;
        log(`Issue 回复请求 ${name} 校验失败：${error.message}`);
      } else {
        summary.failed.push({ file: name, error: error.message });
        log(`Issue 回复请求 ${name} 执行失败：${error.message}`);
        // Rights sync retries from the database every five minutes, avoiding a path-unit busy loop.
        if (payload.schema === 'issue-reply/2') await moveReplyFile(file, directory, 'retry');
        if (payload.schema === 'issue-reply/2' && error.message === '申请原文或评论已修改，需要重新核验') {
          await reportRightsConflict(payload, error.message, env).catch(e => log(e.message));
        }
      }
      continue;
    }

    try {
      await moveReplyFile(file, directory, 'done');
    } catch (error) {
      log(`Issue 回复请求 ${name} 已完成，但移入 done 失败：${error.message}`);
    }
    summary.replied++;
    if (notifier) {
      try {
        await notifier.send(`✍️ 已在后台回复 GitHub Issue #${payload.issue}（${payload.close ? '已关闭' : '未关闭'}）`);
      } catch (error) {
        log(`Issue #${payload.issue} 飞书通知失败：${error.message}`);
      }
    }
  }
  return summary;
}

function parseArgs(argv = []) {
  const args = { replies: null, repliesMode: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--replies') {
      args.repliesMode = true;
      const value = argv[index + 1];
      if (value && !value.startsWith('-')) {
        args.replies = value;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--replies=')) {
      args.repliesMode = true;
      args.replies = arg.slice('--replies='.length);
      if (!args.replies) throw new Error('--replies 需要目录');
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    throw new Error(`无法识别的参数：${arg}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const env = deps.env || process.env;
  const log = deps.log || console.error;
  if (args.help) {
    process.stdout.write('用法：node ops/issue-reconcile.mjs [--replies <dir>]\n');
    return 0;
  }
  if (args.repliesMode) {
    const replyDir = args.replies || String(env.ADMIN_ISSUE_REPLY_DIR || DEFAULT_REPLY_DIR);
    const request = deps.request || createGithubRequest(deps.githubToken || tokenFromGh(), deps.fetchImpl);
    const notify = deps.notify === undefined ? (await import('../server/notify.mjs')).createNotifier() : deps.notify;
    const result = await processReplies({ dir: replyDir, request, notify, log, env });
    log(JSON.stringify(result));
    return result.invalid || result.failed.length ? 1 : 0;
  }

  const fileNames = deps.meta ? [] : await fs.readdir(META_DIR);
  const meta = deps.meta || await Promise.all(fileNames.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .map(async (name) => JSON.parse(await fs.readFile(path.join(META_DIR, name), 'utf8'))));
  const works = deps.works || JSON.parse(await fs.readFile(WORKS_FILE, 'utf8'));
  if (!Array.isArray(meta) || !Array.isArray(works)) throw new Error('作品清单格式错误');
  const request = deps.request || createGithubRequest(deps.githubToken || tokenFromGh(), deps.fetchImpl);
  const fetchItems = deps.fetchItems || (() => fetchQueueItems({ env, fetchImpl: deps.fetchImpl }));
  const notify = deps.notify === undefined ? (await import('../server/notify.mjs')).createNotifier() : deps.notify;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const checkPage = deps.checkPage || (async (url) => (await fetchImpl(url, { method: 'HEAD', signal: timeoutSignal(15000) })).ok);
  const result = await reconcile({ meta, works, request, checkPage, fetchItems, notify, now: deps.now, log });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = Number.isInteger(code) ? code : 0; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
