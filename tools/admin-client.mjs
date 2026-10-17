#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const defaultConfig = path.join(
  os.homedir(),
  ".config",
  "dafeiyu-admin",
  "device.json",
);
export async function makeClient(config, fetchImpl = fetch) {
  const base = new URL(config.baseUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) &&
      base.protocol !== "https:")
  )
    throw new Error("baseUrl 必须是 HTTPS 站点 origin，或本机 HTTP 地址");
  if (!config.apiKey) throw new Error("设备配置缺少 apiKey");
  async function request(method, route, body) {
    const target = new URL(route, base);
    if (
      target.origin !== base.origin ||
      !target.pathname.startsWith("/cms-api/") ||
      target.username ||
      target.password
    )
      throw new Error("只允许访问当前站点的 /cms-api/");
    const res = await fetchImpl(target, {
      method,
      redirect: "error",
      headers: {
        Authorization: "users API-Key " + config.apiKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(
        data?.errors?.[0]?.message ||
          data?.error ||
          data?.message ||
          `HTTP ${res.status}`,
      );
    return data;
  }
  async function topic(data) {
    const { workIds, coverWorkId, ...fields } = data;
    if (workIds !== undefined) {
      if (!Array.isArray(workIds))
        throw new Error("workIds 必须为有序作品 ID 数组");
      const docs = [];
      for (let i = 0; i < workIds.length; i += 100) {
        const q = new URLSearchParams({
          "where[workId][in]": workIds.slice(i, i + 100).join(","),
          depth: "0",
          limit: "100",
        });
        docs.push(...(await request("GET", "/cms-api/works?" + q)).docs);
      }
      const byKey = new Map(docs.map((d) => [d.workId, d.id]));
      if (workIds.some((id) => !byKey.has(id)))
        throw new Error("专题包含不存在的作品 ID");
      fields.works = workIds.map((id) => byKey.get(id));
      if (coverWorkId) {
        if (!byKey.has(coverWorkId)) throw new Error("封面必须属于专题作品");
        fields.cover = byKey.get(coverWorkId);
      }
    } else if (coverWorkId) {
      const q = new URLSearchParams({
        "where[workId][equals]": coverWorkId,
        limit: "1",
      });
      const cover = (await request("GET", "/cms-api/works?" + q)).docs[0];
      if (!cover) throw new Error("封面作品不存在");
      fields.cover = cover.id;
    }
    const q = new URLSearchParams({
      "where[topicId][equals]": fields.topicId,
      limit: "1",
      depth: "0",
    });
    const old = (await request("GET", "/cms-api/topics?" + q)).docs[0];
    return request(
      old ? "PATCH" : "POST",
      "/cms-api/topics" + (old ? "/" + old.id : ""),
      fields,
    );
  }
  return {
    request,
    topic,
    async execute(op, args = {}) {
      if (op === "me") return request("GET", "/cms-api/automation/me");
      if (op === "tasks")
        return request(
          "GET",
          "/cms-api/console/tasks?" + new URLSearchParams(args),
        );
      if (op === "upload") {
        const info = await fs.stat(args.file);
        if (!info.isFile() || info.size > 16 * 1024 * 1024)
          throw new Error("只接受 16 MiB 内的图片文件");
        const data = await fs.readFile(args.file);
        const { file, ...fields } = args;
        return request("POST", "/cms-api/automation/upload", {
          ...fields,
          name: args.name || path.basename(args.file),
          dataBase64: data.toString("base64"),
          requestId: args.requestId || crypto.randomUUID(),
        });
      }
      if (op === "include")
        return request("POST", "/cms-api/bulk/request", {
          ...args,
          operation: "manual-include",
          target: "submissions",
          confirm: "MANUAL_INCLUDE",
          requestId: args.requestId || crypto.randomUUID(),
        });
      if (op === "topic") return topic(args);
      if (op === "publish-plan") return request("GET", "/cms-api/publish/plan");
      if (op === "publish") {
        if (args.confirm !== true)
          throw new Error("先检查 publish-plan，再传 confirm:true");
        return request("POST", "/cms-api/publish/request");
      }
      if (op === "retry" || op === "cancel")
        return request("POST", "/cms-api/bulk/" + op, args);
      if (op === "request")
        return request(args.method || "GET", args.path, args.body);
      throw new Error("未知操作：" + op);
    },
  };
}
export function parseFlags(args) {
  const values = {};
  const allowed = new Set([
    "file",
    "name",
    "character",
    "category-id",
    "include",
    "request-id",
    "status",
    "task",
    "page",
    "kind",
    "ids",
    "job-id",
    "topic-id",
    "summary",
    "work-ids",
    "cover-work-id",
    "order",
    "name-en",
    "summary-en",
    "name-ja",
    "summary-ja",
    "confirm",
    "method",
    "path",
  ]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const key = flag.replace(/^--/, "");
    if (!flag.startsWith("--") || !allowed.has(key))
      throw new Error("未知参数：" + flag);
    const name = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (["include", "confirm"].includes(key)) {
      values[name] = ["true", "false"].includes(args[index + 1])
        ? args[++index] === "true"
        : true;
    } else {
      const value = args[++index];
      if (value === undefined || value.startsWith("--"))
        throw new Error(flag + " 缺少值");
      values[name] = ["ids", "work-ids"].includes(key)
        ? value.split(",").filter(Boolean)
        : key === "order"
          ? Number(value)
          : value;
      if (key === "order" && !Number.isFinite(values[name]))
        throw new Error("--order 必须为数字");
    }
  }
  return values;
}
async function main() {
  const args = process.argv.slice(2);
  const cfgIndex = args.indexOf("--config");
  const cfgPath =
    cfgIndex >= 0
      ? args.splice(cfgIndex, 2)[1]
      : process.env.DAFEIYU_ADMIN_CONFIG || defaultConfig;
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) {
    console.log(
      "node tools/admin-client.mjs me | tasks | upload | include | topic | publish-plan | publish | retry | cancel | request\n使用 --input <JSON 文件> 或命令参数；--config <device.json> 选择设备。\n例：tasks --status running\n例：upload --file E:/作品/新图.png --character deepseek --category-id meme --include\n例：publish --confirm",
    );
    return;
  }
  const client = await makeClient(
    JSON.parse(await fs.readFile(cfgPath, "utf8")),
  );
  const inputIndex = args.indexOf("--input");
  const input =
    inputIndex >= 0
      ? JSON.parse(await fs.readFile(args.splice(inputIndex, 2)[1], "utf8"))
      : {};
  console.log(
    JSON.stringify(
      await client.execute(args[0], { ...input, ...parseFlags(args.slice(1)) }),
      null,
      2,
    ),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
