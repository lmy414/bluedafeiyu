#!/usr/bin/env node
// Copy Astro output and staged data into the requested static release directory.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(frontend, '..');
const dist = path.join(root, 'dist');
const args = process.argv.slice(2);
let requestedOut;
let forceClean=false;
for (let i=0;i<args.length;i++) {
 if(args[i]==='--out'){requestedOut=args[++i];if(!requestedOut)throw new Error('--out requires path')}
 else if(args[i].startsWith('--out=')) requestedOut=args[i].slice(6);
 else if(args[i]==='--force-clean') forceClean=true;
 else throw new Error(`Unknown build argument ${args[i]}`);
}
const out = path.resolve(root, requestedOut || path.join('.build','site'));
const astroOut = path.join(frontend,'out');
const rel = path.relative(root,out);
const withinRepo = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
if(out===root || out===dist || out===frontend || out===astroOut || out===path.parse(out).root || out.split(path.sep).filter(Boolean).length<3)throw new Error(`Unsafe output path: ${out}`);
if(withinRepo && (rel.split(path.sep)[0]!=='.build')) throw new Error(`Output inside source repository must be under .build: ${out}`);
const run = (script, args = [], cwd = root) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, env: process.env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${script} failed: ${result.error?.message || result.status}`);
};
const astro = path.join(frontend, 'node_modules', 'astro', 'bin', 'astro.mjs');
if (!fs.existsSync(astro)) throw new Error('Astro is not installed: run npm ci in frontend/');
// 分享卡片登记表：页面构建时由 src/lib/v2.mjs 的 ogCard() 追加，这里先清空
const ogJobsFile = path.join(frontend, '.astro', 'og-jobs.jsonl');
fs.mkdirSync(path.dirname(ogJobsFile), { recursive: true });
fs.writeFileSync(ogJobsFile, '');
process.env.OG_JOBS_FILE = ogJobsFile;
run(astro, ['build'], frontend);
// Publish only Astro output plus the original public data and synced preview assets.
if(fs.existsSync(out)) {
 const marker=path.join(out,'.build-output');
 if(!forceClean && (!fs.statSync(out).isDirectory() || !fs.existsSync(marker))) throw new Error(`Existing output is not marked as a build result: ${out}`);
 fs.rmSync(out,{recursive:true});
}
fs.cpSync(astroOut,out,{recursive:true});
const copy = (relative, target = relative) => {
  const from = path.join(dist, ...relative.split('/'));
  if (!fs.existsSync(from)) throw new Error(`Missing staged asset ${from}`);
  const to = path.join(out, ...target.split('/'));
  fs.mkdirSync(path.dirname(to), {recursive:true});
  fs.cpSync(from, to, {recursive:true, force:true});
};
for (const file of ['avatar.png','favicon.ico','favicon.png','qq-group.png','events/national-day-2026.webp','characters.json','categories.json','blue-fish-ids.json','topics.json','site-data.json','site-data.js','submissions/works.json','owner-picks/works.json']) copy(file);
for (const dir of ['submissions/previews','submissions/large','owner-picks/previews']) copy(dir);
// data/blue-fish/previews is intentionally omitted; production serves its shared/data persistent copy.
// 社交分享卡片：每页一张 1200×630 JPG，画面就是该页对应的作品（tools/og_cards.py，需 Python + Pillow）。
// 缓存在 .build/og-cache，内容没变的卡片不重画。SKIP_OG=1 可跳过（页面里的 og:image 会指向不存在的图）。
if (process.env.SKIP_OG !== '1') {
  const jobs = [...new Map(fs.readFileSync(ogJobsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(j => [j.id, j])).values()];
  const cache = path.join(root, '.build', 'og-cache');
  fs.mkdirSync(cache, { recursive: true });
  const jobsJson = path.join(cache, 'jobs.json');
  fs.writeFileSync(jobsJson, JSON.stringify(jobs));
  const py = spawnSync(process.env.PYTHON || 'python3', [path.join(root, 'tools', 'og_cards.py'), jobsJson, cache, dist, path.join(dist, 'avatar.png')], { cwd: root, stdio: 'inherit' });
  if (py.error || py.status !== 0) throw new Error('分享卡片生成失败：' + (py.error?.message || py.status));
  fs.mkdirSync(path.join(out, 'og'), { recursive: true });
  for (const j of jobs) fs.copyFileSync(path.join(cache, j.id + '.jpg'), path.join(out, 'og', j.id + '.jpg'));
  console.log('[og] ' + jobs.length + ' share cards');
}
// Astro generates the 404 page; server response semantics must still be verified.
const snapshot = JSON.parse(fs.readFileSync(path.join(dist,'site-data.json'),'utf8'));
const origin = 'https://xn--pssy23gqgbz2d718b.com';
const urls = ['/', '/characters.html','/community.html','/topics.html','/submit.html','/about.html','/projects.html','/changelog.html','/events/national-day-2026.html',
 ...(snapshot.characters || []).filter(c => c.status === 'active' && snapshot.works.some(w => w.characterId === c.id && w.status === 'published')).map(c => `/characters/${c.id}.html`),
 ...snapshot.categories.filter(c => c.status === 'active').map(c=>`/categories/${c.id}.html`),
 ...(snapshot.topics || []).map(t=>`/topics/${t.id}.html`),
 ...snapshot.works.map(w=>`/works/${w.slug}.html`)];
const xmlEscape = value => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(p=>`  <url><loc>${xmlEscape(origin+p)}</loc></url>`).join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(out,'sitemap.xml'),sitemap);
for(const p of urls) if(!fs.existsSync(path.join(out,p==='/'?'index.html':p.slice(1)))) throw new Error(`Page missing from Astro output: ${p}`);
fs.writeFileSync(path.join(out,'.build-output'),'frontend/scripts/build.mjs\n');
console.log(`[astro] ${urls.length} indexable routes; output ${out}`);
