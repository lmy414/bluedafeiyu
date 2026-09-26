#!/usr/bin/env node
/* ops/publish-batch.mjs —— 服务器侧「自动批量发布」编排（零依赖，Node 内置模块 only）
 *
 * 它把私有收录中转区（INTAKE_ROOT）里状态为 ready 的条目，按批次原子地推进到线上：
 *
 *   ready 条目 ──校验──▶ 写内容仓原图 ──▶ 更新站点仓 data/works.json
 *        ──▶ prepare_works ──▶ generate_image_derivatives ──▶ 模板校验 ──▶ 本地构建校验
 *        ──▶ 显式列文件提交（两个仓）──▶ 推送 ──▶ ops/deploy-server.sh ──▶ 健康检查
 *        ──▶ 成功后把中转条目置为 published（保留，不删除）
 *
 * 硬性边界（不要为了「顺手」改掉）：
 *
 *   1. **默认就是 dry-run**：不写两个工作树、不提交、不推送、不部署、不标记。
 *      只有显式 AUTO_PUBLISH_ENABLED=true 才进入可写模式；推送还要 PUBLISH_PUSH_ENABLED=true，
 *      部署还要 PUBLISH_DEPLOY_ENABLED=true。三个都开、且部署健康检查通过，才把条目标成
 *      published。
 *   2. **只处理 status=ready 的条目**。下架 / 删除 / 署名更正永远不自动处理；这里不删任何
 *      原图、不删中转条目、不删 release。
 *   3. **提交只显式列文件**：git add -- <逐条路径>，绝不 git add -A / .。两个工作树里出现
 *      白名单之外的改动一律中止，不 reset、不提交。
 *   4. **批次原子**：任一步失败都保留 ready，只写下失败批次日志；下次运行可安全重跑。
 *      上一批次留下的工作树改动，只有能对上它的批次日志时才允许 git reset --hard 回收。
 *   5. **不写公开仓之外**：中转区 / 队列 / 密钥不在本脚本范围；本脚本只读 INTAKE_ROOT。
 *
 * 用法：
 *   node ops/publish-batch.mjs                 # 默认 dry-run，只打印计划
 *   node ops/publish-batch.mjs --live          # 需要 AUTO_PUBLISH_ENABLED=true
 *   node ops/publish-batch.mjs --dry-run       # 强制 dry-run（即使开关都开了）
 *   node ops/publish-batch.mjs --json          # 机器可读摘要
 *   node ops/publish-batch.mjs --limit 5       # 本次最多处理 5 条 ready
 *
 * 配置全部走环境变量（见 ops/publish-batch.env.example 与 docs/投稿自动化部署.md）。
 * 本文件是公开仓库的一部分：不写死域名、IP、凭据或服务器绝对路径。
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveConfig } from '../tools/intake/core.mjs';

export const PUBLISH_SCHEMA = 'publish-batch/1';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

/* 允许的图片扩展名（与 tools/intake/core.mjs、server/config.mjs 同一口径） */
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.apng']);
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.apng': 'image/png',
};

/* 公开清单的枚举（archive/2026-09-24/数据契约.md §5 §6）。unknown 用于缺信息的情形。 */
export const ORIGIN_TYPES = new Set(['self-created', 'author-submitted', 'internet-found', 'community-created', 'unknown']);
export const LICENSE_TYPES = new Set(['submitter-permission', 'author-permission', 'cc0', 'cc-by', 'cc-by-nc', 'unknown']);

/* 公开文本的长度与字符上限。数值与 server/bridge.mjs 的 content 限制对齐，
 * 避免上游已判合法的 content 在发布侧被更严的私有阈值挡住而永久留在 ready。
 * 分类上限与 bridge 一致（10）；实际能通过的是 data/categories.json 的 active 枚举。 */
const TEXT_LIMITS = { name: 200, description: 2000, commentary: 2000, tag: 40, author: 200, note: 2000 };
const MAX_TAGS = 20;
const MAX_CATEGORIES = 10;

/* 站点仓里自动发布允许改动的文件（本地构建产物都在 .gitignore 里，不会出现在 git status）。 */
const SITE_ALLOWLIST = ['data/works.json', 'data/blue-fish-ids.json', 'data/blue-fish-classification.json'];
/* 内容仓里自动发布允许改动的路径前缀（原图与派生图）。 */
const CONTENT_ALLOW_PREFIXES = [
  'dist/submissions/originals/',
  'dist/submissions/previews/',
  'dist/submissions/large/',
  'dist/data/blue-fish/previews/',
  'dist/avatar.png',
];

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/* ---------------------------------------------------------------- 小工具 */

export function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  throw new Error(`布尔配置只接受 1/0/true/false/yes/no/on/off，收到：${value}`);
}

function toPosix(relPath) {
  return String(relPath).split(path.sep).join('/');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function normalizeExt(value) {
  const text = String(value || '').trim().toLowerCase();
  // entry.ext 形如 '.png'：path.extname('.png') 会把点文件当成「无扩展名」，要单独处理。
  let ext = text;
  if (ext && !ext.startsWith('.')) ext = path.extname(ext) || `.${ext}`;
  return ext === '.jpeg' ? '.jpg' : ext;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return value;
  }
  return undefined;
}

function isValidIso(value) {
  const text = String(value || '');
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

/** 公开文本校验：空、超长、控制字符、HTML/脚本字符都拒绝。 */
function checkText(value, { label, max, required = false, allowNewline = false }) {
  const raw = value === undefined || value === null ? '' : String(value);
  const text = raw.trim();
  if (!text) {
    return required ? { ok: false, reason: `${label} 为空` } : { ok: true, value: '' };
  }
  if (text.length > max) return { ok: false, reason: `${label} 超过 ${max} 字` };
  if (CONTROL_CHARS.test(text)) return { ok: false, reason: `${label} 含控制字符` };
  if (!allowNewline && /[\r\n]/.test(text)) return { ok: false, reason: `${label} 含换行` };
  if (/[<>]/.test(text)) return { ok: false, reason: `${label} 含 HTML/脚本字符` };
  return { ok: true, value: text };
}

/* ---------------------------------------------------------------- 图片头嗅探 */

/**
 * 零依赖读取图片尺寸与动画标记。只解析文件头，不依赖 Pillow；认不出返回 null。
 * 这是为了让发布器能在写清单前就把 width/height/isAnimated 填对（契约 §3 要求这些字段）。
 */
export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  // PNG：IHDR 宽高在 16..24；acTL 块说明是 APNG。
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      format: 'png',
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      isAnimated: buffer.includes(Buffer.from('acTL', 'latin1')),
    };
  }
  // GIF：逻辑屏幕宽高 LE；NETSCAPE2.0 扩展或一个以上图形控制扩展视为多帧。
  if (buffer.length >= 10 && buffer.subarray(0, 4).toString('latin1') === 'GIF8') {
    let controls = 0;
    for (let i = 0; i < buffer.length - 1; i += 1) {
      if (buffer[i] === 0x21 && buffer[i + 1] === 0xf9) controls += 1;
    }
    return {
      format: 'gif',
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
      isAnimated: buffer.includes(Buffer.from('NETSCAPE2.0', 'latin1')) || controls > 1,
    };
  }
  // JPEG：扫描 SOF 段拿宽高。
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isSof) {
        return { format: 'jpeg', width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), isAnimated: false };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
    return null;
  }
  // WebP：VP8X 显式画布尺寸与动画位；VP8 / VP8L 回退到各自头。
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    const chunk = buffer.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8X') {
      return {
        format: 'webp',
        width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
        height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
        isAnimated: (buffer[20] & 0x02) !== 0,
      };
    }
    if (chunk === 'VP8 ') {
      return { format: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, isAnimated: false };
    }
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return {
        format: 'webp',
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        isAnimated: false,
      };
    }
    return null;
  }
  return null;
}

/* ---------------------------------------------------------------- 配置 */

function parseArgv(argv) {
  const args = { dryRun: false, live: false, json: false, limit: 0, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '--dryrun') args.dryRun = true;
    else if (arg === '--live') args.live = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--limit') { args.limit = Number(argv[i + 1]); i += 1; }
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
    else throw new Error(`无法识别的参数：${arg}（node ops/publish-batch.mjs --help 看用法）`);
  }
  if (args.limit && (!Number.isSafeInteger(args.limit) || args.limit <= 0)) {
    throw new Error(`--limit 必须是正整数：${args.limit}`);
  }
  if (args.dryRun && args.live) throw new Error('--dry-run 与 --live 不能同时给');
  return args;
}

/**
 * 解析发布配置。INTAKE_ROOT 的私有性检查（不得落在任一公开仓 / git 工作树内）
 * 复用 tools/intake/core.mjs 的 resolveConfig，口径与收录中转一致。
 */
export function resolvePublishConfig({ env = process.env, argv = [], overrides = {} } = {}) {
  const args = Array.isArray(argv) ? parseArgv(argv) : argv;

  const providedContent = overrides.contentDir || env.PUBLISH_CONTENT_DIR || env.INTAKE_CONTENT_DIR || env.CONTENT_DIR || '';
  if (!String(providedContent).trim()) {
    throw new Error('必须指定内容仓库根目录：PUBLISH_CONTENT_DIR / INTAKE_CONTENT_DIR / CONTENT_DIR');
  }
  const contentDir = path.resolve(String(providedContent).trim());
  const siteDir = path.resolve(overrides.siteDir || env.PUBLISH_SITE_DIR || REPO_ROOT);
  if (contentDir === siteDir) throw new Error('内容仓库与站点仓库不能是同一个目录');
  const siteDataDir = path.join(siteDir, 'data');

  const intake = resolveConfig({ contentDir, root: overrides.root || env.INTAKE_ROOT, siteDataDir });

  if (!fs.existsSync(path.join(siteDataDir, 'works.json'))) throw new Error(`站点仓里找不到 data/works.json：${siteDataDir}`);
  if (!fs.existsSync(path.join(siteDataDir, 'characters.json'))) throw new Error(`站点仓里找不到 data/characters.json：${siteDataDir}`);
  if (!fs.existsSync(path.join(siteDataDir, 'categories.json'))) throw new Error(`站点仓里找不到 data/categories.json：${siteDataDir}`);
  if (!fs.existsSync(path.join(contentDir, 'dist', 'submissions', 'originals'))) {
    throw new Error(`内容仓里找不到原图目录：${path.join(contentDir, 'dist', 'submissions', 'originals')}`);
  }

  const auto = parseBool(env.AUTO_PUBLISH_ENABLED, false);
  let dryRun = true;
  if (args.live) {
    if (!auto) throw new Error('--live 需要显式设置 AUTO_PUBLISH_ENABLED=true');
    dryRun = false;
  } else if (auto && !args.dryRun) {
    dryRun = false;
  }

  const push = parseBool(env.PUBLISH_PUSH_ENABLED, false);
  const deploy = parseBool(env.PUBLISH_DEPLOY_ENABLED, false);

  const baseUrl = String(env.PUBLISH_ORIGINAL_BASE_URL || 'https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main').replace(/\/+$/, '');
  if (!/^https:\/\/[^\s]+$/.test(baseUrl)) throw new Error(`PUBLISH_ORIGINAL_BASE_URL 必须是 https 地址：${baseUrl}`);

  const minConfidence = env.PUBLISH_MIN_CONFIDENCE === undefined ? 0.6 : Number(env.PUBLISH_MIN_CONFIDENCE);
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new Error(`PUBLISH_MIN_CONFIDENCE 必须在 0..1：${env.PUBLISH_MIN_CONFIDENCE}`);
  }

  const limit = args.limit || Number(env.PUBLISH_MAX_ENTRIES || 0) || 0;

  return {
    schema: PUBLISH_SCHEMA,
    args,
    dryRun,
    push,
    deploy,
    mode: dryRun ? 'dry-run' : (push && deploy ? 'live' : (push ? 'push-only' : 'stage-only')),
    intake,
    siteDir,
    contentDir,
    siteDataDir,
    remote: env.PUBLISH_REMOTE || 'origin',
    branch: env.PUBLISH_BRANCH || 'main',
    node: env.PUBLISH_NODE || process.execPath,
    python: env.PUBLISH_PYTHON || 'python3',
    buildCheck: parseBool(env.PUBLISH_BUILD_CHECK, true),
    minConfidence,
    maxEntries: limit > 0 ? limit : Infinity,
    originalBaseUrl: baseUrl,
    gitName: env.PUBLISH_GIT_NAME || 'dafeiyu-publish-bot',
    gitEmail: env.PUBLISH_GIT_EMAIL || 'dafeiyu-publish-bot@users.noreply.github.com',
    deployCmd: env.PUBLISH_DEPLOY_CMD || '',
    deployRoot: env.PUBLISH_DEPLOY_ROOT || env.DEPLOY_ROOT || '',
    deployRunner: env.PUBLISH_DEPLOY_RUNNER || '',
    staleLockMs: Number(env.PUBLISH_LOCK_STALE_MS || 6 * 60 * 60 * 1000),
    workDir: path.join(intake.root, 'work'),
    siteAllowlist: SITE_ALLOWLIST,
    contentAllowPrefixes: CONTENT_ALLOW_PREFIXES,
  };
}

/* ---------------------------------------------------------------- 清单与 ready */

export function loadManifests(siteDataDir) {
  const read = (name) => {
    const file = path.join(siteDataDir, name);
    if (!fs.existsSync(file)) throw new Error(`清单缺失：${file}`);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('顶层不是数组');
      return parsed;
    } catch (error) {
      throw new Error(`清单读不到或不是数组：${file}（${error.message}）`);
    }
  };
  return {
    characters: read('characters.json'),
    categories: read('categories.json'),
    works: read('works.json'),
    ownerPicks: read('owner-picks.json'),
  };
}

/** 读中转区 status=ready 的条目；坏 meta 只跳过并记进 bad，不让整批崩。 */
export async function readReadyEntries(intake) {
  const dir = intake.metaDir;
  let names = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return { entries: [], bad: [] };
  }
  const entries = [];
  const bad = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    let item;
    try {
      item = JSON.parse(await fs.promises.readFile(path.join(dir, name), 'utf8'));
    } catch {
      bad.push({ file: name, reason: 'meta 不是合法 JSON' });
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      bad.push({ file: name, reason: 'meta 不是对象' });
      continue;
    }
    if (item.status !== 'ready') continue;
    const expected = name.slice(0, -'.json'.length);
    if (item.sha256 && item.sha256 !== expected) {
      bad.push({ file: name, reason: 'meta 文件名与 sha256 字段不一致' });
      continue;
    }
    entries.push(item);
  }
  entries.sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')) || String(a.sha256).localeCompare(String(b.sha256)));
  return { entries, bad };
}

/* ---------------------------------------------------------------- 校验 / 规划 */

function extractContent(entry) {
  const fields = entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
  const ai = entry.ai && typeof entry.ai === 'object' ? entry.ai : (entry.review && typeof entry.review === 'object' ? entry.review : {});
  const content = entry.content && typeof entry.content === 'object' ? entry.content : {};
  const origin = entry.origin && typeof entry.origin === 'object' ? entry.origin : {};
  const license = entry.license && typeof entry.license === 'object' ? entry.license : {};
  return {
    fields,
    ai,
    content,
    name: firstDefined(content.name, ai.name, fields.name),
    description: firstDefined(content.description, ai.description, fields.description) || '',
    commentary: firstDefined(content.commentary, ai.commentary, fields.commentary),
    characterId: firstDefined(content.characterId, ai.characterId, fields.characterId, fields.character),
    categoryIds: firstDefined(content.categoryIds, ai.categoryIds, fields.categoryIds, ai.categories, fields.categories) || [],
    tags: firstDefined(content.tags, ai.tags, fields.tags) || [],
    // verdict / confidence 由 server/ 初审保证（桥接只写 auto_passed）；这里仅在存在时复核。
    verdict: firstDefined(ai.verdict, content.verdict),
    confidence: firstDefined(ai.confidence, content.confidence),
    originType: firstDefined(fields.originType, origin.type),
    originAuthor: firstDefined(fields.originAuthor, origin.author),
    originUrl: firstDefined(fields.originUrl, origin.sourceUrl, origin.url, origin.issueUrl),
    licenseType: firstDefined(fields.licenseType, license.type, typeof entry.license === 'string' ? entry.license : undefined),
    licenseNote: firstDefined(fields.licenseNote, license.note),
    submitter: firstDefined(origin.submitter, fields.submitter, entry.submitter),
  };
}

/**
 * 校验一条 ready 条目：图片字节、SHA-256、角色、分类、完整 AI 内容、公开文本。
 * 任一不过就返回 ok:false 与原因，调用方把整条留在 ready，不写任何公开仓。
 */
export function validateEntry(cfg, entry, manifests, nowIso) {
  const problems = [];
  const digest = String(entry.sha256 || '');
  if (!/^[0-9a-f]{64}$/.test(digest)) problems.push('sha256 不是 64 位小写十六进制');

  const ext = normalizeExt(entry.ext);
  if (!ALLOWED_EXT.has(ext)) problems.push(`扩展名不支持：${entry.ext || '(空)'}`);

  let image = null;
  if (ALLOWED_EXT.has(ext) && /^[0-9a-f]{64}$/.test(digest)) {
    const file = path.join(cfg.intake.inboxDir, `${digest}${ext}`);
    if (!fs.existsSync(file)) {
      problems.push('中转区找不到原图字节');
    } else {
      const buffer = fs.readFileSync(file);
      if (sha256(buffer) !== digest) problems.push('原图字节与记录的 sha256 不一致');
      else image = buffer;
    }
  }

  const content = extractContent(entry);
  const name = checkText(content.name, { label: 'name', max: TEXT_LIMITS.name, required: true });
  if (!name.ok) problems.push(name.reason);
  const description = checkText(content.description, { label: 'description', max: TEXT_LIMITS.description });
  if (!description.ok) problems.push(description.reason);
  const commentary = checkText(content.commentary, { label: 'commentary', max: TEXT_LIMITS.commentary, required: true, allowNewline: true });
  if (!commentary.ok) problems.push(commentary.reason);

  const activeCharacters = new Set(manifests.characters.filter((c) => c && c.status === 'active').map((c) => c.id));
  const activeCategories = new Set(manifests.categories.filter((c) => c && c.status === 'active').map((c) => c.id));

  const characterId = String(content.characterId || '');
  if (!characterId) problems.push('缺 characterId');
  else if (!activeCharacters.has(characterId)) problems.push(`角色不在 characters.json（active）：${characterId}`);

  if (!Array.isArray(content.categoryIds) || content.categoryIds.length === 0) {
    problems.push('缺 categoryIds');
  } else if (content.categoryIds.length > MAX_CATEGORIES) {
    problems.push(`categoryIds 超过 ${MAX_CATEGORIES} 个`);
  } else {
    for (const categoryId of content.categoryIds) {
      if (typeof categoryId !== 'string' || !activeCategories.has(categoryId)) problems.push(`分类不在 categories.json（active）：${categoryId}`);
    }
  }

  const tags = [];
  if (!Array.isArray(content.tags) || content.tags.length === 0) {
    problems.push('缺 tags');
  } else if (content.tags.length > MAX_TAGS) {
    problems.push(`tags 超过 ${MAX_TAGS} 个`);
  } else {
    const seen = new Set();
    for (const rawTag of content.tags) {
      const tag = checkText(rawTag, { label: 'tag', max: TEXT_LIMITS.tag, required: true });
      if (!tag.ok) { problems.push(tag.reason); continue; }
      if (seen.has(tag.value)) { problems.push(`tag 重复：${tag.value}`); continue; }
      seen.add(tag.value);
      tags.push(tag.value);
    }
  }

  // verdict / confidence 由 server/ 初审把关（桥接只写 auto_passed），这里仅在字段存在时复核。
  if (content.verdict !== undefined && String(content.verdict) !== 'pass') {
    problems.push(`AI verdict 不是 pass：${content.verdict}`);
  }
  if (content.confidence !== undefined) {
    const value = Number(content.confidence);
    if (!Number.isFinite(value)) problems.push('AI confidence 必须是数字');
    else if (value < cfg.minConfidence) problems.push(`AI 置信度 ${value} 低于阈值 ${cfg.minConfidence}`);
  }

  if (content.originType !== undefined && !ORIGIN_TYPES.has(String(content.originType))) {
    problems.push(`originType 不在枚举内：${content.originType}`);
  }
  if (content.licenseType !== undefined && !LICENSE_TYPES.has(String(content.licenseType))) {
    problems.push(`licenseType 不在枚举内：${content.licenseType}`);
  }

  let dimensions = null;
  if (image) {
    dimensions = sniffImage(image);
    if (!dimensions) problems.push('无法识别图片格式或尺寸');
  }

  if (problems.length > 0) {
    return { ok: false, problems: [...new Set(problems)] };
  }

  const author = checkText(content.originAuthor, { label: 'originAuthor', max: TEXT_LIMITS.author });
  const originUrl = String(content.originUrl || '');
  if (originUrl && !/^https?:\/\//.test(originUrl)) problems.push('originUrl 不是 http(s) 链接');
  const licenseNote = checkText(content.licenseNote, { label: 'licenseNote', max: TEXT_LIMITS.note });
  if (!author.ok) problems.push(author.reason);
  if (!licenseNote.ok) problems.push(licenseNote.reason);
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  const filename = `${digest.slice(0, 16)}${ext}`;
  const stem = filename.slice(0, -ext.length);
  const originalRel = `dist/submissions/originals/${characterId}/${filename}`;
  const previewRel = `dist/submissions/previews/${characterId}/${stem}.webp`;
  const largeRel = `dist/submissions/large/${characterId}/${stem}.webp`;
  const createdAt = isValidIso(entry.receivedAt) || nowIso;
  const format = dimensions.format === 'jpeg' ? 'jpg' : dimensions.format;

  const record = {
    id: `sticker_${digest.slice(0, 24)}`,
    slug: '',
    name: name.value,
    description: description.value,
    commentary: commentary.value,
    path: `${cfg.originalBaseUrl}/${originalRel}`,
    thumbnailPath: '',
    fullPath: '',
    format,
    mimeType: MIME_BY_EXT[ext] || 'application/octet-stream',
    isAnimated: dimensions.isAnimated,
    width: dimensions.width,
    height: dimensions.height,
    fileSize: image.length,
    sha256: digest,
    characterId,
    tone: characterId,
    symbol: '',
    categoryIds: content.categoryIds.map(String),
    tags,
    submitter: {
      name: String(content.submitter || ''),
      github: String(content.submitter || ''),
    },
    origin: {
      type: content.originType !== undefined ? String(content.originType) : 'unknown',
      author: author.value,
      sourceUrl: originUrl || null,
      note: '',
    },
    license: {
      type: content.licenseType !== undefined ? String(content.licenseType) : 'unknown',
      note: licenseNote.value,
    },
    status: 'published',
    createdAt,
    updatedAt: createdAt,
  };

  return {
    ok: true,
    item: {
      sha256: digest,
      entry,
      record,
      originalRel,
      previewRel,
      largeRel,
      stem,
      ext,
    },
  };
}

/** 把 ready 条目分成：可发布 / 已发布同图 / 校验不过（留在 ready）。 */
export function planBatch(cfg, entries, manifests, { nowIso = new Date().toISOString() } = {}) {
  const publishedShas = new Set();
  const takenIds = new Set();
  for (const record of [...manifests.works, ...manifests.ownerPicks]) {
    if (!record || typeof record !== 'object') continue;
    if (record.sha256) publishedShas.add(String(record.sha256));
    if (record.id) takenIds.add(String(record.id));
  }

  const publishable = [];
  const duplicates = [];
  const skipped = [];
  for (const entry of entries) {
    const digest = String(entry.sha256 || '');
    const name = (entry.fields && entry.fields.name) || '';
    if (publishedShas.has(digest)) {
      duplicates.push({ sha256: digest, name });
      continue;
    }
    const result = validateEntry(cfg, entry, manifests, nowIso);
    if (!result.ok) {
      skipped.push({ sha256: digest, name, problems: result.problems });
      continue;
    }
    if (takenIds.has(result.item.record.id)) {
      skipped.push({ sha256: digest, name, problems: [`id 已被占用：${result.item.record.id}`] });
      continue;
    }
    publishable.push(result.item);
  }

  const limited = Number.isFinite(cfg.maxEntries) ? publishable.slice(0, cfg.maxEntries) : publishable;
  const deferred = publishable.length - limited.length;
  return { publishable: limited, duplicates, skipped, deferred };
}

/* ---------------------------------------------------------------- 发布锁 */

/**
 * 发布锁：在私有中转区 logs/ 下用 wx 独占文件，跨进程互斥（systemd 单实例也会撞上重跑）。
 * 锁陈旧（默认 6 小时）时自动回收，避免进程被杀后永久卡死。
 */
export async function acquirePublishLock(intake, { now = () => Date.now(), staleMs = 6 * 60 * 60 * 1000 } = {}) {
  const dir = intake.logDir || path.join(intake.root, 'logs');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'publish.lock');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now() }));
      fs.closeSync(fd);
      return async () => {
        try { fs.rmSync(file, { force: true }); } catch { /* 锁文件已被清掉即可 */ }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(file);
        if (now() - stat.mtimeMs > staleMs) { fs.rmSync(file, { force: true }); continue; }
      } catch { /* 锁刚好消失，重试 */ }
      throw new Error(`另一个发布正在进行（拿不到 ${file}）`);
    }
  }
  throw new Error(`获取发布锁超时：${file}`);
}

/* ---------------------------------------------------------------- 批次日志 */

function batchDir(cfg) {
  return path.join(cfg.intake.root, 'batches');
}

function journalPath(cfg, batchId) {
  return path.join(batchDir(cfg), `${batchId}.json`);
}

function writeJournal(cfg, journal) {
  const file = journalPath(cfg, journal.batchId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return file;
}

function readLatestUnfinishedJournal(cfg) {
  const dir = batchDir(cfg);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const candidates = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const journal = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (journal && (journal.status === 'in_progress' || journal.status === 'failed')) candidates.push(journal);
    } catch { /* 坏日志跳过 */ }
  }
  candidates.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  return candidates[0] || null;
}

/* ---------------------------------------------------------------- 命令执行 */

function defaultExec(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

function runCmd(exec, command, args, options = {}) {
  const result = exec(command, args, options);
  if (result.error) throw new Error(`${command} 启动失败：${result.error.message}`);
  if (result.status !== 0) {
    const tail = String(result.stderr || result.stdout || '').trim().split('\n').slice(-5).join(' | ');
    throw new Error(`${command} ${args.join(' ')} 退出码 ${result.status}${tail ? `：${tail}` : ''}`);
  }
  return result;
}

function gitCmd(exec, dir, args, options = {}) {
  return runCmd(exec, 'git', ['-C', dir, ...args], options);
}

function gitTry(exec, dir, args) {
  const result = exec('git', ['-C', dir, ...args], {});
  return result.status === 0;
}

function parsePorcelainZ(output) {
  const parts = String(output || '').split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part || part.length < 3) continue;
    const xy = part.slice(0, 2);
    const file = part.slice(3);
    entries.push({ xy, file });
    // -z 下重命名 / 复制的旧路径单独占一个字段，跳过。
    if (xy[0] === 'R' || xy[0] === 'C') i += 1;
  }
  return entries;
}

function isAllowedRepoPath(rel, repoKey, cfg) {
  if (repoKey === 'site') return cfg.siteAllowlist.includes(rel);
  return cfg.contentAllowPrefixes.some((prefix) => rel === prefix || rel.startsWith(prefix));
}

/* ---------------------------------------------------------------- 工作树恢复 */

function repoDir(cfg, repoKey) {
  return repoKey === 'site' ? cfg.siteDir : cfg.contentDir;
}

/**
 * 确保工作树干净并可发布：
 *   - 干净且 HEAD == origin/<branch> → 直接返回；
 *   - 否则只允许回收「上一次未完成批次」留下的改动：这些路径必须对上批次日志（或白名单），
 *     先 git reset --hard origin/<branch>，再删掉日志里未跟踪的残留文件；
 *   - 计划外改动（尤其没有批次日志时）一律拒绝，绝不替人 reset。
 */
function ensureRepoClean(cfg, exec, repoKey, previousJournal, log) {
  const dir = repoDir(cfg, repoKey);
  const remoteRef = `${cfg.remote}/${cfg.branch}`;
  gitCmd(exec, dir, ['fetch', '--prune', cfg.remote]);
  const statusOut = gitCmd(exec, dir, ['status', '--porcelain', '-z', '--untracked-files=all']).stdout || '';
  const changed = [...new Set(parsePorcelainZ(statusOut).map((entry) => toPosix(entry.file)))];
  const head = (gitCmd(exec, dir, ['rev-parse', 'HEAD']).stdout || '').trim();
  const originHead = (gitCmd(exec, dir, ['rev-parse', remoteRef]).stdout || '').trim();

  if (changed.length === 0 && head === originHead) return;

  if (!previousJournal) {
    throw new Error(`${repoKey} 工作树 ${dir} 不干净，且没有可回收的上次批次记录，拒绝自动 reset：${(changed.length ? changed : [`HEAD=${head} != ${originHead}`]).slice(0, 5).join(', ')}`);
  }
  const journalFiles = new Set((previousJournal.files && previousJournal.files[repoKey]) || []);
  const outside = changed.filter((rel) => !journalFiles.has(rel) && !isAllowedRepoPath(rel, repoKey, cfg));
  if (outside.length > 0) {
    throw new Error(`${repoKey} 工作树出现计划外改动，拒绝自动 reset：${outside.slice(0, 5).join(', ')}`);
  }

  log(`回收上次未完成批次：git -C ${dir} reset --hard ${remoteRef}`);
  gitCmd(exec, dir, ['reset', '--hard', remoteRef]);
  for (const rel of journalFiles) {
    if (!isAllowedRepoPath(rel, repoKey, cfg)) continue;
    const abs = path.join(dir, ...rel.split('/'));
    if (!fs.existsSync(abs)) continue;
    if (!gitTry(exec, dir, ['ls-files', '--error-unmatch', '--', rel])) fs.rmSync(abs, { force: true });
  }
}

/* ---------------------------------------------------------------- 写入与提交 */

function writeOriginals(cfg, items) {
  for (const item of items) {
    const source = path.join(cfg.intake.inboxDir, `${item.sha256}${item.ext}`);
    const dest = path.join(cfg.contentDir, ...item.originalRel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) {
      if (sha256File(dest) !== item.sha256) throw new Error(`目标原图已存在且内容不同：${item.originalRel}`);
      continue;
    }
    fs.copyFileSync(source, dest);
  }
}

function readWorksText(cfg) {
  return fs.readFileSync(path.join(cfg.siteDataDir, 'works.json'), 'utf8');
}

function updateWorksManifest(cfg, items, originalText) {
  const eol = originalText.includes('\r\n') ? '\r\n' : '\n';
  const records = JSON.parse(originalText);
  if (!Array.isArray(records)) throw new Error('data/works.json 顶层必须是数组');
  const ids = new Set(records.map((record) => record && record.id));
  let added = 0;
  for (const item of items) {
    if (ids.has(item.record.id)) continue;
    records.push(item.record);
    ids.add(item.record.id);
    added += 1;
  }
  if (added === 0) return 0;
  const text = `${JSON.stringify(records, null, 2).replace(/\n/g, eol)}${eol}`;
  fs.writeFileSync(path.join(cfg.siteDataDir, 'works.json'), text, 'utf8');
  return added;
}

function runToolchain(cfg, exec, workDir) {
  // 先确认服务器真能跑派生图（Pillow），避免写坏清单后才发现缺依赖。
  runCmd(exec, cfg.python, ['-c', 'import PIL, sys; sys.exit(0)'], { cwd: cfg.siteDir });
  runCmd(exec, cfg.node, ['tools/prepare_works.mjs'], { cwd: cfg.siteDir });
  runCmd(exec, cfg.python, ['tools/generate_image_derivatives.py', '--content-dir', cfg.contentDir], {
    cwd: cfg.siteDir,
    env: { ...process.env, CONTENT_DIR: cfg.contentDir },
  });
  runCmd(exec, cfg.node, ['tools/sync_issue_template.mjs', '--check', '--content-dir', cfg.contentDir], {
    cwd: cfg.siteDir,
    env: { ...process.env, CONTENT_DIR: cfg.contentDir },
  });
  if (cfg.buildCheck) {
    const out = path.join(workDir, 'build-check');
    fs.rmSync(out, { recursive: true, force: true });
    runCmd(exec, cfg.node, ['tools/build_site.mjs', '--content-dir', cfg.contentDir, '--out', out, '--force-clean'], {
      cwd: cfg.siteDir,
      env: { ...process.env, CONTENT_DIR: cfg.contentDir },
    });
    fs.rmSync(out, { recursive: true, force: true });
  }
}

/** 用 git status 找出真实改动，并要求全部落在白名单内；出现删除直接拒绝。 */
function discoverChanged(cfg, exec, repoKey) {
  const dir = repoDir(cfg, repoKey);
  const out = gitCmd(exec, dir, ['status', '--porcelain', '-z', '--untracked-files=all']).stdout || '';
  const files = [];
  for (const entry of parsePorcelainZ(out)) {
    const rel = toPosix(entry.file);
    if (entry.xy.includes('D')) throw new Error(`${repoKey} 工作树出现删除，自动发布不删文件：${rel}`);
    if (!isAllowedRepoPath(rel, repoKey, cfg)) throw new Error(`${repoKey} 工作树出现计划外改动：${rel}`);
    files.push(rel);
  }
  return [...new Set(files)];
}

/** 只显式列文件暂存与提交；绝不 git add -A / .。返回新 commit 或 null。 */
function commitRepo(cfg, exec, repoKey, files, message) {
  if (files.length === 0) return null;
  const dir = repoDir(cfg, repoKey);
  for (const rel of files) {
    if (!rel || rel === '.' || rel === '..' || rel.startsWith('-')) throw new Error(`非法暂存路径：${rel}`);
  }
  gitCmd(exec, dir, ['add', '--', ...files]);
  const staged = (gitCmd(exec, dir, ['diff', '--cached', '--name-only']).stdout || '').trim();
  if (!staged) return null;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: cfg.gitName,
    GIT_AUTHOR_EMAIL: cfg.gitEmail,
    GIT_COMMITTER_NAME: cfg.gitName,
    GIT_COMMITTER_EMAIL: cfg.gitEmail,
  };
  gitCmd(exec, dir, ['commit', '-m', message], { env });
  return (gitCmd(exec, dir, ['rev-parse', 'HEAD']).stdout || '').trim() || null;
}

function runDeploy(cfg, exec, log) {
  let command = 'bash';
  let args;
  if (cfg.deployCmd) {
    args = ['-lc', cfg.deployCmd];
  } else {
    const runner = cfg.deployRunner || (cfg.deployRoot ? path.join(cfg.deployRoot, '.publish-deploy-runner.sh') : '');
    if (!runner) throw new Error('开启了 PUBLISH_DEPLOY_ENABLED，但没有 PUBLISH_DEPLOY_CMD / PUBLISH_DEPLOY_ROOT / PUBLISH_DEPLOY_RUNNER');
    const source = path.join(cfg.siteDir, 'ops', 'deploy-server.sh');
    if (!fs.existsSync(source)) throw new Error(`找不到发布脚本：${source}`);
    fs.mkdirSync(path.dirname(runner), { recursive: true });
    fs.copyFileSync(source, runner);
    args = [runner];
  }
  log(`运行部署：${command} ${args.join(' ')}`);
  runCmd(exec, command, args, { env: process.env });
}

function markPublished(cfg, digest, batchId, atIso) {
  const file = path.join(cfg.intake.metaDir, `${digest}.json`);
  const item = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = { ...item, status: 'published', publishedAt: atIso, batchId };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/* ---------------------------------------------------------------- 主流程 */

function makeBatchId(date) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', 'T');
  return `pb-${stamp}-${process.pid}`;
}

/**
 * 跑一次批量发布。默认 dry-run；返回结构化摘要，不抛业务异常
 * （配置 / 锁等启动期错误仍会抛出，由 main 统一报错）。
 */
export async function runBatch(cfg, deps = {}) {
  const exec = deps.exec || defaultExec;
  const log = deps.log || ((message) => process.stdout.write(`[publish] ${message}\n`));
  const now = deps.now || (() => new Date());
  const startedAt = now();
  const batchId = makeBatchId(startedAt);
  const workDir = path.join(cfg.workDir, batchId);

  const summary = {
    schema: PUBLISH_SCHEMA,
    batchId,
    mode: cfg.mode,
    dryRun: cfg.dryRun,
    status: 'noop',
    failed: false,
    error: null,
    step: 'init',
    readyTotal: 0,
    badMeta: [],
    publishable: 0,
    deferred: 0,
    duplicates: [],
    skipped: [],
    records: [],
    published: [],
    writtenFiles: { site: [], content: [] },
    commits: { site: null, content: null },
    pushed: false,
    deployed: false,
    journalPath: null,
  };

  let release;
  try {
    release = await acquirePublishLock(cfg.intake, { now: () => now().getTime(), staleMs: cfg.staleLockMs });
  } catch (error) {
    summary.status = 'failed';
    summary.failed = true;
    summary.error = error.message;
    return summary;
  }

  let journal = null;
  try {
    const { entries, bad } = await readReadyEntries(cfg.intake);
    summary.readyTotal = entries.length;
    summary.badMeta = bad;
    if (entries.length === 0) {
      log('中转区没有 ready 条目，no-op');
      summary.status = 'noop';
      return summary;
    }

    if (cfg.dryRun) {
      const manifests = loadManifests(cfg.siteDataDir);
      const plan = planBatch(cfg, entries, manifests, { nowIso: startedAt.toISOString() });
      applyPlan(summary, plan);
      summary.status = 'dry-run';
      logPlan(plan, log, cfg);
      return summary;
    }

    // live：先回收上次未完成批次，再读清单（reset --hard 会把清单恢复到 origin 基线）。
    summary.step = 'preflight';
    const previous = readLatestUnfinishedJournal(cfg);
    for (const repoKey of ['site', 'content']) {
      ensureRepoClean(cfg, exec, repoKey, previous, log);
    }

    const manifests = loadManifests(cfg.siteDataDir);
    const plan = planBatch(cfg, entries, manifests, { nowIso: startedAt.toISOString() });
    applyPlan(summary, plan);

    // 已发布同图：直接幂等标记，不需要写任何仓库。
    for (const duplicate of plan.duplicates) {
      markPublished(cfg, duplicate.sha256, batchId, startedAt.toISOString());
      summary.published.push(duplicate.sha256);
    }

    if (plan.publishable.length === 0) {
      summary.status = 'noop';
      if (plan.duplicates.length > 0) {
        summary.journalPath = writeJournal(cfg, {
          schema: PUBLISH_SCHEMA, batchId, startedAt: startedAt.toISOString(), status: 'succeeded',
          mode: cfg.mode, step: 'duplicates-only',
          sha256: plan.duplicates.map((entry) => entry.sha256), files: { site: [], content: [] },
          commits: { site: null, content: null }, pushed: false, deployed: false, error: null,
        });
      }
      log('没有可发布条目（重复或校验不过），不写任何仓库');
      return summary;
    }

    journal = {
      schema: PUBLISH_SCHEMA,
      batchId,
      startedAt: startedAt.toISOString(),
      status: 'in_progress',
      mode: cfg.mode,
      step: 'init',
      sha256: plan.publishable.map((item) => item.sha256),
      files: {
        site: [...SITE_ALLOWLIST],
        content: plan.publishable.flatMap((item) => [item.originalRel, item.previewRel, item.largeRel]),
      },
      commits: { site: null, content: null },
      pushed: false,
      deployed: false,
      error: null,
    };
    summary.journalPath = writeJournal(cfg, journal);

    summary.step = 'write';
    writeOriginals(cfg, plan.publishable);

    summary.step = 'manifest';
    const worksText = readWorksText(cfg);
    const added = updateWorksManifest(cfg, plan.publishable, worksText);

    summary.step = 'toolchain';
    runToolchain(cfg, exec, workDir);

    summary.step = 'discover';
    const changed = {
      site: discoverChanged(cfg, exec, 'site'),
      content: discoverChanged(cfg, exec, 'content'),
    };
    summary.writtenFiles = changed;

    const message = `feat: 批量发布投稿 ${batchId}（${plan.publishable.length} 件）\n\n${plan.publishable.map((item) => item.record.id).join('\n')}`;
    summary.step = 'commit';
    journal.commits = {
      site: commitRepo(cfg, exec, 'site', changed.site, message),
      content: commitRepo(cfg, exec, 'content', changed.content, message),
    };
    summary.commits = journal.commits;

    if (cfg.push) {
      summary.step = 'push';
      if (journal.commits.site) gitCmd(exec, cfg.siteDir, ['push', cfg.remote, `HEAD:${cfg.branch}`]);
      if (journal.commits.content) gitCmd(exec, cfg.contentDir, ['push', cfg.remote, `HEAD:${cfg.branch}`]);
      journal.pushed = true;
      summary.pushed = true;
    } else {
      log('未开启 PUBLISH_PUSH_ENABLED：只提交本地，不推送、不标记已发布');
    }

    if (cfg.push && cfg.deploy) {
      summary.step = 'deploy';
      runDeploy(cfg, exec, log);
      journal.deployed = true;
      summary.deployed = true;
    } else if (cfg.deploy && !cfg.push) {
      log('未推送，跳过部署（避免部署 origin 上的旧提交）');
    }

    summary.step = 'mark';
    if (cfg.push && cfg.deploy) {
      for (const item of plan.publishable) markPublished(cfg, item.sha256, batchId, startedAt.toISOString());
      summary.published.push(...plan.publishable.map((item) => item.sha256));
      journal.status = 'succeeded';
      summary.status = 'published';
      log(`发布完成：${plan.publishable.length} 件（清单新增 ${added} 条）`);
    } else {
      journal.status = 'incomplete';
      summary.status = 'staged';
      log('已写入并提交，但未推送/部署：保持 ready，下次开启开关后可重跑');
    }
    summary.journalPath = writeJournal(cfg, journal);
    return summary;
  } catch (error) {
    summary.status = 'failed';
    summary.failed = true;
    summary.error = error.message;
    if (journal) {
      journal.status = 'failed';
      journal.step = summary.step;
      journal.error = error.message;
      try { summary.journalPath = writeJournal(cfg, journal); } catch { /* 写日志失败不掩盖原始错误 */ }
    }
    log(`失败：${error.message}`);
    return summary;
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* 清理尽力而为 */ }
    await release();
  }
}

function applyPlan(summary, plan) {
  summary.publishable = plan.publishable.length;
  summary.deferred = plan.deferred || 0;
  summary.duplicates = plan.duplicates;
  summary.skipped = plan.skipped;
  summary.records = plan.publishable.map((item) => ({
    id: item.record.id,
    sha256: item.sha256,
    characterId: item.record.characterId,
    originalRel: item.originalRel,
  }));
}

function logPlan(plan, log, cfg) {
  log(`dry-run：ready ${plan.publishable.length + plan.skipped.length + plan.duplicates.length} 条，可发布 ${plan.publishable.length} 条`);
  for (const item of plan.publishable) {
    log(`  + ${item.record.id}  ${item.record.characterId}  ${item.record.name}  -> ${item.originalRel}`);
  }
  for (const duplicate of plan.duplicates) log(`  = 已发布同图 ${duplicate.sha256.slice(0, 12)}（只标记，不重写）`);
  for (const skipped of plan.skipped) log(`  · 保留 ${skipped.sha256.slice(0, 12)}：${skipped.problems.join('；')}`);
  log(`将写入：内容仓 ${plan.publishable.length * 3} 个文件（原图 + 预览 + 高清），站点仓 data/works.json`);
  log(`开关：AUTO=${cfg.dryRun ? 'false' : 'true'}  PUSH=${cfg.push}  DEPLOY=${cfg.deploy}（dry-run 不执行任何写操作）`);
}

/* ---------------------------------------------------------------- CLI */

function printSummary(summary, cfg) {
  if (cfg.args && cfg.args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`[publish] 批次 ${summary.batchId} 状态：${summary.status}（mode=${summary.mode}）\n`);
  process.stdout.write(`[publish] ready ${summary.readyTotal} 条 · 可发布 ${summary.publishable} 条 · 重复 ${summary.duplicates.length} 条 · 保留 ${summary.skipped.length} 条\n`);
  if (summary.journalPath) process.stdout.write(`[publish] 批次日志：${summary.journalPath}\n`);
  if (summary.failed) process.stdout.write(`[publish] 失败：${summary.error}\n`);
}

function printHelp() {
  process.stdout.write(`ops/publish-batch.mjs —— 自动批量发布（ready 中转条目 → 两个公开仓 → 部署）

用法：
  node ops/publish-batch.mjs [--dry-run] [--live] [--json] [--limit N]

默认 dry-run：只打印计划，不写任何工作树、不提交、不推送、不部署、不标记。
可写模式需要 AUTO_PUBLISH_ENABLED=true；推送需要 PUBLISH_PUSH_ENABLED=true；
部署需要 PUBLISH_DEPLOY_ENABLED=true。三者齐备且部署健康检查通过，才把条目置为 published。

必填环境变量：INTAKE_ROOT、PUBLISH_CONTENT_DIR（或 INTAKE_CONTENT_DIR / CONTENT_DIR）。
详见 docs/投稿自动化部署.md 与 ops/publish-batch.env.example。
`);
}

export async function main(argv = process.argv.slice(2)) {
  // --help 在解析路径配置之前处理，不要求已经配好 INTAKE_ROOT / 内容仓。
  if (parseArgv(argv).help) { printHelp(); return 0; }
  const cfg = resolvePublishConfig({ env: process.env, argv });
  process.stdout.write(`[publish] 站点仓=${cfg.siteDir}\n[publish] 内容仓=${cfg.contentDir}\n[publish] 中转区=${cfg.intake.root}\n[publish] 模式=${cfg.mode}  PUSH=${cfg.push}  DEPLOY=${cfg.deploy}\n`);
  const summary = await runBatch(cfg);
  printSummary(summary, cfg);
  return summary.failed ? 1 : 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`[publish] 错误：${error.message}\n`);
    process.exitCode = 1;
  });
}
