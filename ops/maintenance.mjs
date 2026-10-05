import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
export const REPORT_ROOT = '/var/lib/dafeiyu-maintenance';
export const RELEASE_GROUPS = [
  { root: '/srv/www/dafeiyu/releases', current: '/srv/www/dafeiyu/current', pattern: /^\d{8}-\d{6}$/ },
  { root: '/srv/apps/dafeiyu-admin/releases', current: '/srv/apps/dafeiyu-admin/app', pattern: /^admin-[a-f0-9]+-\d{8}-\d{6}-\d+$/ },
  { root: '/srv/www/codex/releases', current: '/srv/www/codex/current', pattern: /^\d{8}-\d{6}$/ },
];
export const FILE_RULES = [
  ...['/var/log/nginx', '/var/log/letsencrypt', '/var/log/dshregistry', '/srv/www/dafeiyu/logs',
    '/srv/apps/dafeiyu-admin/logs', '/srv/apps/hermes-studio/data/logs'].map((root) => ({ root, days: 30, archivedOnly: true })),
  { root: '/root/.npm/_cacache', days: 14 },
  { root: '/root/.npm/_logs', days: 30 },
  ...['web', 'exec', 'terminal-output', 'terminal', 'screenshots', 'vision'].map((name) => ({ root: `/srv/apps/hermes-studio/data/cache/${name}`, days: 7 })),
  { root: '/tmp/node-compile-cache', days: 7 },
];
async function optionalStat(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function checkedDirectory(root) {
  const stat = await optionalStat(root);
  if (!stat) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(root) !== path.resolve(root)) throw new Error(`拒绝清理软链或异常目录：${root}`);
  return stat;
}
function releaseDate(name) { return name.match(/(\d{8}-\d{6})/)?.[1] || ''; }

export function assertNoMounts(directory, mountInfo) {
  for (const line of mountInfo.split('\n')) {
    const mount = (line.split(' ')[4] || '').replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    if (mount === directory || mount.startsWith(`${directory}/`)) throw new Error(`发布目录内存在挂载点，拒绝删除：${mount}`);
  }
}

export async function planReleases(group) {
  const stat = await checkedDirectory(group.root);
  if (!stat) return { root: group.root, keep: [], remove: [] };
  const active = await fs.realpath(group.current);
  if (path.dirname(active) !== group.root) throw new Error(`当前版本不在发布目录内：${group.current}`);
  const entries = [];
  for (const name of await fs.readdir(group.root)) {
    if (!group.pattern.test(name)) continue;
    const file = path.join(group.root, name);
    const info = await fs.lstat(file);
    if (info.isDirectory() && !info.isSymbolicLink() && info.dev === stat.dev) entries.push(file);
  }
  if (!entries.includes(active)) throw new Error(`当前版本未通过校验：${active}`);
  const newest = entries.filter((file) => file !== active).sort((a, b) => releaseDate(path.basename(b)).localeCompare(releaseDate(path.basename(a))) || b.localeCompare(a));
  const keep = [active, ...newest.slice(0, 2)];
  return { root: group.root, current: group.current, active, keep, remove: entries.filter((file) => !keep.includes(file)).sort() };
}
export async function expiredFiles(rule, { now = Date.now() } = {}) {
  const base = await checkedDirectory(rule.root);
  if (!base) return [];
  const cutoff = now - rule.days * DAY;
  const found = [];
  async function walk(dir, depth = 0) {
    if (depth > 20) throw new Error(`目录层级超出限制：${dir}`);
    for (const name of await fs.readdir(dir)) {
      const file = path.join(dir, name);
      const stat = await optionalStat(file);
      if (!stat || stat.isSymbolicLink() || stat.dev !== base.dev) continue;
      if (stat.isDirectory()) { await walk(file, depth + 1); continue; }
      if (!stat.isFile() || Math.max(stat.mtimeMs, stat.atimeMs) >= cutoff) continue;
      if (rule.archivedOnly && !/(?:\.log\.(?:\d+|\d{4}-\d{2}-\d{2})(?:\.gz)?|\.log-\d{8}(?:\.gz)?|\.gz)$/.test(name)) continue;
      found.push({ path: file, bytes: stat.size, cutoff });
    }
  }
  await walk(rule.root);
  return found;
}
export async function deleteExpired(files) {
  let count = 0;
  let bytes = 0;
  for (const entry of files) {
    const stat = await optionalStat(entry.path);
    if (!stat?.isFile() || stat.isSymbolicLink() || Math.max(stat.mtimeMs, stat.atimeMs) >= entry.cutoff) continue;
    await fs.unlink(entry.path);
    count += 1;
    bytes += stat.size;
  }
  return { count, bytes };
}
export function runCommand(command, args, { timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, timeout);
    child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-1024 * 1024); });
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-16000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${path.basename(command)} 失败（${code ?? signal}）：${stderr.trim().slice(-1000)}`));
      else resolve(stdout);
    });
  });
}
async function diskUsage() {
  const data = await fs.statfs('/');
  const used = (data.blocks - data.bfree) * data.bsize;
  const available = data.bavail * data.bsize;
  return { used, available, percent: Math.ceil(used / (used + available) * 100) };
}
export function formatReport(report) {
  const gib = (value) => (Number(value || 0) / 1073741824).toFixed(2);
  const time = new Date(report.finishedAt || report.startedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const lines = [
    `服务器定期维护｜${report.status === 'success' ? '完成' : report.status === 'dry-run' ? '清理预览' : '存在失败项'}`,
    `服务器：aliyun-hk｜时间：${time}`,
    `过期原图${report.status === 'dry-run' ? '候选' : '清理'}：${report.status === 'dry-run' ? report.originals?.due || 0 : report.originals?.released || 0} 条（保留 14 天，投稿记录保留）`,
    `旧发布版本：${report.releases?.reduce((sum, item) => sum + item.count, 0) || 0} 个（各保留当前版本及最近两个历史版本）`,
    `过期日志和缓存：${report.files?.reduce((sum, item) => sum + item.count, 0) || 0} 个文件`,
    `本轮释放：${gib((report.after?.available || 0) - (report.before?.available || 0))} GiB`,
    `磁盘：${report.after?.percent ?? report.before?.percent ?? '?'}%｜剩余：${gib(report.after?.available || report.before?.available)} GiB`,
    `服务及网站检查：${report.healthOk ? '通过' : report.status === 'dry-run' ? '未执行' : '见失败项'}`,
  ];
  for (const error of report.errors || []) lines.push(`失败：${error.step}｜${error.message}`);
  return lines.join('\n');
}
export async function maintain({ apply = false, command = runCommand, releaseGroups = RELEASE_GROUPS, fileRules = FILE_RULES } = {}) {
  const report = { schema: 'dafeiyu-maintenance/1', startedAt: new Date().toISOString(), status: 'running', errors: [], releases: [], files: [] };
  report.before = await diskUsage();
  async function step(name, fn) {
    try { return await fn(); } catch (error) { report.errors.push({ step: name, message: String(error.message).slice(0, 1000) }); return null; }
  }
  await step('原图清理', async () => {
    const args = ['-u', 'dafeiyu', '--preserve-environment', '--', '/usr/bin/node', '/srv/apps/dafeiyu/source/server/cli.mjs', 'prune-originals', '--days', '14', '--json'];
    if (apply) args.push('--apply');
    const results = JSON.parse(await command('/usr/sbin/runuser', args));
    if (!Array.isArray(results)) throw new Error('原图清理返回格式不正确');
    report.originals = { due: results.length, released: results.filter((entry) => entry.status === 'released').length };
  });
  for (const group of releaseGroups) await step(`旧版本：${group.root}`, async () => {
    const plan = await planReleases(group);
    if (apply && plan.current && await fs.realpath(plan.current) !== plan.active) throw new Error('当前版本已变化，跳过删除');
    let count = 0;
    for (const file of plan.remove) {
      if (apply) {
        const stat = await fs.lstat(file);
        if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(file) !== file || path.dirname(file) !== group.root) throw new Error(`删除前校验失败：${file}`);
        assertNoMounts(file, await fs.readFile('/proc/self/mountinfo', 'utf8'));
        await fs.rm(file, { recursive: true, force: false });
      }
      count += 1;
    }
    report.releases.push({ root: group.root, keep: plan.keep, count, paths: plan.remove });
  });
  for (const rule of fileRules) await step(`过期文件：${rule.root}`, async () => {
    const files = await expiredFiles(rule);
    const result = apply ? await deleteExpired(files) : { count: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
    report.files.push({ root: rule.root, days: rule.days, ...result });
  });
  if (apply) {
    await step('APT 安装包缓存', () => command('/usr/bin/apt-get', ['clean']));
    await step('systemd 历史日志', async () => {
      await command('/usr/bin/journalctl', ['--rotate']);
      await command('/usr/bin/journalctl', ['--vacuum-time=14d', '--vacuum-size=200M']);
    });
    const errorsBeforeHealth = report.errors.length;
    await step('服务检查', () => command('/usr/bin/systemctl', ['is-active', 'nginx', 'dafeiyu-admin', 'dafeiyu-submission']));
    for (const url of ['https://feiyufans.com/', 'https://codex.dshregistry.xyz/', 'https://dshregistry.xyz/']) await step(`网站检查：${url}`, async () => {
      const status = (await command('/usr/bin/curl', ['--max-time', '15', '-s', '-o', '/dev/null', '-w', '%{http_code}', url])).trim();
      if (status !== '200') throw new Error(`HTTP ${status}`);
    });
    report.healthOk = report.errors.length === errorsBeforeHealth;
  }
  report.after = await diskUsage();
  report.finishedAt = new Date().toISOString();
  report.status = report.errors.length ? 'partial' : apply ? 'success' : 'dry-run';
  return report;
}
export async function readReport({ reportRoot = REPORT_ROOT, now = Date.now() } = {}) {
  const report = JSON.parse(await fs.readFile(path.join(reportRoot, 'latest.json'), 'utf8'));
  const age = now - Date.parse(report.finishedAt || '');
  if (!Number.isFinite(age) || age > 20 * 60 * 60 * 1000 || age < -60000) throw new Error('没有最近 20 小时内的维护报告，请检查定时任务，不能把旧报告当成本次完成');
  return report;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--apply', '--report', '--json'].includes(arg))) throw new Error('只接受 --apply、--report 和 --json');
  if (args.includes('--apply') && args.includes('--report')) throw new Error('--apply 与 --report 不能同时使用');
  if (args.includes('--report')) {
    try {
      const report = await readReport();
      console.log(args.includes('--json') ? JSON.stringify(report) : formatReport(report));
    } catch (error) {
      console.log(`服务器定期维护｜报告异常\n服务器：aliyun-hk\n${error.message}`);
      process.exitCode = 1;
    }
    return;
  }
  const apply = args.includes('--apply');
  const report = await maintain({ apply });
  if (apply) {
    await fs.mkdir(REPORT_ROOT, { recursive: true, mode: 0o700 });
    const temporary = path.join(REPORT_ROOT, `latest.${process.pid}.tmp`);
    await fs.writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(temporary, path.join(REPORT_ROOT, 'latest.json'));
  }
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  if (report.errors.length) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
