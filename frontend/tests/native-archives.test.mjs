import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createCreatorViews} from '../src/components/archive/CreatorViews.mjs';
import {summarizeAuditFailure} from '../../tools/localization/audit-summary.mjs';
import {applyNativeArchives,nativeArchiveName} from '../scripts/native-archives.mjs';
import {localizeHtml,LOCALES,ORIGIN} from '../scripts/localize-pages.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const api=language=>({current:language,characterName:id=>id==='doubao'?(language==='en'?'Doubao Chan':'Doubaoちゃん'):id,fmt:key=>({en:{meme:'Reaction images',illustration:'Fan art',comic:'Comics'},ja:{meme:'ネタ画像',illustration:'イラスト',comic:'漫画'}}[language][key.split('.').pop()])});
const snapshot={characters:[{id:'doubao',name:'豆包娘',aliases:['豆包']}],categories:[{id:'meme'},{id:'illustration'}],works:[{slug:'frozen',name:'新的围巾',characterId:'doubao',categoryIds:['meme','illustration'],tags:['新标签'],i18n:{en:{name:'New Scarf',tags:['a new theme']},ja:{name:'新しいマフラー',tags:['新しいテーマ']}}}]};
const role='<main><header class="character-info"><h1>豆包娘<small>表情包档案</small></h1><p class="alias">也叫 豆包</p><div class="tags"><a href="/search.html?q=新标签">新标签</a></div></header><section class="role-reading"><h2>中文标题</h2><p>包含旧作品的旧介绍</p><div class="role-type-links"><a href="/characters/doubao/meme.html">中文类型<small>1</small></a></div><div class="reading-faq"><details><summary>怎样找图</summary><div>旧内容</div></details></div></section></main>';

test('English character SEO preserves the site brand through final localization',async()=>{
  for(const base of ['/characters/doubao.html','/characters/doubao/meme.html','/characters/doubao/page/2.html']){
    const html='<html><head><title>豆包娘 — 蓝色大肥鱼</title><link rel="canonical" href="'+ORIGIN+base+'"><meta name="description" content="角色档案"><meta property="og:title"><meta name="twitter:title"></head><body data-archive data-i18n-page="characterDetail">'+role+'</body></html>';
    const {document}=parseHTML(await localizeHtml(html,base,LOCALES.find(l=>l.id==='en'),snapshot));
    assert.ok(document.title.endsWith(' | Blue Dafeiyu'),base+': '+document.title);
    for(const selector of ['meta[property="og:title"]','meta[name="twitter:title"]'])assert.equal(document.querySelector(selector).getAttribute('content'),document.title);
  }
});

test('new topics use saved translations in collection cards, page SEO and breadcrumb schemas',async()=>{
 const topic={id:'new-style',name:'全新视觉专题',summary:'由站长精选的全新视觉作品。',workIds:['fixture'],i18n:{en:{name:'New Visual Style',summary:'A new visual collection selected by the site owner.'},ja:{name:'新しい視覚スタイル',summary:'管理者が選んだ新しい視覚スタイルの作品集です。'}}};
 const fixture={...snapshot,topics:[topic],works:[{...snapshot.works[0],id:'fixture'}]};
 for(const language of ['en','ja']){
  const html='<html><head><link rel="canonical" href="'+ORIGIN+'/topics/new-style.html"><title>'+topic.name+'</title><meta name="description" content="'+topic.summary+'"><meta property="og:image:alt" content="'+topic.name+'"><script type="application/ld+json">'+JSON.stringify({'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',name:topic.name,item:ORIGIN+'/topics/new-style.html'}]})+'</script></head><body data-archive data-i18n-page="topicDetail"><main><div class="breadcrumbs"><span>'+topic.name+'</span></div><header class="topic-hero"><h1>'+topic.name+'</h1><p class="lede">'+topic.summary+'</p></header><a class="collection-card"><h3>'+topic.name+'</h3><p>'+topic.summary+'</p></a></main></body></html>';
  const {document}=parseHTML(await localizeHtml(html,'/topics/new-style.html',LOCALES.find(l=>l.id===language),fixture));
  const value=topic.i18n[language];
  assert.equal(document.querySelector('main h1').textContent,value.name);
  assert.equal(document.querySelector('.topic-hero .lede').textContent,value.summary);
  assert.equal(document.querySelector('.collection-card h3').textContent,value.name);
  assert.equal(document.querySelector('.collection-card p').textContent,value.summary);
  assert.ok(document.title.includes(value.name));
  assert.ok(document.querySelector('meta[name="description"]').getAttribute('content').includes(value.summary));
  assert.equal(nativeArchiveName('/topics/new-style/page/2.html',api(language),fixture).includes(topic.name),false);
  const schema=JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
  assert.ok(schema.itemListElement[0].name.includes(value.name));
  if(language==='en')assert.doesNotMatch(document.documentElement.outerHTML,/[\u3400-\u9fff]/u);
  const {document:cardPage}=parseHTML(await localizeHtml(html.replace('data-i18n-page="topicDetail"','data-i18n-page="index"'),'/index.html',LOCALES.find(l=>l.id===language),fixture));
  assert.equal(cardPage.querySelector('.collection-card p').textContent,value.summary);
 }
});
test('new characters and changed work titles/tags produce native archive copy without cached Chinese sentence keys',()=>{
 for(const language of ['en','ja']){
  const {document}=parseHTML(role),result=applyNativeArchives(document,api(language),'/characters/doubao.html',snapshot);
  assert.match(result.title,/Doubao (?:Chan)|Doubaoちゃん/);
  assert.ok(document.querySelector('.role-reading > p').textContent.includes(snapshot.works[0].i18n[language].tags[0]));
  if(language==='en'){
    assert.match(document.querySelector('.role-reading > p').textContent,/1 work featuring Doubao Chan/);
    assert.doesNotMatch(result.description,/comics/i);
  }
  assert.equal(document.querySelector('.character-info .tags a').textContent,snapshot.works[0].i18n[language].tags[0]);
  assert.equal(document.querySelector('.role-type-links small').textContent,'1');
  assert.equal(document.querySelector('.reading-faq a').getAttribute('href'),'/characters/doubao/meme.html');
  assert.equal(document.querySelector('.alias').textContent.includes('豆包'),false);
  if(language==='en')assert.doesNotMatch(document.querySelector('main').textContent,/[\u3400-\u9fff]/u);
 }
});
test('new character/type routes use actual native work names in descriptions and metadata, including pagination',()=>{
 for(const language of ['en','ja']){
  const {document}=parseHTML('<main><header class="page-head"><h1><span class="marker-highlight">中文类型</span></h1><p class="lede">中文说明</p></header><section class="intro-panel"><h2>中文标题</h2><p>旧作品示例</p><a href="/characters/doubao.html">回到角色档案</a></section></main>');
  const result=applyNativeArchives(document,api(language),'/characters/doubao/meme.html',snapshot);
  assert.ok(document.querySelector('.intro-panel p').textContent.includes(snapshot.works[0].i18n[language].name));
  assert.ok(document.querySelector('.marker-highlight'));
  assert.equal(document.querySelector('.page-head .lede').textContent,result.description);
  assert.equal(nativeArchiveName('/characters/doubao/meme.html',api(language),snapshot).includes('表情包'),false);
  assert.ok(nativeArchiveName('/characters/doubao/page/2.html',api(language),snapshot));
  if(language==='en')assert.doesNotMatch(document.querySelector('main').textContent,/[\u3400-\u9fff]/u);
 }
});
test('character cards and homepage entry links localize canonical names while preserving routes',()=>{
 const {document}=parseHTML('<main><a class="role-card" href="/characters/doubao.html"><h3>豆包娘</h3><p>豆包</p><img alt="豆包娘"></a><div class="role-entry-links"><a href="/characters/doubao.html">豆包娘表情包与二创</a></div></main>');
 applyNativeArchives(document,api('en'),'/index.html',snapshot);
 assert.doesNotMatch(document.querySelector('main').textContent,/[\u3400-\u9fff]/u);
 assert.equal(document.querySelector('.role-card').getAttribute('href'),'/characters/doubao.html');
 assert.equal(document.querySelector('img').getAttribute('alt'),'Doubao Chan');
});
test('new archive routes localize SEO, image captions and breadcrumb schemas before JavaScript',async()=>{
 const base='/characters/doubao/meme.html';
 const html='<html><head><title>豆包娘表情包</title><link rel="canonical" href="'+ORIGIN+base+'"><meta name="description" content="新的中文介绍"><meta property="og:image:alt" content="豆包娘表情包与梗图"><script type="application/ld+json">'+JSON.stringify({'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',name:'豆包娘表情包与梗图',item:ORIGIN+base}]})+'</script></head><body data-i18n-page="characterDetail"><main><header class="page-head"><h1>豆包娘表情包</h1><p class="lede">中文介绍</p></header><section class="intro-panel"><h2>中文标题</h2><p>新的中文作品示例</p><a href="/characters/doubao.html">回到中文档案</a></section></main></body></html>';
 for(const language of ['en','ja']){
  const {document}=parseHTML(await localizeHtml(html,base,LOCALES.find(l=>l.id===language),snapshot));
  assert.ok(document.querySelector('meta[property="og:image:alt"]').getAttribute('content').includes(language==='en'?'Doubao Chan':'Doubaoちゃん'));
  const crumb=JSON.parse(document.querySelector('script').textContent).itemListElement[0];
  assert.equal(new URL(crumb.item).pathname,'/'+language+base);
  assert.equal(crumb.name.includes('表情包'),false);
  if(language==='en')assert.doesNotMatch(document.title+document.querySelector('main').textContent+document.querySelector('meta[property="og:image:alt"]').getAttribute('content'),/[\u3400-\u9fff]/u);
 }
});
test('publication audit rejects Chinese fallback and keeps its diagnostic report outside public output',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dafeiyu-native-audit-'));
 try{
  const out=path.join(temp,'site'),report=path.join(temp,'private','audit.json');
  for(const lang of ['en','ja'])fs.mkdirSync(path.join(out,lang),{recursive:true});
  fs.writeFileSync(path.join(out,'site-data.json'),JSON.stringify({works:[],topics:[]}));
  fs.writeFileSync(path.join(out,'en/index.html'),'<html><head><title>Archive</title></head><body><h1>中文回退</h1></body></html>');
  fs.writeFileSync(path.join(out,'ja/index.html'),'<html><head><title>アーカイブ</title></head><body><h1>アーカイブ</h1></body></html>');
  const result=spawnSync(process.execPath,[path.resolve(import.meta.dirname,'../../tools/localization/audit-pages.mjs'),out,report],{encoding:'utf8'});
  assert.equal(result.status,1,result.stderr);
  assert.ok(JSON.parse(fs.readFileSync(report)).problems.some(p=>p.text==='中文回退'));
  assert.equal(fs.existsSync(path.join(out,'native-localization-audit.json')),false);
 }finally{
  assert.ok(fs.realpathSync(temp).startsWith(fs.realpathSync(os.tmpdir())+path.sep));
  fs.rmSync(temp,{recursive:true,force:true});
 }
});
test('publication audit protects overlapping full credits regardless of new submission order',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dafeiyu-overlapping-credits-'));
 try{
  for(const lang of ['en','ja'])fs.mkdirSync(path.join(temp,lang),{recursive:true});
  const credits=['可卿救我口牙','Ryan9438（B 站 ID：可卿救我口牙）','Ryan9438'];
  const audit=path.resolve(import.meta.dirname,'../../tools/localization/audit-pages.mjs');
  for(const names of [credits,[...credits].reverse()]){
   fs.writeFileSync(path.join(temp,'site-data.json'),JSON.stringify({works:names.map(name=>({submitter:{name}})),topics:[]}));
   for(const lang of ['en','ja'])fs.writeFileSync(path.join(temp,lang,'index.html'),'<html><head><title>Archive</title></head><body><p>'+credits[1]+'</p></body></html>');
   const result=spawnSync(process.execPath,[audit,temp],{encoding:'utf8'});
   assert.equal(result.status,0,result.stdout+result.stderr);
   assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp,'native-localization-audit.json'))).problems,[]);
  }
  fs.writeFileSync(path.join(temp,'en/index.html'),'<html><head><title>Archive</title></head><body><p>'+credits[1]+'</p><p>确实未翻译的中文</p></body></html>');
  const result=spawnSync(process.execPath,[audit,temp],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp,'native-localization-audit.json'))).problems.map(p=>p.text),['确实未翻译的中文']);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('creator avatar initials stay decorative without exempting untranslated body text',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dafeiyu-avatar-audit-'));
 try{
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const {avatar}=createCreatorViews({esc:escape,tr:(_key,zh)=>zh,icon:()=>'',card:()=>'',videoCard:()=>'',pageHead:()=>'',write:()=>{},breadcrumbs:()=>'',button:()=>''},[]);
  const creator={name:'风纪委员小电视'};
  const initials=['','large','profile'].map(size=>avatar(creator,size)).join('');
  const {document}=parseHTML('<main>'+initials+'</main>');
  for(const el of document.querySelectorAll('.avatar')){
   assert.equal(el.textContent,'');
   assert.equal(el.getAttribute('data-creator-initial'),'风');
   assert.equal(el.getAttribute('aria-hidden'),'true');
  }
  assert.equal(parseHTML(avatar({...creator,avatar:'/creator-avatars/test.jpg'})).document.querySelector('.avatar').hasAttribute('data-creator-initial'),false);
  assert.equal(parseHTML(avatar({name:'🐟作者'})).document.querySelector('.avatar').getAttribute('data-creator-initial'),'🐟');
  fs.writeFileSync(path.join(temp,'site-data.json'),JSON.stringify({works:[{origin:{author:creator.name}}],topics:[]}));
  for(const lang of ['en','ja']){
   fs.mkdirSync(path.join(temp,lang),{recursive:true});
   fs.writeFileSync(path.join(temp,lang,'index.html'),'<html><head><title>Creators</title></head><body>'+initials+'<p>'+creator.name+'</p></body></html>');
  }
  const audit=path.resolve(import.meta.dirname,'../../tools/localization/audit-pages.mjs');
  const valid=spawnSync(process.execPath,[audit,temp],{encoding:'utf8'});
  assert.equal(valid.status,0,valid.stdout+valid.stderr);
  const english=path.join(temp,'en/index.html');
  fs.writeFileSync(english,fs.readFileSync(english,'utf8').replace('</body>','<p>风</p></body>'));
  const untranslated=spawnSync(process.execPath,[audit,temp],{encoding:'utf8'});
  assert.equal(untranslated.status,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp,'native-localization-audit.json'))).problems.map(p=>p.text),['风']);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('build failure summaries expose current audit causes and ignore stale reports',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dafeiyu-audit-summary-'));
 try{
  const report=path.join(temp,'audit.json'),startedAt=Date.now()-1000;
  fs.writeFileSync(report,JSON.stringify({problems:[{file:'en/creators/test.html',kind:'body',text:'风\nextra'}]}));
  assert.match(summarizeAuditFailure(report,startedAt),/英日页面审计失败（1 处）：en\/creators\/test.html \[body\] 风 extra/);
  assert.equal(summarizeAuditFailure(report,Date.now()+1000),'');
  fs.writeFileSync(report,'corrupt');
  assert.equal(summarizeAuditFailure(report,startedAt),'');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
