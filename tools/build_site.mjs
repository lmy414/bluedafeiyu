#!/usr/bin/env node
// tools/build_site.mjs —— 站点构建编排（暂存数据 → 同步图片 → 快照 → 详情页 → sitemap → 发布产物）
//
// 站点源码 / 结构化数据 / 自动化逻辑都在本仓库；内容仓库只提供图片与 Issue 模板：
//   代码仓库：本仓库（手写页面、样式、生成器、构建器、发布脚本、data/ 清单）
//   内容仓库：lmy414/ai-girl-stickers（原图 / 派生图 / 站点图标 / QQ 群二维码、投稿模板）
//
// 用法：
//   node tools/build_site.mjs --content-dir <内容仓库根目录> [--out <目录>] [--force-clean]
//   CONTENT_DIR=<路径> node tools/build_site.mjs [--out <目录>]
//
// 步骤（顺序固定）：
//   1. tools/stage_data.mjs          把本仓库 data/ 的清单暂存成 dist/ 下的产物路径
//   2. tools/sync_content.mjs        把内容仓库的图片同步进本仓库 dist/
//   3. tools/build_site_snapshot.mjs  归一成 dist/site-data.json + site-data.js
//   4. tools/generate_work_pages.mjs  生成 dist/works/<slug>.html（幂等、确定性）
//   5. tools/generate_sitemap.mjs     生成 dist/sitemap.xml
//   6. tools/build.mjs                复制 dist/ 成干净发布产物（跳过 data/ 与 submissions/originals）
//
// 刻意**不**在构建期跑 tools/prepare_works.mjs：它会重算/冻结 slug，
// 一经发布即冻结，构建期绝不能再跑（该脚本现在也归本仓库 tools/）。
//
// 任一步失败即非零退出，后续步骤不再执行。--out / --force-clean 原样透传给 tools/build.mjs。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

function log(message) {
  process.stdout.write(`[build-site] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[build-site] 错误：${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let contentDir = process.env.CONTENT_DIR || null;
  const passthrough = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--content-dir") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        fail("--content-dir 后面必须跟一个目录路径");
      }
      contentDir = value;
      i += 1;
    } else if (arg.startsWith("--content-dir=")) {
      contentDir = arg.slice("--content-dir=".length);
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "用法：node tools/build_site.mjs --content-dir <内容仓库根目录> [--out <目录>] [--force-clean]\n",
      );
      process.exit(0);
    } else if (arg === "--out" || arg === "--force-clean") {
      passthrough.push(arg);
      if (arg === "--out") {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
          fail("--out 后面必须跟一个目录路径");
        }
        passthrough.push(value);
        i += 1;
      }
    } else if (arg.startsWith("--out=")) {
      passthrough.push(arg);
    } else {
      fail(`无法识别的参数：${arg}`);
    }
  }
  if (contentDir === null || String(contentDir).trim() === "") {
    fail("必须指定内容仓库根目录：--content-dir <路径> 或 CONTENT_DIR=<路径>");
  }
  const resolved = path.resolve(String(contentDir).trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    fail(`内容仓库目录不存在或不是目录：${resolved}`);
  }
  return { contentDir: resolved, passthrough };
}

// 用同一个 node 可执行文件跑子步骤；CONTENT_DIR 传下去，供 build.mjs /
// sync_issue_template.mjs 定位内容仓库的投稿模板。
function runStep(scriptRel, extraArgs, contentDir) {
  const scriptAbs = path.join(REPO_ROOT, ...scriptRel.split("/"));
  if (!fs.existsSync(scriptAbs)) {
    fail(`找不到子步骤脚本：${scriptAbs}`);
  }
  log(`运行 ${scriptRel}${extraArgs.length ? " " + extraArgs.join(" ") : ""}`);
  const result = spawnSync(process.execPath, [scriptAbs, ...extraArgs], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, CONTENT_DIR: contentDir },
  });
  if (result.error) {
    fail(`${scriptRel} 启动失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${scriptRel} 退出码 ${result.status === null ? "null" : result.status}，构建中止`);
  }
}

function main() {
  const { contentDir, passthrough } = parseArgs(process.argv.slice(2));
  log(`代码仓库：${REPO_ROOT}`);
  log(`内容仓库：${contentDir}`);

  runStep("tools/stage_data.mjs", [], contentDir);
  runStep("tools/sync_content.mjs", ["--content-dir", contentDir], contentDir);
  runStep("tools/build_site_snapshot.mjs", [], contentDir);
  runStep("tools/generate_work_pages.mjs", [], contentDir);
  runStep("tools/generate_sitemap.mjs", [], contentDir);
  runStep("tools/build.mjs", [...passthrough, "--content-dir", contentDir], contentDir);

  log("站点构建完成");
}

main();
