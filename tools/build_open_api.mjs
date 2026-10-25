#!/usr/bin/env node
// Generate only the public JSON API. No Astro build, image sync or network I/O.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {writeOpenApi} from '../frontend/scripts/open-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let out = path.join(root, '.build/open-api'), snapshot;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    console.log('用法：node tools/build_open_api.mjs [--out <目录>] [--snapshot <已生成快照>]');
    process.exit(0);
  }
  if (!['--out', '--snapshot'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('无效参数：' + arg);
  const value = path.resolve(args[++i]);
  if (arg === '--out') out = value;
  else snapshot = value;
}
const relative = path.relative(root, out);
if (out.split(path.sep).filter(Boolean).length < 3 || !relative || (!relative.startsWith('..') && relative.split(path.sep)[0] !== '.build')) throw new Error('不安全的输出目录：' + out);
if (fs.existsSync(out) && (fs.lstatSync(out).isSymbolicLink() || !fs.existsSync(path.join(out, '.open-api-output')))) throw new Error('输出目录不是已标记的开放 API 产物：' + out);
if (!snapshot) {
  fs.mkdirSync(path.join(root, 'dist'), {recursive: true});
  for (const file of ['stage_data.mjs', 'build_site_snapshot.mjs']) {
    const result = spawnSync(process.execPath, [path.join(root, 'tools', file)], {cwd: root, stdio: 'inherit'});
    if (result.error || result.status !== 0) throw new Error(file + ' 失败');
  }
  snapshot = path.join(root, 'dist/site-data.json');
}
fs.mkdirSync(path.dirname(out), {recursive: true});
const stage = fs.mkdtempSync(path.join(path.dirname(out), '.open-api-pending-'));
try {
  const report = writeOpenApi(stage, JSON.parse(fs.readFileSync(snapshot, 'utf8')));
  fs.writeFileSync(path.join(stage, '.open-api-output'), 'tools/build_open_api.mjs\n');
  if (fs.existsSync(out)) fs.rmSync(out, {recursive: true});
  fs.renameSync(stage, out);
  console.log('[open-api] ' + JSON.stringify({...report, out}));
} finally {
  fs.rmSync(stage, {recursive: true, force: true});
}
