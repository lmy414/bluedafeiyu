import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesCreationMethod} from '../public/archive/creation-method.js';
import fs from 'node:fs';
import path from 'node:path';
import {sourceHash,validateI18n} from '../../tools/localization/contract.mjs';

test('non-AI filtering requires an explicit tag, independent of art type and visual style',()=>{
  const catalog=[{id:'statement',tg:['非AI'],k:['illustration']},{id:'style',tg:['手绘风'],k:['illustration']},{id:'unknown',tg:[],k:['comic']}];
  assert.deepEqual(catalog.filter(w=>matchesCreationMethod(w,'non-ai')).map(w=>w.id),['statement']);
  assert.equal(catalog.filter(w=>matchesCreationMethod(w)).length,3);
  assert.equal(matchesCreationMethod({tags:['非AI']},'non-ai'),true);
  assert.equal(matchesCreationMethod(catalog[0],'unrecognized'),false);
});

test('指定的 Claude 手绘作品归入非 AI，保留插画类型、冻结地址和英日标签',()=>{
  const root=path.resolve(import.meta.dirname,'../..');
  const source=JSON.parse(fs.readFileSync(path.join(root,'data/works.json'),'utf8')).find(w=>w.slug==='claude202610170002');
  assert.equal(source.id,'sticker_79fb44f6fe3253bf449fddda');
  assert.deepEqual(source.categoryIds,['illustration']);
  assert.ok(source.path.endsWith('/originals/claude/79fb44f6fe3253bf.png'));
  assert.ok(source.tags.includes('手绘'));assert.ok(source.tags.includes('非AI'));
  assert.equal(source.i18n.sourceHash,sourceHash(source));validateI18n(source.i18n,source);
  const output=process.env.SITE_OUT_DIR||path.join(root,'.build/site');
  const work=JSON.parse(fs.readFileSync(path.join(output,'archive-data.json'),'utf8')).works.find(w=>w.slug===source.slug);
  assert.equal(matchesCreationMethod(work,'non-ai'),true);
  assert.deepEqual(work.k,['illustration']);
});
