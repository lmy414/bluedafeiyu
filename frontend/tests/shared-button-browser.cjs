// Run against a built site served by tools/preview_site.mjs.
// Requires Playwright and Chromium; no browser dependency is added to the static site.
// node frontend/tests/shared-button-browser.cjs http://127.0.0.1:5173
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const characters = JSON.parse(fs.readFileSync(path.join(root, 'data/characters.json'), 'utf8'));
const origin = process.argv[2] || 'http://127.0.0.1:5173';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const results = [];
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
      await context.addInitScript(value => localStorage.setItem('bluedafeiyu-theme', value), theme);
      const page = await context.newPage();
      for (const character of characters) {
        await page.goto(`${origin}/characters/${character.id}.html`, { waitUntil: 'domcontentloaded' });
        const button = page.locator('.character-page .button.primary').first();
        await button.waitFor({ state: 'visible' });
        for (const state of ['rest', 'hover', 'pressed', 'focus']) {
          await page.mouse.move(0, 0);
          if (state === 'hover' || state === 'pressed') await button.hover();
          if (state === 'pressed') await page.mouse.down();
          if (state === 'focus') { await page.keyboard.press('Tab'); await button.focus(); }
          await page.waitForTimeout(200);
          const styles = await button.evaluate(element => {
            const style = getComputedStyle(element);
            // Resolve the page's dedicated on-accent token through the browser.
            const expected = document.createElement('span');
            expected.style.color = style.getPropertyValue('--brand-accent-ink');
            element.append(expected);
            const foreground = getComputedStyle(expected).color;
            expected.remove();
            return { foreground, color: style.color, background: style.backgroundColor,
              transform: style.transform, filter: style.filter };
          });
          if (state === 'pressed') { await page.mouse.move(0, 0); await page.mouse.up(); }
          const label = `${character.id}/${theme}/${state}`;
          assert.equal(styles.color, styles.foreground, `${label}: preserve character on-accent foreground`);
          assert.notEqual(styles.color, styles.background, `${label}: foreground must not equal background`);
          assert.equal(styles.transform, 'none', `${label}: no legacy lift`);
          assert.equal(styles.filter, 'none', `${label}: no legacy brightness filter`);
          results.push({ character: character.id, theme, state, ...styles });
        }
      }
      await context.close();
    }
    const output = path.join(root, '.build/button-audit/character-states.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(results, null, 2));
    console.log(`PASS ${results.length} character/theme/button-state cases; ${output}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
