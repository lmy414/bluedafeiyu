import fs from 'node:fs';
import path from 'node:path';
import { sourceText, sourceHash, validateI18n } from './contract.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const cli = arg('--pi-cli', 'D:/dev/tools/npm-global/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const batchSize = Number(arg('--batch-size', 12));
const concurrency = Number(arg('--concurrency', 3));
const limit = Number(arg('--limit', Infinity));
const runRoot = path.resolve(root, arg('--run-dir', '.build/localization-runs'));
const output = path.resolve(root, arg('--output', '.build/work-localizations.generated.json'));
const glossary = JSON.parse(fs.readFileSync(path.join(root, 'tools/localization/terminology.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'dist/site-data.json'), 'utf8'));
fs.mkdirSync(runRoot, { recursive: true });

const existing = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { version: glossary.version, works: {} };
const works = snapshot.works.filter(w => existing.works[w.id]?.sourceHash !== sourceHash(w)).slice(0, limit);
const batches = [];
for (let i = 0; i < works.length; i += batchSize) batches.push(works.slice(i, i + batchSize));

function validate(items, originals) {
  if (!Array.isArray(items) || items.length !== originals.length) throw Error('Wrong result count');
  const byId = new Map(items.map(w => [w.id, w]));
  if (byId.size !== originals.length) throw Error('Duplicate result IDs');
  for (const original of originals) {
    const item = byId.get(original.id);
    if (!item) throw Error('Missing ID ' + original.id);
    try { validateI18n({en:item.en,ja:item.ja}, original); } catch(error) { throw Error(original.id+': '+error.message); }
  }
  return items;
}

async function translate(batch, index, attempt = 0, previousError = '') {
  const task = { task: 'Native English and Japanese fan-art localization', glossary, outputSchema: { works: [{ id: 'unchanged id', en: { name:'', description:'', commentary:'', tags:[], seoTitle:'', seoDescription:'', faq:[{question:'',answer:''},{question:'',answer:''}], originNote:'', licenseNote:'' }, ja: 'same keys as en' }] }, sources: batch.map(w => ({ id: w.id, ...sourceText(w) })) };
  const prompt = (previousError ? 'The previous attempt failed validation: '+previousError+'. Correct this and apply it to every work.\n' : '') + 'Act as a native English-language fan-art editor and a native Japanese fandom editor. Follow the provided glossary and editorial rules. Independently write each language from the Chinese facts. Preserve the exact IDs and tag count/order. Return ONLY the JSON object matching outputSchema; ja must be an object with the same fields as en. Do not read files or call tools.\n' + JSON.stringify(task);
  const label = 'batch-' + index.toString().padStart(3, '0') + '-attempt-' + attempt;
  fs.writeFileSync(path.join(runRoot,label+'.input.json'),JSON.stringify(task,null,2));
  const args = [cli,'--provider','cpa','--model','deepseek/deepseek-v4.1-flash','--thinking','off','--mode','json','--print','--no-tools','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-session','--offline'];
  const result = await new Promise((resolve,reject) => {
    const child = spawn(process.execPath,args,{cwd:root,stdio:['pipe','pipe','pipe'],windowsHide:true});
    let pending='',final,stderr='';
    const timer=setTimeout(()=>{child.kill();reject(Error('PI translation timed out'));},12*60*1000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{pending+=chunk;let nl;while((nl=pending.indexOf('\n'))>=0){const line=pending.slice(0,nl).replace(/\r$/,'');pending=pending.slice(nl+1);if(!line)continue;try{const event=JSON.parse(line);if(event.type==='message_end'&&event.message?.role==='assistant')final=event.message;}catch{}}});
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0||!final||final.stopReason==='error')reject(Error('PI failed: '+(final?.errorMessage||stderr.slice(-1000)||code)));else resolve(final);});
    child.stdin.end(prompt);
  });
  const content = result.content.filter(c=>c.type==='text').map(c=>c.text).join('').trim().replace(/^```(?:json)?\s*|\s*```$/g,'');
  fs.writeFileSync(path.join(runRoot,label+'.output.json'),content);
  const values=validate(JSON.parse(content).works,batch);
  for(const item of values){const original=batch.find(w=>w.id===item.id);existing.works[item.id]={sourceHash:sourceHash(original),...validateI18n({en:item.en,ja:item.ja},original)};}
  fs.writeFileSync(output+'.tmp',JSON.stringify(existing,null,2)+'\n');fs.renameSync(output+'.tmp',output);
  fs.writeFileSync(path.join(runRoot,label+'.usage.json'),JSON.stringify({provider:result.provider,model:result.model,usage:result.usage,stopReason:result.stopReason},null,2));
  console.log(JSON.stringify({batch:index,translated:values.length,completed:Object.keys(existing.works).length,total:snapshot.works.length,model:result.model}));
}
let cursor=0,failed=0;
await Promise.all(Array.from({length:Math.min(concurrency,batches.length)},async()=>{
  while(cursor<batches.length){const index=cursor++,batch=batches[index];let succeeded=false,previousError='';for(let attempt=0;attempt<3;attempt++){try{await translate(batch,index,attempt,previousError);succeeded=true;break;}catch(error){previousError=error.message;console.log(JSON.stringify({batch:index,attempt,error:error.message}));}}
    if(!succeeded)failed+=batch.length;
  }
}));
console.log(JSON.stringify({completed:Object.keys(existing.works).length,failed,output}));
if(failed)process.exitCode=1;
