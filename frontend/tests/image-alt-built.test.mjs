import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditSite} from '../scripts/audit-image-alt.mjs';

test('all built images have alt and every empty value has a reviewed decorative reason',()=>{
  const report=auditSite(fileURLToPath(new URL('../../.build/site/',import.meta.url)));
  assert.deepEqual(report.issues,[]);
  assert.deepEqual(Object.keys(report.locales).sort(),['en','ja','zh','zh-hant']);
  assert.ok(report.images>0);
  assert.equal(Object.values(report.decorations).reduce((sum,count)=>sum+count,0),report.empty,'every empty alt needs a reviewed reason');
});
