import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseHTML} from 'linkedom';
const root=new URL('../../',import.meta.url);
const out=new URL('.build/character-preview/',root);
const expected=['deepseek','gemini','claude','gpt','qwen','kimi','grok','other','glm','doubao','minimax','mistral','mimo','stepfun','git','llama','perplexity','rwkv','hunyuan','novelai','huggingface','zcode','opencode','owner-picks'];
for(const prefix of ['','zh-hant/','en/','ja/'])test('character index preserves real cards and routes: '+(prefix||'zh'),()=>{
 const file=new URL(prefix+'characters.html',out);assert.ok(fs.existsSync(file),'complete build required');
 const {document}=parseHTML(fs.readFileSync(file,'utf8'));
 const snapshot=JSON.parse(fs.readFileSync(new URL('dist/site-data.json',root),'utf8'));
 const serialIds=new Set(snapshot.topics.filter(t=>t.status!=='removed'&&t.reader).flatMap(t=>t.workIds));
 const works=Object.values(JSON.parse(fs.readFileSync(new URL('works-v2.json',out),'utf8')));
 const cards=[...document.querySelectorAll('.character-index-card')];
 assert.equal(cards.length,24);assert.equal(document.querySelectorAll('h1').length,1);
 assert.deepEqual(cards.map(c=>c.querySelector('h2').getAttribute('data-character-name')),expected);
 for(const [i,c] of cards.entries()){
  assert.equal(c.getAttribute('href'),'/'+prefix+'characters/'+expected[i]+'.html');
  assert.ok(fs.existsSync(new URL(c.querySelector('img').getAttribute('src').slice(1),out)));
  assert.ok(c.querySelector('img').getAttribute('alt'));
  const actual=Number(c.querySelector('p').textContent.replace(/[^0-9]/g,''));
  assert.equal(actual,works.filter(w=>w.cids.includes(expected[i])&&!serialIds.has(w.id)).length,'real archive count '+expected[i]);
 }
 assert.equal(document.querySelector('.nav-item[aria-current=page]').getAttribute('href'),'/'+prefix+'characters.html');
 assert.equal(document.querySelectorAll('#language-options [role=option]').length,4);
 assert.equal(document.querySelector('.brand-mark img').getAttribute('src'),'/avatar.png');
 assert.equal(document.querySelectorAll('select').length,0);
 assert.ok(!document.querySelector('[data-home-feed]'));
});
