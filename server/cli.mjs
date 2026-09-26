#!/usr/bin/env node
/* server/cli.mjs —— 统一投稿服务的命令行入口
 *
 *   SUBMISSION_STORAGE_ROOT=/srv/www/dafeiyu/submission-private \
 *   SUBMISSION_ADMIN_TOKEN=... node server/cli.mjs serve
 *
 * 命令：
 *   doctor                   校验配置与私有存储根，打印脱敏摘要（不发网络请求）
 *   serve                    启动公开入口 + 管理入口
 *   recover                  启动前恢复：卡住的审核转人工、重建索引
 *   enqueue <图片> [--name --character --description]   把本地图放进队列
 *   list [--state --source --json]
 *   show <id>
 *   export <id> --out ./review
 *   review [<id>...] [--all] [--limit N]   跑 AI 审核（未配置则一律转人工）
 *   approve <id> [--reason ...]
 *   reject <id> [--reason ...]
 *   pull-issues [--issue N] [--state open] [--since <ISO>|auto] [--max-pages N] [--full]
 *   bridge-passed [<id>...] [--limit N]    把 auto_passed 且内容完整的条目桥接进私有中转区
 *   bridge-ready [--json]                  列出中转区 ready 条目
 *   stats
 *
 * 注意：本服务**不会**自动把图片写进内容仓、不会推送、不会发布。
 * approve 只是人工审核通过，后续收录仍由维护者按既有流程做。
 * 桥接只写 INTAKE_ROOT 的 inbox/ 与 meta/，需要显式配置 INTAKE_ROOT 与
 * INTAKE_CONTENT_DIR 才启用；缺配置是可观测 skipped，不影响队列。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { configSummary, resolveConfig } from './config.mjs';
import { createQueue, sha256, STATES } from './queue.mjs';
import { createReviewer, reviewPending } from './review.mjs';
import { createBridge } from './bridge.mjs';
import { createGithubAdapter } from './adapters/github.mjs';
import { createQqAdapter } from './adapters/qq.mjs';
import { startServers } from './http.mjs';

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) options[key] = true;
      else { options[key] = next; i += 1; }
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

function die(message) {
  console.error(`× ${message}`);
  process.exit(1);
}

function optionValue(options, key, fallback = '') {
  return options[key] && options[key] !== true ? String(options[key]) : fallback;
}

async function loadCharacters(cfg) {
  try {
    const records = JSON.parse(await fs.readFile(path.join(cfg.siteRoot, 'data', 'characters.json'), 'utf8'));
    return records.map((entry) => entry.id).filter(Boolean);
  } catch {
    return [];
  }
}

async function buildContext(cfg, { fetchImpl } = {}) {
  const queue = await createQueue(cfg);
  const reviewer = createReviewer(cfg, { fetchImpl });
  const bridge = await createBridge({ queue });
  const githubAdapter = createGithubAdapter(cfg, { queue, fetchImpl });
  const qqAdapter = createQqAdapter(cfg, { queue, fetchImpl });
  const characters = await loadCharacters(cfg);
  return { queue, reviewer, bridge, githubAdapter, qqAdapter, characters };
}

const commands = {
  async doctor(cfg) {
    const summary = configSummary(cfg);
    console.log(JSON.stringify(summary, null, 2));
    console.log('\n检查：');
    console.log(`  √ 存储根可写且不在公开仓：${summary.storageRoot}`);
    console.log(`  ${summary.adminToken === 'configured' ? '√' : '·'} 管理令牌：${summary.adminToken}`);
    console.log(`  ${summary.review.configured ? '√' : '·'} AI 审核：${summary.review.configured ? '已配置（仅手动触发，不会自动跑）' : '未配置（一律转人工）'}`);
    const internal = summary.internalReview || {};
    console.log(`  ${internal.enabled ? '√' : '·'} 内部审核令牌：astrbot=${internal.astrbot || 'absent'} hermes=${internal.hermes || 'absent'}`);
    console.log(`  ${summary.qq.enabled ? '√' : '·'} QQ 入站：${summary.qq.enabled ? '已开启' : '未开启'}`);
    console.log(`  ${summary.github.token === 'configured' ? '√' : '·'} GitHub 令牌：${summary.github.token}`);
    console.log('\n注意：doctor 不发任何网络请求，也不构造真实 AI 客户端。');
  },

  async serve(cfg) {
    const context = await buildContext(cfg);
    await context.queue.recover();
    const servers = await startServers(cfg, context);
    const publicPort = servers.publicServer.address().port;
    const adminPort = servers.adminServer.address().port;
    console.log(`公开投稿入口 http://${cfg.publicHost}:${publicPort}`);
    console.log(`管理接口（仅回环） http://${cfg.adminHost}:${adminPort}`);
    console.log(`私有存储根 ${cfg.storageRoot}`);
    console.log(`AI 审核：${context.reviewer.configured ? '已配置（仅管理端手动触发）' : '未配置（一律转人工）'}`);
    console.log('内置 AI 自动审核：已关闭（入队不自动审；结论由内部审核接口回写）');
    console.log(`内部审核接口：${cfg.internalReview.enabled ? '已开启（astrbot / hermes 独立令牌）' : '未开启（未配置审核令牌）'}`);
    console.log(`QQ 入站：${context.qqAdapter.enabled ? '已开启' : '未开启'}`);
    console.log(`自动桥接：${context.bridge.enabled ? '已开启' : `未启用（${context.bridge.reason}）`}`);
    console.log('本服务不会自动发布；图片入库后由维护者人工收录。');
    const shutdown = async () => { await servers.close(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  },

  async recover(cfg) {
    const queue = await createQueue(cfg);
    const result = await queue.recover();
    console.log(`恢复完成：转人工 ${result.recovered.length} 条，索引已重建。`);
  },

  async enqueue(cfg, { options, positional }) {
    if (positional.length === 0) die('enqueue 需要至少一个图片路径');
    const queue = await createQueue(cfg);
    for (const file of positional) {
      const buffer = await fs.readFile(file);
      const digest = sha256(buffer);
      const result = await queue.enqueue({
        source: 'local',
        sourceId: `local:${digest}`,
        buffer,
        fields: {
          name: optionValue(options, 'name', path.basename(file)),
          character: optionValue(options, 'character'),
          description: optionValue(options, 'description'),
        },
        origin: { via: 'cli', fileName: path.basename(file) },
      });
      console.log(`${result.status === 'created' ? '+' : '='} ${result.item.id}  ${result.status}  ${file}`);
    }
  },

  async list(cfg, { options }) {
    const queue = await createQueue(cfg);
    const items = await queue.list({
      state: optionValue(options, 'state') || undefined,
      source: optionValue(options, 'source') || undefined,
      limit: optionValue(options, 'limit') ? Number(optionValue(options, 'limit')) : undefined,
    });
    if (options.json) {
      console.log(JSON.stringify(items, null, 2));
      return;
    }
    if (items.length === 0) {
      console.log('队列是空的。');
      return;
    }
    console.log(`${'id'.padEnd(30)}${'来源'.padEnd(14)}${'状态'.padEnd(14)}名字`);
    for (const item of items) {
      console.log(`${item.id.padEnd(30)}${String(item.source).padEnd(14)}${String(item.state).padEnd(14)}${item.fields.name || '(未填)'}`);
    }
    console.log(`\n共 ${items.length} 条。`);
  },

  async show(cfg, { positional }) {
    if (!positional[0]) die('show 需要 id');
    const queue = await createQueue(cfg);
    const item = await queue.get(positional[0]);
    if (!item) die(`队列里没有 ${positional[0]}`);
    console.log(JSON.stringify(item, null, 2));
  },

  async export(cfg, { options, positional }) {
    if (!positional[0]) die('export 需要 id');
    const queue = await createQueue(cfg);
    const item = await queue.get(positional[0]);
    if (!item) die(`队列里没有 ${positional[0]}`);
    const outDir = path.resolve(optionValue(options, 'out', './review'));
    await fs.mkdir(outDir, { recursive: true });
    const target = path.join(outDir, `${item.id}${item.ext}`);
    await fs.writeFile(target, await queue.readImage(item.id), { mode: 0o600 });
    console.log(`已导出 ${target}`);
  },

  async review(cfg, { options, positional }) {
    const { queue, reviewer } = await buildContext(cfg);
    if (!reviewer.configured) {
      console.log('提示：AI 审核未配置，本次一律转人工（不会假造结论）。');
    }
    const results = await reviewPending(queue, reviewer, {
      ids: positional,
      limit: optionValue(options, 'limit') ? Number(optionValue(options, 'limit')) : 50,
    });
    for (const entry of results) {
      console.log(`${String(entry.verdict).padEnd(8)}${entry.id}  ${entry.reason || ''}`);
    }
    console.log(`\n共审核 ${results.length} 条。通过后会自动进入私有中转区，下一次批量发布处理；下架仍需人工。`);
  },

  async 'review-received'(cfg, { options }) {
    const { queue, reviewer, bridge } = await buildContext(cfg);
    const limit = optionValue(options, 'limit') ? Number(optionValue(options, 'limit')) : 50;
    const received = await queue.list({ state: STATES.RECEIVED, limit });
    const results = [];
    for (const item of received) {
      try {
        const result = await reviewPending(queue, reviewer, { ids: [item.id], limit: 1 });
        results.push({ id: item.id, ...(result[0] || { verdict: 'manual', reason: '没有审核结果' }) });
      } catch (error) {
        results.push({ id: item.id, verdict: 'manual', reason: error.message });
      }
    }
    const bridged = await bridge.bridgePending({ limit });
    for (const entry of results) {
      console.log(`${String(entry.verdict).padEnd(8)}${entry.id}  ${entry.reason || ''}`);
    }
    console.log(`\n即时审核 ${results.length} 条；桥接 ready ${bridged.ready} 条。`);
  },

  async approve(cfg, { options, positional }) {
    if (!positional[0]) die('approve 需要 id');
    const queue = await createQueue(cfg);
    const item = await queue.decide(positional[0], 'approved', { actor: 'maintainer', reason: optionValue(options, 'reason') });
    console.log(`已批准 ${item.id}（state=${item.state}）。服务不会自动收录/发布，请按既有流程人工入库。`);
  },

  async reject(cfg, { options, positional }) {
    if (!positional[0]) die('reject 需要 id');
    const queue = await createQueue(cfg);
    const item = await queue.decide(positional[0], 'rejected', { actor: 'maintainer', reason: optionValue(options, 'reason') });
    console.log(`已拒绝 ${item.id}（state=${item.state}）。`);
  },

  async 'pull-issues'(cfg, { options }) {
    const { queue, githubAdapter } = await buildContext(cfg);

    /* --since <ISO> 显式起点；--since（不带值）与不传都表示用已持久化游标；
     * --full / --no-since 强制忽略游标做一次全量。默认行为兼容原有手动命令。 */
    let since;
    if (options.full || options['no-since']) since = null;
    else if (options.since === undefined) since = undefined;
    else if (options.since === true || String(options.since).toLowerCase() === 'auto') since = undefined;
    else since = String(options.since);

    const maxPagesRaw = optionValue(options, 'max-pages');
    let maxPages;
    if (maxPagesRaw) {
      maxPages = Number(maxPagesRaw);
      if (!Number.isSafeInteger(maxPages) || maxPages <= 0) die(`--max-pages 必须是正整数：${maxPagesRaw}`);
    }

    const results = await githubAdapter.pullIssues({
      issue: optionValue(options, 'issue') ? Number(optionValue(options, 'issue')) : null,
      state: optionValue(options, 'state', 'open'),
      since,
      ...(maxPages ? { maxPages } : {}),
    });
    for (const entry of results) {
      console.log(`${String(entry.status).padEnd(16)}#${entry.issue}  ${entry.item ? entry.item.id : ''}  ${entry.error || ''}`);
    }
    console.log(`\n共处理 ${results.length} 个附件，入队 ${(await queue.list()).length} 条。`);
    const cursor = await githubAdapter.readCursor();
    if (cursor && cursor.since) console.log(`增量游标 since=${cursor.since}（下次拉取只取更新的 Issue；--full 可强制全量）`);
  },

  /**
   * 把 auto_passed 且完整 content schema 合法的条目桥接进私有中转区。
   * 只写 INTAKE_ROOT 的 inbox/ + meta/；不写内容仓、不跑 git、不提交。
   */
  async 'bridge-passed'(cfg, { options, positional }) {
    const queue = await createQueue(cfg);
    const bridge = await createBridge({ queue });
    if (!bridge.enabled) {
      console.log(`bridge-passed skipped：${bridge.reason}`);
      return;
    }
    const pending = await bridge.bridgePending({
      ids: positional,
      limit: optionValue(options, 'limit') ? Number(optionValue(options, 'limit')) : 200,
    });
    if (pending.results.length === 0) console.log('没有 auto_passed 的条目可桥接。');
    for (const entry of pending.results) {
      console.log(`${String(entry.status).padEnd(10)}${String(entry.sha256 || '').slice(0, 12).padEnd(14)}${entry.id}  ${entry.reason || ''}`);
    }
    console.log(`\n就绪 ${pending.ready}，重复 ${pending.duplicate}，跳过 ${pending.skipped}，失败 ${pending.failed}。`);
    console.log(`中转区 ${bridge.intake.root}；发布由后续批次负责，本命令不提交 Git。`);
  },

  /** 列出中转区 ready 条目（供人工查看与后续发布批次消费）。 */
  async 'bridge-ready'(cfg, { options }) {
    const queue = await createQueue(cfg);
    const bridge = await createBridge({ queue });
    if (!bridge.enabled) {
      console.log(`bridge-ready skipped：${bridge.reason}`);
      return;
    }
    const items = await bridge.listReady();
    if (options.json) {
      console.log(JSON.stringify(items, null, 2));
      return;
    }
    if (items.length === 0) {
      console.log('中转区没有 ready 条目。');
      return;
    }
    console.log(`${'sha256'.padEnd(14)}${'字节'.padEnd(10)}${'投稿 id'.padEnd(30)}名字`);
    for (const item of items) {
      const name = (item.fields && item.fields.name) || '(未填)';
      console.log(`${String(item.sha256).slice(0, 12).padEnd(14)}${String(item.bytes).padEnd(10)}${String(item.submissionId || '').padEnd(30)}${name}`);
    }
    console.log(`\n共 ${items.length} 条 ready；中转区 ${bridge.intake.root}`);
  },

  async stats(cfg) {
    const queue = await createQueue(cfg);
    console.log(JSON.stringify(await queue.stats(), null, 2));
    console.log(`\n状态枚举：${Object.values(STATES).join(' / ')}`);
  },

  help() {
    console.log(`统一投稿服务 · 可用命令

  doctor                    校验配置与私有存储根（不发网络请求）
  serve                     启动公开投稿入口 + 管理接口
  recover                   恢复卡住的审核、重建索引
  enqueue <图片...>         把本地图放进队列
  list / show / export      查看与导出
  review [<id>...] [--all]  跑 AI 审核（未配置一律转人工）
  approve <id> / reject <id> 人工审核结论
  pull-issues               拉取 ai-girl-stickers 投稿 Issue 附件
                            [--state open] [--issue N] [--max-pages N]
                            [--since ISO] [--full]  默认走已存 since 游标，--full 全量
  bridge-passed [<id>...]   把 auto_passed 且内容完整的条目桥接进私有中转区
  bridge-ready [--json]     列出中转区 ready 条目
  stats                     队列计数

配置走环境变量：SUBMISSION_STORAGE_ROOT（必填）
                SUBMISSION_ADMIN_TOKEN / SUBMISSION_ALLOWED_ORIGINS
                SUBMISSION_AI_ENDPOINT / SUBMISSION_AI_API_KEY / SUBMISSION_AI_MODEL
                              （仅管理端手动触发，入队不再自动审核）
                SUBMISSION_ASTRABOT_REVIEW_TOKEN   内部审核 reviewer=astrbot 的独立令牌
                SUBMISSION_HERMES_REVIEW_TOKEN     内部审核 reviewer=hermes 的独立令牌
                              （配了才开放 POST /api/v1/internal/review-results 与内部列表）
                SUBMISSION_GITHUB_REPO（默认 lmy414/ai-girl-stickers）/ SUBMISSION_GITHUB_TOKEN
                SUBMISSION_GITHUB_MAX_PAGES / SUBMISSION_GITHUB_PER_PAGE
                SUBMISSION_GITHUB_MAX_RETRIES / SUBMISSION_GITHUB_RETRY_BASE_MS / SUBMISSION_GITHUB_RETRY_MAX_MS
                SUBMISSION_QQ_ENABLED / SUBMISSION_QQ_INBOUND_TOKEN / SUBMISSION_QQ_GROUP_ALLOWLIST
                INTAKE_ROOT / INTAKE_CONTENT_DIR（两个都显式配置才启用桥接）`);
  },
};

const { options, positional } = parseArgs(process.argv.slice(2));
const command = positional.shift() || 'help';
if (options.help || command === 'help' || command === '--help') {
  commands.help();
  process.exit(0);
}
const action = commands[command];
if (!action) die(`未知命令 ${command}（node server/cli.mjs help 看可用命令）`);

let cfg;
try {
  cfg = resolveConfig();
} catch (error) {
  die(error.message);
}

try {
  await action(cfg, { options, positional });
} catch (error) {
  die(error.message);
}
