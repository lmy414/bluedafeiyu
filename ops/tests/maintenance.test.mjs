import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { planReleases, expiredFiles, deleteExpired, maintain, readReport, formatReport, assertNoMounts } from '../maintenance.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('发布目录自身或内部存在挂载点时拒绝删除', () => {
  assert.throws(() => assertNoMounts('/srv/releases/old', '12 1 0:5 / /srv/releases/old rw - ext4 x rw'), /挂载点/);
  assert.throws(() => assertNoMounts('/srv/releases/old', '12 1 0:5 / /srv/releases/old/data rw - ext4 x rw'), /挂载点/);
  assert.doesNotThrow(() => assertNoMounts('/srv/releases/old', '12 1 0:5 / /srv/releases/older rw - ext4 x rw'));
});

test('保留正在运行的旧版本和最新两个版本，忽略非发布目录', async (t) => {
  const dir = await fixture(t);
  const root = path.join(dir, 'releases');
  for (const name of ['20260101-000000', '20260102-000000', '20260103-000000', '20260104-000000', 'not-a-release']) await fs.mkdir(path.join(root, name), { recursive: true });
  const current = path.join(dir, 'current');
  await fs.symlink(path.join(root, '20260101-000000'), current, 'junction');
  const plan = await planReleases({ root, current, pattern: /^\d{8}-\d{6}$/ });
  assert.deepEqual(plan.keep.map((file) => path.basename(file)), ['20260101-000000', '20260104-000000', '20260103-000000']);
  assert.deepEqual(plan.remove.map((file) => path.basename(file)), ['20260102-000000']);
  await fs.unlink(current);
  await fs.symlink(dir, current, 'junction');
  await assert.rejects(planReleases({ root, current, pattern: /^\d{8}-\d{6}$/ }), /当前版本不在发布目录/);
});

test('只删过期归档日志，保留当前日志、近期读取文件和目录外软链', async (t) => {
  const dir = await fixture(t);
  const root = path.join(dir, 'logs');
  await fs.mkdir(root);
  const old = new Date(Date.now() - 40 * 86400000);
  for (const name of ['access.log', 'access.log.1.gz', 'recent.log.2.gz']) {
    const file = path.join(root, name);
    await fs.writeFile(file, 'data');
    await fs.utimes(file, old, old);
  }
  await fs.utimes(path.join(root, 'recent.log.2.gz'), new Date(), old);
  const external = path.join(dir, 'external');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'outside.log.1.gz'), 'keep');
  await fs.utimes(path.join(external, 'outside.log.1.gz'), old, old);
  await fs.symlink(external, path.join(root, 'external'), 'junction');
  const files = await expiredFiles({ root, days: 30, archivedOnly: true });
  assert.deepEqual(files.map((file) => path.basename(file.path)), ['access.log.1.gz']);
  assert.deepEqual(await deleteExpired(files), { count: 1, bytes: 4 });
  assert.equal(await fs.readFile(path.join(root, 'access.log'), 'utf8'), 'data');
  assert.equal(await fs.readFile(path.join(external, 'outside.log.1.gz'), 'utf8'), 'keep');
  await assert.rejects(expiredFiles({ root: path.join(root, 'external'), days: 30 }), /拒绝清理软链/);
});

test('删除前重查读取时间，刚使用的缓存保留', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'cache');
  const old = new Date(Date.now() - 20 * 86400000);
  await fs.writeFile(file, 'data');
  await fs.utimes(file, old, old);
  const files = await expiredFiles({ root, days: 14 });
  await fs.utimes(file, new Date(), old);
  assert.deepEqual(await deleteExpired(files), { count: 0, bytes: 0 });
});

test('dry-run 不调用系统清理命令，apply 失败项会保留在报告', async () => {
  const calls = [];
  const command = async (binary, args) => {
    calls.push([binary, args]);
    if (binary.endsWith('runuser')) return JSON.stringify([{ status: args.includes('--apply') ? 'released' : 'dry-run' }]);
    if (binary.endsWith('apt-get')) throw new Error('cache clean failed');
    if (binary.endsWith('curl')) return '200';
    return '';
  };
  const dry = await maintain({ command, releaseGroups: [], fileRules: [] });
  assert.equal(dry.status, 'dry-run');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].includes('--apply'), false);
  const result = await maintain({ apply: true, command, releaseGroups: [], fileRules: [] });
  assert.equal(result.status, 'partial');
  assert.equal(result.originals.released, 1);
  assert.equal(result.healthOk, true);
  assert.match(formatReport(result), /APT 安装包缓存.*cache clean failed/);
});

test('旧维护报告不能当成本次完成通知', async (t) => {
  const reportRoot = await fixture(t);
  await fs.writeFile(path.join(reportRoot, 'latest.json'), JSON.stringify({ finishedAt: new Date(Date.now() - 21 * 3600000).toISOString() }));
  await assert.rejects(readReport({ reportRoot }), /最近 20 小时/);
  await fs.writeFile(path.join(reportRoot, 'latest.json'), JSON.stringify({ finishedAt: new Date().toISOString(), status: 'success' }));
  assert.equal((await readReport({ reportRoot })).status, 'success');
  await fs.writeFile(path.join(reportRoot, 'latest.json'), JSON.stringify({ startedAt: '2026-10-05T03:00:00+08:00', finishedAt: '2026-10-05T03:01:00+08:00', status: 'success' }));
  await assert.rejects(readReport({ reportRoot, now: Date.parse('2026-10-05T04:30:00+08:00') }), /本轮维护尚未产生报告/);
});
