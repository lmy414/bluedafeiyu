import http from 'node:http';
import fs from 'node:fs/promises';
import {init, request} from './node_modules/rsshub/dist-lib/pkg.mjs';
import {PRESETS} from './node_modules/header-generator/index.js';

// The upstream "last 5" Browserslist preset can outrun its bundled header dataset.
// Use that dataset's supported Chrome headers instead of failing before any request.
delete PRESETS.MODERN_MACOS_CHROME.browserListQuery;
PRESETS.MODERN_MACOS_CHROME.browsers=['chrome'];

// Unmodified, pinned upstream package. Only the required read-only route is exposed.
const config={ CACHE_TYPE: 'memory', CACHE_EXPIRE: 900, BILIBILI_EXCLUDE_SUBTITLES: true,
  CHROMIUM_EXECUTABLE_PATH: process.env.CHROMIUM_EXECUTABLE_PATH,
  ...(process.env.BILIBILI_COMMUNITY_COOKIE ? { BILIBILI_COOKIE_LOCAL: process.env.BILIBILI_COMMUNITY_COOKIE } : {}) };
await init(config);
let sessionVersion='';
let busy = false;
http.createServer(async (req, res) => {
  const json = (status, value) => {res.writeHead(status, {'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if (req.headers.host !== '127.0.0.1:1200' || req.method !== 'GET') return json(403,{error:'Local read-only source'});
  if (req.url === '/health') return json(200,{provider:'RSSHub',version:'1.0.0-master.70e402b',busy});
  if (!/^\/bilibili\/user\/video\/[1-9]\d{0,16}$/.test(req.url || '')) return json(404,{error:'Unknown feed'});
  if (busy) return json(429,{error:'RSSHub busy; retry later'});
  busy = true;
  try {
    const session=await fs.readFile(process.env.RSSHUB_SESSION_FILE || '/etc/dafeiyu/rsshub-session.json','utf8').then(JSON.parse).catch(()=>null);
    if(session?.savedAt && session.savedAt!==sessionVersion){await init({...config,BILIBILI_COOKIE_LOCAL:session.cookie});sessionVersion=session.savedAt;}
    const feed = await request(req.url);
    if (!feed || !Array.isArray(feed.item)) throw Error('Feed unavailable');
    json(200,feed);
  } catch { json(502,{error:'RSSHub 未取得有效投稿列表，保留已有记录并稍后重试'}); }
  finally {busy=false;}
}).listen(1200,'127.0.0.1',()=>console.log('RSSHub local source: http://127.0.0.1:1200'));
