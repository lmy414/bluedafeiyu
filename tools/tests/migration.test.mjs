#!/usr/bin/env node
// tools/tests/migration.test.mjs —— 双仓分工迁移回归测试（零依赖，Node 内置模块 only）
//
// 验证迁移后那条关键性质：**站点仓自带结构化数据，构建不再依赖内容仓库的任何
// JSON 或脚本**，内容仓库只剩「图片 + 投稿 Issue 模板」也能把站点构建出来。
//
// 用法：
//   node tools/tests/migration.test.mjs --content-dir <内容仓库根目录>
//   CONTENT_DIR=<内容仓库根目录> node tools/tests/migration.test.mjs
//   # 也可把内容仓库放在本仓库同级 content/，然后直接：
//   node tools/tests/migration.test.mjs
//
// 测试会：
//   1. 断言本仓库 data/ 下 7 份结构化数据存在且是合法 JSON；
//   2. 在系统临时目录里搭一个「清理后」的内容仓库——只软链图片目录、只复制
//      站点图标与投稿模板，**不含任何 JSON**；
//   3. 用这个瘦身内容仓库跑完整构建，断言成功、且产物里的清单与站点 data/
//      逐字节一致（证明数据来自站点仓而不是内容仓）；
//   4. 断言投稿模板校验 / 生成指向内容仓且可重复执行（--write 不改内容）；
//   5. 断言 tools/prepare_works.mjs 幂等（跑完 data/ 不变）。
//
// 只读内容仓库；不写它的任何文件（--write 只写模板且内容不变）。临时内容仓
// 落在系统临时目录，跑完删除。不联网。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA_DIR = path.join(REPO_ROOT, "data");

// data/ 里的权威副本 → dist/ 产物路径（与 tools/stage_data.mjs 的映射一致）。
const DATA_FILES = [
  "characters.json",
  "categories.json",
  "blue-fish-ids.json",
  "works.json",
  "owner-picks.json",
  "blue-fish-classification.json",
  "blue-fish-editorial.json",
];
const STAGED = {
  "characters.json": "characters.json",
  "categories.json": "categories.json",
  "blue-fish-ids.json": "blue-fish-ids.json",
  "works.json": "submissions/works.json",
  "owner-picks.json": "owner-picks/works.json",
};

const IMAGE_DIRS = [
  "dist/submissions/previews",
  "dist/submissions/large",
  "dist/owner-picks/previews",
  "dist/data/blue-fish/previews",
];
const IMAGE_FILES = ["dist/favicon.ico", "dist/favicon.png", "dist/avatar.png", "dist/qq-group.png"];
const TEMPLATE_REL = ".github/ISSUE_TEMPLATE/sticker-submission.yml";

let passed = 0;
function ok(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u221a ${label}`);
  } catch (error) {
    console.error(`  \u00d7 ${label}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runNode(scriptRel, args, env = {}) {
  return spawnSync(process.execPath, [path.join(REPO_ROOT, ...scriptRel.split("/")), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function parseContentArg() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--content-dir") return argv[i + 1];
    if (argv[i].startsWith("--content-dir=")) return argv[i].slice("--content-dir=".length);
  }
  return process.env.CONTENT_DIR || process.env.INTAKE_CONTENT_DIR || path.join(REPO_ROOT, "content");
}

// 搭一个「清理后」的内容仓库：只软链图片目录 + 复制图标与模板，绝不含 JSON。
function buildSlimContentRepo(contentDir, slimDir) {
  fs.mkdirSync(slimDir, { recursive: true });
  for (const rel of IMAGE_DIRS) {
    const src = path.join(contentDir, ...rel.split("/"));
    if (!fs.existsSync(src)) throw new Error(`内容仓库缺少图片目录：${src}`);
    const dest = path.join(slimDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Windows 下 'junction' 不需要管理员权限，且 statSync 会跟随到真实目录。
    fs.symlinkSync(src, dest, "junction");
  }
  for (const rel of IMAGE_FILES) {
    const src = path.join(contentDir, ...rel.split("/"));
    if (!fs.existsSync(src)) throw new Error(`内容仓库缺少站点图标：${src}`);
    const dest = path.join(slimDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  const templateSrc = path.join(contentDir, ...TEMPLATE_REL.split("/"));
  if (!fs.existsSync(templateSrc)) throw new Error(`内容仓库缺少投稿模板：${templateSrc}`);
  const templateDest = path.join(slimDir, ...TEMPLATE_REL.split("/"));
  fs.mkdirSync(path.dirname(templateDest), { recursive: true });
  fs.copyFileSync(templateSrc, templateDest);
}

function anyJson(dir) {
  const stack = [dir];
  const found = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".json")) found.push(full);
    }
  }
  return found;
}

function main() {
  const contentDir = path.resolve(String(parseContentArg()).trim());
  if (!fs.existsSync(contentDir) || !fs.statSync(contentDir).isDirectory()) {
    console.log(`[migration-test] 跳过：找不到内容仓库 ${contentDir}`);
    console.log("  用 --content-dir <目录> 或 CONTENT_DIR=<目录> 指定内容仓库根目录。");
    return;
  }

  console.log(`[migration-test] 站点仓：${REPO_ROOT}`);
  console.log(`[migration-test] 内容仓：${contentDir}\n`);

  console.log("1) 站点结构化数据齐全且合法");
  for (const name of DATA_FILES) {
    const file = path.join(DATA_DIR, name);
    ok(`data/${name} 存在且可解析`, () => {
      assert.ok(fs.existsSync(file), `缺文件 ${file}`);
      JSON.parse(fs.readFileSync(file, "utf8"));
    });
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dafeiyu-migration-"));
  const slimDir = path.join(tmpRoot, "content-slim");
  const outDir = path.join(tmpRoot, "site-out");
  try {
    console.log("\n2) 瘦身内容仓（只有图片 + 投稿模板，无任何 JSON）");
    buildSlimContentRepo(contentDir, slimDir);
    ok("瘦身内容仓里没有任何 JSON", () => {
      const found = anyJson(slimDir);
      assert.deepEqual(found, [], `不应有 JSON：${found.join(", ")}`);
    });

    console.log("\n3) 用瘦身内容仓跑完整构建（数据必须来自站点 data/）");
    const build = runNode("tools/build_site.mjs", ["--content-dir", slimDir, "--out", outDir]);
    if (build.status !== 0) {
      console.error(build.stdout || "");
      console.error(build.stderr || "");
    }
    ok("构建退出码为 0", () => assert.equal(build.status, 0, build.stderr || "构建失败"));
    ok("产物含首页与清单", () => {
      for (const rel of ["index.html", "characters.json", "submissions/works.json", "site-data.json"]) {
        assert.ok(fs.existsSync(path.join(outDir, ...rel.split("/"))), `产物缺 ${rel}`);
      }
    });
    ok("产物清单与站点 data/ 逐字节一致", () => {
      for (const [dataName, stagedRel] of Object.entries(STAGED)) {
        const from = path.join(DATA_DIR, dataName);
        const to = path.join(outDir, ...stagedRel.split("/"));
        assert.ok(fs.existsSync(to), `产物缺 ${stagedRel}`);
        assert.equal(sha256(to), sha256(from), `${stagedRel} 与 data/${dataName} 不一致`);
      }
    });
    ok("产物里没有 data/（构建期数据不进发布包）", () => {
      assert.ok(!fs.existsSync(path.join(outDir, "data")), "产物里不应有 data/");
    });

    console.log("\n4) 投稿模板校验 / 生成指向内容仓");
    const check = runNode("tools/sync_issue_template.mjs", ["--check", "--content-dir", slimDir]);
    ok("--check 通过（站点 data/characters.json ↔ 内容仓模板一致）", () =>
      assert.equal(check.status, 0, check.stderr || check.stdout));
    const templateFile = path.join(slimDir, ...TEMPLATE_REL.split("/"));
    const before = sha256(templateFile);
    const write = runNode("tools/sync_issue_template.mjs", ["--write", "--content-dir", slimDir]);
    ok("--write 成功且不改变已同步的模板", () => {
      assert.equal(write.status, 0, write.stderr || write.stdout);
      assert.equal(sha256(templateFile), before, "模板内容被改动了");
    });

    console.log("\n5) prepare_works.mjs 幂等");
    const dataHashes = new Map(DATA_FILES.map((name) => [name, sha256(path.join(DATA_DIR, name))]));
    const prepare = runNode("tools/prepare_works.mjs", []);
    ok("prepare_works.mjs 退出码为 0", () => assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout));
    ok("跑完后 data/ 逐字节不变", () => {
      for (const name of DATA_FILES) {
        assert.equal(sha256(path.join(DATA_DIR, name)), dataHashes.get(name), `data/${name} 被改动了`);
      }
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n[migration-test] 通过 ${passed} 项检查${process.exitCode ? "（有失败）" : ""}。`);
}

main();
