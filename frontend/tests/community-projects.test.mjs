import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {communityProjects,renderCommunityProjects,renderFriendDirectory} from '../src/components/archive/LinkDirectories.mjs';
import {createPrimitives} from '../src/components/archive/primitives.mjs';
import {filterProjectRows} from '../public/components/community-projects.js';
const ctx=createPrimitives({translations:{en:{},ja:{}},modelVendors:{}});

test('community project view reuses source destinations and keeps the requested six entries and order',()=>{
  const {document}=parseHTML(renderCommunityProjects(ctx));
  const rows=[...document.querySelectorAll('[data-project-kind]')];
  assert.deepEqual(rows.map(row=>row.dataset.projectKind),['owner','owner','meme','setting','other','other']);
  assert.deepEqual([...document.querySelectorAll('.project-directory-number')].map(node=>node.textContent),['01','02','03','04','05','06']);
  assert.equal(communityProjects[0].url,communityProjects[2].url);
  assert.equal(document.querySelector('.link-directory a[href="/friend-links.html"]'),null);
  for(const link of document.querySelectorAll('a[href^="https://"]')){assert.equal(link.getAttribute('target'),'_blank');assert.ok(link.getAttribute('rel').includes('noopener'));}
  assert.equal(filterProjectRows(document.querySelector('[data-project-catalog]'),'owner'),2);
  assert.equal(filterProjectRows(document.querySelector('[data-project-catalog]'),'meme'),1);
  assert.equal(rows.filter(row=>row.classList.contains('is-last')).length,1);
  assert.equal(filterProjectRows(document.querySelector('[data-project-catalog]'),'unknown'),0);
  assert.equal(document.querySelector('[data-project-empty]').hidden,false);
  assert.equal(filterProjectRows(document.querySelector('[data-project-catalog]'),'all'),6);
  assert.equal(document.querySelector('[data-project-filter="all"]').getAttribute('aria-pressed'),'true');
});

test('friend card variant keeps external card destinations without adding project filters',()=>{
  const {document}=parseHTML(renderFriendDirectory(ctx));
  assert.ok(document.querySelectorAll('.link-directory-card').length>=4);
  assert.equal(document.querySelector('[data-project-filter]'),null);
  for(const link of document.querySelectorAll('.link-directory-card'))assert.equal(link.getAttribute('target'),'_blank');
});
