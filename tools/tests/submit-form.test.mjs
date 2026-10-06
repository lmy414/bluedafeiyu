#!/usr/bin/env node
// tools/tests/submit-form.test.mjs —— 投稿页前端静态检查（零依赖，Node 内置模块 only）
//
// 只读 Astro 构建产物与 frontend/public/page-scripts/submit-0.js，不联网、不起服务、不写任何文件。
// 验证站内快速投稿确实接到了统一投稿 API，且没有把占位期的禁用/占位形态留在线上。
//
// 用法：
//   node --test tools/tests/submit-form.test.mjs
//
// 覆盖：endpoint 可配置、控件解除 disabled、必填 name 属性、单文件格式与 10 MB 校验、
// 三条确认必勾选、FormData POST、turnstileToken 字段、Turnstile sitekey 构建注入与失败重置、
// 按钮状态文案、不回显内部信息，以及 GitHub 入口与「审核后批量发布」文案仍在。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUBMIT_HTML = path.join(REPO_ROOT, "frontend", "out", "submit.html");
const SUBMIT_FORM_ASTRO = path.join(REPO_ROOT, "frontend", "src", "components", "SubmissionForm.astro");
const SCRIPT_JS = path.join(REPO_ROOT, "frontend", "public", "page-scripts", "submit-0.js");
const LANG_JS = path.join(REPO_ROOT, "frontend", "public", "lang.js");

const html = fs.readFileSync(SUBMIT_HTML, "utf8");
const formAstro = fs.readFileSync(SUBMIT_FORM_ASTRO, "utf8");
const lang = fs.readFileSync(LANG_JS, "utf8");

/* 取 <form id="submission-form" …> … </form> 这一段，之后的断言只针对表单本身。 */
function formSlice() {
  const start = html.indexOf('id="submission-form"');
  assert.ok(start > 0, "找不到 #submission-form");
  const end = html.indexOf("</form>", start);
  assert.ok(end > start, "找不到 </form>");
  return html.slice(start, end);
}

// 投稿逻辑在独立文件中，不能把构建产物中的 script src 当作内联代码检查。
const form = formSlice();
const script = fs.readFileSync(SCRIPT_JS, "utf8");

/* 去掉注释后的代码，用来查「内部信息」这类只该出现在解释性注释里、不该出现在代码路径里的词。 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 "); // 行注释（避开 https://）
}
const code = codeOnly(script);

test("表单把 endpoint 交给 data-api-endpoint，默认同源 /api/v1/submissions", () => {
  assert.match(form, /data-api-endpoint="\/api\/v1\/submissions"/);
  assert.match(script, /DEFAULT_ENDPOINT\s*=\s*"\/api\/v1\/submissions"/);
  assert.match(script, /form\.getAttribute\("data-api-endpoint"\)/);
});

test("投稿表单从构建环境读取 Turnstile sitekey（空值不输出属性）", () => {
  assert.match(formAstro, /import\.meta\.env\.PUBLIC_TURNSTILE_SITEKEY/);
  assert.match(formAstro, /\.trim\(\)/);
  assert.match(formAstro, /data-turnstile-sitekey=\{turnstileSitekey \|\| undefined\}/);
  assert.match(script, /form\.getAttribute\("data-turnstile-sitekey"\)/);
});

test("投稿控件已解除 disabled（占位形态不再存在）", () => {
  assert.doesNotMatch(form, /\bdisabled\b/, "投稿表单里仍有 disabled 控件");
  for (const id of ["f-files", "f-name", "f-desc", "f-character", "f-confirm-1", "f-confirm-2", "f-confirm-3", "btn-generate"]) {
    assert.match(form, new RegExp(`id="${id}"`), `缺少 #${id}`);
  }
});

test("表单字段带 name 属性，字段名与后端契约一致", () => {
  assert.match(form, /id="f-files"[^>]*name="image"/);
  assert.match(form, /id="f-name"[^>]*name="name"/);
  assert.match(form, /id="f-desc"[^>]*name="description"/);
  assert.match(form, /id="f-character"[^>]*name="character"/);
  assert.match(form, /id="f-type"[^>]*name="categoryId"[^>]*required/);
  assert.match(form, /id="f-turnstile-token"[^>]*name="turnstileToken"/);
});

test("作品类型只允许单选，六个有效类型都存在并随表单提交", () => {
  const selector = /<select[^>]*id="f-type"[\s\S]*?<\/select>/.exec(form)?.[0];
  assert.ok(selector);
  assert.doesNotMatch(selector, /\bmultiple\b/);
  for (const id of ['meme', 'illustration', 'comic', 'standing', 'setting', 'other']) assert.match(selector, new RegExp(`value="${id}"`));
  assert.match(script, /data\.append\("categoryId"/);
});

test("三个确认项与 turnstileToken 字段都在表单里", () => {
  const confirms = form.match(/id="f-confirm-\d"/g) || [];
  assert.equal(confirms.length, 3, "必须正好三个确认项");
  assert.match(script, /confirmBoxes\s*=\s*\[/);
  assert.match(script, /confirmBoxes\[i\]\.checked/);
  assert.match(script, /turnstileToken/);
  assert.match(script, /data\.append\("turnstileToken"/);
});

test("单文件格式与 10 MB 前端校验", () => {
  assert.match(form, /accept="image\/png,image\/jpeg,image\/gif,image\/webp,image\/apng"/);
  assert.match(script, /MAX_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
  assert.match(script, /files\.length\s*===\s*0/);
  assert.match(script, /file\.size\s*>\s*MAX_BYTES/);
  assert.match(script, /ALLOWED_TYPES/);
});

test("FormData POST，成功只看响应 ok 字段，不回显 id/路径/sha256/AI 结果", () => {
  assert.match(script, /new FormData\(\)/);
  assert.match(script, /fetch\(endpoint/);
  assert.match(script, /method:\s*"POST"/);
  assert.match(script, /payload\.ok\s*===\s*true/);
  assert.doesNotMatch(code, /payload\.id|\.item\.|sha256|sourceId|reviewRaw/i);
});

test("按钮 loading / 成功 / 失败三种提示都有词典 key", () => {
  assert.match(script, /submit\.form\.submitting/);
  assert.match(script, /submit\.form\.success/);
  assert.match(script, /submit\.form\.err\.server/);
  assert.match(script, /submitBtn\.disabled\s*=\s*true/);
  assert.match(script, /aria-busy/);
});

test("提交失败后重置 Turnstile token，403 走同一失败分支", () => {
  assert.match(script, /else \{\s*resetTurnstile\(\);\s*var mapped = errorForStatus\(outcome\.response\.status\);/);
  assert.match(script, /\.catch\(function \(\) \{\s*resetTurnstile\(\);/);
});

test("页内 script 语法可解析", () => {
  // new Function 只编译不执行：能挡住笔误，也不会去碰 document/window。
  assert.doesNotThrow(() => new Function(script), "页内 script 语法错误");
});

test("GitHub 入口与「审核后批量发布」文案保留", () => {
  assert.match(html, /github\.com\/lmy414\/ai-girl-stickers\/issues\/new\?template=sticker-submission\.yml/);
  assert.match(html, /批量发布/);
  assert.match(html, /data-i18n="submit\.note2"/);
});

test("en / ja 词典覆盖页内 script 用到的全部 submit.form.* key", () => {
  const keys = new Set();
  for (const m of script.matchAll(/(?:t|SiteLang\.fmt)\("(submit\.[^"]+)"/g)) keys.add(m[1]);
  assert.ok(keys.size > 0, "没有解析到任何 submit.* key");
  for (const key of keys) {
    const hits = lang.split(`"${key}":`).length - 1;
    assert.ok(hits >= 2, `词典缺少 ${key}（en/ja 各需一份，当前 ${hits}）`);
  }
});

test("HTML 结构性标签成对", () => {
  for (const tag of ["html", "head", "body", "main", "form"]) {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, "g")) || []).length;
    assert.equal(open, close, `<${tag}> 开闭数量不一致：${open} vs ${close}`);
  }
});
