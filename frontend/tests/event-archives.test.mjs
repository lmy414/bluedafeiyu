import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {createPrimitives} from '../src/components/archive/primitives.mjs';
import {createEventDirectory} from '../src/components/archive/EventDirectory.mjs';
import {createEventPage} from '../src/components/archive/EventPage.mjs';
import {events, eventPaths} from '../src/lib/events.mjs';

function context() {
  const pages = new Map();
  const ctx = {translations: {en: {}, ja: {}}, modelVendors: {}, write: (url, title, active, content) => pages.set(url, parseHTML('<html><body>' + content + '</body></html>').document)};
  Object.assign(ctx, createPrimitives(ctx));
  return {ctx, pages};
}

test('event tabs separate current and past editions, and the landing view defaults to the archive', () => {
  const {ctx, pages} = context();
  createEventPage(ctx);
  for (const url of ['/events.html', eventPaths.archived]) {
    const document = pages.get(url);
    assert.equal(document.querySelector('.event-tabs [aria-current="page"]').getAttribute('href'), eventPaths.archived);
    assert.equal(document.querySelectorAll('.event-archive-card').length, 1);
    assert.equal(document.querySelector('.event-archive-copy .button').getAttribute('href'), events[0].href);
    assert.equal(document.querySelector('[data-event-archive]'), null);
    assert.equal(document.querySelector('.event-rules'), null);
  }
  const current = pages.get(eventPaths.current);
  assert.equal(current.querySelector('.event-tabs [aria-current="page"]').getAttribute('href'), eventPaths.current);
  assert.ok(current.body.textContent.includes('暂无进行中的活动'));
  assert.equal(current.querySelectorAll('.event-archive-card').length, 0);
});

test('the directory supports multiple independent editions and prioritizes current events on the landing view', () => {
  const {ctx, pages} = context();
  const earlier = {...events[0], id: 'earlier', href: '/events/earlier.html', deadline: '2025-10-26T23:59:59+08:00'};
  const current = {...events[0], id: 'next', href: '/events/next.html', status: 'current', deadline: '2027-10-26T23:59:59+08:00'};
  createEventDirectory(ctx, [earlier, current, events[0]]);
  const archived = pages.get(eventPaths.archived);
  assert.deepEqual([...archived.querySelectorAll('.event-archive-copy .button')].map(a => a.getAttribute('href')), [events[0].href, earlier.href]);
  assert.equal(pages.get('/events.html').querySelector('.event-tabs [aria-current="page"]').getAttribute('href'), eventPaths.current);
  assert.equal(pages.get(eventPaths.current).querySelector('.event-archive-copy .button').getAttribute('href'), current.href);
});

test('the original National Day URL preserves the exhibition, original rules and pending results without a submission CTA', () => {
  const {ctx, pages} = context();
  createEventPage(ctx);
  const document = pages.get(events[0].href);
  assert.equal(document.querySelector('[data-event-archive]').getAttribute('data-event-archive'), events[0].id);
  assert.ok(document.querySelector('.event-status').textContent.includes('征集已结束'));
  assert.ok(document.querySelector('.event-status').textContent.includes('结果待公布'));
  assert.deepEqual([...document.querySelectorAll('.hero-actions a')].map(a => a.getAttribute('href')), [events[0].exhibition, events[0].repository]);
  assert.equal(document.querySelector('.event-rules').hasAttribute('open'), false);
  assert.ok(document.querySelector('.event-rules').textContent.includes('88'));
  assert.ok(document.querySelector('.event-rules').textContent.includes('66'));
  assert.equal(document.querySelector('.breadcrumbs a').getAttribute('href'), eventPaths.archived);
  assert.equal([...document.querySelectorAll('a')].some(a => /投稿$/.test(a.textContent)), false);
  assert.equal(ctx.translations.en['d.events.nationalCover'], events[0].coverAlt[1]);
});

test('published event routes preserve language, metadata, archive links and closed status without JavaScript', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const out = process.env.SITE_OUT_DIR || path.join(root, '.build/site');
  for (const prefix of ['', '/en', '/ja', '/zh-hant']) {
    for (const url of ['/events.html', eventPaths.current, eventPaths.archived, events[0].href]) {
      const document = parseHTML(fs.readFileSync(path.join(out, prefix, url), 'utf8')).document;
      assert.equal(document.querySelectorAll('.event-tabs a').length, 2);
      assert.ok(document.querySelector('.event-tabs a').getAttribute('href').startsWith(prefix + '/events/'));
      assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://xn--pssy23gqgbz2d718b.com' + prefix + url);
      assert.equal(document.querySelector('.main-nav [aria-current="page"]').getAttribute('href'), prefix + '/events.html');
      if (url === eventPaths.archived) {
        assert.equal(document.querySelector('.event-archive-copy .button').getAttribute('href'), prefix + events[0].href);
        const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
        assert.equal(schema['@type'], 'CollectionPage');
        assert.equal(schema.mainEntity.itemListElement[0].item.url, 'https://xn--pssy23gqgbz2d718b.com' + prefix + events[0].href);
      }
      if (prefix === '/en') assert.doesNotMatch(document.title + document.querySelector('main').textContent, /[\u3400-\u9fff]/u);
    }
  }
});
