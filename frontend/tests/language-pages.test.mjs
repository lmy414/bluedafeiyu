import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseHTML, DOMParser } from 'linkedom';
import { LOCALES, ORIGIN, localizedPath, localizeHtml, buildLanguagePages } from '../scripts/localize-pages.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const out = process.env.SITE_OUT_DIR ? path.resolve(process.env.SITE_OUT_DIR) : path.join(root, '.build/site');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'dist/site-data.json'), 'utf8'));
const read = base => parseHTML(fs.readFileSync(path.join(out, base.endsWith('/') ? base.slice(1) + 'index.html' : base.slice(1)), 'utf8')).document;
const rootFiles = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dir === out && LOCALES.some(l => l.prefix.slice(1) === item.name)) continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else if (item.name.endsWith('.html') && fs.readFileSync(file, 'utf8').includes('data-site-lang="zh"')) rootFiles.push('/' + path.relative(out, file).split(path.sep).join('/'));
  }
}
walk(out);

test('每个公开 HTML 的四种语言版本、canonical 和相互 hreflang 都存在', () => {
  assert.ok(rootFiles.length > snapshot.works.length);
  for (const base of rootFiles) {
    const canonicalBase = new URL(read(base).querySelector('link[rel="canonical"]').getAttribute('href')).pathname;
    for (const locale of LOCALES) {
      const document = read(localizedPath(base, locale));
      assert.equal(document.documentElement.getAttribute('data-site-lang'), locale.id, base);
      assert.equal(document.documentElement.getAttribute('lang'), locale.html, base);
      assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), ORIGIN + localizedPath(canonicalBase, locale), base);
      const alternates = [...document.querySelectorAll('link[hreflang]')];
      assert.equal(alternates.length, 5, base);
      for (const other of LOCALES) assert.equal(alternates.find(el => el.getAttribute('hreflang') === other.hreflang)?.getAttribute('href'), ORIGIN + localizedPath(canonicalBase, other), base);
      assert.equal(document.querySelector('link[hreflang="x-default"]').getAttribute('href'), ORIGIN + canonicalBase, base);
      assert.equal(document.querySelector('meta[property="og:url"]').getAttribute('content'), ORIGIN + localizedPath(canonicalBase, locale), base);
    }
  }
});

test('HTML 在执行 JS 前已翻译，导航与分页留在当前语言且资产共用根路径', () => {
  const labels = ['关于', '關於', 'About', 'このサイトについて'];
  for (const [i, locale] of LOCALES.entries()) {
    const document = read(localizedPath('/about.html', locale));
    assert.equal(document.querySelector('main h1').textContent, labels[i]);
    assert.equal(document.querySelector('.feed-search').getAttribute('action'), locale.prefix + '/search.html');
    assert.equal(document.querySelector('.top-submit').getAttribute('href'), locale.prefix + '/submit.html');
    assert.equal(document.querySelector('script[src*="lang.js"]').getAttribute('src'), '/lang.js?v=18');
    assert.ok(document.querySelector('noscript details a[href="/ja/about.html"]'));
    const pagination = read(localizedPath('/page/2.html', locale));
    assert.ok(pagination.querySelector('[data-next]').getAttribute('data-next').startsWith(locale.prefix + '/page/'));
    assert.equal(pagination.querySelector('meta[name="robots"]').getAttribute('content'), 'noindex,follow');
  }
  for (const asset of ['cn2t-1.4.2.js', 'LICENSE', 'LICENSES/Apache-2.0.txt', 'THIRD_PARTY_LICENSES.md']) assert.ok(fs.existsSync(path.join(out, 'vendor/opencc', asset)));
  assert.equal(read('/zh-hant/about.html').querySelector('[data-i18n="about.license.p1b"]').textContent, '程式碼');
});

test('作品的冻结标识、作者、图片和评论串跨语言一致，许可链接指向对应版本', () => {
  for (const work of snapshot.works) {
    const base = '/works/' + work.slug + '.html';
    const original = JSON.parse(read(base).querySelector('script[type="application/ld+json"]').textContent);
    for (const locale of LOCALES) {
      const document = read(localizedPath(base, locale));
      const data = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
      assert.equal(data.name, ['en','ja'].includes(locale.id) ? work.i18n[locale.id].name : original.name);
      if (['en','ja'].includes(locale.id)) {
        const native=work.i18n[locale.id];
        assert.equal(document.querySelector('main h1').textContent,native.name,work.id+' '+locale.id);
        assert.equal(data.keywords,native.tags.join(', '));
        assert.deepEqual([...document.querySelectorAll('[data-work-faq] details')].map(el=>({question:el.querySelector('summary').textContent,answer:el.querySelector('div').textContent})),native.faq);
      }
      assert.deepEqual(data.creator, original.creator);
      assert.equal(data.contentUrl, original.contentUrl);
      assert.equal(data.thumbnailUrl, original.thumbnailUrl);
      assert.equal(data.url, ORIGIN + localizedPath(base, locale));
      assert.equal(new URL(data.license).pathname, locale.prefix + '/about.html');
      assert.equal(new URL(data.acquireLicensePage).pathname, locale.prefix + '/about.html');
      assert.equal(document.querySelector('[data-static-work]').getAttribute('data-comment-term'), 'sticker-' + work.id);
      assert.ok(!data.creditText.includes('{credit}'));
      assert.ok(!data.copyrightNotice.includes('{creator}'));
      if (locale.id === 'en') {
        assert.equal(data.description,work.i18n.en.description);
        assert.equal(document.querySelector('meta[name="description"]').getAttribute('content'),work.i18n.en.seoDescription);
        assert.equal(document.querySelector('[data-work-faq]').querySelectorAll('details').length,2);
        assert.ok(data.creditText.endsWith('DeepSeek Chan (archive)'));
        assert.doesNotMatch(document.querySelector('main h1').textContent, /(?:DeepSeek|Claude|GPT|GLM|Kimi|Gemini|Grok|MiMo|Stepfun|通义千问|豆包)\s*娘(?!\.[a-z])/i);
      }
      if (locale.id === 'ja') assert.equal(data.description,work.i18n.ja.description);
    }
  }
});

test('新作品缺少真实英日内容时停止生成语言页面', async () => {
  await assert.rejects(buildLanguagePages(out,{works:[{id:'untranslated',name:'新作品'}]}),/Native English\/Japanese work content missing or stale: untranslated/);
});

test('英文静态展示、SEO、结构化数据统一 Chan，保留 URL、标识和作者署名', async () => {
  const html = '<html><head><title>蓝色大肥鱼</title><link rel="canonical" href="' + ORIGIN + '/works/frozen-slug.html"><meta name="description" content="DeepSeek娘作品"><meta property="og:site_name" content="蓝色大肥鱼"><meta property="og:url" content="' + ORIGIN + '/works/frozen-slug.html"><script>const original = "蓝色大肥鱼";</script><script type="application/ld+json">' + JSON.stringify({ '@type': 'ImageObject', name: 'DeepSeek娘与Claude娘', creator: { '@type': 'Person', name: '蓝色大肥鱼' }, contentUrl: 'https://example.test/DeepSeek娘.png', url: ORIGIN + '/works/frozen-slug.html', license: ORIGIN + '/about.html', acquireLicensePage: ORIGIN + '/about.html' }) + '</script></head><body><a href="/characters/deepseek.html">DeepSeek娘</a><main><h1>DeepSeek娘与Claude娘</h1><img alt="通义千问娘" src="/frozen.png"><button aria-label="DeepSeek娘">预览</button><option value="kimi">Kimi娘</option><dl class="work-facts"><dd>蓝色大肥鱼</dd></dl></main><footer>Blue Fish</footer></body></html>';
  const english = LOCALES.find(locale => locale.id === 'en');
  const doc = parseHTML(await localizeHtml(html, '/works/frozen-slug.html', english, { works: [{ slug: 'frozen-slug', name: 'DeepSeek娘与Claude娘', characterId: 'deepseek', categoryIds: ['meme'] }], characters: [{ id: 'deepseek', name: 'DeepSeek娘' }] })).document;
  assert.equal(doc.querySelector('main h1').textContent, 'DeepSeek Chan与Claude Chan');
  assert.equal(doc.querySelector('footer').textContent, 'DeepSeek Chan');
  assert.equal(doc.querySelector('meta[property="og:site_name"]').getAttribute('content'), 'DeepSeek Chan');
  assert.ok(doc.title.endsWith(' | DeepSeek Chan'));
  assert.equal(doc.querySelector('a').getAttribute('href'), '/en/characters/deepseek.html');
  assert.equal(doc.querySelector('option').getAttribute('value'), 'kimi');
  assert.equal(doc.querySelector('option').textContent, 'Kimi Chan');
  assert.equal(doc.querySelector('img').getAttribute('alt'), 'Qwen Chan');
  assert.equal(doc.querySelector('button').getAttribute('aria-label'), 'DeepSeek Chan');
  assert.equal(doc.querySelector('.work-facts dd').textContent, '蓝色大肥鱼');
  assert.equal(doc.querySelector('script').textContent, 'const original = "蓝色大肥鱼";');
  const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(data.name, 'DeepSeek Chan与Claude Chan');
  assert.equal(data.creator.name, '蓝色大肥鱼');
  assert.equal(data.contentUrl, 'https://example.test/DeepSeek娘.png');
});

test('英文首页和所有角色页的品牌、角色名称在无 JS 时也使用 Chan', () => {
  for (const base of ['/index.html', '/characters.html', ...snapshot.characters.filter(c => c.status === 'active' && snapshot.works.some(w => w.characterId === c.id)).map(c => '/characters/' + c.id + '.html')]) {
    const doc = read('/en' + base);
    assert.equal(doc.querySelector('meta[property="og:site_name"]').getAttribute('content'), 'DeepSeek Chan', base);
    assert.match(doc.querySelector('.sidebar').textContent, /DeepSeek Chan/, base);
    assert.doesNotMatch(doc.querySelector('.sidebar').textContent, /蓝色大肥鱼|Blue Fish/, base);
    assert.doesNotMatch(doc.querySelector('main h1').textContent, /(?:DeepSeek|Claude|GPT|GLM|Kimi|Gemini|Grok|MiMo|Stepfun|通义千问|豆包)娘/, base);
  }
});

test('sitemap 收录四种语言的可索引路由，每条包含完整的语言对应关系', () => {
  const xml = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const urls = [...document.querySelectorAll('url')];
  const locs = urls.map(el => el.querySelector('loc').textContent);
  assert.equal(new Set(locs).size, locs.length);
  assert.equal(urls.length % 4, 0);
  for (const el of urls) {
    const loc = el.querySelector('loc').textContent;
    const links = [...el.querySelectorAll('xhtml\\:link')];
    assert.equal(links.length, 5, loc);
    assert.ok(links.some(link => link.getAttribute('href') === loc), loc);
    assert.equal(read(new URL(loc).pathname).querySelector('meta[name="robots"]').getAttribute('content'), 'index,follow', loc);
    const lastmod = el.querySelector('lastmod')?.textContent;
    assert.ok(lastmod && Number.isFinite(Date.parse(lastmod)) && Date.parse(lastmod) <= Date.now(), loc + ': missing or future lastmod');
  }
  for (const locale of LOCALES) {
    assert.ok(locs.includes(ORIGIN + localizedPath('/', locale)));
    assert.equal(locs.includes(ORIGIN + localizedPath('/search.html', locale)), false);
    assert.equal(locs.includes(ORIGIN + localizedPath('/404.html', locale)), false);
  }
});
