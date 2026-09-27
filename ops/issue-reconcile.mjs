#!/usr/bin/env node
// 发布后对账：只处理私有中转区已标为 published 且线上确实可访问的 GitHub Issue。
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REPO = 'lmy414/ai-girl-stickers';
export const SITE = 'https://xn--pssy23gqgbz2d718b.com';
export const MARKER = '<!-- dafeiyu-published -->';
const META_DIR = process.env.INTAKE_ROOT ? path.join(process.env.INTAKE_ROOT, 'meta') : '/srv/apps/dafeiyu/intake/meta';
const WORKS_FILE = process.env.PUBLISH_SITE_DIR ? path.join(process.env.PUBLISH_SITE_DIR, 'data', 'works.json') : '/srv/apps/dafeiyu/source/data/works.json';
const API = 'https://api.github.com';
const ISSUE_URL = /^https:\/\/github\.com\/lmy414\/ai-girl-stickers\/issues\/(\d+)$/;
const ID_PATTERN = /^sticker_[0-9a-f]{24}$/;

export function publishedIssueGroups(meta, works) {
  const bySha = new Map(works.filter(w => w?.status === 'published' && typeof w.sha256 === 'string')
    .map(w => [w.sha256, w]));
  const groups = new Map();
  for (const m of meta) {
    if (m?.status !== 'published' || m.source !== 'github-issue') continue;
    const issueNo = Number(m.origin?.issue);
    const url = String(m.origin?.issueUrl || '');
    if (!Number.isSafeInteger(issueNo) || issueNo < 1 || url !== `https://github.com/${REPO}/issues/${issueNo}`) continue;
    if (!ISSUE_URL.test(url) || !/^[a-f0-9]{64}$/.test(String(m.sha256 || ''))) continue;
    const work = bySha.get(m.sha256);
    if (!work || work.id !== `sticker_${m.sha256.slice(0, 24)}` || !ID_PATTERN.test(work.id) || !/^[a-z0-9-]+$/.test(String(work.slug || ''))) continue;
    const group = groups.get(issueNo) || [];
    group.push({ digest: m.sha256, slug: work.slug });
    groups.set(issueNo, group);
  }
  return groups;
}

export function commentFor(works) {
  const links = [...new Set(works.map(w => `${SITE}/works/${w.slug}.html`))];
  return `已收录到「蓝色大肥鱼」，谢谢投稿！\n\n${links.map(u => `- 作品页面：${u}`).join('\n')}\n\n${MARKER}`;
}

function tokenFromGh() {
  const token = execFileSync('/usr/bin/gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (!token) throw new Error('GitHub 授权不可用');
  return token;
}

export async function reconcile({ meta, works, request, checkPage, log = console.log }) {
  const byIssue = publishedIssueGroups(meta, works);
  const summary = { candidates: byIssue.size, commented: 0, closed: 0, skipped: 0, failed: [] };
  for (const [number, published] of [...byIssue.entries()].sort((a, b) => a[0] - b[0])) {
    try {
      const issue = await request(`/repos/${REPO}/issues/${number}`);
      if (issue.pull_request || !issue.labels?.some(label => label.name === 'sticker-submission')) { summary.skipped++; continue; }
      // 任一附件尚未发布都不能关闭整个 Issue。新增附件的 Issue 更新后保持待对账。
      const attachments = [...new Set((issue.body || '').match(/https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+/g) || [])];
      const recorded = new Set(meta.filter(m => m.source === 'github-issue' && Number(m.origin?.issue) === number && m.status === 'published')
        .map(m => m.origin?.assetUrl));
      if (!attachments.length || attachments.some(url => !recorded.has(url))) { summary.skipped++; continue; }
      if (issue.number !== number) throw new Error('GitHub Issue 编号不匹配');
      for (const work of published) {
        if (!(await checkPage(`${SITE}/works/${work.slug}.html`))) throw new Error('作品页尚未上线');
      }
      const comments = await request(`/repos/${REPO}/issues/${number}/comments?per_page=100`);
      if (!Array.isArray(comments) || comments.length >= 100) throw new Error('评论列表无法完整核验，留待重试');
      const alreadyCommented = comments.some(c => c.user?.login === 'lmy414' && c.body?.includes(MARKER));
      if (!alreadyCommented) {
        await request(`/repos/${REPO}/issues/${number}/comments`, { method: 'POST', body: { body: commentFor(published) } });
        summary.commented++;
      }
      if (issue.state === 'open') {
        await request(`/repos/${REPO}/issues/${number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
        summary.closed++;
      }
    } catch (error) {
      summary.failed.push({ issue: number, error: error.message });
      log(`Issue #${number} 对账失败：${error.message}`);
    }
  }
  return summary;
}

export async function main() {
  const fileNames = await fs.readdir(META_DIR);
  const meta = await Promise.all(fileNames.filter(name => /^[a-f0-9]{64}\.json$/.test(name))
    .map(async name => JSON.parse(await fs.readFile(path.join(META_DIR, name), 'utf8'))));
  const works = JSON.parse(await fs.readFile(WORKS_FILE, 'utf8'));
  if (!Array.isArray(works)) throw new Error('作品清单格式错误');
  const token = tokenFromGh();
  async function request(route, { method = 'GET', body } = {}) {
    const response = await fetch(`${API}${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dafeiyu-issue-reconcile', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${route.split('?')[0]} HTTP ${response.status}`);
    return response.json();
  }
  async function checkPage(url) {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    return response.ok;
  }
  const result = await reconcile({ meta, works, request, checkPage });
  console.log(JSON.stringify(result));
  if (result.failed.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
