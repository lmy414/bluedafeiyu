// 核对社群内容保留、首页真实下载量排序和统计不可用时的降级。
// 用法：node docs/redesign-v3/gen/verify-community-home.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseHTML} from '../../../frontend/node_modules/linkedom/esm/index.js';
import {BUILT, QQ, gallery, loadDownloadStats} from './data.mjs';
import {context} from './layout.mjs';
import {docPage} from './docs.mjs';
import {home} from './pages.mjs';
import {liveURLs} from './live.mjs';

const generated = new Set(liveURLs().map(p => p.endsWith('/') ? p + 'index.html' : p));
const doc = html => parseHTML(html).document;
const text = el => el?.textContent.replace(/\s+/g, ' ').trim();
const source = doc(readFileSync(path.join(BUILT, 'community.html'), 'utf8'));
const community = doc(docPage(context('/community.html', generated), '/community.html'));

assert.equal(community.querySelectorAll('main h1').length, 1);
for (let n = 1; n <= 8; n++) assert.ok(community.getElementById(`s${n}`), `缺少社群锚点 s${n}`);
assert.equal(community.querySelector('.community-group strong').textContent, QQ.number);
assert.equal(community.querySelector('.community-actions a').getAttribute('href'), QQ.join);
assert.match(community.querySelector('.community-qr img').getAttribute('src'), /assets\/qq-group\.png/);
assert.equal(community.querySelectorAll('.community-entry').length, 4);
assert.equal(text(community.querySelector('.community-notice p')), text(source.querySelector('.live-group-notice')));
assert.deepEqual([...community.querySelectorAll('.community-panel li')].map(text), [...source.querySelectorAll('.live-intro-panel ul li')].map(text));
assert.deepEqual([...community.querySelectorAll('.community-social a')].map(a => a.getAttribute('href')), [...source.querySelectorAll('.live-social-links a')].map(a => a.getAttribute('href')));
for (const heading of [...source.querySelectorAll('.live-info-card h2, .community-activity h2')].map(text)) {
  assert.ok([...community.querySelectorAll('.community-entry h3')].some(h => text(h) === heading), `缺少社群入口：${heading}`);
}

const snapshot = {available:true, syncedAt:'2026-10-29T14:44:31Z', works:{
  [gallery[0].id]: {downloads: 17},
  [gallery[1].id]: {downloads: 912},
  [gallery[2].id]: {downloads: 251},
}};
assert.equal(await loadDownloadStats(async () => ({ok:true, json:async () => snapshot})), snapshot);
assert.equal(await loadDownloadStats(async () => ({ok:false})), null);
assert.equal(await loadDownloadStats(async () => { throw new Error('offline'); }), null);
assert.equal(await loadDownloadStats(async () => ({ok:true, json:async () => ({available:false})})), null);
assert.equal(await loadDownloadStats(async () => ({ok:true, json:async () => ({available:true, works:{}, syncedAt:'invalid'})})), null);

const withStats = doc(home(context('/', generated), snapshot));
const latest = withStats.querySelector('section[aria-labelledby="h-new"]');
const popular = withStats.querySelector('section[aria-labelledby="h-dl"]');
assert.equal(latest.querySelectorAll('.card-download').length, 18);
assert.equal(popular.querySelectorAll('.card-download').length, 6);
assert.equal(popular.querySelector('.card').getAttribute('data-slug'), gallery[1].slug);
assert.match(text(popular.querySelector('.card-download')), /912/);
assert.match(text(latest.querySelector('.card-download')), /17/);
assert.match(text(latest.querySelector('.home-stats-note')), /按钮点击次数/);
assert.match(text(popular.querySelector('.home-stats-note')), /按钮点击次数/);

const fallback = doc(home(context('/', generated), null));
assert.match(text(fallback.querySelector('.home-stats-note')), /统计暂不可用/);
assert.equal(fallback.querySelectorAll('.picks .rank').length, 0);
assert.ok([...fallback.querySelectorAll('.card-download')].every(el => text(el).includes('待同步')));
console.log('社群内容、下载统计排序、零值和不可用降级检查通过。');
