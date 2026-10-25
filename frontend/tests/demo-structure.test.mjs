import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {decorateDocument} from '../src/lib/demo-design.mjs';
test('event migration replaces the old grid rather than nesting another grid inside it',()=>{
 const html=decorateDocument('<header class="event-hero"><figure><img src="/event.webp"></figure><div><h1>Event</h1><p>Details</p></div></header>','events');
 const {document}=parseHTML('<html><body>'+html+'</body></html>');
 const hero=document.querySelector('.designed-event-hero');
 assert.ok(hero);assert.equal(hero.children.length,2);assert.equal(hero.firstElementChild.tagName,'DIV');assert.equal(hero.lastElementChild.tagName,'FIGURE');assert.equal(document.querySelector('.event-hero,.live-event-hero'),null);
});

test('document headings keep translated introductions before the shared section navigation',()=>{
 const html=decorateDocument('<h1 data-i18n="about.h1">About</h1><p class="lede" data-i18n="about.lede">Introduction</p><section id="license"><h2>License</h2><a href="/works/example.html">Source</a></section>','about');
 const {document}=parseHTML('<html><body>'+html+'</body></html>');
 assert.equal(document.querySelectorAll('h1').length,1);
 const heading=document.querySelector('.page-head');
 assert.equal(heading.querySelector('h1 [data-i18n="about.h1"]').textContent,'About');
 assert.equal(heading.querySelector('.lede [data-i18n="about.lede"]').textContent,'Introduction');
 assert.ok(heading.nextElementSibling.matches('nav.section-tabs'));
 assert.equal(document.querySelector('nav [aria-current="page"]').getAttribute('href'),'/about.html');
 assert.equal(document.querySelector('#license a').getAttribute('href'),'/works/example.html');
 assert.equal(document.querySelector('.synced-prose [data-i18n="about.lede"]'),null);
});
