import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClient, parseFlags } from "../admin-client.mjs";
test("本地通道使用 owner API Key，拒绝跨站地址和凭证重定向", async () => {
  let call;
  const client = await makeClient(
    { baseUrl: "https://example.test", apiKey: "test-owner" },
    async (url, options) => {
      call = { url, options };
      return Response.json({ role: "owner" });
    },
  );
  assert.equal((await client.execute("me")).role, "owner");
  assert.equal(call.options.headers.Authorization, "users API-Key test-owner");
  assert.equal(call.options.redirect, "error");
  await assert.rejects(
    () => client.request("GET", "https://other.test/cms-api/users"),
    /只允许/,
  );
  await assert.rejects(() => client.request("GET", "/admin"), /只允许/);
  await assert.rejects(
    () => makeClient({ baseUrl: "http://example.test", apiKey: "test" }),
    /HTTPS/,
  );
});
test("专题作品顺序和封面由本地调用明确指定，发布需先明确确认", async () => {
  const calls = [];
  const client = await makeClient(
    { baseUrl: "https://example.test", apiKey: "test" },
    async (url, o) => {
      calls.push({ url: String(url), ...o });
      if (url.pathname === "/cms-api/works")
        return Response.json({
          docs: [
            { workId: "b", id: 2 },
            { workId: "a", id: 1 },
          ],
        });
      if (o.method === "GET") return Response.json({ docs: [] });
      return Response.json({ ok: true });
    },
  );
  await client.execute("topic", {
    topicId: "demo",
    name: "示例",
    summary: "简介",
    workIds: ["a", "b"],
    coverWorkId: "b",
  });
  assert.deepEqual(JSON.parse(calls.at(-1).body).works, [1, 2]);
  assert.equal(JSON.parse(calls.at(-1).body).cover, 2);
  await assert.rejects(() => client.execute("publish"), /confirm/);
});

test("命令参数支持上传、任务筛选与明确发布，未知或缺值参数会报错", () => {
  assert.deepEqual(
    parseFlags(["--file", "E:/a.png", "--category-id", "meme", "--include"]),
    { file: "E:/a.png", categoryId: "meme", include: true },
  );
  assert.deepEqual(
    parseFlags(["--work-ids", "b,a", "--order", "10", "--confirm", "false"]),
    { workIds: ["b", "a"], order: 10, confirm: false },
  );
  assert.throws(() => parseFlags(["--file"]), /缺少值/);
  assert.throws(() => parseFlags(["--unknown", "x"]), /未知/);
});
