#!/usr/bin/env node
// tools/sync_content.mjs —— 从「内容仓库」把数据清单与派生资产同步进本代码仓库的 dist/ 工作区
//
// 背景：本站源码（本仓库）与图片/投稿内容（lmy414/ai-girl-stickers）已经分家。
// 本仓库的 dist/ 只跟踪手写的站点页面 / 样式 / 脚本；清单、派生图、原始数据一律
// 由内容仓库同步进来，是「临时工作区」，不提交、只供构建读取。
//
// 用法：
//   node tools/sync_content.mjs --content-dir <内容仓库根目录>
//   node tools/sync_content.mjs --content-dir=<路径>
//   CONTENT_DIR=<路径> node tools/sync_content.mjs
//
// 行为契约：
//   1. --content-dir / CONTENT_DIR 指向**内容仓库根目录**（不是它的 dist/）。
//      本脚本读 <内容仓库>/dist/<目标>，写 <本仓库>/dist/<同名目标>；
//      投稿模板是唯一的例外，它读 <内容仓库根>/.github/ISSUE_TEMPLATE/...，
//      同样写进 <本仓库>/dist/.github/...（见 ROOT_SYNC_FILE_TARGETS）。
//   2. 只同步下面 SYNC_FILE_TARGETS / ROOT_SYNC_FILE_TARGETS / SYNC_DIR_TARGETS
//      列出的目标；其余文件（手写页面、styles.css、tokens.css、analytics.js 等）
//      一律不碰。
//   3. 不复制 submissions/originals/，也不复制 owner-picks/ 根目录下的原图——
//      原图只留在内容仓库，线上走 GitHub Raw。
//   4. 覆盖语义：同步前先删除本仓库 dist/ 下**同名目标**（仅限清单内），再复制。
//      清理范围写死在清单里，不做任何通配/递归删除，且每一步都断言目标仍在
//      <本仓库>/dist 之内。
//   5. 缺文件即报错并非零退出：内容仓库必需的清单 / 数据 / 模板文件先校验存在。
//   6. 确定性复制：目录条目按名字排序后再复制，同一输入两次同步结果一致。
//   7. Windows / POSIX 路径都可以（统一走 node:path 解析）。
//
// 本仓库内不需要 Node 之外的依赖，也不联网。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DIST_DIR = path.join(REPO_ROOT, "dist");

// 从内容仓库 dist/ 同步到本仓库 dist/ 的单个文件（相对路径，POSIX 风格）。
const SYNC_FILE_TARGETS = [
  "characters.json",
  "categories.json",
  "blue-fish-ids.json",
  "submissions/works.json",
  "owner-picks/works.json",
  "favicon.ico",
  "favicon.png",
  "avatar.png",
];

// 从内容仓库**根目录**（不是它的 dist/）同步到本仓库 dist/ 的单个文件。
// 投稿模板归内容仓库管、放在它仓库根的 .github/，构建期同步一份进本仓库
// dist/.github/ 作为「同步内容」的副本；产物侧由 tools/build.mjs 的 SKIP_DIRS
// 排除 .github，不会进发布包。
const ROOT_SYNC_FILE_TARGETS = [".github/ISSUE_TEMPLATE/sticker-submission.yml"];

// 从内容仓库 dist/ 同步到本仓库 dist/ 的目录。
// 注意：不含 submissions/originals（原图不进构建）与 owner-picks.根原图。
const SYNC_DIR_TARGETS = [
  "submissions/previews",
  "submissions/large",
  "owner-picks/previews",
  "data",
];

const SYNC_TARGETS = [
  ...SYNC_FILE_TARGETS,
  ...ROOT_SYNC_FILE_TARGETS,
  ...SYNC_DIR_TARGETS,
];

// 内容仓库里必须存在的文件（相对内容仓库根）。
// 投稿模板不进 dist 的 data，但会被同步进本仓库 dist/.github/，所以先校验存在。
const REQUIRED_CONTENT_ROOT_FILES = [...ROOT_SYNC_FILE_TARGETS];

// 内容仓库 dist/ 里必须存在的具体文件（目录类目标另按目录校验）。
const REQUIRED_CONTENT_DIST_FILES = [
  ...SYNC_FILE_TARGETS,
  "data/blue-fish-classification.json",
];

function log(message) {
  process.stdout.write(`[sync-content] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[sync-content] 错误：${message}\n`);
  process.exit(1);
}

function toPosix(relPath) {
  return relPath.split(path.sep).join("/");
}

function parseArgs(argv) {
  let contentDir = process.env.CONTENT_DIR || null;
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
        "用法：node tools/sync_content.mjs --content-dir <内容仓库根目录>\n" +
          "  也可用环境变量 CONTENT_DIR 指定内容仓库根目录。\n",
      );
      process.exit(0);
    } else {
      fail(`无法识别的参数：${arg}（内容仓库根目录用 --content-dir 指定）`);
    }
  }
  if (contentDir === null || String(contentDir).trim() === "") {
    fail("必须指定内容仓库根目录：--content-dir <路径> 或 CONTENT_DIR=<路径>");
  }
  return { contentDir: path.resolve(String(contentDir).trim()) };
}

// 目标必须落在 <本仓库>/dist 之内，且不能就是 dist 本身。
function resolveInsideDist(relTarget) {
  const abs = path.resolve(DIST_DIR, relTarget.split("/").join(path.sep));
  const rel = path.relative(DIST_DIR, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    fail(`同步目标逃出本仓库 dist/，拒绝操作：${relTarget}`);
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

function requireDir(absPath, label) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    fail(`${label} 不存在：${absPath}`);
  }
  if (!stat.isDirectory()) {
    fail(`${label} 不是目录：${absPath}`);
  }
}

// 确定性递归复制：条目按名字排序；只复制文件与目录，遇到符号链接等按目标类型处理。
function copyTree(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs
    .readdirSync(srcDir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(srcPath, destPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      continue;
    }
    const target = fs.statSync(srcPath);
    if (target.isDirectory()) copyTree(srcPath, destPath);
    else if (target.isFile()) fs.copyFileSync(srcPath, destPath);
    else fail(`不支持的源条目类型：${srcPath}`);
  }
}

// 删除本仓库 dist/ 下同名目标（文件或目录）。只接受清单里的相对目标。
function cleanTarget(relTarget) {
  const abs = resolveInsideDist(relTarget);
  if (!fs.existsSync(abs)) return;
  fs.rmSync(abs, { recursive: true, force: true });
}

function countTreeFiles(absDir) {
  let total = 0;
  const stack = [absDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else total += 1;
    }
  }
  return total;
}

function main() {
  const { contentDir } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(contentDir) || !fs.statSync(contentDir).isDirectory()) {
    fail(`内容仓库目录不存在或不是目录：${contentDir}`);
  }
  if (path.resolve(contentDir) === REPO_ROOT) {
    fail("内容仓库目录不能是本代码仓库根目录");
  }

  const contentDist = path.join(contentDir, "dist");
  if (!fs.existsSync(contentDist) || !fs.statSync(contentDist).isDirectory()) {
    fail(`内容仓库里找不到 dist/：${contentDist}（--content-dir 应指向内容仓库根目录）`);
  }
  if (!fs.existsSync(DIST_DIR) || !fs.statSync(DIST_DIR).isDirectory()) {
    fail(`本仓库里找不到 dist/：${DIST_DIR}`);
  }

  // 1. 校验内容仓库必需文件存在。
  for (const rel of REQUIRED_CONTENT_ROOT_FILES) {
    requireFile(path.resolve(contentDir, ...rel.split("/")), `内容仓库 ${rel}`);
  }
  for (const rel of REQUIRED_CONTENT_DIST_FILES) {
    requireFile(path.resolve(contentDist, ...rel.split("/")), `内容仓库 dist/${rel}`);
  }
  for (const rel of SYNC_DIR_TARGETS) {
    requireDir(path.resolve(contentDist, ...rel.split("/")), `内容仓库 dist/${rel}`);
  }

  log(`内容仓库：${contentDir}`);
  log(`本仓库 dist：${DIST_DIR}`);
  log(`同步目标：${SYNC_TARGETS.join(", ")}`);

  // 2. 只清理清单内的同名目标。
  for (const rel of SYNC_TARGETS) cleanTarget(rel);

  // 3. 复制。单文件来自内容仓库 dist/，投稿模板来自内容仓库根。
  for (const rel of SYNC_FILE_TARGETS) {
    const srcPath = path.resolve(contentDist, ...rel.split("/"));
    const destPath = resolveInsideDist(rel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }
  for (const rel of ROOT_SYNC_FILE_TARGETS) {
    const srcPath = path.resolve(contentDir, ...rel.split("/"));
    const destPath = resolveInsideDist(rel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }
  for (const rel of SYNC_DIR_TARGETS) {
    const srcPath = path.resolve(contentDist, ...rel.split("/"));
    const destPath = resolveInsideDist(rel);
    copyTree(srcPath, destPath);
  }

  const files = SYNC_FILE_TARGETS.length + ROOT_SYNC_FILE_TARGETS.length;
  let dirFiles = 0;
  for (const rel of SYNC_DIR_TARGETS) {
    dirFiles += countTreeFiles(resolveInsideDist(rel));
  }
  log(`同步完成：单文件 ${files} 个，目录内文件 ${dirFiles} 个`);
  log(`已跳过（不入本仓库 dist）：submissions/originals、owner-picks 根原图`);
  log(
    `同步目录清单：${SYNC_DIR_TARGETS.map((rel) => toPosix(rel)).join(", ")}`,
  );
}

main();
