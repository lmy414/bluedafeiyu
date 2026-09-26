// server/config.test.mjs —— 配置与私有存储根的安全边界
//
// 重点性质：
//   1. 存储根必须显式配置，没有默认值，缺了直接拒绝；
//   2. 存储根不得落在站点仓、内容仓或任何 git 工作树内；
//   3. 摘要/日志口径不得回显密钥。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  assertPrivateRoot,
  configSummary,
  ensureStorageLayout,
  isIpInCidr,
  isTrustedProxy,
  normalizeIp,
  parseCidr,
  resolveConfig,
} from './config.mjs';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function tmpDir(prefix = 'subcfg-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('缺少 SUBMISSION_STORAGE_ROOT 时拒绝解析配置', async (t) => {
  const dir = await tmpDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  assert.throws(
    () => resolveConfig({}, { env: { CONTENT_DIR: dir } }),
    /SUBMISSION_STORAGE_ROOT/,
  );
});

test('空字符串的存储根等同未配置', () => {
  assert.throws(() => resolveConfig({}, { env: { SUBMISSION_STORAGE_ROOT: '   ' } }), /SUBMISSION_STORAGE_ROOT/);
});

test('存储根落在站点仓内被拒绝', async (t) => {
  const inside = path.join(SITE_ROOT, 'server', '__storage__');
  t.after(() => fs.rm(inside, { recursive: true, force: true }));
  assert.throws(
    () => resolveConfig({ storageRoot: inside }, { env: {} }),
    /公开仓|git 工作树/,
  );
});

test('存储根落在内容仓内被拒绝', async (t) => {
  const content = await tmpDir('content-');
  t.after(() => fs.rm(content, { recursive: true, force: true }));
  await fs.mkdir(path.join(content, '.git'), { recursive: true });
  const root = path.join(content, 'private-store');
  assert.throws(
    () => resolveConfig({ storageRoot: root, contentDir: content }, { env: {} }),
    /内容仓|公开仓|git 工作树/,
  );
});

test('存储根落在任意 git 工作树内被拒绝（不限于已知两仓）', async (t) => {
  const outer = await tmpDir('gitrepo-');
  t.after(() => fs.rm(outer, { recursive: true, force: true }));
  await fs.mkdir(path.join(outer, '.git'), { recursive: true });
  const nested = path.join(outer, 'a', 'b');
  await fs.mkdir(nested, { recursive: true });
  assert.throws(() => assertPrivateRoot(nested), /git 工作树/);
});

test('临时目录里的独立存储根被接受', async (t) => {
  const root = path.join(await tmpDir('store-'), 'submission-private');
  t.after(() => fs.rm(path.dirname(root), { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: root }, { env: {} });
  assert.equal(cfg.storageRoot, path.resolve(root));
  assert.equal(cfg.github.repo, 'lmy414/ai-girl-stickers');
  assert.equal(cfg.github.label, 'sticker-submission');
  assert.equal(cfg.maxBytes, 16 * 1024 * 1024);
});

test('默认不开放 QQ / 审核，且允许来源必须在白名单里', async (t) => {
  const root = path.join(await tmpDir('store-'), 'private');
  t.after(() => fs.rm(path.dirname(root), { recursive: true, force: true }));
  const cfg = resolveConfig(
    { storageRoot: root },
    { env: { SUBMISSION_ALLOWED_ORIGINS: 'https://xn--pssy23gqgbz2d718b.com, https://example.com' } },
  );
  assert.equal(cfg.qq.enabled, false);
  assert.equal(cfg.review.configured, false);
  assert.equal(cfg.adminToken, '');
  assert.deepEqual(cfg.allowedOrigins, ['https://xn--pssy23gqgbz2d718b.com', 'https://example.com']);
  assert.ok(!cfg.allowedOrigins.includes('*'));
});

test('配置摘要不回显任何密钥', async (t) => {
  const root = path.join(await tmpDir('store-'), 'private');
  t.after(() => fs.rm(path.dirname(root), { recursive: true, force: true }));
  const cfg = resolveConfig(
    { storageRoot: root },
    {
      env: {
        SUBMISSION_ADMIN_TOKEN: 'admin-secret-value',
        SUBMISSION_AI_API_KEY: 'ai-secret-value',
        SUBMISSION_GITHUB_TOKEN: 'gh-secret-value',
        SUBMISSION_QQ_INBOUND_TOKEN: 'qq-secret-value',
        SUBMISSION_QQ_ENABLED: 'true',
        SUBMISSION_QQ_GROUP_ALLOWLIST: '123456,789',
      },
    },
  );
  const text = JSON.stringify(configSummary(cfg));
  for (const secret of ['admin-secret-value', 'ai-secret-value', 'gh-secret-value', 'qq-secret-value']) {
    assert.ok(!text.includes(secret), `摘要里不应出现 ${secret}`);
  }
  assert.equal(configSummary(cfg).adminToken, 'configured');
  assert.equal(configSummary(cfg).qq.enabled, true);
  assert.deepEqual(cfg.qq.groupAllowlist, ['123456', '789']);
});

test('recoverAfterMs 由 reviewRecoverMs 覆盖，不受 reviewTimeoutMs 影响', async (t) => {
  const root = path.join(await tmpDir('recover-'), 'private');
  t.after(() => fs.rm(path.dirname(root), { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: root, reviewRecoverMs: 1234, reviewTimeoutMs: 777 }, { env: {} });
  assert.equal(cfg.recoverAfterMs, 1234);
  assert.equal(cfg.review.timeoutMs, 777);

  const envCfg = resolveConfig({ storageRoot: root }, { env: { SUBMISSION_REVIEW_RECOVER_MS: '4321', SUBMISSION_AI_TIMEOUT_MS: '999' } });
  assert.equal(envCfg.recoverAfterMs, 4321);
  assert.equal(envCfg.review.timeoutMs, 999);
});

test('可信代理 CIDR：解析合法值、拒绝非法值', async (t) => {
  const root = path.join(await tmpDir('proxy-'), 'private');
  t.after(() => fs.rm(path.dirname(root), { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: root, trustedProxyCidrs: '127.0.0.1/32, 10.0.0.0/8, ::1/128' }, { env: {} });
  assert.deepEqual(cfg.trustedProxyCidrs, ['127.0.0.1/32', '10.0.0.0/8', '::1/128']);

  const envCfg = resolveConfig({ storageRoot: root }, { env: { SUBMISSION_TRUSTED_PROXY_CIDRS: '192.168.0.0/16' } });
  assert.deepEqual(envCfg.trustedProxyCidrs, ['192.168.0.0/16']);

  const none = resolveConfig({ storageRoot: root }, { env: {} });
  assert.deepEqual(none.trustedProxyCidrs, []);

  for (const bad of ['10.0.0.0', '10.0.0.0/33', 'not-an-ip/8', '::1/129']) {
    assert.throws(
      () => resolveConfig({ storageRoot: root, trustedProxyCidrs: bad }, { env: {} }),
      /CIDR/,
      `应拒绝非法 CIDR：${bad}`,
    );
  }
});

test('CIDR 匹配支持 IPv4 / IPv6 / ::ffff: 映射', () => {
  assert.equal(isIpInCidr('10.1.2.3', parseCidr('10.0.0.0/8')), true);
  assert.equal(isIpInCidr('11.1.2.3', parseCidr('10.0.0.0/8')), false);
  assert.equal(isIpInCidr('::1', parseCidr('::1/128')), true);
  assert.equal(isIpInCidr('::2', parseCidr('::1/128')), false);
  assert.equal(isIpInCidr('2001:db8::1', parseCidr('2001:db8::/32')), true);
  assert.equal(isIpInCidr('2001:db9::1', parseCidr('2001:db8::/32')), false);
  assert.equal(isIpInCidr('::ffff:127.0.0.1', parseCidr('127.0.0.0/8')), true);
  assert.equal(isTrustedProxy('10.0.0.1', [parseCidr('10.0.0.0/8'), parseCidr('::1/128')]), true);
  assert.equal(isTrustedProxy('8.8.8.8', [parseCidr('10.0.0.0/8')]), false);
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIp('[::1]'), '::1');
  assert.equal(normalizeIp('fe80::1%eth0'), 'fe80::1');
});

test('限流、字符上限与 Turnstile 超时有安全默认值且可覆盖', async (t) => {
  const root = path.join(await tmpDir('limits-'), 'private');
  t.after(() => fs.rm(path.dirname(root), { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: root }, { env: {} });
  assert.equal(cfg.rateLimit.maxKeys, 5000);
  assert.equal(cfg.characterMaxLength, 64);
  assert.equal(cfg.turnstile.timeoutMs, 5000);
  assert.equal(cfg.turnstile.enabled, false);

  const custom = resolveConfig(
    { storageRoot: root, rateMaxKeys: 3, characterMaxLength: 10, turnstileTimeoutMs: 250 },
    { env: {} },
  );
  assert.equal(custom.rateLimit.maxKeys, 3);
  assert.equal(custom.characterMaxLength, 10);
  assert.equal(custom.turnstile.timeoutMs, 250);

  const envCustom = resolveConfig({ storageRoot: root }, {
    env: {
      SUBMISSION_RATE_MAX_KEYS: '7',
      SUBMISSION_CHARACTER_MAX_LENGTH: '12',
      SUBMISSION_TURNSTILE_TIMEOUT_MS: '900',
      SUBMISSION_TURNSTILE_SECRET: 'ts-secret',
    },
  });
  assert.equal(envCustom.rateLimit.maxKeys, 7);
  assert.equal(envCustom.characterMaxLength, 12);
  assert.equal(envCustom.turnstile.timeoutMs, 900);
  assert.equal(envCustom.turnstile.enabled, true);
  assert.ok(!JSON.stringify(configSummary(envCustom)).includes('ts-secret'));
});

test('ensureStorageLayout 只建私有权限目录', async (t) => {
  const base = await tmpDir('layout-');
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cfg = resolveConfig({ storageRoot: path.join(base, 'private') }, { env: {} });
  await ensureStorageLayout(cfg);
  for (const dir of [cfg.paths.items, cfg.paths.objects, cfg.paths.index, cfg.paths.ai, cfg.paths.logs]) {
    const stat = await fs.stat(dir);
    assert.ok(stat.isDirectory());
  }
});
