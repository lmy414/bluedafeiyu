/* server/adapters/github.mjs —— GitHub Issue 附件入站适配器
 *
 * 只做一件事：把 `lmy414/ai-girl-stickers` 上带 `sticker-submission` 标签的
 * Issue 里的图片附件拉进统一投稿队列。边界：
 *
 *   1. **标签过滤**：查询带 labels=sticker-submission，返回结果再按标签名二次确认；
 *   2. **分页有限**：列表接口按 Link rel="next" 翻页，只跟 API 同源的下一页，
 *      并有 maxPages 上限；单 Issue 模式不翻页；
 *   3. **增量游标**：since 游标持久化到私有 storage state（`state/github-issues.json`），
 *      下次拉取自动带上；仓库 / 标签变了或游标损坏就退回全量，绝不跨仓串用；
 *   4. **失败退避**：429 / 5xx / 网络超时做有限退避重试（指数退避 + Retry-After，
 *      都受上限约束）；4xx（非 429）不重试；
 *   5. **单附件失败继续**：同一 Issue 里某个附件失败只记该条，其余附件照常处理；
 *   6. **域名白名单**：附件只允许 GitHub 附件域名，https-only，端口必须是默认端口；
 *   7. **跳转受限**：redirect 手动处理，每一跳都要重新过白名单，跳转次数有上限；
 *   8. **大小 / 超时受限**：流式读取带字节上限，AbortController 控制超时；
 *   9. **最小 token**：token 只发给「协议 https 且 host 与配置 apiBase 完全一致」的
 *      地址；附件请求永远不带 Authorization；
 *  10. **URL 脱敏**：写进 origin、结果和日志的地址先剥掉 jwt / token / signature 之类
 *      的敏感 query 与 fragment 参数（复用 intake core 的 redactUrl），但原始带签名
 *      地址仍用于实际下载；
 *  11. **幂等**：sourceId = github:<repo>#<issue>:<assetId>，重复拉取不重复下载；
 *  12. **只读**：只用 GET 读 Issue，绝不关闭 / 改写 Issue。
 *
 * 这里不判断图片是否合规、不写内容仓、不发布——那是 review 与人工的事。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  assetIdOf,
  characterIdFromLabel,
  extractAttachments,
  fieldsFromSections,
  parseIssueForm,
  redactUrl,
} from '../../tools/intake/core.mjs';

export const GITHUB_ATTACHMENT_HOSTS = Object.freeze([
  'github.com',
  'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com',
]);

/* 游标文件的结构版本与默认文件名。只落时间戳、仓库与计数，绝不含密钥。 */
export const GITHUB_STATE_SCHEMA = 'submission-server/github-pull/1';
export const GITHUB_STATE_FILE_NAME = 'github-issues.json';

/** 附件地址白名单：https、默认端口、且命中 GitHub 附件域名与路径。 */
export function isAllowedAttachmentUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.port !== '') return false;
  if (url.username || url.password) return false;
  if (url.hostname === 'github.com') return url.pathname.startsWith('/user-attachments/assets/');
  return GITHUB_ATTACHMENT_HOSTS.includes(url.hostname);
}

/**
 * 是否可以把 GitHub API token 发给这个地址。只认「协议 https + host（含端口）与配置
 * apiBase 完全一致 + 不带凭据」。apiBase 解析不出来、地址非法或 host 对不上，一律不发。
 */
export function isTrustedApiUrl(apiBase, value) {
  let base;
  try {
    base = new URL(String(apiBase));
  } catch {
    return false;
  }
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  return url.protocol === 'https:' && url.host === base.host;
}

/** 从 Link 头里挑出 rel="next" 的地址；没有就返回 null。 */
export function nextLinkOf(linkHeader) {
  if (!linkHeader) return null;
  for (const part of String(linkHeader).split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?([^";]+)"?/i);
    if (match && match[2].trim().toLowerCase() === 'next') return match[1].trim();
  }
  return null;
}

/** Retry-After 解析：秒数或 HTTP-date，非法返回 null。 */
function retryAfterMsOf(response) {
  const header = response && response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('retry-after')
    : null;
  if (header === null || header === undefined || header === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * 退避时长：优先尊重 Retry-After，否则指数退避；两者都被 retryMaxMs 封顶，
 * 保证「有限」，不会因为服务端给个大数字就睡死。
 */
export function backoffDelayMs(attempt, { retryBaseMs = 500, retryMaxMs = 8000, retryAfterMs = null } = {}) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.min(retryAfterMs, retryMaxMs);
  const exponential = retryBaseMs * (2 ** Math.max(0, attempt));
  return Math.min(exponential, retryMaxMs);
}

async function readCapped(response, maxBytes, url) {
  const safe = redactUrl(url);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error(`附件超过大小上限 ${maxBytes} 字节：${safe}`);
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`附件超过大小上限 ${maxBytes} 字节：${safe}`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`附件超过大小上限 ${maxBytes} 字节：${safe}`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

/**
 * 带大小、超时、跳转上限的下载。每一跳（含重定向目标）都过 allowUrl。
 * redirect 用 manual，绝不把请求交给底层自动跟到白名单外。
 */
export async function fetchWithLimits(fetchImpl, startUrl, {
  maxBytes,
  timeoutMs,
  maxRedirects = 3,
  headers = {},
  allowUrl = null,
} = {}) {
  let current = String(startUrl);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const safe = redactUrl(current);
    if (allowUrl && !allowUrl(current)) {
      throw new Error(`附件地址不在白名单，拒绝下载：${safe}`);
    }
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`附件下载超时：${safe}`));
      }, timeoutMs);
      timer.unref?.();
    });
    let response;
    try {
      response = await Promise.race([
        fetchImpl(current, { headers, redirect: 'manual', signal: controller.signal }),
        timeout,
      ]);
    } catch (error) {
      if (/超时|abort/i.test(String(error && error.message))) throw new Error(`附件下载超时：${safe}`);
      throw new Error(`附件下载失败：${error.message}：${safe}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`附件返回重定向但没有 Location：${safe}`);
      const next = new URL(location, current).toString();
      if (allowUrl && !allowUrl(next)) {
        throw new Error(`附件重定向到白名单外的地址，拒绝：${redactUrl(next)}`);
      }
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`附件下载失败 ${response.status}：${safe}`);
    return { buffer: await readCapped(response, maxBytes, current), finalUrl: current };
  }
  throw new Error(`附件重定向超过上限 ${maxRedirects} 次：${redactUrl(startUrl)}`);
}

export function createGithubAdapter(cfg, {
  queue,
  fetchImpl = globalThis.fetch,
  logger = console,
  stateFile = null,
  sleep = null,
} = {}) {
  const {
    repo, label, apiBase, token, timeoutMs, maxBytes, maxRedirects,
    perPage = 100, maxPages = 5, maxRetries = 3, retryBaseMs = 500, retryMaxMs = 8000,
  } = cfg.github;

  /* 游标只落到私有 storage state 目录；调用方可显式覆盖（测试 / doctor 用）。 */
  const stateDir = cfg.paths && cfg.paths.state ? cfg.paths.state : null;
  const resolvedStateFile = stateFile
    ? path.resolve(String(stateFile))
    : (stateDir ? path.join(stateDir, GITHUB_STATE_FILE_NAME) : null);

  const doSleep = typeof sleep === 'function'
    ? sleep
    : (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); });

  function apiHeaders(url) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'blue-fish-submission-server',
    };
    /* token 只发给协议 https 且 host 与配置 apiBase 完全一致的地址，别的地址（含附件域）绝不带 */
    if (token && isTrustedApiUrl(apiBase, url)) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function isRetryableStatus(status) {
    return status === 429 || status >= 500;
  }

  /**
   * 只读 API 请求（GET），带超时和有限退避重试。返回 { json, headers }。
   * 429 / 5xx / 网络错误 / 超时才重试；其余 4xx 立即抛错。
   */
  async function apiRequest(url) {
    const safeUrl = redactUrl(url);
    const attempts = Math.max(1, Number(maxRetries) + 1);
    let lastError = new Error(`GitHub 接口失败：${safeUrl}`);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`GitHub 接口超时：${safeUrl}`));
        }, timeoutMs);
        timer.unref?.();
      });
      let response = null;
      try {
        response = await Promise.race([
          fetchImpl(url, { method: 'GET', headers: apiHeaders(url), redirect: 'manual', signal: controller.signal }),
          timeout,
        ]);
      } catch (error) {
        lastError = /超时|abort/i.test(String(error && error.message))
          ? new Error(`GitHub 接口超时：${safeUrl}`)
          : new Error(`GitHub 接口请求失败：${error.message}：${safeUrl}`);
      } finally {
        clearTimeout(timer);
      }

      if (response) {
        if (response.status >= 300 && response.status < 400) {
          throw new Error(`GitHub 接口不允许重定向：${response.status}`);
        }
        if (!isRetryableStatus(response.status)) {
          if (!response.ok) throw new Error(`GitHub ${response.status} ${response.statusText}：${safeUrl}`);
          return { json: await response.json(), headers: response.headers };
        }
        lastError = new Error(`GitHub ${response.status} ${response.statusText}：${safeUrl}`);
        if (attempt < attempts - 1) {
          await doSleep(backoffDelayMs(attempt, { retryBaseMs, retryMaxMs, retryAfterMs: retryAfterMsOf(response) }));
          continue;
        }
        break;
      }
      if (attempt < attempts - 1) {
        await doSleep(backoffDelayMs(attempt, { retryBaseMs, retryMaxMs }));
        continue;
      }
      break;
    }
    throw lastError;
  }

  async function apiJson(url) {
    return (await apiRequest(url)).json;
  }

  /* ------------------------------------------------ 增量游标（私有 storage state） */

  async function readCursor() {
    if (!resolvedStateFile) return null;
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(resolvedStateFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') logger.warn?.(`GitHub 游标读取失败，本次退回全量：${error.message}`);
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.schema !== GITHUB_STATE_SCHEMA) return null;
    if (parsed.repo !== repo || parsed.label !== label) return null; // 换仓 / 换标签不得串用游标
    if (typeof parsed.since !== 'string' || !parsed.since.trim()) return null;
    return { since: parsed.since, lastPullAt: parsed.lastPullAt || null };
  }

  async function writeCursor(since, { lastIssue = null, count = 0 } = {}) {
    if (!resolvedStateFile) return null;
    const payload = {
      schema: GITHUB_STATE_SCHEMA,
      repo,
      label,
      since,
      lastPullAt: new Date().toISOString(),
      lastIssue,
      count,
    };
    const dir = path.dirname(resolvedStateFile);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = path.join(dir, `.${path.basename(resolvedStateFile)}.${process.pid}.${Date.now()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'w', 0o600);
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`);
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, resolvedStateFile);
      await fs.chmod(resolvedStateFile, 0o600).catch(() => {});
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return payload;
  }

  /* ------------------------------------------------ Issue -> 队列 */

  function labelsOf(entry) {
    return (entry.labels || []).map((entryLabel) => (typeof entryLabel === 'string' ? entryLabel : entryLabel && entryLabel.name)).filter(Boolean);
  }

  /* 一个 Issue 的所有附件：单个失败只记该条，其余继续。 */
  async function processIssue(entry) {
    const results = [];
    if (!labelsOf(entry).includes(label)) return results; // 二次确认标签

    const sections = parseIssueForm(entry.body);
    const fields = fieldsFromSections(sections);
    if (fields.character) fields.character = characterIdFromLabel(fields.character) || fields.character;

    for (const url of extractAttachments(entry.body)) {
      /* 落 origin / 结果 / 日志的一律是脱敏地址；带签名的原始地址只用于实际下载 */
      const safeUrl = redactUrl(url);
      const assetId = assetIdOf(safeUrl);
      const sourceId = `github:${repo}#${entry.number}:${assetId}`;
      const origin = {
        issue: entry.number,
        issueTitle: entry.title,
        issueUrl: redactUrl(entry.html_url),
        submitter: entry.user ? entry.user.login : '',
        assetId,
        assetUrl: safeUrl,
      };
      try {
        if (!isAllowedAttachmentUrl(url)) throw new Error(`附件地址不在白名单：${safeUrl}`);
        const existing = await queue.findBySourceId(sourceId);
        if (existing) {
          results.push({ issue: entry.number, url: safeUrl, status: 'duplicate_source', item: existing });
          continue;
        }
        const { buffer } = await fetchWithLimits(fetchImpl, url, {
          maxBytes,
          timeoutMs,
          maxRedirects,
          headers: { 'User-Agent': 'blue-fish-submission-server' }, // 附件不带 token
          allowUrl: isAllowedAttachmentUrl,
        });
        let name = '';
        try { name = decodeURIComponent(new URL(safeUrl).pathname.split('/').pop() || ''); } catch { name = ''; }
        const result = await queue.enqueue({
          source: 'github-issue',
          sourceId,
          buffer,
          fields,
          origin,
          ext: name && name.includes('.') ? `.${name.split('.').pop()}` : '',
        });
        results.push({
          issue: entry.number,
          url: safeUrl,
          status: result.status === 'created' ? 'staged' : result.status,
          item: result.item,
        });
      } catch (error) {
        logger.error?.(`GitHub 附件入站失败 #${entry.number}：${error.message}`);
        results.push({ issue: entry.number, url: safeUrl, status: 'failed', error: error.message });
      }
    }
    return results;
  }

  function issueListUrl({ state, since, per }) {
    const query = [
      `state=${encodeURIComponent(state)}`,
      `labels=${encodeURIComponent(label)}`,
      `per_page=${per}`,
      'sort=updated',
      'direction=asc',
    ];
    if (since) query.push(`since=${encodeURIComponent(since)}`);
    return `${apiBase}/repos/${repo}/issues?${query.join('&')}`;
  }

  /**
   * 拉取 Issue 附件。
   *   issue          指定单个 Issue 编号（单条模式，不翻页、不动游标）
   *   state          Issue 状态，默认 open
   *   limit          每页条数，默认 cfg.github.perPage（受 100 上限约束）
   *   since          增量起点：undefined=用已存游标；null/''=强制全量；字符串=显式指定
   *   maxPages       翻页上限，默认 cfg.github.maxPages
   *   persist        是否在成功后写游标，默认 true
   */
  async function pullIssues({ issue = null, state = 'open', limit = perPage, since, maxPages: pageCap = maxPages, persist = true } = {}) {
    if (issue !== null && issue !== undefined) {
      const entries = [await apiJson(`${apiBase}/repos/${repo}/issues/${encodeURIComponent(issue)}`)];
      const out = [];
      for (const entry of entries) out.push(...await processIssue(entry));
      return out;
    }

    const cursor = since === undefined ? await readCursor() : null;
    /* since 显式给了就用它（null/'' 表示强制全量）；没给就用游标；没有游标就全量。 */
    const effectiveSince = since === undefined ? (cursor ? cursor.since : null) : (since ? String(since) : null);

    const per = Math.max(1, Math.min(100, Number(limit) || perPage));
    const cappedPages = Math.max(1, Math.floor(Number(pageCap) || maxPages));
    const startedAt = new Date().toISOString();

    const results = [];
    const seen = new Set();
    let maxUpdated = null;
    let issueCount = 0;
    let lastNumber = null;
    let url = issueListUrl({ state, since: effectiveSince, per });

    for (let page = 0; page < cappedPages; page += 1) {
      const { json, headers } = await apiRequest(url);
      const list = Array.isArray(json) ? json.filter((entry) => !entry.pull_request) : [];
      for (const entry of list) {
        issueCount += 1;
        if (typeof entry.updated_at === 'string' && (!maxUpdated || entry.updated_at > maxUpdated)) maxUpdated = entry.updated_at;
        if (Number.isFinite(Number(entry.number))) lastNumber = Number(entry.number);
        results.push(...await processIssue(entry));
      }

      const next = nextLinkOf(headers.get('link'));
      if (!next) break;
      if (!isTrustedApiUrl(apiBase, next)) {
        logger.warn?.(`忽略不在 API 同源的下一页，停止翻页：${redactUrl(next)}`);
        break;
      }
      if (seen.has(next)) break; // 防环
      seen.add(next);
      url = next;
    }

    /* 只有整轮翻页没有半途抛错才写游标；写入的起点是这一轮看到的最大 updated_at。 */
    if (persist) {
      await writeCursor(maxUpdated || startedAt, { lastIssue: lastNumber, count: issueCount });
    }
    return results;
  }

  return { pullIssues, isAllowedAttachmentUrl, apiHeaders, readCursor, writeCursor, stateFile: resolvedStateFile };
}
