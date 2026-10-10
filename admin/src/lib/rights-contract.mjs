import crypto from 'node:crypto'
const REPO = 'lmy414/ai-girl-stickers'
export function rightsIssueSnapshot(issue, comments = []) {
  return {
    number: issue.number,
    url: `https://github.com/${REPO}/issues/${issue.number}`,
    title: issue.title,
    body: String(issue.body || ''),
    login: issue.user?.login || '',
    comments: comments
      .filter(
        (c) => !(c.user?.login === 'lmy414' && String(c.body).includes('<!-- dafeiyu-rights:')),
      )
      .map((c) => ({
        id: c.id,
        login: c.user?.login,
        body: c.body || '',
        updatedAt: c.updated_at,
      })),
  }
}
export const rightsIssueHash = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
