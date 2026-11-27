import { fail, hash } from '../routes/hermes/protocol.js';
import type { Wire } from '../routes/hermes/protocol.js';

export const repo = 'lmy414/ai-girl-stickers';
export const ownerLogin = 'lmy414';
export const issueUrl = (number: number) => `https://github.com/${repo}/issues/${number}`;
export const rightsMarker = (id: string) => `<!-- dafeiyu-rights:${id} -->`;
export const submissionMarker = '<!-- dafeiyu-published -->';
export const validIssueNumber = (number: number) => Number.isSafeInteger(number) && number > 0;

export function githubClient(token?: string, fetcher = fetch) {
  async function request(path: string, method = 'GET', body?: Wire) {
    if (method !== 'GET' && !token) throw new Error('GitHub 写入令牌未配置');
    const response = await fetcher(`https://api.github.com${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dafeiyu-issue-reconcile',
        ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }),
      }, body: body && JSON.stringify(body),
    });
    if (!response.ok) fail(`GitHub ${method} ${path.split('?')[0]} HTTP ${response.status}`, 502);
    return response.json() as Promise<Wire>;
  }
  const read = (path: string) => request(`/repos/${repo}/${path}`);
  async function pages(path: string) {
    const rows: Wire[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await read(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(batch)) fail('GitHub 列表格式错误', 502);
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
    fail('GitHub 列表超过 1000 项，需人工复核', 502);
  }
  return { request, read, pages, write: (path: string, method: string, body: Wire) => request(`/repos/${repo}/${path}`, method, body),
    list: (label: string) => pages(`issues?state=open&labels=${label}`),
  };
}

export function labeled(issue: Wire, label: string) {
  return !issue.pull_request && Array.isArray(issue.labels) && issue.labels.some((entry: Wire | string) => (typeof entry === 'string' ? entry : entry.name) === label);
}

export function isRightsIssue(issue: Wire, requireOpen = true) {
  return labeled(issue, 'takedown') && (!requireOpen || issue.state === 'open') && !/^\[(?:bug|feature|投稿)\]/i.test(issue.title || '');
}

export async function readRightsIssue(client: ReturnType<typeof githubClient>, number: number, botLogin = ownerLogin) {
  if (!validIssueNumber(number)) fail('Issue 编号无效', 400);
  const [issue, comments] = await Promise.all([client.read(`issues/${number}`), client.pages(`issues/${number}/comments`)]);
  return { issue, comments, snapshot: {
    number, url: issueUrl(number), title: issue.title || '', body: String(issue.body || ''), login: issue.user?.login || '',
    comments: comments.filter(comment => !(comment.user?.login === botLogin && String(comment.body).includes('<!-- dafeiyu-rights:')))
      .map(comment => ({ id: comment.id, login: comment.user?.login || '', body: comment.body || '', updatedAt: comment.updated_at || '' })),
  } };
}

export function rightsHash(snapshot: Wire) {
  return hash({ number: snapshot.number, url: snapshot.url, title: snapshot.title, body: snapshot.body, login: snapshot.login,
    comments: (snapshot.comments || []).map((comment: Wire) => ({ id: comment.id, login: comment.login, body: comment.body, updatedAt: comment.updatedAt })),
  });
}
