#!/usr/bin/env node
// tools/stage_data.mjs —— 把本仓库自己跟踪的结构化数据（data/）暂存进构建工作区 dist/
//
// 背景：站点拆成两个仓库后，「程序 + 结构化数据 + 自动化逻辑」归本仓库
// （lmy414/bluedafeiyu），内容仓库（lmy414/ai-girl-stickers）只留图片 / 文档 /
// Issue 模板。角色、分类、投稿清单、id 冻结映射、首批编辑叠加层这些**清单类
// JSON** 因此从内容仓库的 dist/ 迁到了本仓库的 data/。
//
// 但这些清单在发布产物里仍有固定的对外路径（如 /characters.json、
// /submissions/works.json）——站点页面之外还有外链与健康检查在按这些路径取。
// 所以构建时需要把 data/ 里的权威副本「暂存」成 dist/ 下同名的产物路径，
// 再由 tools/build.mjs 复制进发布产物。这一步只做复制，不改写 JSON 内容。
//
// 用法：
//   node tools/stage_data.mjs
//
// 行为契约：
//   1. 只处理下面 STAGE_TARGETS 列出的映射；data/ 里其余文件不碰。
//   2. 源文件缺失或为空即报错并非零退出。
//   3. 覆盖语义：先删 dist/ 下同名目标（仅限清单内），再逐字节复制；不做通配删除，
//      且每一步都断言目标仍在本仓库 dist/ 之内。
//   4. 确定性：同一输入两次运行结果一致，不改写 JSON 的换行或字段顺序。
//   5. 只用 Node 内置模块；不联网、不读内容仓库。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const DIST_DIR = path.join(REPO_ROOT, "dist");

// data/ 里的权威副本 → dist/ 里对外路径，一一对应。
// 前五项是发布产物里要保留的公开清单；后两项是首批「蓝色大肥鱼档案馆」的
// raw 清单与编辑叠加层，只在构建期被 tools/build_site_snapshot.mjs 读取，
// 不进发布产物（tools/build.mjs 的 SKIP_DIRS 跳过 data/）。
const STAGE_TARGETS = [
  { from: "characters.json", to: "characters.json" },
  { from: "categories.json", to: "categories.json" },
  { from: "blue-fish-ids.json", to: "blue-fish-ids.json" },
  { from: "works.json", to: "submissions/works.json" },
  { from: "owner-picks.json", to: "owner-picks/works.json" },
  { from: "blue-fish-classification.json", to: "data/blue-fish-classification.json" },
  { from: "blue-fish-editorial.json", to: "data/blue-fish-editorial.json" },
];

function log(message) {
  process.stdout.write(`[stage-data] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[stage-data] 错误：${message}\n`);
  process.exit(1);
}

// 目标必须落在 <本仓库>/dist 之内，且不能就是 dist 本身。
function resolveInsideDist(relPosix) {
  const abs = path.resolve(DIST_DIR, relPosix.split("/").join(path.sep));
  const rel = path.relative(DIST_DIR, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    fail(`暂存目标逃出本仓库 dist/，拒绝操作：${relPosix}`);
  }
  return abs;
}

function requireFile(absPath, label) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    fail(`${label} 不存在：${absPath}`);
  }
  if (!stat.isFile() || stat.size <= 0) {
    fail(`${label} 不是非空文件：${absPath}`);
  }
}

function main() {
  if (!fs.existsSync(DATA_DIR) || !fs.statSync(DATA_DIR).isDirectory()) {
    fail(`找不到结构化数据目录：${DATA_DIR}`);
  }
  if (!fs.existsSync(DIST_DIR) || !fs.statSync(DIST_DIR).isDirectory()) {
    fail(`找不到站点源目录：${DIST_DIR}`);
  }

  // 1. 先校验源文件齐全，避免半途失败留下残缺工作区。
  for (const { from } of STAGE_TARGETS) {
    requireFile(path.resolve(DATA_DIR, ...from.split("/")), `data/${from}`);
  }

  // 2. 清理清单内同名目标，再逐字节复制。
  for (const { from, to } of STAGE_TARGETS) {
    const srcPath = path.resolve(DATA_DIR, ...from.split("/"));
    const destPath = resolveInsideDist(to);
    fs.rmSync(destPath, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }

  log(`结构化数据目录：${DATA_DIR}`);
  log(`暂存 ${STAGE_TARGETS.length} 个清单到 dist/：${STAGE_TARGETS.map((t) => t.to).join(", ")}`);
  log("data/blue-fish-classification.json 与 data/blue-fish-editorial.json 只在构建期读取，不进发布产物");
}

main();
