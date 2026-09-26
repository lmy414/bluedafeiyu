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
 * AI 响应必须是严格的 submission-ai-content/1 契约：verdict、JSON number
 * confidence、reason、content{name,description,commentary,characterId,categoryIds,tags}。
 * 未知字段、错误类型、重复 tags、HTML/脚本/控制字符、非法角色/分类、低置信度，
 * 以及任何 AI 异常或字段缺失，一律转人工。**AI 不得生成 id/slug/path/submitter/
 * origin/license/status 等系统与法律字段**——那些字段不在 content 白名单里，
 * 出现即视为未知字段并拒绝。
 *
 * 通过校验的 content 只写入私有条目摘要与 ai raw，绝不进公开响应。
 */
import { AI_CONTENT_SCHEMA, loadContentVocabulary } from './config.mjs';
import { STATES } from './queue.mjs';

export const REVIEW_VERDICTS = Object.freeze(['pass', 'reject', 'manual']);
export { AI_CONTENT_SCHEMA };

/* content 白名单：只有这六个字段，别的（含系统/法律字段）都是未知字段。 */
export const CONTENT_KEYS = Object.freeze(['name', 'description', 'commentary', 'characterId', 'categoryIds', 'tags']);
const TOP_LEVEL_KEYS = new Set(['schema', 'verdict', 'confidence', 'reason', 'content']);

const LIMITS = Object.freeze({
  name: 200,
  description: 2000,
  commentary: 2000,
  characterId: 64,
  categoryId: 64,
  categoryIds: 10,
  tags: 20,
  tagLength: 40,
  reason: 1000,
});

const SYSTEM_PROMPT = [
  '你是 AI 娘二创表情包站的内容初审助手。',
  '只判断这张图是否属于「AI 角色的拟人化二创表情包」，并产出站点内容字段。',
  '拒绝：真人肖像、与 AI 角色无关的通用表情包、明显盗用商业素材、含违法内容。',
  '只输出一个 JSON 对象，不要输出解释、Markdown 或代码块，结构严格如下：',
  '{"schema":"submission-ai-content/1","verdict":"pass|reject","confidence":0.0,"reason":"一句话理由","content":{"name":"图片名称","description":"一句话说明","commentary":"蓝色大肥鱼第一人称评价","characterId":"角色 id","categoryIds":["分类 id"],"tags":["标签"]}}',
  'content 的六个字段都必须提供；verdict 为 reject 时也要给出。',
  '只能输出以上字段，不得输出 id/slug/path/submitter/origin/license/status 等系统或法律字段。',
].join('\n');

/* 控制字符、HTML 标签、脚本协议、事件处理器一律视为注入，拒绝。 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MARKUP_TAG = /<\/?[A-Za-z!]/;
const DANGEROUS_SCHEME = /(?:javascript|vbscript|data)\s*:/i;
const EVENT_HANDLER = /\bon[a-z]+\s*=/i;

/** 文本里是否含 HTML / 脚本 / 控制字符。用于所有 AI 产出的字符串。 */
export function containsForbiddenText(value) {
  const text = String(value ?? '');
  return CONTROL_CHARS.test(text)
    || MARKUP_TAG.test(text)
    || DANGEROUS_SCHEME.test(text)
    || EVENT_HANDLER.test(text);
}

function manual(reason) {
  return { verdict: 'manual', confidence: 0, reason, content: null };
}

/** 校验一个字符串字段：类型、注入、长度。allowEmpty=false 时空串也算缺字段。 */
function strictText(value, { label, max, allowEmpty = true }) {
  if (typeof value !== 'string') return { error: `AI 返回的 ${label} 不是字符串` };
  if (containsForbiddenText(value)) return { error: `AI 返回的 ${label} 含 HTML/脚本/控制字符` };
  const text = value.trim();
  if (!allowEmpty && text === '') return { error: `AI 返回的 ${label} 为空` };
  if (text.length > max) return { error: `AI 返回的 ${label} 超过长度上限 ${max}` };
  return { value: text };
}

function stringList(value, { label, max, itemMax, allowEmpty = true }) {
  if (!Array.isArray(value)) return { error: `AI 返回的 ${label} 不是数组` };
  if (value.length > max) return { error: `AI 返回的 ${label} 超过数量上限 ${max}` };
  const out = [];
  for (const raw of value) {
    const item = strictText(raw, { label: `${label}[]`, max: itemMax, allowEmpty: false });
    if (item.error) return item;
    if (out.includes(item.value)) return { error: `AI 返回的 ${label} 出现重复项：${item.value}` };
    out.push(item.value);
  }
  if (!allowEmpty && out.length === 0) return { error: `AI 返回的 ${label} 不能为空` };
  return { value: out };
}

/**
 * 校验 content 对象：未知字段、缺字段、错误类型、重复项、非法枚举全部拒绝。
 * vocabulary 必须 ok=true；否则无法确认角色/分类合法性，fail-closed。
 */
export function validateContent(content, vocabulary) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return { error: 'AI 未返回 content 对象' };
  for (const key of Object.keys(content)) {
    if (!CONTENT_KEYS.includes(key)) return { error: `content 含未知字段 ${key}，转人工` };
  }
  for (const key of CONTENT_KEYS) {
    if (!(key in content)) return { error: `content 缺少字段 ${key}` };
  }

  const name = strictText(content.name, { label: 'content.name', max: LIMITS.name, allowEmpty: false });
  if (name.error) return name;
  const description = strictText(content.description, { label: 'content.description', max: LIMITS.description });
  if (description.error) return description;
  const commentary = strictText(content.commentary, { label: 'content.commentary', max: LIMITS.commentary });
  if (commentary.error) return commentary;
  const characterId = strictText(content.characterId, { label: 'content.characterId', max: LIMITS.characterId, allowEmpty: false });
  if (characterId.error) return characterId;

  if (!vocabulary || vocabulary.ok !== true) return { error: '无法加载角色/分类枚举，转人工' };
  if (!vocabulary.characterIds.has(characterId.value)) {
    return { error: `content.characterId 不在角色枚举内：${characterId.value}` };
  }

  const categoryIds = stringList(content.categoryIds, {
    label: 'content.categoryIds', max: LIMITS.categoryIds, itemMax: LIMITS.categoryId, allowEmpty: false,
  });
  if (categoryIds.error) return categoryIds;
  for (const id of categoryIds.value) {
    if (!vocabulary.categoryIds.has(id)) return { error: `content.categoryIds 含非法分类：${id}` };
  }

  const tags = stringList(content.tags, {
    label: 'content.tags', max: LIMITS.tags, itemMax: LIMITS.tagLength,
  });
  if (tags.error) return tags;

  return {
    value: {
      name: name.value,
      description: description.value,
      commentary: commentary.value,
      characterId: characterId.value,
      categoryIds: categoryIds.value,
      tags: tags.value,
    },
  };
}

/**
 * 解析各家 AI 服务的响应成统一结论。任何看不懂的输入一律 manual。
 * 支持：已是统一形状的对象 / OpenAI 兼容 choices[].message.content(JSON 字符串) / output_text。
 * 只有完整通过 submission-ai-content/1 校验的 pass/reject 才会带 content 返回。
 */
export function parseReviewResponse(payload, { vocabulary = null } = {}) {
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

  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) return manual(`AI 返回了未知字段 ${key}，转人工`);
  }
  if (value.schema !== undefined && value.schema !== AI_CONTENT_SCHEMA) {
    return manual(`AI 返回的 schema 不是 ${AI_CONTENT_SCHEMA}`);
  }
  if (value.verdict !== 'pass' && value.verdict !== 'reject') return manual('AI 没有给出明确的通过/拒绝结论');
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    return manual('AI 未给出可信的 JSON number 置信度');
  }
  const reason = strictText(value.reason, { label: 'reason', max: LIMITS.reason, allowEmpty: false });
  if (reason.error) return manual(reason.error);
  const content = validateContent(value.content, vocabulary);
  if (content.error) return manual(content.error);

  return { verdict: value.verdict, confidence: value.confidence, reason: reason.value, content: content.value };
}

function vocabularyLine(vocabulary) {
  if (!vocabulary || vocabulary.ok !== true) {
    return '（角色与分类枚举未加载，无法确定时请降低置信度或给出 reject）';
  }
  return `characterId 只能取：${[...vocabulary.characterIds].join('、')}；`
    + `categoryIds 只能取：${[...vocabulary.categoryIds].join('、')}，至少一个。`;
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
  return async function httpReviewClient({ buffer, mime = 'image/png', fields = {}, vocabulary = null, signal }) {
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
                {
                  type: 'text',
                  text: [
                    `投稿名称：${fields.name || '(未填)'}；角色：${fields.character || '(未填)'}`,
                    vocabularyLine(vocabulary),
                    '请按 system 指定的 submission-ai-content/1 结构只输出一个 JSON 对象。',
                  ].join('\n'),
                },
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
 * vocabulary 可注入；不注入时每次审核动态从 data/ 读取，配置不完整时 configured=false。
 */
export function createReviewer(cfg, { client = null, now = () => Date.now(), fetchImpl, vocabulary = null } = {}) {
  const injected = typeof client === 'function' ? client : null;
  const configured = Boolean(injected) || cfg.review.configured;
  const activeClient = injected
    || (cfg.review.configured
      ? createHttpReviewClient({ ...cfg.review, fetchImpl: fetchImpl || cfg.fetchImpl })
      : null);

  const vocabularyOf = () => (vocabulary && typeof vocabulary === 'object' ? vocabulary : loadContentVocabulary(cfg.siteRoot));

  async function review({ buffer, ext = '', format = '', mime = '', fields = {}, itemId = null }) {
    if (!configured || !activeClient) {
      return {
        verdict: 'manual',
        confidence: 0,
        reason: 'AI 审核未配置（缺少 SUBMISSION_AI_ENDPOINT / SUBMISSION_AI_API_KEY），转人工',
        content: null,
        model: null,
        promptVersion: cfg.review.promptVersion,
        latencyMs: 0,
        raw: { not_configured: true },
      };
    }
    const activeVocabulary = vocabularyOf();
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
          activeClient({ buffer, ext, format, mime: mime || 'image/png', fields, itemId, vocabulary: activeVocabulary, signal: controller.signal }),
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
        content: null,
        model: cfg.review.model || null,
        promptVersion: cfg.review.promptVersion,
        latencyMs: now() - started,
        raw: { error: String(error && error.message) },
      };
    }

    const parsed = parseReviewResponse(payload, { vocabulary: activeVocabulary });
    const latencyMs = now() - started;
    const base = {
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      reason: parsed.reason,
      schema: parsed.content ? AI_CONTENT_SCHEMA : null,
      content: parsed.content,
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
    result = { verdict: 'manual', confidence: 0, reason: `审核器异常（${error.message}），转人工`, content: null, raw: { error: error.message } };
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
