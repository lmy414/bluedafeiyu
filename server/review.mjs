/* server/review.mjs —— AI 审核层（可注入真实客户端，默认失败关闭）
 *
 * 这一层只做判断，不做发布。三条硬规则：
 *
 *   1. **没配 AI 服务就是「待人工」**，不是「通过」。缺 endpoint / apiKey 时
 *      连请求都不发（不假造审核结论）。
 *   2. **超时、报错、返回解析不了、置信度不够 —— 全部转人工。**
 *      verdict 只可能是 pass / reject / manual，永远没有 approved / published。
 *   3. **不自动发布**：即使 verdict=pass，队列也只到 auto_passed，
 *      必须由维护者 human.approve 才到 approved，且服务仍然不推送、不发布。
 *
 * 真实 AI 客户端（OpenAI 兼容 vision）在没有密钥时根本不会被构造。
 */
import { STATES } from './queue.mjs';

export const REVIEW_VERDICTS = Object.freeze(['pass', 'reject', 'manual']);

const SYSTEM_PROMPT = [
  '你是 AI 娘二创表情包站的内容初审助手。',
  '只判断这张图是否属于「AI 角色的拟人化二创表情包」，并给出一句理由。',
  '拒绝：真人肖像、与 AI 角色无关的通用表情包、明显盗用商业素材、含违法内容。',
  '只输出 JSON：{"verdict":"pass|reject","confidence":0..1,"reason":"...","tags":["..."],"characterId":"..."}',
].join('\n');

/**
 * 解析各家 AI 服务的响应成统一结论。任何看不懂的输入一律 manual。
 * 支持：已是统一形状的对象 / OpenAI 兼容 choices[].message.content(JSON 字符串) / output_text。
 */
export function parseReviewResponse(payload) {
  const manual = (reason) => ({ verdict: 'manual', confidence: 0, reason });

  if (payload === null || payload === undefined) return manual('AI 未返回可解析的结果');
  let value = payload;
  if (typeof payload === 'string') {
    try {
      value = JSON.parse(payload);
    } catch {
      return manual('AI 返回的不是 JSON');
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const content = value.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      try {
        value = JSON.parse(content);
      } catch {
        return manual('AI 返回的正文不是 JSON');
      }
    } else if (typeof value.output_text === 'string') {
      try {
        value = JSON.parse(value.output_text);
      } catch {
        return manual('AI 返回的 output_text 不是 JSON');
      }
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return manual('AI 返回结构无法识别');
  if (value.verdict !== 'pass' && value.verdict !== 'reject') return manual('AI 没有给出明确的通过/拒绝结论');
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return manual('AI 未给出可信的置信度');
  return {
    verdict: value.verdict,
    confidence,
    reason: String(value.reason || '').slice(0, 1000),
    categories: Array.isArray(value.categories) ? value.categories.map(String).slice(0, 10) : [],
    tags: Array.isArray(value.tags) ? value.tags.map(String).slice(0, 20) : [],
    characterId: value.characterId ? String(value.characterId).slice(0, 64) : '',
  };
}

/**
 * OpenAI 兼容 vision 客户端。**缺 endpoint 或 apiKey 时直接抛错**，
 * 不允许出现「看起来配了其实没配」的调用。
 */
export function createHttpReviewClient({ endpoint, apiKey, model, timeoutMs, fetchImpl = globalThis.fetch }) {
  if (!String(endpoint || '').trim() || !String(apiKey || '').trim()) {
    throw new Error('createHttpReviewClient 需要 endpoint 与 apiKey；未配置时不要构造真实客户端');
  }
  if (typeof fetchImpl !== 'function') throw new Error('缺少可用的 fetch 实现');
  return async function httpReviewClient({ buffer, mime = 'image/png', fields = {}, signal }) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || undefined,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: `投稿名称：${fields.name || '(未填)'}；角色：${fields.character || '(未填)'}` },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  };
}

/**
 * 构造审核器。client 可注入（测试用假客户端，生产用 createHttpReviewClient）。
 * 未注入且配置不完整时 configured=false，review 一律 manual。
 */
export function createReviewer(cfg, { client = null, now = () => Date.now(), fetchImpl } = {}) {
  const injected = typeof client === 'function' ? client : null;
  const configured = Boolean(injected) || cfg.review.configured;
  const activeClient = injected
    || (cfg.review.configured
      ? createHttpReviewClient({ ...cfg.review, fetchImpl: fetchImpl || cfg.fetchImpl })
      : null);

  async function review({ buffer, ext = '', format = '', mime = '', fields = {}, itemId = null }) {
    if (!configured || !activeClient) {
      return {
        verdict: 'manual',
        confidence: 0,
        reason: 'AI 审核未配置（缺少 SUBMISSION_AI_ENDPOINT / SUBMISSION_AI_API_KEY），转人工',
        model: null,
        promptVersion: cfg.review.promptVersion,
        latencyMs: 0,
        raw: { not_configured: true },
      };
    }
    const started = now();
    let payload;
    try {
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('AI 审核超时'));
        }, cfg.review.timeoutMs);
        timer.unref?.();
      });
      try {
        payload = await Promise.race([
          activeClient({ buffer, ext, format, mime: mime || 'image/png', fields, itemId, signal: controller.signal }),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const timedOut = /超时|abort/i.test(String(error && error.message));
      const reason = timedOut ? 'AI 审核超时，转人工' : `AI 审核失败（${error.message}），转人工`;
      return {
        verdict: 'manual',
        confidence: 0,
        reason,
        model: cfg.review.model || null,
        promptVersion: cfg.review.promptVersion,
        latencyMs: now() - started,
        raw: { error: String(error && error.message) },
      };
    }

    const parsed = parseReviewResponse(payload);
    const latencyMs = now() - started;
    const base = {
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      reason: parsed.reason,
      categories: parsed.categories,
      tags: parsed.tags,
      characterId: parsed.characterId,
      model: cfg.review.model || null,
      promptVersion: cfg.review.promptVersion,
      latencyMs,
      raw: payload,
    };
    if (parsed.verdict === 'manual') return base;
    if (parsed.confidence < cfg.review.minConfidence) {
      return {
        ...base,
        verdict: 'manual',
        reason: `AI 置信度 ${parsed.confidence} 低于阈值 ${cfg.review.minConfidence}，转人工`,
      };
    }
    return base;
  }

  return { configured, review, client: activeClient };
}

/**
 * 对一个队列条目跑一次审核：先置 reviewing，再按结论迁移。
 * 任何异常都收敛成 manual，绝不把条目留在 reviewing 或推进到通过。
 */
export async function reviewQueuedItem(queue, reviewer, id, { actor = 'ai', reason = '' } = {}) {
  const item = await queue.get(id);
  if (!item) throw new Error(`队列里没有 ${id}`);
  await queue.transition(id, 'review.start', { actor, reason });
  let result;
  try {
    const buffer = await queue.readImage(id);
    result = await reviewer.review({
      buffer,
      ext: item.ext,
      format: item.format,
      mime: item.mime,
      fields: item.fields,
      itemId: id,
    });
  } catch (error) {
    result = { verdict: 'manual', confidence: 0, reason: `审核器异常（${error.message}），转人工`, raw: { error: error.message } };
  }
  await queue.attachReview(id, result, { raw: result.raw ?? null });
  const event = result.verdict === 'pass' ? 'review.pass' : result.verdict === 'reject' ? 'review.reject' : 'review.manual';
  await queue.transition(id, event, { actor, reason: result.reason });
  return result;
}

/** 批量审核待审/待人工的条目。返回每条结果。 */
export async function reviewPending(queue, reviewer, { id = null, ids = [], limit = 50, actor = 'ai' } = {}) {
  const targets = [];
  if (id) targets.push(id);
  if (ids.length > 0) targets.push(...ids);
  if (targets.length === 0) {
    const pending = await queue.list({ state: STATES.RECEIVED });
    const manual = await queue.list({ state: STATES.NEEDS_MANUAL });
    targets.push(...[...pending, ...manual].slice(0, limit).map((entry) => entry.id));
  }
  const results = [];
  for (const target of targets) results.push({ id: target, ...(await reviewQueuedItem(queue, reviewer, target, { actor })) });
  return results;
}
