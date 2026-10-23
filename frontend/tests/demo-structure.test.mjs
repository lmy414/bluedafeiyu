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
