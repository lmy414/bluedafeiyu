import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');
function boot({ saved = null, dark = false, blocked = false } = {}) {
  const listeners = {};
  const attrs = {};
  const button = { hidden: true, setAttribute: (name, value) => { attrs[name] = value; } };
  const root = { dataset: {} };
  const messages = [];
  const system = { matches: dark, addEventListener: (type, fn) => { listeners.system = fn; } };
  const storage = new Map(saved === null ? [] : [['bluedafeiyu-theme', saved]]);
  const context = {
    window: { matchMedia: () => system, addEventListener: (type, fn) => { listeners[type] = fn; } },
    document: {
      documentElement: root,
      querySelectorAll: selector => selector === '[data-theme-toggle]' ? [button] : [{ contentWindow: { postMessage: (...args) => messages.push(args) } }],
      addEventListener: (type, fn) => { listeners[type] = fn; },
      dispatchEvent: () => {},
    },
    localStorage: {
      getItem: key => { if (blocked) throw new Error('blocked'); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (blocked) throw new Error('blocked'); storage.set(key, value); },
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  };
  vm.runInNewContext(source, context);
  return { root, attrs, button, system, storage, listeners, messages, context,
    click: () => listeners.click({ target: { closest: () => button } }) };
}

test('first visit follows system changes; manual choice takes priority and persists on reload', () => {
  const page = boot({ dark: true });
  assert.equal(page.root.dataset.theme, 'dark');
  page.system.matches = false;
  page.listeners.system();
  assert.equal(page.root.dataset.theme, 'light');
  page.click();
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.attrs['aria-pressed'], 'true');
  assert.equal(page.storage.get('bluedafeiyu-theme'), 'dark');
  page.listeners.system();
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(boot({ saved: page.storage.get('bluedafeiyu-theme') }).root.dataset.theme, 'dark');
  page.click();
  assert.equal(page.attrs['aria-label'], '切换到黑夜模式');
});

test('invalid saved values and blocked storage still allow theme switching', () => {
  assert.equal(boot({ saved: 'invalid', dark: true }).root.dataset.theme, 'dark');
  assert.equal(boot({ saved: 'light', dark: true }).root.dataset.theme, 'light');
  const page = boot({ blocked: true });
  page.click();
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.button.hidden, false);
});

test('other tabs synchronize preferences; removing preference restores system behavior', () => {
  const page = boot({ saved: 'light', dark: true });
  page.listeners.storage({ key: 'unrelated', newValue: 'dark' });
  assert.equal(page.root.dataset.theme, 'light');
  page.listeners.storage({ key: 'bluedafeiyu-theme', newValue: 'dark' });
  assert.equal(page.root.dataset.theme, 'dark');
  page.listeners.storage({ key: 'bluedafeiyu-theme', newValue: null });
  page.system.matches = false;
  page.listeners.system();
  assert.equal(page.root.dataset.theme, 'light');
});

test('language change updates accessible labels and comments receive the chosen theme', () => {
  const page = boot();
  page.context.window.SiteLang = { t: key => ({ 'theme.toDark': 'Switch to dark mode', 'theme.toLight': 'Switch to light mode' })[key] };
  page.listeners['site:langchange']();
  assert.equal(page.attrs['aria-label'], 'Switch to dark mode');
  page.click();
  assert.equal(page.attrs['aria-label'], 'Switch to light mode');
  const [message, origin] = page.messages.at(-1);
  assert.equal(message.giscus.setConfig.theme, 'dark');
  assert.equal(origin, 'https://giscus.app');
});
