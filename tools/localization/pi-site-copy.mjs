import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from '../../frontend/node_modules/linkedom/esm/index.js';
import {piJSON} from './pi-json.mjs';
import {copyKey} from './copy-key.mjs';
const root=process.cwd();
const siteIndex=process.argv.indexOf('--site-dir');
const out=path.resolve(root,siteIndex<0?'.build/site':process.argv[siteIndex+1]);
const glossary=JSON.parse(fs.readFileSync('tools/localization/terminology.json','utf8'));
const snapshot=JSON.parse(fs.readFileSync('dist/site-data.json','utf8'));
const identities=['上善无形',...snapshot.works.flatMap(w=>[w.origin?.author,w.submitter?.name]),...(snapshot.topics||[]).map(t=>t.author?.name)].filter(Boolean);
function withoutCredits(text){let value=text;for(const name of identities)value=value.replaceAll(name,'');return value;}
const workStrings=new Set(snapshot.works.flatMap(w=>[w.name,w.description,w.commentary].filter(Boolean)));
const sources=new Map();
function add(text,context='') {
  const s=String(text||'').trim();
  if (!s||!/[\u3400-\u9fff]/u.test(s)||workStrings.has(s))return;
  const key=copyKey(s);if(!sources.has(key))sources.set(key,{source:key,context});
}
function scan(dir) {for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
  if(entry.isDirectory()){if(!['en','ja','zh-hant'].includes(entry.name))scan(path.join(dir,entry.name));continue;}
  if(!entry.name.endsWith('.html'))continue;
  const file=path.join(dir,entry.name),{document}=parseHTML(fs.readFileSync(file,'utf8'));
  for(const el of document.querySelectorAll('*')) {
    if(el.closest('script,style,code,pre,textarea,.work-card,.detail-info h1,.work-description,.fish-comment p,[data-i18n],[data-i18n-tpl],.lang-fallback,.work-facts dd:not(:last-child),.author-profile h1,.author-profile .author-name'))continue;
    for(const node of el.childNodes)if(node.nodeType===3)add(node.textContent,path.relative(out,file)+' '+el.tagName.toLowerCase());
    for(const attr of ['alt','title','aria-label','placeholder'])if(el.hasAttribute(attr))add(el.getAttribute(attr),attr);
    if(el.tagName==='META'&&!/image|url/.test(el.getAttribute('name')||el.getAttribute('property')||''))add(el.getAttribute('content'),'page metadata');
  }
  for(const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    function visit(value) {if(!value||typeof value!=='object')return;for(const [k,v]of Object.entries(value)){if(['creator','author','copyrightHolder'].includes(k))continue;if(typeof v==='string'&&['name','description','headline','text','keywords'].includes(k))add(v,'structured data '+k);else if(typeof v==='object')visit(v);}}
    visit(JSON.parse(script.textContent));
  }
}}
scan(out);
for(const w of snapshot.works)for(const tag of w.tags)add(tag,'image search tag');
for(const c of snapshot.characters)add(c.name,'character name');
for(const t of snapshot.topics||[]){add(t.name,'collection name');add(t.summary,'collection description');if(t.author?.bio)add(t.author.bio,'creator biography');}
for(const text of ['原作者未标注','未标注','作品问答','放大图片','当前位置'])add(text,'interface');
// Detail metadata is authored with each work; translating it as a generic template would duplicate work.
const workNames=[...workStrings].filter(s=>s.length>4);
const rows=[...sources.values()].filter(r=>!(r.context==='page metadata'&&workNames.some(n=>r.source.includes(copyKey(n)))));
const output=path.join(root,'data/site-copy-localizations.json');
const existing=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):{version:glossary.version,texts:{}};
fs.mkdirSync('.build/localization-copy',{recursive:true});
fs.writeFileSync('.build/localization-copy/sources.json',JSON.stringify(rows,null,2));
const pending=rows.filter(r=>!existing.texts[r.source]);const batches=[];for(let i=0;i<pending.length;i+=30)batches.push(pending.slice(i,i+30));
console.log(JSON.stringify({copySources:rows.length,pending:pending.length,batches:batches.length}));
let cursor=0,failed=0;
await Promise.all(Array.from({length:4},async()=>{while(cursor<batches.length){const index=cursor++,batch=batches[index];let error='';for(let attempt=0;attempt<3;attempt++){
  try{
    const prompt='Act as native English and Japanese fan-art website editors. Localize these interface, taxonomy, landing page, FAQ and SEO texts naturally from their Chinese meaning, using the glossary. Preserve every {n0}, {n1} number placeholder exactly once (order may change), IDs, URLs, product names and author handles. Do not invent facts, licenses or domains. Each result has source (verbatim unchanged), en, ja. Return ONLY JSON {texts:[{source,en,ja}]}. '+(error?'Previous validation error: '+error+'. ':'')+JSON.stringify({glossary,texts:batch});
    const result=await piJSON(prompt,{cwd:root});
    const values=result.data.texts;
    if(!Array.isArray(values)||values.length!==batch.length||new Set(values.map(v=>v.source)).size!==batch.length)throw Error('Wrong source count');
    for(const item of values){if(!batch.some(r=>r.source===item.source))throw Error('Unknown source');for(const lang of ['en','ja']){if(typeof item[lang]!=='string'||!item[lang].trim()||/<\/?[A-Za-z!]/.test(item[lang]))throw Error('Invalid text');if(lang==='en'&&/[\u3400-\u9fff]/u.test(withoutCredits(item.en)))throw Error('Chinese in English: '+item.source);const a=(item.source.match(/\{n\d+\}/g)||[]).sort(),b=(item[lang].match(/\{n\d+\}/g)||[]).sort();if(a.join()!==b.join())throw Error('Number placeholders changed: '+item.source);}}
    for(const item of values)existing.texts[item.source]={en:item.en,ja:item.ja};
    fs.writeFileSync(output,JSON.stringify(existing,null,2)+'\n');fs.writeFileSync('.build/localization-copy/batch-'+index+'.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify({batch:index,completed:Object.keys(existing.texts).length,total:rows.length,model:result.model}));break;
  }catch(e){error=e.message;console.log(JSON.stringify({batch:index,attempt,error}));if(attempt===2)failed+=batch.length;}
}}}));
console.log(JSON.stringify({failed,completed:Object.keys(existing.texts).length}));if(failed)process.exitCode=1;
