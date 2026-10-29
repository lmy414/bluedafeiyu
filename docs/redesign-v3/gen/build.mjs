// 生成演示站点：node docs/redesign-v3/gen/build.mjs → docs/redesign-v3/site/
// 页面清单与线上简体中文完全一致（少一页或多一页都会报错）；输出目录每次重建前清空。
import {mkdirSync, writeFileSync, rmSync, copyFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {ROOT, BUILT, KIND, works, serials, serialOf, serialWorkIds, creators, characters, topics, guides, events, roleColors, loadDownloadStats} from './data.mjs';
import {liveURLs} from './live.mjs';
import {context, workURL, pageURL} from './layout.mjs';
import {home, work, videoPage, seriesURL} from './pages.mjs';
import {collections, listingPage, charactersDirectory, topicsDirectory, guidePage, guideURL} from './listings.mjs';
import {creatorsDirectory, creatorPage, eventDirectories, eventsPage} from './people.mjs';
import {docURLs, docPage, projectsPage, changelogPage, submitPage, searchPage, savedPage, notFound} from './docs.mjs';
import {seriesLanding, readerPage} from './comics.mjs';

const OUT = path.join(ROOT, 'docs/redesign-v3/site');
const DEMO = path.join(ROOT, 'docs/redesign-v3');
const browse = collections.find(c => c.kind === 'browse');
const downloadStats = await loadDownloadStats();
if (!downloadStats) console.warn('下载统计暂不可用，首页将显示待同步和推荐作品。');

const routes = new Map([
  ['/', ctx => home(ctx, downloadStats)], ['/gallery.html', ctx => listingPage(ctx, browse, 1)],
  ...collections.flatMap(c => Array.from({length: c.pages}, (_, i) => [pageURL(c.base, i + 1), ctx => listingPage(ctx, c, i + 1)])),
  ['/characters.html', charactersDirectory], ['/category.html', charactersDirectory],
  ['/topics.html', topicsDirectory], ['/collections.html', topicsDirectory],
  ...guides.map(g => [guideURL(g), ctx => guidePage(ctx, g)]),
  ['/videos.html', videoPage], ['/creators.html', creatorsDirectory], ...creators.map(c => [c.href, ctx => creatorPage(ctx, c)]),
  ...eventDirectories.map(u => [u, ctx => eventsPage(ctx, u)]), ...docURLs.map(u => [u, ctx => docPage(ctx, u)]),
  ['/projects.html', projectsPage], ['/changelog.html', changelogPage], ['/submit.html', submitPage],
  ['/search.html', searchPage], ['/saved.html', savedPage], ['/404.html', notFound],
  ...serials.flatMap(s => [[seriesURL(s), ctx => seriesLanding(ctx, s)], ...s.numbers.map(n => [seriesURL(s, n), ctx => readerPage(ctx, s, n)])]),
  ...works.map(w => [workURL(w), ctx => work(ctx, w)]),
]);
const verification = '/google653ce5fe960a5fb0.html';
const want = liveURLs().filter(u => u !== verification);
const missing = want.filter(u => !routes.has(u)), extra = [...routes.keys()].filter(u => !want.includes(u));
if (missing.length || extra.length) throw new Error(`页面清单与线上不一致\n缺少：${missing.join(' ')}\n多出：${extra.join(' ')}`);

const generated = new Set([...routes.keys()].map(p => p.endsWith('/') ? p + 'index.html' : p));
// 只清空目录内容，不删除目录本身（终端或浏览器正打开这个目录时，删除目录会失败）。
mkdirSync(OUT, {recursive: true});
for (const f of readdirSync(OUT)) rmSync(path.join(OUT, f), {recursive: true, force: true});
let bytes = 0;
for (const [urlPath, render] of routes) {
  const ctx = context(urlPath, generated);
  const html = render(ctx);
  const file = path.join(OUT, ctx.file);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, html);
  bytes += Buffer.byteLength(html);
}
copyFileSync(path.join(BUILT, verification.slice(1)), path.join(OUT, verification.slice(1)));

mkdirSync(path.join(OUT, 'assets'), {recursive: true});
for (const f of ['site.css', 'site.js']) copyFileSync(path.join(DEMO, 'assets', f), path.join(OUT, 'assets', f));
// 社群页的二维码来自同一份正式构建快照，file:// 预览也无需等待远程图片。
copyFileSync(path.join(BUILT, 'qq-group.png'), path.join(OUT, 'assets/qq-group.png'));
// 角色色：.r-<id> 提供 --c，作品卡色点、角色标签、筛选 chip、角色页头图共用。
writeFileSync(path.join(OUT, 'assets/roles.css'), Object.entries(roleColors).map(([id, c]) => `.r-${id}{--c:${c}}`).join('\n') + '\n');

// 浏览器端数据（首次预览、下滑到底、改排序或搜索时才加载）：预览弹窗、无限瀑布流、多选筛选、搜索、收藏页共用。
const alias = Object.fromEntries(characters.map(c => [c.id, [c.name, ...c.aliases].join(' ')]));
const data = {
  roles: Object.fromEntries(characters.map(c => [c.id, c.name])), kinds: KIND,
  topics: Object.fromEntries(topics.map(t => [t.id, t.list.map(w => w.slug)])),
  works: works.map(w => ({s: w.slug, id: w.id, n: w.n, i: w.i, l: w.l, o: w.o, w: w.w, h: w.h, dt: w.dt, at: w.at, k: w.kinds, r: w.cids || [],
    g: w.gif ? 1 : 0, lk: w.lk, ls: w.ls, lt: w.lt, cm: w.cm || '', d: w.d || '', tg: w.tg || [], f: w.f || '', sz: w.s || '',
    c: serialWorkIds.has(w.id) ? serialOf(w).name : '', a: w.a || '',
    // 来源与署名：来源作者、署名者的站外主页、原始来源链接、站内创作者页、授权备注（预览弹窗与详情页一致）
    sa: w.rights?.creator || w.sa || '', au: w.au || '', su: w.su || '', ow: w.owners?.[0]?.href || '', ln: w.ln || ''})),
  alias,
};
writeFileSync(path.join(OUT, 'assets/works-data.js'), 'window.WORKS_DATA=' + JSON.stringify(data) + ';\n');

console.log(`${routes.size} pages (= live), ${(bytes / 1048576).toFixed(1)} MB HTML → ${path.relative(ROOT, OUT)}; events ${events.length}`);
