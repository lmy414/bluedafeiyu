import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Converter } from 'opencc-js/cn2t';

const source = fs.readFileSync(new URL('../public/lang.js', import.meta.url), 'utf8');
const converter = Converter({ from: 'cn', to: 'twp' });
function boot({ saved = null, language = 'zh-CN', search = '', blocked = false, baked = '', pathname = '/about.html', hash = '' } = {}) {
  const storage = new Map(saved ? [['bluedafeiyu-lang', saved]] : []);
  const listeners = {}, scripts = [], events = [];
  let document;
  class Element {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false; this.textContent = ''; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(el => el !== this); }
    contains(el) { return el === this || this.children.some(child => child.contains(el)); }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    focus() { document.activeElement = this; }
    matches(selector) {
      if (selector[0] === '.') return (this.className || '').split(' ').includes(selector.slice(1));
      const attr = selector.match(/^\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]$/);
      return !!attr && this.attrs[attr[1]] != null && (attr[2] == null || this.attrs[attr[1]] === attr[2]);
    }
    querySelectorAll(selector) { return this.children.flatMap(el => [...(selector.split(',').some(s => el.matches(s)) ? [el] : []), ...el.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    fire(type, extra = {}) { this.listeners[type]?.({ target: this, preventDefault() {}, stopPropagation() {}, ...extra }); }
  }
  const root = new Element(), body = new Element('body'), head = new Element('head');
  if (baked) root.setAttribute('data-site-lang', baked);
  root.appendChild(body); root.appendChild(head);
  const appendScript = head.appendChild.bind(head);
  head.appendChild = el => { scripts.push(el); return appendScript(el); };
  const hosts = ['top', 'drawer'].map(where => { const el = new Element(); el.setAttribute('data-lang-host', where); body.appendChild(el); return el; });
  const label = new Element('span'); label.setAttribute('data-i18n', 'nav.about'); label.textContent = '关于'; body.appendChild(label);
  const input = new Element('input'); input.setAttribute('data-i18n-attr', 'placeholder:v2.searchPh'); input.setAttribute('placeholder', '搜索作品、角色、别名或 Tag'); body.appendChild(input);
  document = { readyState: 'complete', documentElement: root, body, head, activeElement: body, title: '关于',
    createElement: tag => new Element(tag), querySelectorAll: selector => root.querySelectorAll(selector), querySelector: selector => root.querySelector(selector),
    getElementById: id => [root, ...root.querySelectorAll('[data-lang-host]'), ...hosts.flatMap(host => [host.children[0]])].find(el => el?.id === id),
    addEventListener: (type, fn) => { listeners[type] = fn; }, dispatchEvent: event => { events.push(event); },
  };
  const navigations = [];
  const location = new URL('https://example.test' + pathname + search + hash);
  location.assign = href => navigations.push(href); location.replace = href => navigations.push(href);
  const window = { navigator: { languages: [language] }, location, localStorage: {
    getItem: key => { if (blocked) throw Error('blocked'); return storage.get(key); },
    setItem: (key, value) => { if (blocked) throw Error('blocked'); storage.set(key, value); },
  } };
  vm.runInNewContext(source, { window, document, URL, URLSearchParams, WeakMap, Promise, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  return { api: window.SiteLang, hosts, label, input, root, document, storage, scripts, listeners, events, navigations, location,
    finishLoad: () => { window.OpenCC = { Converter: () => converter }; scripts.at(-1).onload(); },
    key: (box, key) => box.fire('keydown', { key }),
  };
}

test('繁体地区与脚本标签、URL 和既有语言偏好的优先级正确', async () => {
  for (const language of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh_Hant_TW']) {
    const page = boot({ language }); page.finishLoad(); await Promise.resolve(); await Promise.resolve();
    assert.equal(page.api.current, 'zh-Hant'); assert.equal(page.root.lang, 'zh-Hant');
  }
  assert.equal(boot({ language: 'zh-Hans-TW' }).api.current, 'zh');
  assert.equal(boot({ saved: 'en', language: 'zh-TW' }).api.current, 'en');
  assert.equal(boot({ saved: 'en', search: '?lang=ja' }).api.current, 'ja');
});

test('独立 URL 固定页面语言，切换保留页面、参数、锚点和浮层更新后的地址', async () => {
  const page = boot({ baked: 'en', saved: 'ja', language: 'zh-TW', pathname: '/en/search.html', search: '?q=鲸鱼', hash: '#results' });
  assert.equal(page.api.current, 'en');
  await page.api.setLang('zh-Hant');
  assert.equal(page.navigations.at(-1), '/zh-hant/search.html?q=%E9%B2%B8%E9%B1%BC#results');
  page.location.href = 'https://example.test/en/works/frozen-slug.html';
  await page.api.setLang('ja'); assert.equal(page.navigations.at(-1), '/ja/works/frozen-slug.html');
  assert.equal(page.api.url('/characters/deepseek.html'), '/en/characters/deepseek.html');
  assert.equal(page.api.url('https://github.com/example/repo'), 'https://github.com/example/repo');
  assert.equal(page.api.languageUrl('zh', '/en/index.html'), '/');
});

test('旧 lang 参数跳转到独立版本并去掉 lang，保留搜索参数和锚点', () => {
  const page = boot({ baked: 'zh', search: '?lang=zh-TW&q=DeepSeek', hash: '#license' });
  assert.equal(page.navigations.at(-1), '/zh-hant/about.html?q=DeepSeek#license');
});
test('按需加载繁体，静态属性、动态变量转换且简英繁往返不丢原文', async () => {
  const page = boot(); assert.equal(page.scripts.length, 0);
  const pending = page.api.setLang('zh-Hant'); page.finishLoad(); await pending;
  assert.equal(page.label.textContent, '關於'); assert.equal(page.input.getAttribute('placeholder'), '搜尋作品、角色、別名或 Tag');
  assert.equal(page.api.t('about.license.p1b', '程序代码'), '程式碼');
  assert.equal(page.api.t('v2.nav.gallery', '图库'), '圖庫');
  assert.equal(page.api.fmt('new.interface.key', '已经复制 {count} 张图片', { count: 2 }), '已經複製 2 張圖片');
  assert.equal(page.storage.get('bluedafeiyu-lang'), 'zh-Hant');
  await page.api.setLang('en'); assert.equal(page.label.textContent, 'About');
  await page.api.setLang('zh-Hant'); assert.equal(page.label.textContent, '關於');
  await page.api.setLang('zh'); assert.equal(page.label.textContent, '关于');
  assert.equal(page.input.getAttribute('placeholder'), '搜索作品、角色、别名或 Tag');
  assert.equal(page.scripts.length, 1);
});
test('转换资源失败可重试，迟到的加载不会覆盖新的语言选择', async () => {
  const page = boot(); const failed = page.api.setLang('zh-Hant'); page.scripts.at(-1).onerror(); await failed;
  assert.equal(page.api.current, 'zh'); assert.equal(page.storage.has('bluedafeiyu-lang'), false);
  assert.equal(page.hosts[0].children[0].children[2].hidden, false);
  const pending = page.api.setLang('zh-Hant'); await page.api.setLang('ja'); page.finishLoad(); await pending;
  assert.equal(page.api.current, 'ja'); assert.equal(page.storage.get('bluedafeiyu-lang'), 'ja');
  await page.api.setLang('zh-Hant'); assert.equal(page.api.current, 'zh-Hant');
});
test('桌面和抽屉各有一个收起入口，四个选项同步且键盘、外部点击会收起', async () => {
  const page = boot(); const boxes = page.hosts.map(host => host.children[0]);
  const [trigger, menu] = boxes[0].children;
  assert.equal(menu.hidden, true); assert.equal(menu.children.length, 4);
  trigger.fire('click'); assert.equal(menu.hidden, false); assert.equal(page.document.activeElement, menu.children[0]);
  page.key(boxes[0], 'ArrowDown'); assert.equal(page.document.activeElement, menu.children[1]);
  page.key(boxes[0], 'End'); assert.equal(page.document.activeElement, menu.children[3]);
  page.key(boxes[0], 'Escape'); assert.equal(menu.hidden, true); assert.equal(page.document.activeElement, trigger);
  trigger.fire('click'); menu.children[2].fire('click');
  for (const box of boxes) { assert.equal(box.children[0].children[1].textContent, 'English'); assert.equal(box.children[1].children[2].getAttribute('aria-checked'), 'true'); }
  boxes[1].children[0].fire('click'); assert.equal(menu.hidden, true);
  page.listeners.pointerdown({ target: page.document.body }); assert.equal(boxes[1].children[1].hidden, true);
  assert.equal(trigger.getAttribute('aria-controls'), menu.id);
  page.api.mountMenus(); assert.equal(boxes[0].children[1].children.length, 4);
});
test('隐私模式阻止存储时仍可切换，刷新后恢复已保存的繁体选择', async () => {
  const blocked = boot({ blocked: true }); const pending = blocked.api.setLang('zh-Hant'); blocked.finishLoad(); await pending;
  assert.equal(blocked.api.current, 'zh-Hant');
  const restored = boot({ saved: 'zh-Hant' }); restored.finishLoad(); await Promise.resolve(); await Promise.resolve();
  assert.equal(restored.label.textContent, '關於');
});
