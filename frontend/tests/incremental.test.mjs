import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {hash,makePlan,verifyPrevious,safeFile,readState,copyImmutableAsset,STATE_VERSION,filesIn,outputHashes} from '../scripts/incremental.mjs';
import {createPageModel} from '../src/components/library/page-model.mjs';
import {createWorkPages} from '../src/components/archive/WorkPages.mjs';
import {finalizeNavigationCount} from '../src/components/library/navigation-count.mjs';

const inputs={code:'code',build:'build',content:'content',runtime:'runtime'};
test('transfer temporary files never enter artifact inventories or release hashes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bluefish-transfer-'));
 try {
  fs.mkdirSync(path.join(dir,'en/.rsync-tmp'),{recursive:true});
  fs.writeFileSync(path.join(dir,'en/.rsync-tmp/unfinished.html'),'incomplete transfer');
  fs.writeFileSync(path.join(dir,'en/about.html'),'published content');
  assert.deepEqual(filesIn(dir),['en/about.html']);
  assert.deepEqual(Object.keys(outputHashes(dir)),['en/about.html']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('immutable asset reuse never rewrites the prior release when a later image changes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bluefish-incremental-'));
 const originalEnv=process.env.SITE_REUSE_ASSETS;
 try {
  const source=path.join(dir,'source.jpg'),previous=path.join(dir,'previous.jpg'),target=path.join(dir,'next.jpg');
  fs.writeFileSync(source,'old image');fs.writeFileSync(previous,'old image');fs.chmodSync(previous,0o644);
  process.env.SITE_REUSE_ASSETS='1';copyImmutableAsset(source,target,previous);
  if(process.platform!=='win32')assert.equal(fs.statSync(target).ino,fs.statSync(previous).ino);
  fs.writeFileSync(source,'new image');copyImmutableAsset(source,target,previous);
  assert.equal(fs.readFileSync(previous,'utf8'),'old image');assert.equal(fs.readFileSync(target,'utf8'),'new image');
 }finally{
  if(originalEnv===undefined)delete process.env.SITE_REUSE_ASSETS;else process.env.SITE_REUSE_ASSETS=originalEnv;
  assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});
 }
});
test('gzip reuse verifies source bytes and regenerates corrupt compressed artifacts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bluefish-incremental-'));
 try {
  const previous=path.join(dir,'previous'),next=path.join(dir,'next');fs.mkdirSync(previous);fs.mkdirSync(next);
  const raw='body{color:blue;margin:0}\n'.repeat(200);fs.writeFileSync(path.join(previous,'site.css'),raw);fs.writeFileSync(path.join(next,'site.css'),raw);
  fs.writeFileSync(path.join(previous,'site.css.gz'),'corrupted');fs.writeFileSync(path.join(next,'.build-state.json'),'x'.repeat(2000));
  const tool=path.resolve(import.meta.dirname,'../../tools/compress_static.mjs');
  const run=()=>spawnSync(process.execPath,[tool,'--dir',next,'--precompress'],{env:{...process.env,SITE_PREVIOUS_DIR:previous},encoding:'utf8'});
  const first=run();assert.equal(first.status,0,first.stderr);assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(next,'site.css.gz'))).toString(),raw);
  assert.equal(fs.existsSync(path.join(next,'.build-state.json.gz')),false);
  const second=run();assert.equal(second.status,0,second.stderr);assert.match(second.stdout,/复用已验证的压缩产物：1/);
  assert.equal(fs.readFileSync(path.join(previous,'site.css.gz'),'utf8'),'corrupted');
 }finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});}
});
test('shared navigation counts update reused pages without changing their main content',()=>{
 const source='<aside><small data-library-work-total="">25</small></aside><main>Unchanged detail</main>';
 assert.equal(finalizeNavigationCount(source,24),'<aside><small data-library-work-total="">24</small></aside><main>Unchanged detail</main>');
 assert.equal(finalizeNavigationCount('<main>24</main>',25),'<main>24</main>');
 assert.throws(()=>finalizeNavigationCount(source,-1));
});
test('plans cold starts, edits, additions, deletions and unchanged inputs',()=>{
 const previous={inputs,routes:{'/a.html':'a','/b.html':'b'}};
 assert.equal(makePlan(inputs,previous.routes,null,{ok:false,reason:'missing-baseline'}).mode,'full');
 const next=makePlan({...inputs,content:'changed'},{'/a.html':'edited','/c.html':'new'},previous,{ok:true});
 assert.equal(next.mode,'incremental');assert.deepEqual(next.changed,['/a.html','/c.html']);assert.deepEqual(next.removed,['/b.html']);
 assert.equal(makePlan(inputs,previous.routes,previous,{ok:true}).mode,'noop');
 assert.equal(makePlan({...inputs,code:'new'},previous.routes,previous,{ok:true}).mode,'incremental');
 assert.equal(makePlan({...inputs,build:'new'},previous.routes,previous,{ok:true}).mode,'full');
 assert.equal(makePlan({...inputs,runtime:'new'},previous.routes,previous,{ok:true}).mode,'full');
 assert.equal(makePlan({...inputs,code:'new',styles:'new'},previous.routes,previous,{ok:true}).mode,'full');
 assert.equal(makePlan(inputs,previous.routes,previous,{ok:true},true).mode,'full');
});
test('missing or corrupted release artifacts invalidate reuse; artifact paths stay inside the output',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'bluefish-incremental-'));
 try {
  fs.writeFileSync(path.join(base,'index.html'),'original');
  const state={outputs:{'index.html':hash('original')}};
  assert.equal(verifyPrevious(base,state).ok,true);
  fs.writeFileSync(path.join(base,'index.html'),'corrupted');
  assert.match(verifyPrevious(base,state).reason,/changed/);
  fs.unlinkSync(path.join(base,'index.html'));assert.match(verifyPrevious(base,state).reason,/missing/);
  for(const value of ['../secret','a/../../secret','C:\\secret','/secret','a\\secret'])assert.throws(()=>safeFile(base,value));
  fs.writeFileSync(path.join(base,'state.json'),JSON.stringify({version:STATE_VERSION,inputs,routes:{},outputs:{'../secret':'x'}}));
  assert.equal(readState(path.join(base,'state.json')),null);
 } finally {
  assert.equal(path.dirname(base),path.resolve(os.tmpdir()));assert.ok(path.basename(base).startsWith('bluefish-incremental-'));
  fs.rmSync(base,{recursive:true,force:true});
 }
});
test('dependency analysis never renders a lazy detail; transforms execute once on demand',()=>{
 let renders=0,enriches=0;
 const ctx={snapshot:{},seo:{metadata:()=>({title:'a'}),enrich:(_url,value)=>{enriches++;return value;}}};
 const model=createPageModel(ctx,'/works/a.html','a','browse',()=>{renders++;return 'body';},{dependencies:{work:'a'}});
 model.transformContent(value=>value+' transformed');
 assert.equal(model.cacheKey,model.cacheKey);assert.equal(renders,0);assert.equal(enriches,0);
 assert.equal(model.content,'body transformed');assert.equal(model.content,'body transformed');assert.equal(renders,1);
});
function keys(works,topics=[]) {
 const pages=new Map();
 const ctx={works,types:[],topics,tr:(_key,value)=>value,snapshot:{works},workHref:w=>'/works/'+w.slug+'.html',seo:{metadata:()=>({}),enrich:(_url,value)=>value}};
 ctx.write=(url,title,active,body,options)=>pages.set(url,createPageModel(ctx,url,title,active,body,options));
 createWorkPages(ctx);
 return Object.fromEntries([...pages].map(([url,p])=>[url,p.cacheKey]));
}
const work=(slug,tags=[])=>({id:slug,slug,cid:'one',cids:['one'],tg:tags,n:slug,d:'text'});
test('recommendation dependencies include new candidates, selected edits and removed works',()=>{
 const works=[work('target',['match']),...Array.from({length:10},(_,i)=>work('other-'+i))];
 const before=keys(works);
 const unrelated=structuredClone(works);unrelated.at(-1).d='not visible in the selected recommendations';
 assert.equal(keys(unrelated)['/works/target.html'],before['/works/target.html']);
 const entering=[...works,work('new',['match'])];
 assert.notEqual(keys(entering)['/works/target.html'],before['/works/target.html']);
 assert.notEqual(keys(works.filter(w=>w.slug!=='other-0'))['/works/target.html'],before['/works/target.html']);
 const edited=structuredClone(works);edited[1].d='visible card changed';
 assert.notEqual(keys(edited)['/works/target.html'],before['/works/target.html']);
 const topic={id:'chosen',list:[works[0],works[2]]};
 assert.notEqual(keys(works,[topic])['/works/target.html'],before['/works/target.html']);
});
