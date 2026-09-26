/* server/adapters/github.mjs —— GitHub Issue 附件入站适配器
 *
 * 只做一件事：把 `lmy414/ai-girl-stickers` 上带 `sticker-submission` 标签的
 * Issue 里的图片附件拉进统一投稿队列。边界：
 *
 *   1. **标签过滤**：查询带 labels=sticker-submission，返回结果再按标签名二次确认；
 *   2. **域名白名单**：附件只允许 GitHub 附件域名，https-only，端口必须是默认端口；
 *   3. **跳转受限**：redirect 手动处理，每一跳都要重新过白名单，跳转次数有上限；
 *   4. **大小 / 超时受限**：流式读取带字节上限，AbortController 控制超时；
 *   5. **最小 token**：token 只发给「协议 https 且 host 与配置 apiBase 完全一致」的
 *      地址；附件请求永远不带 Authorization；
 *   6. **URL 脱敏**：写进 origin、结果和日志的地址先剥掉 jwt / token / signature 之类
 *      的敏感 query 与 fragment 参数（复用 intake core 的 redactUrl），但原始带签名
 *      地址仍用于实际下载；
 *   7. **幂等**：sourceId = github:<repo>#<issue>:<assetId>，重复拉取不重复下载。
 *
 * 这里不判断图片是否合规、不写内容仓、不发布——那是 review 与人工的事。
 */
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

export function createGithubAdapter(cfg, { queue, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const { repo, label, apiBase, token, timeoutMs, maxBytes, maxRedirects } = cfg.github;

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

  async function apiJson(url) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`GitHub 接口超时：${redactUrl(url)}`));
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      const response = await Promise.race([
        fetchImpl(url, { headers: apiHeaders(url), redirect: 'manual', signal: controller.signal }),
        timeout,
      ]);
      if (response.status >= 300 && response.status < 400) {
        throw new Error(`GitHub 接口不允许重定向：${response.status}`);
      }
      if (!response.ok) throw new Error(`GitHub ${response.status} ${response.statusText}：${redactUrl(url)}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function labelsOf(entry) {
    return (entry.labels || []).map((entryLabel) => (typeof entryLabel === 'string' ? entryLabel : entryLabel && entryLabel.name)).filter(Boolean);
  }

  async function pullIssues({ issue = null, state = 'open', limit = 50 } = {}) {
    const entries = [];
    if (issue !== null && issue !== undefined) {
      entries.push(await apiJson(`${apiBase}/repos/${repo}/issues/${encodeURIComponent(issue)}`));
    } else {
      const url = `${apiBase}/repos/${repo}/issues?state=${encodeURIComponent(state)}&labels=${encodeURIComponent(label)}&per_page=${limit}`;
      const list = await apiJson(url);
      if (Array.isArray(list)) entries.push(...list.filter((entry) => !entry.pull_request));
    }

    const results = [];
    for (const entry of entries) {
      if (!labelsOf(entry).includes(label)) continue; // 二次确认标签
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
    }
    return results;
  }

  return { pullIssues, isAllowedAttachmentUrl, apiHeaders };
}
