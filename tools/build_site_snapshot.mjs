#!/usr/bin/env node
// tools/build_site_snapshot.mjs —— 把三路来源归一成公开静态数据快照。
// 读：characters/categories、投稿/owner-picks 清单、blue-fish raw 清单、冻结映射
//     （blue-fish-ids.json）与首批编辑叠加层（data/blue-fish-editorial.json：视觉复核出的
//     categoryIds 与第一人称 commentary）。这些清单的权威副本都在本仓库 data/
//     （内容仓库只管图片），由 tools/stage_data.mjs 先暂存进本仓库 dist/。
// 写：dist/site-data.json、dist/site-data.js。幂等、无网络、确定性。
//     上游 EDMOK/blue-fish-archive 的原图 URL 与既有投稿/owner-picks 原图 path 都不改写。

import fs from "node:fs";
import {sourceHash,validateI18n} from "./localization/contract.mjs";
import { isSingleWorkType } from '../admin/src/lib/work-types.mjs';
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
    // 后台下架/删除的首批作品只留叠加层墓碑，不进入任何公开快照。
    if (["hidden", "deleted", "removed"].includes(editorial.status)) return;
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
      // 说明优先取编辑叠加层（后台补写的看图说明），没有时留空，不再填占位句
      description: String(editorial.description || "").trim(),
      characterId,
      // 分类与第一人称评价取编辑叠加层；没有叠加层的条目退回既有的 meme 兜底
      categoryIds: Array.isArray(editorial.categoryIds) && editorial.categoryIds.length ? editorial.categoryIds : ["meme"],
      commentary: String(editorial.commentary || ""),
      ...(editorial.i18n ? {i18n:editorial.i18n} : {}),
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

  const allowedTypes = new Set(categories.filter(c => c.status === 'active').map(c => c.id));
  for (const work of unique) {
    if (!isSingleWorkType(work.categoryIds, allowedTypes)) throw new Error(`作品 ${work.id} 必须且只能有一个有效类型`);
  }

  const translationsPath = path.join(DIST,"data/work-localizations.json");
  const localized = fs.existsSync(translationsPath) ? readJson(translationsPath).works : {};
  for (const work of unique) {
    const candidate = work.i18n?.sourceHash === sourceHash(work) ? work.i18n : localized[work.id];
    delete work.i18n;
    if (candidate?.sourceHash === sourceHash(work)) work.i18n = {sourceHash:candidate.sourceHash, ...validateI18n(candidate,work)};
    else console.warn(`[i18n] Missing or stale localization: ${work.id}`);
  }
  const snapshot = {
    version: "2026-09-25-vision-reclassify",
    characters,
    // 分类直接取本仓库 data/categories.json（此前这里硬编码过一份，加分类要改两处就漏了）
    categories: categories.filter((item) => item.status === "active"),
    topics: buildTopics(readJson(path.join(DIST, "topics.json")), unique),
    works: unique
  };
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  const js = `window.SITE_DATA = ${JSON.stringify(snapshot)}; window.DEMO = window.SITE_DATA;\n`;
  const jsonChanged = writeIfChanged(path.join(DIST, "site-data.json"), json);
  const jsChanged = writeIfChanged(path.join(DIST, "site-data.js"), js);
  console.log(`[snapshot] works=${unique.length} characters=${characters.length} json=${jsonChanged ? "written" : "unchanged"} js=${jsChanged ? "written" : "unchanged"}`);
}

// 专题三语字段：只透传 en / ja 的非空字符串，缺省由前台回落中文。
function normalizeTopicI18n(value) {
  const out = {};
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  for (const lang of ["en", "ja"]) {
    const raw = source[lang];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = {};
    for (const field of ["name", "summary"]) {
      const text = typeof raw[field] === "string" ? raw[field] : "";
      if (text.trim()) entry[field] = text;
    }
    if (Object.keys(entry).length) out[lang] = entry;
  }
  return out;
}

// 外链校验：先要求字面量 http:// / https:// 且 authority 以非空、非 /?#\ 、非空白字符开头
// （挡掉 `https://`、`https:///x`、反斜杠这些 new URL 会偷偷规范化的写法），
// 再解析核对协议与主机名；javascript: / data: 之类的 scheme 同样在此失败。
const safeLink = (raw) => {
  if (!raw || /\s/.test(raw) || raw.includes("\\")) return false;
  if (!/^https?:\/\/[^\s/?#\\]/.test(raw)) return false;
  let parsed;
  try { parsed = new URL(raw); } catch { return false; }
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
};

// 专题来源作者（可选字段）：{ name, url?, bio?, channels: [{ platform, label?, url }] }。
// 没有 author 或各字段全空 → null，前台维持原 SubHead + Feed，快照里也不多出这个键。
// 一旦出现作者名或渠道就按作者型处理：缺作者名或首选渠道直接构建失败，并报出专题 id 与原因。
function normalizeTopicAuthor(value, id) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const homepage = typeof value.url === "string" ? value.url.trim() : "";
  const bio = typeof value.bio === "string" ? value.bio.trim() : "";
  const channelsRaw = Array.isArray(value.channels) ? value.channels : [];
  if (!name && !homepage && !bio && !channelsRaw.length) return null;
  const fail = (why) => { throw new Error(`专题 ${id} 的作者信息不完整：${why}`); };
  if (!name) fail("缺少 name（作者名）");
  if (homepage && !safeLink(homepage)) fail(`url 不是有效的 http/https 地址：${homepage}`);
  const channels = [];
  channelsRaw.forEach((channel, i) => {
    if (!channel || typeof channel !== "object" || Array.isArray(channel)) fail(`渠道 ${i + 1} 不是对象`);
    const platform = String(channel.platform || "").trim();
    const url = String(channel.url || "").trim();
    if (!platform) fail(`渠道 ${i + 1} 缺 platform`);
    if (!url) fail(`渠道 ${i + 1} 缺 url`);
    if (!safeLink(url)) fail(`渠道 ${i + 1} 的 url 不是有效的 http/https 地址：${url}`);
    const label = typeof channel.label === "string" ? channel.label.trim() : "";
    channels.push({ platform, ...(label ? { label } : {}), url });
  });
  if (!channels.length) fail("缺少首选渠道 channels[0]（只有作者名不足以成为作者型专题）");
  return { name, ...(homepage ? { url: homepage } : {}), ...(bio ? { bio } : {}), channels };
}

// 专题：站长人工精选，data/topics.json 按 workIds 显式收录（不按 tag 现算，不分类；id 即稳定键）。
// 作品下架后 id 会从快照消失——这里只丢弃并警告，不让一次下架卡住整站构建；
// 封面失效退回首张收录作品；收录清空的专题不上线。
function buildTopics(list, works) {
  const known = new Set(works.map((work) => work.id));
  const seenTopic = new Set();
  const topics = [];
  for (const topic of Array.isArray(list) ? list : []) {
    const id = String(topic && topic.id || "").trim();
    if (!id || topic.status !== "active") continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`专题 id 不合法：${id}`);
    if (seenTopic.has(id)) throw new Error(`专题 id 重复：${id}`);
    seenTopic.add(id);
    const seenWork = new Set();
    const workIds = [];
    for (const raw of Array.isArray(topic.workIds) ? topic.workIds : []) {
      const workId = String(raw || "").trim();
      if (!workId || seenWork.has(workId)) continue;
      seenWork.add(workId);
      if (!known.has(workId)) { console.warn(`[snapshot] 专题 ${id} 引用了不存在或未发布的作品 ${workId}，已跳过`); continue; }
      workIds.push(workId);
    }
    if (!workIds.length) { console.warn(`[snapshot] 专题 ${id} 没有可用作品，本次不上线`); continue; }
    const coverWorkId = workIds.includes(topic.coverWorkId) ? topic.coverWorkId : workIds[0];
    const i18n = normalizeTopicI18n(topic.i18n);
    const author = normalizeTopicAuthor(topic.author, id);
    topics.push({
      id,
      name: String(topic.name || id),
      summary: String(topic.summary || ""),
      ...(Object.keys(i18n).length ? { i18n } : {}),
      // 无 author 时连键都不加，快照形状与原来完全一致
      ...(author ? { author } : {}),
      coverWorkId,
      order: Number(topic.order) || 0,
      updatedAt: String(topic.updatedAt || topic.createdAt || ""),
      workIds
    });
  }
  topics.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  console.log(`[snapshot] topics=${topics.length}`);
  return topics;
}

main();
