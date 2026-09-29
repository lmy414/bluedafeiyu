// server/notify.test.mjs —— 飞书群通知
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNotifier } from './notify.mjs';

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
const ENV = {
  FEISHU_NOTIFY_APP_ID: 'cli_test',
  FEISHU_NOTIFY_APP_SECRET: 'secret_test',
  FEISHU_NOTIFY_CHAT_ID: 'oc_test',
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function parsedBody(call) {
  return call.options.body ? JSON.parse(call.options.body) : null;
}

test('缺少任一环境变量时返回 no-op，不发请求', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ code: 0 });
  };
  for (const missing of ['FEISHU_NOTIFY_APP_ID', 'FEISHU_NOTIFY_APP_SECRET', 'FEISHU_NOTIFY_CHAT_ID']) {
    const env = { ...ENV };
    delete env[missing];
    const notifier = createNotifier({ env, fetchImpl, logger: { warn() {} } });
    assert.equal(notifier.enabled, false);
    await notifier.received({ source: 'web', id: 'sub_1', fields: { name: 'x' } });
    await notifier.reviewed({}, { from: 'reviewing', to: 'auto_passed', reason: 'ok' });
    await notifier.published({ ok: true, runId: 'run_1', summary: {}, siteUrl: 'https://example.com' });
    await notifier.send('x');
  }
  assert.equal(calls, 0);
});

test('缓存 tenant_access_token，并发送纯文本消息体', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === TOKEN_URL) return jsonResponse({ code: 0, tenant_access_token: 't_test', expire: 7200 });
    return jsonResponse({ code: 0, data: { message_id: 'om_test' } });
  };
  const notifier = createNotifier({ env: ENV, fetchImpl, logger: { warn() {} } });

  await notifier.received({
    id: 'sub_github',
    source: 'github-issue',
    fields: { name: '探头', character: 'deepseek' },
    origin: { issueUrl: 'https://github.com/lmy414/ai-girl-stickers/issues/12' },
  });
  await notifier.reviewed({
    id: 'sub_web',
    source: 'web',
    fields: { name: '大肥鱼', character: 'deepseek' },
    stateHistory: [{ actor: 'hermes' }],
  }, { from: 'reviewing', to: 'auto_passed', reason: '资料齐全' });
  await notifier.published({
    ok: true,
    runId: 'run_1',
    summary: { added: 1, updated: 2, hidden: 3, restored: 9, deleted: 4, topics: 5 },
    siteUrl: 'https://example.com/dafeiyu',
  });
  await notifier.published({ ok: false, runId: 'run_2', summary: {}, error: '部署失败' });

  assert.equal(calls.length, 5);
  assert.equal(calls.filter((call) => call.url === TOKEN_URL).length, 1);

  assert.equal(calls[0].url, TOKEN_URL);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(parsedBody(calls[0]), { app_id: 'cli_test', app_secret: 'secret_test' });

  for (const call of calls.slice(1)) {
    assert.equal(call.url, MESSAGE_URL);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.Authorization, 'Bearer t_test');
    assert.equal(parsedBody(call).receive_id, 'oc_test');
    assert.equal(parsedBody(call).msg_type, 'text');
  }

  const texts = calls.slice(1).map((call) => JSON.parse(parsedBody(call).content).text);
  assert.match(texts[0], /📥 收到投稿｜来源：GitHub/);
  assert.match(texts[0], /标题：探头/);
  assert.match(texts[0], /角色：deepseek/);
  assert.match(texts[0], /投稿 id：sub_github/);
  assert.match(texts[0], /Issue 链接：https:\/\/github\.com\/lmy414\/ai-girl-stickers\/issues\/12/);

  assert.match(texts[1], /🔎 审核结果｜AI 通过/);
  assert.match(texts[1], /来源：站内/);
  assert.match(texts[1], /操作者：hermes/);
  assert.match(texts[1], /理由：资料齐全/);

  assert.match(texts[2], /🚀 上线成功/);
  assert.match(texts[2], /runId：run_1/);
  assert.match(texts[2], /新增：1｜修改：2｜隐藏：3｜删除：4｜专题：5/);
  assert.match(texts[2], /站点：https:\/\/example\.com\/dafeiyu/);

  assert.match(texts[3], /❌ 上线失败/);
  assert.match(texts[3], /runId：run_2/);
  assert.match(texts[3], /错误：部署失败/);
});

test('发送失败只告警，不抛给调用方', async () => {
  const warnings = [];
  const notifier = createNotifier({
    env: ENV,
    fetchImpl: async () => { throw new Error('network down'); },
    logger: {
      warn(message) {
        warnings.push(message);
        throw new Error('logger down');
      },
    },
  });

  await assert.doesNotReject(() => notifier.received({ source: 'qq', id: 'sub_qq', fields: { name: 'x' } }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /network down/);
});
