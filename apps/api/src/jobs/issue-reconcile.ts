import { and, eq, or, sql } from 'drizzle-orm';
import { Unzip, UnzipInflate } from 'fflate';
import { isDeepStrictEqual } from 'node:util';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { submissions, takedownRequests, works } from '../db/schema.js';
import { createCloudflare } from '../services/cloudflare.js';
import { createFeishu } from '../services/feishu.js';
import { createPublisher } from '../services/publish.js';
import { createR2 } from '../services/r2.js';
import { safeUrl } from '../services/work-data.js';
import type { HermesContext } from '../routes/hermes/context.js';
import { fetchAttachment, stageSubmission } from '../routes/hermes/intake.js';
import { finalizeRemoval, importRightsIssues } from '../routes/hermes/request.js';
import { imageFormat, object, sha256, text } from '../routes/hermes/protocol.js';
import type { Wire } from '../routes/hermes/protocol.js';
import { githubClient, isRightsIssue, issueUrl, labeled, ownerLogin, readRightsIssue, repo, rightsHash, rightsMarker, submissionMarker, validIssueNumber } from './github.js';
import { runCli } from './runtime.js';

const maxImage = 16 * 1024 * 1024;
const maxArchive = 100 * 1024 * 1024;
const links = [
  /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+/g,
  /https:\/\/(?:private-)?user-images\.githubusercontent\.com\/[^\s)"'<>\]]+/g,
  /https:\/\/github\.com\/user-attachments\/files\/[1-9][0-9]*\/[^\s)"'<>\]]+/g,
];

function assetId(url: string) {
  const asset = url.match(/\/user-attachments\/assets\/([0-9a-fA-F-]+)/)?.[1];
  const file = url.match(/\/user-attachments\/files\/([1-9][0-9]*)\//)?.[1];
  return asset || (file ? `file-${file}` : url.match(/user-images\.githubusercontent\.com\/\d+\/([^/]+)\//)?.[1] || url);
}

function redactedUrl(value: string) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.href;
}

function allowedAttachment(url: URL) {
  if (url.hostname === 'github.com') return /^\/user-attachments\/(?:assets\/[0-9a-f-]+|files\/[1-9]\d*\/[^/]+)$/i.test(url.pathname);
  if (url.hostname === 'objects.githubusercontent.com') return /^\/github-production-repository-file-[a-z0-9-]+\/\d+\/\d+$/.test(url.pathname);
  return ['user-images.githubusercontent.com', 'private-user-images.githubusercontent.com'].includes(url.hostname) || /^github-production-user-asset-[a-z0-9-]+\.s3\.amazonaws\.com$/.test(url.hostname);
}

function imagesInZip(bytes: Buffer) {
  const output: { name: string; bytes: Buffer }[] = [];
  let total = 0;
  let files = 0;
  const unzip = new Unzip(file => {
    if (++files > 500) throw new Error('ZIP 文件数超过上限');
    if (file.name.endsWith('/') || /(?:^|\/)(?:__MACOSX|\.[^/]*)/.test(file.name)) return;
    if (!/\.(?:gif|png|jpe?g|webp)$/i.test(file.name)) return;
    if ((file.originalSize ?? 0) > maxImage) throw new Error('ZIP 图片超过大小限制');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const entry = { name: file.name.split('/').at(-1) || '', bytes: Buffer.alloc(0) as Buffer };
    output.push(entry);
    if (output.length > 100) throw new Error('ZIP 图片数超过 100');
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      total += chunk.length;
      if (size > maxImage || total > maxArchive) throw new Error('ZIP 解包超过大小上限');
      chunks.push(chunk);
      if (final) {
        entry.bytes = Buffer.concat(chunks);
        if (!imageFormat(entry.bytes)) throw new Error('ZIP 图片格式非法');
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 32768) unzip.push(bytes.subarray(offset, offset + 32768), offset + 32768 >= bytes.length);
  if (!output.length || output.some(item => !item.bytes.length)) throw new Error('ZIP 内没有完整图片');
  return output;
}

function parseFields(issue: Wire) {
  const sections = new Map<string, string>();
  for (const section of String(issue.body || '').replaceAll('\r\n', '\n').split(/^###[ \t]+/m).slice(1)) {
    const split = section.indexOf('\n');
    if (split < 0) continue;
    sections.set(section.slice(0, split).trim(), section.slice(split + 1).trim());
  }
  const field = (...names: string[]) => {
    const value = names.map(name => sections.get(name)).find(Boolean);
    return /^_No response_$/i.test(value || '') ? '' : value || '';
  };
  const rawCharacter = field('角色');
  const characterIds = [...new Set(rawCharacter.split(/(?<=）)\s*[,，\n]\s*/).map(label => label.match(/^[^（）\r\n]+（([a-z0-9_-]+)(?:\s*·\s*别名 [^（）\r\n]+)?）$/)?.[1]).filter(Boolean))];
  const category = field('作品类型');
  const credit = field('是否署名');
  return { name: field('图片名称').slice(0, 200), description: field('一句话说明（可选）').slice(0, 2000),
    character: characterIds[0] || rawCharacter, ...(characterIds.length && { characterIds }),
    ...(category && { categoryId: category.match(/（([a-z0-9_-]+)）/)?.[1] || category }),
    tags: field('Tag').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').split(/[\s,，、]+/).filter(tag => tag && !tag.startsWith('http')).slice(0, 20),
    ...(credit && { credit: /匿名/.test(credit) ? 'anonymous' : 'named', creditName: field('署名名字（选择署名时必填）'), creditUrl: field('个人主页链接（可选）') }),
  };
}

type Submission = typeof submissions.$inferSelect;
function matchingAttachments(items: Submission[], parent: string) {
  const direct = items.find(row => row.sourceIds.includes(parent));
  if (direct) return [direct];
  const members = new Map<number, Submission>();
  let count = 0;
  let digest = '';
  for (const row of items) for (const source of row.sourceIds) {
    if (!source.startsWith(`${parent}:zip:`)) continue;
    const match = source.slice(parent.length).match(/^:zip:([a-f0-9]{64}):([1-9]\d*):(\d+)$/);
    if (!match) continue;
    const index = Number(match[3]);
    const size = Number(match[2]);
    if (size > 100 || index >= size) continue;
    if (digest && (digest !== match[1] || count !== size) || members.has(index) && members.get(index)?.id !== row.id)
      throw new Error('ZIP 附件版本出现冲突');
    digest = match[1]!;
    count = size;
    members.set(index, row);
  }
  return count && members.size === count ? [...members].sort(([a], [b]) => a - b).map(([, row]) => row) : [];
}

async function reply(client: ReturnType<typeof githubClient>, issue: Wire, body: string, marker: string, comments: Wire[], botLogin: string, state: 'completed' | 'not_planned') {
  let sent = comments.find(comment => comment.user?.login === botLogin && String(comment.body).includes(marker) &&
    !(marker === submissionMarker && body.includes('作品页面：') && String(comment.body).includes('未检测到图片附件')));
  if (!sent) sent = await client.write(`issues/${issue.number}/comments`, 'POST', { body: `${body}\n\n${marker}` });
  if (issue.state !== 'closed') await client.write(`issues/${issue.number}`, 'PATCH', { state: 'closed', state_reason: state });
  return sent.html_url;
}

export async function reconcileIssues(ctx: HermesContext, options: { readToken?: string; writeToken?: string; botLogin?: string; fetcher?: typeof fetch } = {}) {
  const read = githubClient(options.readToken, options.fetcher);
  const write = githubClient(options.writeToken, options.fetcher);
  const botLogin = options.botLogin || ownerLogin;
  const { db, services, config } = ctx;
  const [issues, rights] = await Promise.all([read.list('sticker-submission'), importRightsIssues(db, read)]);
  const stats = { rightsImported: rights.length, submissionsImported: 0, closed: 0, failures: [] as { issue: number; error: string }[] };
  const checkPage = async (slug: string, removed = false) => {
    const response = await (options.fetcher || fetch)(`${config.SITE_PUBLIC_URL}/works/${encodeURIComponent(slug)}.html`, {
      method: 'HEAD', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    return removed ? [404, 410].includes(response.status) : response.ok;
  };
  const verifyRights = async (work: typeof works.$inferSelect) => {
    const removed = work.status === 'removed';
    const fetcher = options.fetcher || fetch;
    const get = (path: string) => fetcher(new URL(path, config.SITE_PUBLIC_URL), { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const open = await get(`/open-api/v1/works/${encodeURIComponent(work.id)}.json`);
    if (removed && ![404, 410].includes(open.status)) return false;
    if (!removed) {
      if (!open.ok) return false;
      const current = (await open.json() as Wire).work;
      if (!current || current.slug !== work.slug || (work.origin.author && current.author?.name !== work.origin.author) ||
        (work.origin.sourceUrl && current.source?.url !== safeUrl(work.origin.sourceUrl)) || (work.license.note && current.license?.note !== work.license.note)) return false;
    }
    for (const prefix of ['', '/zh-hant', '/en', '/ja']) {
      const page = await get(`${prefix}/works/${encodeURIComponent(work.slug)}.html`);
      if (removed || !page.ok) {
        await page.body?.cancel();
        if (!(removed && [404, 410].includes(page.status))) return false;
        continue;
      }
      const html = (await page.text()).replaceAll('&quot;', '"').replace(/&#39;|&#x27;/g, "'").replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
      if (work.origin.author && !html.includes(String(work.origin.author))) return false;
      const translated = (work.i18n as Wire)[prefix.slice(1)]?.licenseNote;
      if (translated && !html.includes(translated)) return false;
    }
    return true;
  };
  for (const issue of issues) {
    if (!validIssueNumber(issue.number) || issue.state !== 'open' || !labeled(issue, 'sticker-submission')) continue;
    try {
      const urls = [...new Set(links.flatMap(pattern => String(issue.body || '').match(pattern) || []))];
      if (urls.length > 100) throw new Error('Issue 附件数量超过 100');
      const published: string[] = [];
      const rejected: string[] = [];
      let pending = false;
      let index = 0;
      if (!urls.length) {
        const date = Date.parse(issue.created_at);
        if (!Number.isFinite(date) || Date.now() - date <= 3_600_000) continue;
        rejected.push('未检测到图片附件（可能上传失败），请重新发起投稿并确认图片上传完成。');
      }
      for (const url of urls) {
        const safeUrl = redactedUrl(url);
        const asset = assetId(safeUrl);
        const parent = `github:${repo}#${issue.number}:${asset}`;
        const load = () => db.select().from(submissions).where(sql`exists (select 1 from unnest(${submissions.sourceIds}) id where id = ${parent} or left(id, ${parent.length + 5}) = ${`${parent}:zip:`})`);
        let checked = matchingAttachments(await load(), parent);
        if (!checked.length) {
          const zip = /\.zip$/i.test(new URL(url).pathname);
          const bytes = await fetchAttachment(url, allowedAttachment, zip ? maxArchive : maxImage, 20_000,
            { 'User-Agent': 'dafeiyu-issue-reconcile' }, options.fetcher);
          const archive = zip || bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'));
          const entries = archive ? imagesInZip(bytes) : [{ name: '', bytes }];
          const digest = archive ? sha256(bytes) : '';
          const fields = parseFields(issue);
          const now = new Date();
          for (const [i, item] of entries.entries()) {
            const sourceId = archive ? `${parent}:zip:${digest}:${entries.length}:${i}` : parent;
            const result = await db.transaction(tx => stageSubmission(tx, ctx, { source: 'github-issue', sourceId, bytes: item.bytes, fields,
              origin: { type: 'github-issue', issue: issue.number, issueTitle: issue.title, issueUrl: issueUrl(issue.number),
                submitter: issue.user?.login || '', assetId: archive ? `${asset}:zip:${digest}:${entries.length}:${i}` : asset, assetUrl: safeUrl,
                ...(archive && { archive: { assetId: asset, sha256: digest, name: new URL(safeUrl).pathname.split('/').at(-1), member: item.name, index: i, count: entries.length } }),
              }, now,
            }));
            stats.submissionsImported += Number(result.created);
          }
          checked = matchingAttachments(await load(), parent);
        }
        if (!checked.length) { pending = true; continue; }
        for (const item of checked) {
          index++;
          if (item.state === 'published') {
            const [work] = await db.select().from(works).where(and(eq(works.sha256, item.sha256), eq(works.status, 'published')));
            if (work && await checkPage(work.slug)) published.push(`${config.SITE_PUBLIC_URL}/works/${work.slug}.html`);
            else pending = true;
          } else if (['rejected', 'auto_rejected'].includes(item.state)) {
            const reason = item.state === 'auto_rejected' ? item.review.reason : item.stateHistory.findLast(row => row.to === 'rejected')?.reason;
            rejected.push(`第 ${index} 张未通过：${text(reason) || '未通过审核'}`);
          } else pending = true;
        }
      }
      if (pending || !options.writeToken) continue;
      const message = [published.length && `已收录到「蓝色大肥鱼」，谢谢投稿！\n\n${[...new Set(published)].map(url => `- 作品页面：${url}`).join('\n')}`, ...rejected].filter(Boolean).join('\n\n');
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`issue:${issue.number}`}, 0))`);
        const latest = await read.read(`issues/${issue.number}`);
        if (latest.state !== 'open' || !labeled(latest, 'sticker-submission') || latest.body !== issue.body) return;
        const known = await read.pages(`issues/${issue.number}/comments`);
        await reply(write, latest, message, submissionMarker, known, botLogin, published.length ? 'completed' : 'not_planned');
        await services.feishu.enqueue({ eventType: 'github.submission.closed', dedupeKey: String(issue.number), text: `GitHub 投稿 #${issue.number} 已回复并关闭｜收录 ${published.length}｜未通过 ${rejected.length}\n${issueUrl(issue.number)}` }, tx);
        stats.closed++;
      });
    } catch (error) { stats.failures.push({ issue: issue.number, error: (error as Error).message }); }
  }
  const requests = await db.select().from(takedownRequests).where(or(
    eq(takedownRequests.status, 'approved'),
    and(eq(takedownRequests.status, 'rejected'), sql`${takedownRequests.agentProgress}->>'stage' = 'reply_queued'`),
  ));
  for (const record of requests) {
    const number = Number(record.issueData.number);
    if (!validIssueNumber(number)) continue;
    try {
      const updated = record.status === 'approved' ? await finalizeRemoval(ctx, record) : record;
      if (!options.writeToken) continue;
      await db.transaction(async tx => {
        const [current] = await tx.select().from(takedownRequests).where(and(eq(takedownRequests.id, updated.id), eq(takedownRequests.status, record.status))).for('update');
        if (!current || current.agentProgress.stage !== 'reply_queued') return;
        const p = current.agentProgress;
        const rejected = current.status === 'rejected';
        let message = text(current.decisionNote) || '经人工复核，当前申请未通过。';
        if (!rejected) {
          const expected = p.expected;
          if (!object(expected) || !current.workId) return;
          const [work] = await tx.select().from(works).where(eq(works.id, current.workId)).for('update');
          if (!work || expected.status !== work.status || !isDeepStrictEqual(expected.origin, work.origin) || !isDeepStrictEqual(expected.license, work.license) || !await verifyRights(work)) return;
          message = work.status === 'removed' ? '已将该作品从公开站下架，原始投稿和处理记录保留。' : '已按申请原文更新作品的署名、来源或授权备注。';
        }
        const live = await readRightsIssue(read, number, botLogin);
        if (!isRightsIssue(live.issue, false)) return;
        if (rightsHash(live.snapshot) !== rightsHash(current.issueData)) {
          await tx.update(takedownRequests).set({ status: 'investigating', decisionNote: '回复前申请原文发生变化，请人工复核新诉求。', agentProgress: { ...p, stage: 'manual' }, updatedAt: new Date() }).where(eq(takedownRequests.id, current.id));
          return;
        }
        const replyUrl = await reply(write, live.issue, message, rightsMarker(current.id), live.comments, botLogin, rejected ? 'not_planned' : 'completed');
        const processedAt = new Date();
        await tx.update(takedownRequests).set({ status: rejected ? 'rejected' : 'completed', processedAt, agentProgress: { ...p, stage: 'completed', replyUrl }, updatedAt: processedAt }).where(eq(takedownRequests.id, current.id));
        await services.feishu.enqueue({ eventType: 'github.rights.closed', dedupeKey: current.id, text: `GitHub 维权申请 #${number} 已回复并关闭\n${issueUrl(number)}` }, tx);
        stats.closed++;
      });
    } catch (error) { stats.failures.push({ issue: number, error: (error as Error).message }); }
  }
  return stats;
}

runCli(import.meta.url, async () => {
  const config = loadConfig();
  const connection = createDb(config.DATABASE_URL);
  const deps = { db: connection.db, config, r2: createR2(config), cloudflare: createCloudflare(config), feishu: createFeishu(connection.db, config) };
  try {
    const stats = await reconcileIssues({ db: connection.db, config, services: { ...deps, publish: createPublisher(deps) } }, {
      readToken: process.env.SUBMISSION_GITHUB_TOKEN || process.env.GITHUB_TOKEN, writeToken: process.env.GITHUB_WRITE_TOKEN || process.env.GITHUB_TOKEN, botLogin: process.env.GITHUB_BOT_LOGIN,
    });
    if (stats.failures.length) process.exitCode = 1;
    return stats;
  } finally { await connection.close(); }
});
