import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesCreationMethod} from '../public/archive/creation-method.js';

test('non-AI filtering requires an explicit tag, independent of art type and visual style',()=>{
  const catalog=[{id:'statement',tg:['非AI'],k:['illustration']},{id:'style',tg:['手绘风'],k:['illustration']},{id:'unknown',tg:[],k:['comic']}];
  assert.deepEqual(catalog.filter(w=>matchesCreationMethod(w,'non-ai')).map(w=>w.id),['statement']);
  assert.equal(catalog.filter(w=>matchesCreationMethod(w)).length,3);
  assert.equal(matchesCreationMethod({tags:['非AI']},'non-ai'),true);
  assert.equal(matchesCreationMethod(catalog[0],'unrecognized'),false);
});
