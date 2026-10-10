/* Hermes tool protocol. No model calls; all state lives in the submission queue. */
import crypto from 'node:crypto';
import { containsForbiddenText, validateContent } from './review.mjs';
import { sourceHash, validateLocale, validateI18n } from '../admin/src/lib/localization.mjs';
import { STATES } from './queue.mjs';
import { WORK_TYPE_RULES } from '../admin/src/lib/work-types.mjs';

export const LEASE_MS = 10 * 60 * 1000;
const eligible = (item) => item.state === STATES.RECEIVED;
const fault = (message, status = 409) => Object.assign(new Error(message), { status });
function owner(item, token, now) {
  if (!eligible(item) || !token || item.agent?.token !== token || item.agent?.expiresAt <= now) throw fault('任务已过期或已由其他处理者领取');
}
export function agentView(item) {
  const state = item.agent || {};
  return {
    id: item.id, source: item.source, fields: item.fields, origin: item.origin || {},
    state: item.state, stage: state.stage || 'queued', attempt: state.attempt || 0,
    draft: state.draft || null, review: state.review || null, lastError: state.lastError || null,
  };
}

export async function agentAction(queue, action, input, { vocabulary, now = Date.now() } = {}) {
  const at = () => new Date(now).toISOString();
  if (action === 'list') {
    const items = await queue.list({ state: STATES.RECEIVED, limit: 200 });
    return { items: items.filter(i => !i.agent?.token || i.agent.expiresAt <= now).filter(i => !i.agent?.retryAt || i.agent.retryAt <= now).slice(0, 20).map(agentView) };
  }
  if (action === 'rules') return { characterIds: [...vocabulary.characterIds], categoryIds: [...vocabulary.categoryIds], rules: WORK_TYPE_RULES };
  if (!/^sub_[A-Za-z0-9_-]{1,64}$/.test(input.id || '')) throw fault('投稿 ID 非法', 400);
  if (action === 'claim') {
    const token = crypto.randomUUID();
    const item = await queue.updateAgent(input.id, current => {
      if (!eligible(current)) throw fault('条目不允许 Agent 处理');
      if (current.agent?.retryAt > now || current.agent?.stage === 'blocked' || (current.agent?.attempt || 0) >= 3) throw fault('条目暂挂，需站长检查后重试');
      if (current.agent?.token && current.agent.expiresAt > now) throw fault('任务正在处理');
      current.agent = { ...current.agent, token, expiresAt: now + LEASE_MS, attempt: (current.agent?.attempt || 0) + 1, stage: current.agent?.draft ? 'translating' : 'reviewing', claimedAt: at() };
    });
    return { ...agentView(item), token, expiresAt: item.agent.expiresAt };
  }
  const item = await queue.get(input.id);
  if (!item) throw fault('条目不存在', 404);
  owner(item, input.token, now);
  const reviewOk = (review) => review && Object.keys(review).every(k => ['verdict', 'confidence', 'reason'].includes(k)) && ['pass', 'reject', 'manual'].includes(review.verdict) && typeof review.confidence === 'number' && Number.isFinite(review.confidence) && review.confidence >= 0 && review.confidence <= 1 && typeof review.reason === 'string' && review.reason.trim() && review.reason.length <= 1000 && !containsForbiddenText(review.reason);
  if (action === 'image') {
    const saved = await queue.updateAgent(input.id, current => { owner(current, input.token, now); current.agent.imageToken = input.token; current.agent.expiresAt = now + LEASE_MS; });
    return agentView(saved);
  }
  if (action === 'get') return agentView(item);
  if (action === 'release') {
    const saved = await queue.updateAgent(input.id, current => {
      owner(current, input.token, now);
      const attempts = current.agent.attempt || 0;
      current.agent = { ...current.agent, token: null, expiresAt: 0, stage: attempts >= 3 ? 'blocked' : 'retry', retryAt: attempts >= 3 ? Number.MAX_SAFE_INTEGER : now + 5 * 60 * 1000, lastError: String(input.reason || 'Agent 本轮未完成').slice(0, 1000) };
    });
    return agentView(saved);
  }
  if (action === 'draft') {
    if (item.agent.imageToken !== input.token) throw fault('请先读取本次领取任务的图片', 422);
    const checked = validateContent(input.content, vocabulary);
    if (checked.error) throw fault(checked.error, 422);
    if ('i18n' in input.content) throw fault('请通过 locale 工具分语言提交译文', 422);
    if (!reviewOk(input.review)) throw fault('审核结论、置信度或理由非法', 422);
    const saved = await queue.updateAgent(input.id, current => {
      owner(current, input.token, now);
      const source = { ...checked.value, origin: current.origin || {} };
      const hash = sourceHash(source);
      const previous = current.agent.draft;
      current.agent = { ...current.agent, expiresAt: now + LEASE_MS, stage: 'translating', review: input.review, draft: { ...checked.value, i18n: { sourceHash: hash, ...(previous?.i18n?.sourceHash === hash ? previous.i18n : {}) } } };
    });
    return agentView(saved);
  }
  if (action === 'locale') {
    if (!item.agent.draft || !['en', 'ja'].includes(input.language)) throw fault('请先保存中文草稿，再提交 en 或 ja', 422);
    const source = { ...item.agent.draft, origin: item.origin || {} };
    const hash = sourceHash(source);
    if (input.sourceHash !== hash) throw fault('中文版本已变化，请重新读取后翻译');
    const locale = validateLocale(input.content, input.language, source);
    const saved = await queue.updateAgent(input.id, current => {
      owner(current, input.token, now);
      if (sourceHash({ ...current.agent.draft, origin: current.origin || {} }) !== hash) throw fault('中文版本已变化');
      current.agent.draft.i18n = { ...current.agent.draft.i18n, sourceHash: hash, [input.language]: locale };
      current.agent.expiresAt = now + LEASE_MS;
      current.agent.stage = current.agent.draft.i18n.en && current.agent.draft.i18n.ja ? 'ready' : 'translating';
    });
    return agentView(saved);
  }
  if (action === 'validate' || action === 'complete') {
    if (item.agent.imageToken !== input.token) throw fault('请先读取本次领取任务的图片', 422);
    const draft = item.agent.draft;
    const review = input.review || item.agent.review;
    if (!reviewOk(review)) throw fault('审核结论非法', 422);
    if (review.verdict === 'pass') {
      const checked = validateContent(draft, vocabulary, { origin: item.origin });
      if (checked.error) throw fault(checked.error, 422);
      validateI18n(draft?.i18n, { ...draft, origin: item.origin || {} });
      if (draft.i18n.sourceHash !== sourceHash({ ...draft, origin: item.origin || {} })) throw fault('译文已过期');
    }
    return { ready: true, result: { ...review, content: review.verdict === 'pass' ? draft : null }, item: agentView(item) };
  }
  throw fault('未知 Agent 操作', 400);
}
