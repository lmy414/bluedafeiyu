import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {workImageURL, workImages, IMAGE_PLACEHOLDER} from '../public/components/work-image.js';
import {renderWorkCard} from '../public/components/work-card.js';

test('empty or invalid image names use a real shared placeholder', () => {
  for (const value of [undefined, null, '', ' ', '/', 'undefined', '/submissions/previews/deepseek/.webp', '/submissions/large/gpt/undefined.webp', '/submissions/previews/gpt/null.webp?x=1', '/submissions/previews/gpt/%75ndefined.webp', 'javascript:bad.webp', '/broken%ZZ.webp']) {
    assert.equal(workImageURL(value), IMAGE_PLACEHOLDER, String(value));
    const work = {slug:'test', i:value, k:[], roles:[]};
    assert.equal(parseHTML(renderWorkCard(work)).document.querySelector('img').getAttribute('src'), IMAGE_PLACEHOLDER);
  }
});

test('valid recorded paths survive character changes; missing derivatives reuse an existing size', () => {
  const thumbnailPath = 'submissions/previews/other/source.webp';
  const fullPath = 'submissions/large/other/source.webp';
  assert.deepEqual(workImages({id:'', characterId:'doubao', thumbnailPath, fullPath}), {thumbUrl:'/'+thumbnailPath, displayUrl:'/'+fullPath});
  assert.deepEqual(workImages({thumbnailPath, fullPath}, value=>value==='/'+fullPath), {thumbUrl:'/'+fullPath, displayUrl:'/'+fullPath});
  assert.deepEqual(workImages({thumbnailPath, fullPath}, ()=>false), {thumbUrl:IMAGE_PLACEHOLDER, displayUrl:IMAGE_PLACEHOLDER});
  assert.equal(workImageURL('https://example.com/a%20b.webp?size=480'), 'https://example.com/a%20b.webp?size=480');
});
