#!/usr/bin/env node
// tools/compress_static.mjs —— 发布产物的文本资源 gzip 预压缩（零依赖，Node 内置 zlib）
//
// 用途：给「已经构建好的发布产物」（tools/build.mjs 的输出，默认 .build/site）里的
// 文本资源生成同名 .gz，供 nginx `gzip_static on;` 直接回发，省掉每个请求的实时压缩。
//
// 默认只「报告」：扫描并统计可压缩文件与预计收益，不写任何文件。
// 显式加 --precompress 才真正写出 .gz。这样每个 release 不会被无条件撑大。
//
// 用法：
//   node tools/compress_static.mjs --dir .build/site              # 只报告（默认）
//   node tools/compress_static.mjs --dir .build/site --precompress # 写出 .gz
//   node tools/compress_static.mjs --dir .build/site --precompress --level 9
//
// 参数：
//   --dir <目录>     发布产物根目录（默认 .build/site）。拒绝站点源目录 dist/ 与仓库根，
//                    保证 .gz 只落在构建产物里、绝不会混进源码仓库。
//   --precompress    真正写出 .gz（默认只报告）
//   --level <1-9>    gzip 压缩级别，默认 6
//   --min-size <字节> 小于该体积的文件跳过，默认 1024
//
// 性质：只读输入文件 + 可选写 .gz，不删原文件、不改写文本、不访问网络。
// 遍历按路径排序、压缩级别固定，同一输入同一 Node 版本两次运行产出一致。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DIST_DIR = path.join(REPO_ROOT, "dist");

// 会生成 .gz 的文本扩展名（小写，含点）。
const TEXT_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".xml",
  ".svg",
  ".txt",
  ".map",
]);

const DEFAULT_LEVEL = 6;
const DEFAULT_MIN_SIZE = 1024;

function log(message) {
  process.stdout.write(`[compress] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[compress] 错误：${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let dir = path.join(REPO_ROOT, ".build", "site");
  let precompress = false;
  let level = DEFAULT_LEVEL;
  let minSize = DEFAULT_MIN_SIZE;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) fail("--dir 后面必须跟一个目录路径");
      dir = value;
      i += 1;
    } else if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (arg === "--precompress") {
      precompress = true;
    } else if (arg === "--level") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) fail("--level 后面必须跟 1-9 的数字");
      level = Number(value);
      i += 1;
    } else if (arg.startsWith("--level=")) {
      level = Number(arg.slice("--level=".length));
    } else if (arg === "--min-size") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) fail("--min-size 后面必须跟字节数");
      minSize = Number(value);
      i += 1;
    } else if (arg.startsWith("--min-size=")) {
      minSize = Number(arg.slice("--min-size=".length));
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "用法：node tools/compress_static.mjs [--dir <发布产物目录>] [--precompress] [--level 1-9] [--min-size <字节>]\n" +
          "  默认只报告收益；--precompress 才写出 .gz（不会进源码仓库，只落在产物目录里）。\n",
      );
      process.exit(0);
    } else {
      fail(`无法识别的参数：${arg}`);
    }
  }

  if (!Number.isInteger(level) || level < 1 || level > 9) {
    fail(`--level 必须是 1-9 的整数，收到：${level}`);
  }
  if (!Number.isFinite(minSize) || minSize < 0) {
    fail(`--min-size 必须是非负数字，收到：${minSize}`);
  }

  const dirAbs = path.resolve(String(dir).trim());
  if (!isSafeOutputDir(dirAbs)) {
    fail(
      `拒绝在源码目录上操作：${dirAbs}\n` +
        `  --dir 必须指向构建产物（默认 .build/site），不能是仓库根或站点源目录 dist/。`,
    );
  }
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
    fail(`产物目录不存在或不是目录：${dirAbs}\n  先跑 node tools/build_site.mjs 生成产物。`);
  }
  return { dirAbs, precompress, level, minSize };
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isSafeOutputDir(dirAbs) {
  if (dirAbs === REPO_ROOT) return false;
  if (dirAbs === DIST_DIR || isInside(dirAbs, DIST_DIR)) return false;
  return true;
}

function walk(dirAbs, relPrefix, out) {
  const entries = fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const rel = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      walk(abs, rel, out);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push({ rel, abs });
    }
    // 上一轮写出的 .gz / .br 扩展名不在 TEXT_EXTENSIONS 里，会在上面这轮被自然跳过：
    // 重复运行不会把 .gz 当成输入，写出时也是 fs.writeFileSync 覆盖同名文件，结果确定。
  }
  return out;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function main() {
  const { dirAbs, precompress, level, minSize } = parseArgs(process.argv.slice(2));

  log(`产物目录：${dirAbs}`);
  log(`模式：${precompress ? `写出 .gz（level ${level}）` : "只报告（加 --precompress 才写出）"}`);

  const files = walk(dirAbs, "", []);
  let considered = 0;
  let skippedSmall = 0;
  let gzipped = 0;
  let written = 0;
  let skippedLarger = 0;
  let rawTotal = 0;
  let gzTotal = 0;
  const rows = [];

  for (const file of files) {
    const raw = fs.readFileSync(file.abs);
    if (raw.length < minSize) {
      skippedSmall += 1;
      continue;
    }
    considered += 1;
    const gz = zlib.gzipSync(raw, { level });
    rawTotal += raw.length;

    if (gz.length >= raw.length) {
      // 压不小就放弃：避免为几个字节的收益多留一份文件。
      skippedLarger += 1;
      gzTotal += raw.length;
      continue;
    }
    gzTotal += gz.length;
    gzipped += 1;
    const ratio = ((1 - gz.length / raw.length) * 100).toFixed(1);
    rows.push({ rel: file.rel, raw: raw.length, gz: gz.length, ratio });

    if (precompress) {
      const target = `${file.abs}.gz`;
      fs.writeFileSync(target, gz);
      written += 1;
    }
  }

  rows.sort((a, b) => b.raw - a.raw);
  for (const row of rows.slice(0, 20)) {
    log(
      `  ${row.rel}  ${formatBytes(row.raw)} → ${formatBytes(row.gz)}（省 ${row.ratio}%）`,
    );
  }
  if (rows.length > 20) log(`  …… 其余 ${rows.length - 20} 个文件略`);

  const saving = rawTotal > 0 ? ((1 - gzTotal / rawTotal) * 100).toFixed(1) : "0.0";
  log(`候选文本文件：${considered}（跳过过小 ${skippedSmall}，压不小 ${skippedLarger}）`);
  log(`可压缩：${gzipped} 个，文本总体积 ${formatBytes(rawTotal)} → ${formatBytes(gzTotal)}（省 ${saving}%）`);
  if (precompress) {
    log(`已写出 .gz：${written} 个。产物目录如需重跑构建，先删掉这些 .gz 再跑，或让发布脚本忽略 *.gz。`);
  } else {
    log("未写出任何文件。启用 nginx gzip_static 时，部署前跑一次 --precompress 即可。");
  }
  log("提醒：.gz 只落在发布产物里，不要提交进源码仓库（本脚本已拒绝在 dist/ 与仓库根上运行）。");
}

main();
