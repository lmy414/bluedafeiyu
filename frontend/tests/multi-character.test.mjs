import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {workCharacterIds} from '../../tools/work-characters.mjs';
import {createListing} from '../src/components/archive/Listing.mjs';
import {matchesCreationMethod} from '../public/archive/creation-method.js';
import {renderWorkCard} from '../public/archive/work-card.js';
import {applyNativeContent} from '../scripts/native-content.mjs';
import {createAiDocuments} from '../scripts/ai-content.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const chars=[{id:'deepseek',name:'DeepSeek娘',aliases:[],list:Array(100)},{id:'gpt',name:'GPT娘',aliases:[],list:Array(30)}];
const works=[{cid:'deepseek',cids:['deepseek'],slug:'single'},{cid:'deepseek',cids:['deepseek','gpt'],slug:'both'}];
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx={works,chars,types:[],icon:()=>'',esc:escape,tr:(_key,zh)=>zh,old:(_key,zh)=>zh};

test('single-character records normalize without changing IDs, paths or slugs',()=>{
 const legacy={id:'frozen-id',slug:'frozen-slug',characterId:'deepseek',path:'originals/deepseek/frozen.png'};
 assert.deepEqual(workCharacterIds(legacy),['deepseek']);
 assert.deepEqual(workCharacterIds({...legacy,characterIds:['gpt','deepseek','gpt']}),['gpt','deepseek']);
 assert.deepEqual(legacy,{id:'frozen-id',slug:'frozen-slug',characterId:'deepseek',path:'originals/deepseek/frozen.png'});
});
test('character options and counts are scoped to the full collection, including shared roles',()=>{
 const {filters}=createListing(ctx);
 const {document}=parseHTML(filters('','','curated',works));
 const role=document.querySelector('select[name=character]');
 assert.ok(role.hasAttribute('multiple'));
 assert.deepEqual([...role.querySelectorAll('option')].map(o=>o.textContent),['全部角色','DeepSeek娘 (2)','GPT娘 (1)']);
 assert.match(document.querySelector('#character-filter-help').textContent,/全部所选角色（AND）/);
 const single=parseHTML(filters('','','curated',works.slice(0,1))).document;
 assert.equal(single.querySelector('option[value=gpt]'),null);
 assert.equal(single.querySelector('option[value=deepseek]').textContent,'DeepSeek娘 (1)');
});
test('the browser filter uses AND rather than OR for multiple characters',()=>{
 const source=fs.readFileSync(new URL('../public/archive/archive.js',import.meta.url),'utf8');
 const expression=source.match(/filtered=all\.filter\(([^\n]+)\);/)[1];
 const all=[{slug:'a',cids:['deepseek'],k:['meme'],tg:['非AI']},{slug:'b',cids:['gpt'],k:['meme']},{slug:'both',cids:['deepseek','gpt'],k:['meme'],tg:['非AI']},{slug:'both-ai',cids:['deepseek','gpt'],k:['meme']}];
 const filter=creation=>vm.runInNewContext('all.filter('+expression+')',{all,matchesCreationMethod,characters:['deepseek','gpt'],state:{type:'',creation},scores:null});
 assert.deepEqual(Array.from(filter(''),w=>w.slug),['both','both-ai']);
 assert.deepEqual(Array.from(filter('non-ai'),w=>w.slug),['both']);
});
test('cards show every role link without changing the frozen detail URL',()=>{
 const work={slug:'frozen',n:'Fixture',d:'Fixture',cid:'deepseek',c:'DeepSeek娘',col:'#123',roles:[{id:'deepseek',name:'DeepSeek娘',color:'#123'},{id:'gpt',name:'GPT娘',color:'#456'}],k:['meme'],i:'/fixture.webp',w:1,h:1,dt:'2026.10.11'};
 const {document}=parseHTML(renderWorkCard(work));
 assert.deepEqual([...document.querySelectorAll('.card-roles a')].map(a=>a.getAttribute('href')),['/characters/deepseek.html','/characters/gpt.html']);
 assert.equal(document.querySelector('.work-title').getAttribute('href'),'/works/frozen.html');
});
test('native card and detail localization retains all character identities',()=>{
 const {document}=parseHTML('<html><head></head><body><main><div class="work-card" data-slug="frozen"><a class="work-title"></a><img><div class="card-meta"><a data-character-id="deepseek"><i></i>DeepSeek娘</a><a data-character-id="gpt"><i></i>GPT娘</a></div></div><h1></h1><a class="detail-role" data-character-id="deepseek"><i></i>DeepSeek娘</a><a class="detail-role" data-character-id="gpt"><i></i>GPT娘</a><article data-static-work></article></main></body></html>');
 const snapshot={works:[{slug:'frozen',name:'作品',characterId:'deepseek',characterIds:['deepseek','gpt'],tags:[],i18n:{en:{name:'Work',description:'Description',commentary:'Note',tags:[],faq:[]}}}],characters:chars,categories:[],topics:[]};
 const api={current:'en',characterName:id=>id==='deepseek'?'DeepSeek Chan':'GPT Chan',fmt:(_key,fallback)=>fallback,contentText:value=>value};
 applyNativeContent(document,api,'/works/frozen.html',snapshot);
 assert.deepEqual([...document.querySelectorAll('.card-meta a')].map(a=>a.textContent),['DeepSeek Chan','GPT Chan']);
 assert.deepEqual([...document.querySelectorAll('.detail-role')].map(a=>a.textContent),['DeepSeek Chan','GPT Chan']);
});
test('submission uses touch-friendly checkboxes and serializes every selected character',()=>{
 const form=fs.readFileSync(new URL('../src/components/SubmissionForm.astro',import.meta.url),'utf8');
 const script=fs.readFileSync(new URL('../public/page-scripts/submit-0.js',import.meta.url),'utf8');
 assert.match(form,/<fieldset[^>]*id="f-character"/);
 assert.match(form,/type="checkbox" name="characterIds"/);
 assert.match(form,/characters\.filter\(c => c\.status === 'active' && c\.inSubmissionForm\)/);
 assert.match(script,/data\.append\("characterIds", JSON\.stringify\(selectedCharacters\(\)\)\)/);
 assert.doesNotMatch(script,/DEMO|SITE_DATA|characterSelect/);
});
test('AI character indexes include shared works once in each matching archive',()=>{
 const snapshot={works:[{id:'frozen-id',slug:'frozen',name:'同框',status:'published',characterId:'deepseek',characterIds:['deepseek','gpt'],categoryIds:['meme']}],characters:chars.map(c=>({...c,status:'active'})),categories:[{id:'meme',name:'梗图',status:'active'}],topics:[]};
 const {documents}=createAiDocuments(snapshot);
 assert.ok(documents.get('/characters/gpt.html.md').includes('/works/frozen.html.md'));
 assert.match(documents.get('/works/frozen.html.md'),/角色：DeepSeek娘、GPT娘/);
});
