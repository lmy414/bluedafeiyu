import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {applyNativeArchives,nativeArchiveName} from '../scripts/native-archives.mjs';
import {localizeHtml,LOCALES,ORIGIN} from '../scripts/localize-pages.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const api=language=>({current:language,characterName:id=>id==='doubao'?(language==='en'?'Doubao Chan':'Doubaoちゃん'):id,fmt:key=>({en:{meme:'Reaction images',illustration:'Fan art',comic:'Comics'},ja:{meme:'ネタ画像',illustration:'イラスト',comic:'漫画'}}[language][key.split('.').pop()])});
const snapshot={characters:[{id:'doubao',name:'豆包娘',aliases:['豆包']}],categories:[{id:'meme'},{id:'illustration'}],works:[{slug:'frozen',name:'新的围巾',characterId:'doubao',categoryIds:['meme','illustration'],tags:['新标签'],i18n:{en:{name:'New Scarf',tags:['a new theme']},ja:{name:'新しいマフラー',tags:['新しいテーマ']}}}]};
const role='<main><header class="character-info"><h1>豆包娘<small>表情包档案</small></h1><p class="alias">也叫 豆包</p><div class="tags"><a href="/search.html?q=新标签">新标签</a></div></header><section class="role-reading"><h2>中文标题</h2><p>包含旧作品的旧介绍</p><div class="role-type-links"><a href="/characters/doubao/meme.html">中文类型<small>1</small></a></div><div class="reading-faq"><details><summary>怎样找图</summary><div>旧内容</div></details></div></section></main>';
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
