#!/usr/bin/env node
// tools/preview_site.mjs —— 本地预览构建产物（只监听 127.0.0.1，不对外）
// 用法：node tools/preview_site.mjs [--dir .build/site] [--port 5173]
// · 首批图派生图（data/blue-fish/previews）不进发布包，线上由 shared/data 提供；
//   本地预览时从 dist/data 只读挂载，页面才能看到这批图
// · 找不到的地址回发 404.html（与线上 nginx error_page 一致）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const SITE = path.resolve(root, arg('--dir', '.build/site'));
const DATA = path.join(root, 'dist', 'data');
const PORT = Number(arg('--port', '5173'));
// Optional local submission service makes the preview form usable during acceptance.
const submissionArg = arg('--submission-url', null);
const SUBMISSION = submissionArg ? new URL(submissionArg) : null;
if (SUBMISSION && (SUBMISSION.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(SUBMISSION.hostname))) throw Error('--submission-url must be a local HTTP service');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.ico': 'image/x-icon' };

const inside = (base, file) => { const r = path.relative(base, file); return r && !r.startsWith('..') && !path.isAbsolute(r); };
function resolve(urlPath) {
  let p; try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.startsWith('/data/blue-fish/')) { const f = path.join(DATA, p.slice('/data/'.length)); return inside(DATA, f) ? f : null; }
  let f = path.join(SITE, p);
  if (path.relative(SITE, f) !== '' && !inside(SITE, f)) return null;     // 防目录穿越
  if (fs.statSync(f, { throwIfNoEntry: false })?.isDirectory()) f = path.join(f, 'index.html');
  return f;
}
http.createServer((req, res) => {
  if (SUBMISSION && new URL(req.url, 'http://x').pathname === '/api/v1/submissions') {
    const proxy = http.request(new URL(req.url, SUBMISSION), { method: req.method, headers: { ...req.headers, host: SUBMISSION.host } }, upstream => {
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"ok":false,"error":"本地投稿服务暂不可用"}'); });
    req.pipe(proxy); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const file = resolve(new URL(req.url, 'http://x').pathname);
  if (!file) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(path.join(SITE, '404.html')));
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('[preview] http://127.0.0.1:' + PORT + '  ← ' + SITE));
