import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const root = path.resolve(import.meta.dirname, '../..');
const html = fs.readFileSync(path.join(process.env.SITE_OUT_DIR || path.join(root, '.build/site'), 'submit.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'frontend/public/page-scripts/submit-0.js'), 'utf8');

async function useForm({ file = new File(['zip bytes'], 'collection.ZIP', { type: 'application/octet-stream' }), status = 201, nonAi = false,
  payload = { ok: true, count: 3, created: 2, duplicates: 1 } } = {}) {
  const { document, Event } = parseHTML(html).window;
  const form = document.querySelector('#submission-form');
  form.removeAttribute('data-turnstile-sitekey');
  const fileInput = document.querySelector('#f-files');
  Object.defineProperty(fileInput, 'files', { value: [file] });
  document.querySelector('#f-name').value = '测试图集';
  const character = document.querySelector('#character-choices input[value="deepseek"]');
  character.setAttribute('checked', '');
  character.checked = true;
  const type = document.querySelector('#f-type');
  Object.defineProperty(type, 'value', { value: 'meme' });
  Object.defineProperty(type, 'selectedOptions', { value: [type.querySelector('option[value="meme"]')] });
  Object.defineProperty(document.querySelector('#f-credit'), 'value', { value: 'anonymous' });
  document.querySelector('#f-non-ai').checked = nonAi;
  for (const checkbox of document.querySelectorAll('[id^="f-confirm-"]')) checkbox.checked = true;
  let resets = 0;
  form.reset = () => { resets++; };
  const requests = [];
  vm.runInNewContext(script, { document, window: { setTimeout, clearTimeout }, FormData, URL, AbortController,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return { ok: status >= 200 && status < 300, status, json: async () => payload };
    } });
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  return { document, requests, resets, text: document.querySelector('#form-status').textContent,
    button: document.querySelector('#btn-generate') };
}

test('网页表单接受浏览器通用 MIME 的 ZIP，保留字段并显示新增/重复计数', async () => {
  const result = await useForm();
  assert.equal(result.requests.length, 1);
  const request = result.requests[0];
  assert.equal(request.url, '/api/v1/submissions');
  assert.equal(request.method, 'POST');
  assert.equal(request.body.get('image').name, 'collection.ZIP');
  assert.equal(request.body.get('name'), '测试图集');
  assert.equal(request.body.get('categoryId'), 'meme');
  assert.equal(request.body.get('nonAi'), null);
  assert.deepEqual(JSON.parse(request.body.get('characterIds')), ['deepseek']);
  assert.match(result.text, /已接收 3 张：新投稿 2 张，重复 1 张/);
  assert.equal(result.resets, 1);
  assert.equal(result.button.disabled, false);
});

test('非 AI 生成是独立的可选项，单图和 ZIP 均仅在勾选后传递声明', async () => {
  for(const file of [new File(['zip'], 'set.zip'), new File(['png'], 'art.png', {type:'image/png'})]){
    const result=await useForm({file,nonAi:true});
    assert.equal(result.requests.length,1);
    assert.equal(result.requests[0].body.get('nonAi'),'true');
    assert.equal(result.requests[0].body.get('categoryId'),'meme');
    assert.equal(result.document.querySelector('#f-non-ai').hasAttribute('required'),false);
  }
  for(const prefix of ['', 'en/', 'ja/', 'zh-hant/']){
    const file=path.join(process.env.SITE_OUT_DIR||path.join(root,'.build/site'),prefix+'submit.html');
    const page=parseHTML(fs.readFileSync(file,'utf8')).document;
    assert.ok(page.querySelector('input[name="nonAi"]'));
    assert.equal(page.querySelector('input[name="nonAi"]').hasAttribute('checked'),false);
    const help=page.querySelector('#non-ai-hint').textContent;
    assert.ok(help.length>30);
    if(prefix==='en/')assert.match(help,/all works|Non-AI/);
    if(prefix==='ja/')assert.match(help,/すべての作品/);
  }
});

test('ZIP 和单图采用不同前端大小限制，空文件和其他格式不发请求', async () => {
  for (const [file, message] of [
    [new File([new Uint8Array(32 * 1024 * 1024 + 1)], 'big.zip'), /32 MiB/],
    [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }), /10 MiB/],
    [new File([], 'empty.zip'), /内容为空/],
    [new File(['rar'], 'bad.rar', { type: 'application/octet-stream' }), /只支持/],
  ]) {
    const result = await useForm({ file });
    assert.equal(result.requests.length, 0);
    assert.match(result.text, message);
    assert.equal(result.resets, 0);
  }
  const single = await useForm({ file: new File(['png'], 'single.png', { type: 'image/png' }), payload: { ok: true, id: 'sub_test', status: 'received' } });
  assert.equal(single.requests.length, 1);
  assert.equal(single.resets, 1);
  assert.match(single.text, /提交成功/);
});

test('服务端 ZIP 拒绝显示固定提示并保留表单，不回显异常正文', async () => {
  const result = await useForm({ status: 400, payload: { ok: false, code: 'INVALID_ARCHIVE', error: '<script>private/secret</script>' } });
  assert.equal(result.resets, 0);
  assert.match(result.text, /ZIP 校验未通过/);
  assert.doesNotMatch(result.text, /private|secret|script/);
  assert.equal(result.document.querySelector('#f-name').value, '测试图集');
  assert.equal(result.button.disabled, false);
});

test('未完成或未知计数回执不能清空图集，失败后可重试', async () => {
  for (const response of [
    { status: 503, payload: { ok: false, code: 'ARCHIVE_RETRY' } },
    { payload: { ok: true } },
    { payload: { ok: true, count: 3, created: 2, duplicates: 2 } },
    { payload: { ok: true, count: 101, created: 101, duplicates: 0 } },
    { payload: { ok: true, count: '<img>', created: 0, duplicates: 0 } },
  ]) {
    const result = await useForm(response);
    assert.equal(result.resets, 0);
    assert.match(result.text, /尚未完整接收/);
    assert.equal(result.button.disabled, false);
    assert.equal(result.button.hasAttribute('aria-busy'), false);
  }
});

test('全部重复也明确反馈零新增，不宣称重复作品已通过审核', async () => {
  const result = await useForm({ status: 200, payload: { ok: true, count: 3, created: 0, duplicates: 3 } });
  assert.equal(result.resets, 1);
  assert.match(result.text, /新投稿 0 张，重复 3 张/);
  assert.doesNotMatch(result.text, /已收录|已发布|全部通过/);
});
