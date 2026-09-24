#!/usr/bin/env node
// tools/build_site_snapshot.mjs —— 把三路来源归一成公开静态数据快照。
// 读：characters/categories、投稿/owner-picks 清单、blue-fish raw 清单、冻结映射
//     （blue-fish-ids.json）与首批编辑叠加层（data/blue-fish-editorial.json：视觉复核出的
//     categoryIds 与第一人称 commentary）。这些输入全部来自内容仓库
//     （lmy414/ai-girl-stickers），由 tools/sync_content.mjs 先同步进本仓库 dist/；
//     本仓库自己不跟踪它们。
// 写：dist/site-data.json、dist/site-data.js。幂等、无网络、确定性。
//     上游 EDMOK/blue-fish-archive 的原图 URL 与既有投稿/owner-picks 原图 path 都不改写。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const RAW_PATH = process.env.BLUE_FISH_RAW || path.join(DIST, "data", "blue-fish-classification.json");
const UPSTREAM = "https://raw.githubusercontent.com/EDMOK/blue-fish-archive/main/";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeIfChanged = (file, text) => {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
  fs.writeFileSync(file, text, "utf8");
  return true;
};
const basename = (value) => String(value || "").split("/").pop();
// 投稿/站长自用清单缺 categoryIds 时的兜底启发式。漫画（多格分镜）判不出来——
// 那是视觉复核的结论，写在清单里；这里的兜底永远只会给 meme。
// tools/prepare_works.mjs 有同款一份，改规则两处一起改。
const kindFor = (record) => {
  if (String(record.id || "").startsWith("sticker_op_")) return ["illustration"];
  if (/立绘|设定|三视图/.test(String(record.name || ""))) return ["setting"];
  return ["meme"];
};
// 首批记录「够不够格当作品」的门槛：得有名字、标签、角色。
// 叠加层合并之后才判——首批里有 59 条上游清单只给了图和角色，名字与标签是后来
// 视觉复核补在叠加层里的，合并前它们过不了这道门，也就一直没进站点。
const gate = (name, tags, characterId) => Boolean(String(name || "").trim() && tags.length && String(characterId || "").trim());
const rawUrl = (value) => `${UPSTREAM}${String(value || "").replace(/^\/+/, "")}`;
// 自托管原图（叠加层带 originalPath 的首批记录）走本内容仓的 Raw，不再依赖上游档案馆
const CONTENT_RAW = "https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/";
const contentRawUrl = (value) => `${CONTENT_RAW}${String(value || "").replace(/^\/+/, "")}`;

function main() {
  const characters = readJson(path.join(DIST, "characters.json"));
  const categories = readJson(path.join(DIST, "categories.json"));
  const submissions = readJson(path.join(DIST, "submissions", "works.json"));
  const ownerPicks = readJson(path.join(DIST, "owner-picks", "works.json"));
  const raw = readJson(RAW_PATH);
  const frozen = readJson(path.join(DIST, "blue-fish-ids.json"));
  const frozenByPath = new Map(Object.entries(frozen));
  // 首批（blue-fish）编辑叠加层：视觉复核出的分类与第一人称评价。
  // 单独一份文件、不写回上面那份 raw 清单——raw 会被仓库外导入流程重新生成，
  // 而叠加层是本站的编辑结论，必须留下来（理由同 dist/blue-fish-ids.json 的冻结映射）。
  const editorialPath = path.join(DIST, "data", "blue-fish-editorial.json");
  const editorialByPath = fs.existsSync(editorialPath)
    ? new Map(Object.entries(readJson(editorialPath)))
    : new Map();
  const works = [];

  for (const record of [...submissions, ...ownerPicks]) {
    if (record.status !== "published") continue;
    works.push({
      ...record,
      categoryIds: Array.isArray(record.categoryIds) && record.categoryIds.length ? record.categoryIds : kindFor(record),
      thumbUrl: String(record.thumbnailPath || "").replace(/^\/+/, ""),
      displayUrl: String(record.fullPath || record.thumbnailPath || "").replace(/^\/+/, ""),
      originalUrl: String(record.path || ""),
      source: record.id.startsWith("sticker_op_") ? "owner-picks" : "submission"
    });
  }

  raw.forEach((record) => {
    const sourcePath = String(record.sourcePath || "").trim();
    const editorial = editorialByPath.get(sourcePath) || {};
    // 叠加层优先：首批 59 条的名字、标签、分类、评价、自托管原图都在这里；
    // 其余条目回落到上游 raw 清单的字段
    const name = String(editorial.name || record.name || "").trim();
    const tags = (Array.isArray(editorial.tags) && editorial.tags.length ? editorial.tags : record.tags || [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    const characterId = String(record.characterId || "").trim();
    if (!gate(name, tags, characterId)) return;
    const frozenEntry = frozenByPath.get(sourcePath);
    if (!frozenEntry || !frozenEntry.id || !frozenEntry.slug) return;
    const filename = basename(record.previewPath || record.sourcePath);
    const preview = `data/blue-fish/previews/${encodeURIComponent(filename)}`;
    const format = String(editorial.format || record.format || "").toLowerCase();
    const originalUrl = editorial.originalPath ? contentRawUrl(editorial.originalPath) : rawUrl(sourcePath);
    works.push({
      id: frozenEntry.id,
      slug: frozenEntry.slug,
      name,
      description: "首批收录自蓝色大肥鱼档案馆的公开清单；单条原作者与授权信息待补充，可在详情页申请署名或删除。",
      characterId,
      // 分类与第一人称评价取编辑叠加层；没有叠加层的条目退回既有的 meme 兜底
      categoryIds: Array.isArray(editorial.categoryIds) && editorial.categoryIds.length ? editorial.categoryIds : ["meme"],
      commentary: String(editorial.commentary || ""),
      tags,
      format,
      mimeType: format === "jpg" || format === "jpeg" ? "image/jpeg" : `image/${format || "png"}`,
      isAnimated: format === "gif" || format === "apng",
      width: Number(record.width) || 1,
      height: Number(record.height) || 1,
      fileSize: Number(record.fileSize) || 0,
      sha256: "",
      submitter: { name: "上游清单导入", github: "" },
      origin: { type: "internet-found", author: "", sourceUrl: record.sourceUrl || null, note: "从公开上游清单导入；单条原作者信息待补充" },
      license: { type: "unknown", note: "" },
      status: "published",
      createdAt: "2026-09-15T00:00:00+08:00",
      updatedAt: "2026-09-15T00:00:00+08:00",
      path: originalUrl,
      thumbnailPath: preview,
      fullPath: preview,
      thumbUrl: preview,
      displayUrl: preview,
      originalUrl,
      tone: characterId,
      symbol: "",
      sourcePath,
      source: "blue-fish"
    });
  });

  const seen = new Set();
  const unique = works.filter((work) => {
    if (seen.has(work.id)) return false;
    seen.add(work.id);
    return true;
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.slug).localeCompare(String(a.slug)));

  const snapshot = {
    version: "2026-09-25-vision-reclassify",
    characters,
    // 分类直接取内容仓库的 categories.json（此前这里硬编码过一份，加分类要改两处就漏了）
    categories: categories.filter((item) => item.status === "active"),
    works: unique
  };
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  const js = `window.SITE_DATA = ${JSON.stringify(snapshot)}; window.DEMO = window.SITE_DATA;\n`;
  const jsonChanged = writeIfChanged(path.join(DIST, "site-data.json"), json);
  const jsChanged = writeIfChanged(path.join(DIST, "site-data.js"), js);
  console.log(`[snapshot] works=${unique.length} characters=${characters.length} json=${jsonChanged ? "written" : "unchanged"} js=${jsChanged ? "written" : "unchanged"}`);
}

main();
