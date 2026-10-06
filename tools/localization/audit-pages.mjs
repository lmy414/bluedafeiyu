import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from '../../frontend/node_modules/linkedom/esm/index.js';
const out=path.resolve(process.argv[2]||'.build/native-localization');
const snapshot=JSON.parse(fs.readFileSync(path.join(out,'site-data.json'),'utf8'));
const identities=['上善无形',...(snapshot.topics||[]).map(t=>t.author?.name),...snapshot.works.flatMap(w=>[w.origin?.author,w.submitter?.name])].filter(v=>v&&v.length>1);
const problems=[];let pages=0,details=0;
function remaining(text) {let result=String(text||'');for(const name of identities)result=result.replaceAll(name,'');return result.replaceAll('投稿','');}
function scan(dir,lang) {for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);if(entry.isDirectory()){scan(file,lang);continue;}if(!entry.name.endsWith('.html'))continue;
  const {document}=parseHTML(fs.readFileSync(file,'utf8'));pages++;
  const slug=document.body?.getAttribute('data-work-slug'),work=slug&&snapshot.works.find(w=>w.slug===slug),native=work?.i18n?.[lang];
  if(work){details++;if(!native||document.querySelector('main h1')?.textContent!==native.name||!document.querySelector('[data-work-faq]'))problems.push({file:path.relative(out,file),problem:'Missing native work title/FAQ'});}
  const pattern=lang==='en'?/[\u3400-\u9fff]|Whale[ -]?Chan|DeepSeek Chan\.com|Blue Fish|Fat Fish/u:/蓝|鲸|这|们|说|图|语|DeepSeek Chan\.com/u;
  const seen=new Set();
  function check(text,kind){const value=String(text||'').trim();if(value&&!seen.has(value)&&pattern.test(remaining(value))){seen.add(value);problems.push({file:path.relative(out,file),kind,text:value});}}
  for(const el of document.querySelectorAll('body *')){
    if(el.closest('script,style,code,pre,textarea,noscript,.lang-menu'))continue;
    for(const node of el.childNodes)if(node.nodeType===3)check(node.textContent,'body');
    for(const attr of ['alt','title','aria-label','placeholder'])if(el.hasAttribute(attr))check(el.getAttribute(attr),attr);
  }
  check(document.title,'title');for(const meta of document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"],meta[property="og:image:alt"]'))check(meta.getAttribute('content'),'metadata');
  function schema(value){if(!value||typeof value!=='object')return;for(const[k,v]of Object.entries(value)){if(['author','creator','copyrightHolder'].includes(k))continue;if(typeof v==='string'&&['name','description','text','headline','keywords','caption'].includes(k))check(v,'schema');else if(typeof v==='object')schema(v);}}
  for(const script of document.querySelectorAll('script[type="application/ld+json"]'))schema(JSON.parse(script.textContent));
}}
for(const lang of ['en','ja'])scan(path.join(out,lang),lang);
const report={pages,details,problems};fs.writeFileSync(path.join(out,'native-localization-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pages,details,problems:problems.length,samples:problems.slice(0,25)},null,2));if(problems.length)process.exitCode=1;
