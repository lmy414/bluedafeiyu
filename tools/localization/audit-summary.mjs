import fs from 'node:fs';

// Only describe the current attempt; an older report must not mask a new failure.
export function summarizeAuditFailure(file, startedAt) {
  try {
    if (fs.statSync(file).mtimeMs < startedAt) return '';
    const {problems} = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(problems) || !problems.length) return '';
    const compact = value => String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, 160);
    const examples = problems.slice(0, 3).map(item => `${compact(item.file)} [${compact(item.kind || 'content')}] ${compact(item.text || item.problem)}`);
    return `英日页面审计失败（${problems.length} 处）：${examples.join('；')}`;
  } catch { return ''; }
}
