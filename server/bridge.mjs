/* server/bridge.mjs —— auto_passed 条目到私有 intake 中转区的幂等桥接
 *
 * 桥接是审核与自动发布之间的私有步骤。四条硬规则：
 *
 *   1. **只有 auto_passed 且完整 content schema 合法才入中转区**。
 *      needs_manual / auto_rejected / 内容不完整 / 异常一律留在投稿审核区。
 *   2. **只在显式配置 INTAKE_ROOT 与 INTAKE_CONTENT_DIR 时启用**；缺配置是
 *      「可观测 skipped」，不抛错、不删队列，等配置到位再跑即可。
 *   3. **幂等**：按 submission id + sha256 判断，重复桥接只返回 duplicate，
 *      不覆盖已有中转记录，也不产生第二条。
 *   4. **不碰公开内容**：只写 INTAKE_ROOT 的 inbox/ 与 meta/，不写内容仓、
 *      不写 dist/、不跑 git、不提交。
 *
 * 中转区路径与安全边界由 tools/intake/core.mjs 的配置校验兜底（中转根不得位于
 * 站点仓、内容仓或任何 git 工作树内）。
 *
 * content 口径与 server/review.mjs 的 `submission-ai-content/1` 一致：只有
 * name / description / commentary / characterId / categoryIds / tags 六个字段。
 * 这里对已通过审核的 content **再校验一遍**（防御纵深），规则与审核层保持一致，
 * 但不 import review.mjs，避免将来 review 侧调用桥接时形成模块环。
 */
import path from 'node:path';

import { AI_CONTENT_SCHEMA, loadContentVocabulary } from './config.mjs';
import { STATES } from './queue.mjs';
import {
  READY_STATUS,
  listItems,
  resolveConfig as resolveIntakeConfig,
  stageReadyItem,
} from '../tools/intake/core.mjs';

export const CONTENT_SCHEMA = AI_CONTENT_SCHEMA;
export const BRIDGE_SCHEMA = 'submission-bridge/1';

/* 与审核层一致：content 只允许这六个字段，多一个少一个都算不完整。 */
export const CONTENT_KEYS = Object.freeze(['name', 'description', 'commentary', 'characterId', 'categoryIds', 'tags']);
const CONTENT_KEY_SET = new Set(CONTENT_KEYS);

/* 与 server/review.mjs 的 LIMITS 对齐。 */
const LIMITS = Object.freeze({
  name: 200,
  description: 2000,
  commentary: 2000,
  characterId: 64,
  categoryId: 64,
  categoryIds: 10,
  tags: 20,
  tagLength: 40,
});

/* 控制字符、HTML 标签、脚本协议、事件处理器：公开文本里出现即判非法。 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MARKUP_TAG = /<\/?[A-Za-z!]/;
const DANGEROUS_SCHEME = /(?:javascript|vbscript|data)\s*:/i;
const EVENT_HANDLER = /\bon[a-z]+\s*=/i;

export function containsForbiddenText(value) {
  const text = String(value ?? '');
  return CONTROL_CHARS.test(text)
    || MARKUP_TAG.test(text)
    || DANGEROUS_SCHEME.test(text)
    || EVENT_HANDLER.test(text);
}

function toIdSet(value) {
  if (value instanceof Set) return value;
  return new Set((Array.isArray(value) ? value : []).map(String));
}

function textError(value, { label, max, allowEmpty = true }) {
  if (typeof value !== 'string') return `${label} 不是字符串`;
  if (containsForbiddenText(value)) return `${label} 含 HTML/脚本/控制字符`;
  const text = value.trim();
  if (!allowEmpty && text === '') return `${label} 不能为空`;
  if (text.length > max) return `${label} 超过长度上限 ${max}`;
  return null;
}

function listError(value, { label, max, itemMax, allowEmpty = true }) {
  if (!Array.isArray(value)) return `${label} 不是数组`;
  if (value.length > max) return `${label} 超过数量上限 ${max}`;
  const seen = new Set();
  for (const raw of value) {
    const error = textError(raw, { label: `${label}[]`, max: itemMax, allowEmpty: false });
    if (error) return error;
    const item = raw.trim();
    if (seen.has(item)) return `${label} 出现重复项：${item}`;
    seen.add(item);
  }
  if (!allowEmpty && seen.size === 0) return `${label} 不能为空`;
  return null;
}

/**
 * 校验一个 content 对象。规则与 server/review.mjs 的 validateContent 一致：
 * 未知字段、缺字段、错误类型、重复项、注入文本、非法枚举全部拒绝。
 * vocabulary.ok !== true 时 fail-closed（无法确认角色/分类合法性）。
 */
export function validateContent(content, vocabulary = null) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { ok: false, errors: ['content 不是对象'], value: null };
  }
  const errors = [];
  for (const key of Object.keys(content)) {
    if (!CONTENT_KEY_SET.has(key)) errors.push(`content 含未知字段 ${key}`);
  }
  for (const key of CONTENT_KEYS) {
    if (!(key in content)) errors.push(`content 缺少字段 ${key}`);
  }
  if (errors.length > 0) return { ok: false, errors, value: null };

  const nameError = textError(content.name, { label: 'content.name', max: LIMITS.name, allowEmpty: false });
  const descriptionError = textError(content.description, { label: 'content.description', max: LIMITS.description });
  const commentaryError = textError(content.commentary, { label: 'content.commentary', max: LIMITS.commentary });
  const characterError = textError(content.characterId, { label: 'content.characterId', max: LIMITS.characterId, allowEmpty: false });
  const categoryError = listError(content.categoryIds, {
    label: 'content.categoryIds', max: LIMITS.categoryIds, itemMax: LIMITS.categoryId, allowEmpty: false,
  });
  const tagError = listError(content.tags, { label: 'content.tags', max: LIMITS.tags, itemMax: LIMITS.tagLength });
  for (const error of [nameError, descriptionError, commentaryError, characterError, categoryError, tagError]) {
    if (error) errors.push(error);
  }
  if (errors.length > 0) return { ok: false, errors, value: null };

  if (!vocabulary || vocabulary.ok !== true) {
    return { ok: false, errors: ['无法加载角色 / 分类枚举，转人工'], value: null };
  }
  const characterIds = toIdSet(vocabulary.characterIds);
  const categoryIds = toIdSet(vocabulary.categoryIds);
  const characterId = content.characterId.trim();
  if (!characterIds.has(characterId)) errors.push(`content.characterId 不在角色枚举内：${characterId}`);
  for (const id of content.categoryIds) {
    if (!categoryIds.has(String(id).trim())) errors.push(`content.categoryIds 含非法分类：${id}`);
  }
  if (errors.length > 0) return { ok: false, errors, value: null };

  return {
    ok: true,
    errors: [],
    value: {
      name: content.name.trim(),
      description: content.description.trim(),
      commentary: content.commentary.trim(),
      characterId,
      categoryIds: content.categoryIds.map((id) => String(id).trim()),
      tags: content.tags.map((tag) => tag.trim()),
    },
  };
}

/**
 * 判断桥接是否启用。必须**同时**显式给 INTAKE_ROOT 与 INTAKE_CONTENT_DIR；
 * 缺任一个都返回 enabled:false（可观测 skipped），绝不使用 intake 的默认中转根。
 */
export function resolveBridgeOptions({ env = process.env, overrides = {} } = {}) {
  const root = String(overrides.root ?? env.INTAKE_ROOT ?? '').trim();
  const contentDir = String(overrides.contentDir ?? env.INTAKE_CONTENT_DIR ?? '').trim();
  const missing = [];
  if (!root) missing.push('INTAKE_ROOT');
  if (!contentDir) missing.push('INTAKE_CONTENT_DIR');
  if (missing.length > 0) {
    return {
      enabled: false,
      reason: `未显式配置 ${missing.join(' 与 ')}，桥接跳过（队列条目保留，配置到位后可重跑）`,
      root: '',
      contentDir: '',
    };
  }
  return { enabled: true, reason: '', root, contentDir };
}

/** 读站点仓权威角色 / 分类枚举（只读，缺文件即 ok=false）。 */
export function loadVocabulary(siteRoot) {
  return loadContentVocabulary(siteRoot);
}

function disabledBridge(reason) {
  return {
    enabled: false,
    reason,
    schema: BRIDGE_SCHEMA,
    contentSchema: CONTENT_SCHEMA,
    intake: null,
    bridgeItem: async (target) => ({
      id: typeof target === 'string' ? target : (target && target.id) || null,
      sha256: null,
      status: 'skipped',
      reason,
    }),
    bridgePending: async () => ({ enabled: false, reason, results: [], ready: 0, duplicate: 0, skipped: 0, failed: 0 }),
    listReady: async () => [],
  };
}

/**
 * 打开桥接器。缺配置或配置不合法时返回 enabled:false 的实例：所有调用都得到
 * `skipped`，不抛错、不写盘、不动队列。
 */
export async function createBridge({
  queue,
  env = process.env,
  overrides = {},
  intakeOverrides = {},
  now = Date.now,
  vocabulary = null,
} = {}) {
  if (!queue || typeof queue.get !== 'function') throw new Error('createBridge 需要队列实例');

  const options = resolveBridgeOptions({ env, overrides });
  if (!options.enabled) return disabledBridge(options.reason);

  let intakeCfg;
  try {
    intakeCfg = resolveIntakeConfig({ contentDir: options.contentDir, root: options.root, ...intakeOverrides });
  } catch (error) {
    return disabledBridge(`INTAKE_ROOT / INTAKE_CONTENT_DIR 配置不合法，桥接停用：${error.message}`);
  }

  const resolvedVocabulary = vocabulary || loadVocabulary();
  if (!resolvedVocabulary || resolvedVocabulary.ok !== true) {
    return disabledBridge('站点仓角色 / 分类枚举不可用，桥接停用（不放开未校验的枚举）');
  }

  const metaPathOf = (digest) => path.join(intakeCfg.metaDir, `${digest}.json`);
  const inboxPathOf = (digest, ext) => path.join(intakeCfg.inboxDir, `${digest}${ext}`);

  async function bridgeItem(target) {
    const item = typeof target === 'string' ? await queue.get(target) : target;
    if (!item || !item.id) return { id: null, sha256: null, status: 'failed', reason: '队列里没有该条目' };

    if (item.state !== STATES.AUTO_PASSED) {
      return {
        id: item.id,
        sha256: item.sha256 || null,
        status: 'skipped',
        reason: `状态 ${item.state} 不进入中转区（仅 auto_passed）`,
      };
    }

    if (!item.review || item.review.verdict !== 'pass') {
      return {
        id: item.id,
        sha256: item.sha256 || null,
        status: 'skipped',
        reason: '审核结论不是 pass，不进入中转区',
      };
    }

    const content = item.review.content || null;
    const check = validateContent(content, resolvedVocabulary);
    if (!check.ok) {
      const reason = `内容 schema 不合法：${check.errors.slice(0, 5).join('；')}`;
      await queue.recordBridge(item.id, {
        schema: BRIDGE_SCHEMA,
        status: 'skipped',
        sha256: item.sha256 || null,
        reason,
      }).catch(() => {});
      return { id: item.id, sha256: item.sha256 || null, status: 'skipped', reason };
    }

    let buffer;
    try {
      buffer = await queue.readImage(item.id);
    } catch (error) {
      return { id: item.id, sha256: item.sha256 || null, status: 'failed', reason: `读取私有原图失败：${error.message}` };
    }

    let staged;
    try {
      staged = await stageReadyItem(intakeCfg, buffer, {
        ext: item.ext,
        submissionId: item.id,
        source: item.source,
        contentSchema: CONTENT_SCHEMA,
        fields: {
          name: check.value.name,
          description: check.value.description,
          character: check.value.characterId,
          tags: check.value.tags,
        },
        content: check.value,
        origin: item.origin || {},
        license: item.license || 'unknown',
        receivedAt: item.createdAt || null,
      });
    } catch (error) {
      const reason = `写入中转区失败：${error.message}`;
      await queue.recordBridge(item.id, {
        schema: BRIDGE_SCHEMA,
        status: 'failed',
        sha256: item.sha256 || null,
        reason,
      }).catch(() => {});
      return { id: item.id, sha256: item.sha256 || null, status: 'failed', reason };
    }

    const isDuplicate = staged.status === 'duplicate';
    const metaPath = metaPathOf(staged.sha256);
    const inboxPath = inboxPathOf(staged.sha256, staged.item.ext);
    const bridgeStatus = isDuplicate && item.bridge && item.bridge.status === READY_STATUS ? READY_STATUS : staged.status;
    await queue.recordBridge(item.id, {
      schema: BRIDGE_SCHEMA,
      status: bridgeStatus,
      sha256: staged.sha256,
      metaPath,
      inboxPath,
      reason: isDuplicate ? '中转区已有同 sha256 记录，未重复写入' : '',
    }).catch(() => {});

    return {
      id: item.id,
      sha256: staged.sha256,
      status: staged.status,
      reason: isDuplicate ? '中转区已有同 sha256 记录，未重复写入' : '',
      metaPath,
      inboxPath,
    };
  }

  async function bridgePending({ ids = [], limit = 200 } = {}) {
    let targets;
    if (Array.isArray(ids) && ids.length > 0) {
      targets = ids;
    } else {
      const passed = await queue.list({
        state: STATES.AUTO_PASSED,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      targets = passed.map((entry) => entry.id);
    }
    const results = [];
    for (const id of targets) results.push(await bridgeItem(id));
    const summary = { ready: 0, duplicate: 0, skipped: 0, failed: 0 };
    for (const entry of results) {
      if (summary[entry.status] !== undefined) summary[entry.status] += 1;
    }
    return { enabled: true, reason: '', results, ...summary };
  }

  async function listReady() {
    return listItems(intakeCfg, { status: READY_STATUS });
  }

  return {
    enabled: true,
    reason: '',
    schema: BRIDGE_SCHEMA,
    contentSchema: CONTENT_SCHEMA,
    intake: {
      root: intakeCfg.root,
      inboxDir: intakeCfg.inboxDir,
      metaDir: intakeCfg.metaDir,
      logDir: intakeCfg.logDir,
      siteDataDir: intakeCfg.siteDataDir,
    },
    bridgeItem,
    bridgePending,
    listReady,
  };
}
