// 验证作品预览的视口约束、操作区、滚动和嵌套弹窗。
// 用法：node docs/redesign-v3/gen/verify-preview.mjs [chrome|msedge ...]
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'admin/package.json'));
const {chromium} = require('playwright');
const built = path.resolve(root, '.build/site');
const site = path.join(root, 'docs/redesign-v3/site');
const pageDir = path.join(site, 'page');
const pages = [path.join(site, 'browse.html'), ...readdirSync(pageDir).filter(name => /^\d+\.html$/.test(name)).map(name => path.join(pageDir, name))];
const workPage = pages.find(file => readFileSync(file, 'utf8').includes('data-preview="deepseek202610250010"'));
assert.ok(workPage, '演示图库中没有预览测试作品');
const pageURL = pathToFileURL(workPage).href;
const channels = process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'msedge'];
const viewports = [
  [1440, 778, 1.25], [1200, 648, 1.5], [900, 486, 2],
  [390, 844, 1], [375, 667, 1], [320, 568, 1], [320, 320, 1], [844, 390, 1],
];

async function verifyViewport(browser, channel, [width, height, deviceScaleFactor]) {
  const context = await browser.newContext({viewport:{width, height}, deviceScaleFactor});
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async text => { window.__copied = text; }}});
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:/, route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'xn--pssy23gqgbz2d718b.com') return route.abort();
    const local = path.resolve(built, '.' + decodeURIComponent(url.pathname));
    return local.startsWith(built + path.sep) && existsSync(local) && statSync(local).isFile() ? route.fulfill({path:local}) : route.abort();
  });
  try {
    await page.goto(pageURL, {waitUntil:'domcontentloaded'});
    const artwork = page.locator('[data-preview="deepseek202610250010"]').first();
    assert.equal(await artwork.count(), 1, '缺少预览测试作品');
    await artwork.click();
    await page.waitForSelector('dialog.preview[open] .pv-content');
    await page.waitForFunction(() => { const img = document.querySelector('.pv-art img'); return img.complete && img.naturalWidth > 0; });
    const measure = () => page.evaluate(() => {
      const box = el => { const r = el.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height}; };
      const dialog = document.querySelector('dialog.preview'), image = dialog.querySelector('.pv-art img'), content = dialog.querySelector('.pv-content');
      return {viewport:{width:innerWidth, height:innerHeight}, dialog:box(dialog), art:box(dialog.querySelector('.pv-art')), image:box(image),
        fit:getComputedStyle(image).objectFit, scroll:{client:content.clientHeight, height:content.scrollHeight, top:content.scrollTop},
        actions:[...dialog.querySelectorAll('.pv-actions .btn')].map(el => ({label:el.textContent.trim(), box:box(el)}))};
    });
    const before = await measure(), tag = `${channel} ${width}x${height}`;
    assert.ok(before.dialog.left >= -1 && before.dialog.top >= -1 && before.dialog.right <= width + 1 && before.dialog.bottom <= height + 1, `${tag}: 弹窗超出视口`);
    assert.ok(before.art.width > 0 && before.art.height > 0, `${tag}: 图片区域不可见`);
    assert.equal(before.fit, 'contain', `${tag}: 图片不是完整显示`);
    assert.ok(before.image.left >= before.art.left && before.image.right <= before.art.right + 1 && before.image.top >= before.art.top && before.image.bottom <= before.art.bottom + 1, `${tag}: 图片区域被截断`);
    assert.equal(before.actions.length, 5, `${tag}: 操作按钮数量不对`);
    for (const action of before.actions) assert.ok(action.box.top >= before.dialog.top && action.box.bottom <= before.dialog.bottom + 1 && action.box.left >= 0 && action.box.right <= width + 1, `${tag}: ${action.label} 被遮挡`);
    assert.equal(await page.locator('dialog.preview').getAttribute('aria-label'), '作品预览');
    assert.equal(await page.locator('.pv-content').getAttribute('tabindex'), '0');

    // 即使说明很长，信息区可滚动，底部操作按钮仍固定在可视区域。
    await page.locator('.pv-content .fish p:last-child').evaluate(el => { el.textContent = '较长的作品说明'.repeat(300); });
    await page.locator('.pv-content').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const after = await measure();
    assert.ok(after.scroll.height > after.scroll.client && after.scroll.top > 0, `${tag}: 作品信息不可滚动`);
    assert.deepEqual(after.actions.map(a => a.box), before.actions.map(a => a.box), `${tag}: 滚动时操作区移动`);

    if (width === 1440) {
      await page.locator('.pv-actions [data-copy-link]').click();
      assert.match(await page.evaluate(() => window.__copied), /\/works\/deepseek202610250010\.html$/);
      await page.locator('.pv-actions [data-save]').click();
      assert.equal(await page.locator('.pv-actions [data-save]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-pv-zoom]').click();
      assert.equal(await page.locator('#zoom-dialog').evaluate(el => el.open), true);
      const beforeZoomKey = await page.locator('.pv-content h2').textContent();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('.pv-content h2').textContent(), beforeZoomKey, '放大层打开时不应切换底层作品');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#zoom-dialog').evaluate(el => el.open), false);
      assert.equal(await page.locator('dialog.preview').evaluate(el => el.open), true, '关闭放大层时不应关闭作品预览');
      assert.equal(await page.locator('body').evaluate(el => el.classList.contains('lock')), true);
      await page.locator('.pv-actions [data-share]').click();
      await page.waitForSelector('#share-dialog[open]');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog.preview').evaluate(el => el.open), true, '关闭分享层时不应关闭作品预览');
      const previous = await page.locator('.pv-content h2').textContent();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(old => document.querySelector('.pv-content h2')?.textContent !== old, previous);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog.preview').evaluate(el => el.open), false);
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('lock')), false);
    assert.deepEqual(errors, [], `${tag}: 浏览器脚本报错`);
    console.log(`${tag}: 通过`);
  } finally {
    await context.close();
  }
}

async function verifySlowLoading(browser, channel) {
  const context = await browser.newContext({viewport:{width:1280, height:720}});
  const page = await context.newPage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let intercepted = false;
  await page.route('**/assets/works-data.js', async route => { intercepted = true; await gate; await route.continue(); });
  await page.route(/^https?:/, route => route.abort());
  try {
    await page.goto(pageURL, {waitUntil:'domcontentloaded'});
    const original = page.url();
    await page.locator('[data-preview="deepseek202610250010"]').first().click();
    await page.waitForSelector('dialog.preview[open] .pv-pos[role="status"]');
    assert.equal(intercepted, true, `${channel}: 未拦截作品数据`);
    assert.ok(await page.locator('.pv-art').evaluate(el => el.getBoundingClientRect().height > 100), `${channel}: 加载时图片区域不可见`);
    await page.locator('[data-pv-close]').click();
    release();
    await page.waitForFunction(() => !!window.WORKS_DATA);
    assert.equal(await page.locator('dialog.preview').evaluate(el => el.open), false);
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('lock')), false);
    assert.equal(page.url(), original, `${channel}: 关闭加载中的预览后不应跳转`);
    console.log(`${channel} 加载中关闭: 通过`);
  } finally {
    release();
    await context.close();
  }
}

for (const channel of channels) {
  const browser = await chromium.launch({channel, headless:true});
  try { for (const viewport of viewports) await verifyViewport(browser, channel, viewport); await verifySlowLoading(browser, channel); }
  finally { await browser.close(); }
}
console.log('作品预览回归检查通过。');
