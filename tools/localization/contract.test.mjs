import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceHash,validateI18n} from './contract.mjs';
import {fixtureI18n} from './test-fixture.mjs';
import {parseReviewResponse} from '../../server/review.mjs';
import {validateContent as bridge} from '../../server/bridge.mjs';
const source={name:'探头',description:'露出脑袋',commentary:'让我看看',tags:['探头','可爱'],characterId:'deepseek',categoryIds:['meme']};
const vocabulary={ok:true,characterIds:new Set(['deepseek']),categoryIds:new Set(['meme'])};
test('v2 retains validated translations through review and bridge, v1 historical content stays readable',()=>{
  const payload={schema:'submission-ai-content/2',verdict:'pass',confidence:0.95,reason:'valid',content:{...source,i18n:fixtureI18n(source.tags)}};
  const reviewed=parseReviewResponse(payload,{vocabulary});assert.equal(reviewed.verdict,'pass');
  assert.deepEqual(bridge(reviewed.content,vocabulary).value.i18n,payload.content.i18n);
  delete payload.content.i18n;assert.equal(parseReviewResponse(payload,{vocabulary}).verdict,'manual');
  payload.schema='submission-ai-content/1';assert.equal(parseReviewResponse(payload,{vocabulary}).verdict,'pass');
});
test('missing languages, tag misalignment, name violations and injection are rejected',()=>{
  for(const change of [v=>delete v.ja,v=>v.en.tags.pop(),v=>v.en.name='Whale Chan',v=>v.ja.name='鲸鱼娘',v=>v.ja.tags[0]='Q版',v=>v.en.faq[0].answer='<script>x</script>',v=>v.en.description='javascript:alert(1)']){
    const value=fixtureI18n(source.tags);change(value);assert.throws(()=>validateI18n(value,source));
    assert.equal(bridge({...source,i18n:value},vocabulary).ok,false);
  }
});
test('source digest detects editorial and taxonomy changes but preserves frozen identity and attribution independence',()=>{
  assert.notEqual(sourceHash(source),sourceHash({...source,name:'换标题'}));
  assert.notEqual(sourceHash(source),sourceHash({...source,tags:['新标签']}));
  assert.equal(sourceHash(source),sourceHash({...source,id:'frozen',slug:'same',submitter:{name:'Author'}}));
});
test('distinct source aliases may translate to the same tag without losing positional alignment',()=>{
  const aliased={...source,tags:['DeepSeek娘','鲸鱼娘']};
  const value=fixtureI18n(aliased.tags);
  value.en.tags=['DeepSeek Chan','DeepSeek Chan'];
  value.ja.tags=['DeepSeekちゃん','DeepSeekちゃん'];
  assert.deepEqual(validateI18n(value,aliased).en.tags,value.en.tags);
  assert.deepEqual(validateI18n(value,aliased).ja.tags,value.ja.tags);
  value.en.tags.pop();
  assert.throws(()=>validateI18n(value,aliased),/tag alignment/);
});
