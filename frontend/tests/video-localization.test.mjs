import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {localizeHtml, LOCALES, ORIGIN} from '../scripts/localize-pages.mjs';
import {videoArchive} from '../src/lib/video-archive.mjs';

test('creator identity survives role-name translation in title, credits and sharing metadata', async () => {
  const creator = {uid: '3747573030456892', name: 'DeepSeek鲸鱼娘在运营'};
  const route = `/creators/bilibili-${creator.uid}.html`;
  const before = videoArchive.creators;
  videoArchive.creators = [creator];
  try {
    const html = `<html><head><title>${creator.name} · 作者视频档案</title><link rel="canonical" href="${ORIGIN}${route}"><meta name="description" content="作者介绍"><meta property="og:title"><meta name="twitter:title"><meta property="og:image:alt"><script type="application/ld+json">${JSON.stringify({'@type': 'WebPage', name: creator.name, url: ORIGIN + route})}</script></head><body data-i18n-page="videos"><main><h1>${creator.name}</h1><a href="${route}">${creator.name}</a></main></body></html>`;
    for (const locale of LOCALES) {
      const {document} = parseHTML(await localizeHtml(html, route, locale, {works: [], characters: [], topics: []}));
      assert.ok(document.title.startsWith(creator.name + ' · '), locale.id);
      assert.equal(document.querySelector('main h1').textContent, creator.name, locale.id);
      assert.equal(document.querySelector('main a').textContent, creator.name, locale.id);
      assert.equal(document.querySelector('meta[property="og:image:alt"]').getAttribute('content'), document.title);
      if (locale.id !== 'zh') {
        for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) assert.equal(document.querySelector(selector).getAttribute('content'), document.title);
        assert.equal(JSON.parse(document.querySelector('script').textContent).name, document.title);
      }
      if (locale.id === 'en') assert.doesNotMatch(document.title.replace(creator.name, ''), /[\u3400-\u9fff]/u);
    }
  } finally { videoArchive.creators = before; }
});
