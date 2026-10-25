import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {outputHashes} from '../scripts/incremental.mjs';

const root=path.resolve(import.meta.dirname,'../..');
function sameArtifacts(left,right,message) {
 const a=outputHashes(left),b=outputHashes(right);
 const differences=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(name=>a[name]!==b[name]);
 assert.deepEqual(differences,[],message);
}
test('real Astro builds: no-op, edits, additions, removals, cold-cache fallback and atomic failure', {timeout:900000},()=>{
 const sandbox=fs.mkdtempSync(path.join(root,'.build/incremental-fixture-'));
 const fixture=path.join(sandbox,'source');fs.mkdirSync(fixture);
 const logRoot=path.join(root,'.build/incremental-integration');fs.mkdirSync(logRoot,{recursive:true});
 const results=[];
 const copy=name=>{fs.mkdirSync(path.dirname(path.join(fixture,name)),{recursive:true});fs.cpSync(path.join(root,name),path.join(fixture,name),{recursive:true,mode:fs.constants.COPYFILE_FICLONE});};
 for(const name of ['frontend/src','frontend/public','frontend/scripts','frontend/package.json','frontend/package-lock.json','frontend/astro.config.mjs','frontend/component-library.json','tools','admin/src/lib','data','package.json','dist'])copy(name);
 fs.symlinkSync(path.join(root,'frontend/node_modules'),path.join(fixture,'frontend/node_modules'),process.platform==='win32'?'junction':'dir');
 const videos=path.join(fixture,'data/video-archive.json');
 const videoData=JSON.parse(fs.readFileSync(videos,'utf8'));videoData.videos=[];videoData.creators=[{uid:'396353160',name:'风纪委员小电视',homepage:'https://space.bilibili.com/396353160',intro:''}];fs.writeFileSync(videos,JSON.stringify(videoData));
 const original=JSON.parse(fs.readFileSync(path.join(root,'dist/site-data.json'),'utf8'));
 const candidates=original.works.filter(work=>{
   const image=work.displayUrl||work.fullPath||work.thumbUrl||work.thumbnailPath||'';
   return image && !image.startsWith('http') && fs.existsSync(path.join(root,'dist',decodeURIComponent(image).replace(/^\//,'')));
 });
 assert.ok(candidates.length>24,'integration fixtures need 25 complete local images');
 // Editorial guides require these characters even when the newest 24 works
 // all belong to the same character. Keep the fixture independent of intake order.
 const required=['deepseek','gemini'].map(id=>candidates.find(w=>(w.characterIds||[w.characterId]).includes(id)));
 assert.ok(required.every(Boolean),'integration fixtures need the guide characters');
 const ordered=[...new Map([...required,...candidates].map(w=>[w.id,w])).values()];
 const sample=structuredClone({...original,works:ordered.slice(0,24),topics:[]});
 // Keep the search page's fixed suggestions translated in the deliberately small catalog.
 const fixtureTags=work=>{
   work.tags=['DeepSeek','晚安','摸摸头','哈气','女仆','工作','Claude'];
   work.i18n.en.tags=['DeepSeek','Good night','Head pats','Hiss','Maid','Work','Claude'];
   work.i18n.ja.tags=['DeepSeek','おやすみ','なでなで','威嚇','メイド','仕事','Claude'];return work;
 };
 sample.works.forEach(fixtureTags);
 const snapshot=path.join(fixture,'dist/site-data.json');
 const write=data=>fs.writeFileSync(snapshot,JSON.stringify(data));
 const epoch=String(Math.floor(Date.now()/1000));
 function build(name,previous,flags=[],extraEnv={}) {
   const out=path.join(fixture,'.build',name);
   const command=[path.join(fixture,'frontend/scripts/build.mjs'),'--out',out,...(previous?['--previous',path.join(fixture,'.build',previous)]:[]),...flags];
   const started=performance.now();
   const result=spawnSync(process.execPath,command,{cwd:path.join(fixture,'frontend'),env:{...process.env,SITE_SNAPSHOT:snapshot,SOURCE_DATE_EPOCH:epoch,...extraEnv},encoding:'utf8',maxBuffer:12*1024*1024,timeout:240000});
   fs.writeFileSync(path.join(logRoot,name+'.log'),result.stdout+'\n'+result.stderr);
   assert.equal(result.status,0,name+': '+(result.stdout+'\n'+result.stderr).slice(-2000));
   const report=JSON.parse(fs.readFileSync(path.join(out,'build-info.json'),'utf8'));
   results.push({name,...report,wallSeconds:Number(((performance.now()-started)/1000).toFixed(2))});
   console.log('[integration] '+name+': '+JSON.stringify(report));
   return {out,report};
 }
 write(sample);
 const initial=build('initial',null,['--full']);assert.equal(initial.report.mode,'full');
 const apiRoot='open-api/v1/';
 const readApi=(release,file)=>JSON.parse(fs.readFileSync(path.join(release.out,apiRoot,file),'utf8'));
 assert.equal(readApi(initial,'works.json').total,sample.works.length);
 assert.ok(fs.readFileSync(path.join(initial.out,'about.html'),'utf8').includes('id="open-data-api"'));
 for(const locale of ['en','ja','zh-hant'])assert.ok(fs.readFileSync(path.join(initial.out,locale,'about.html'),'utf8').includes('data-open-api-docs'));
 const extra=path.join(initial.out,'not-a-release-artifact.txt');fs.writeFileSync(extra,'temporary, unverified file');
 const noop=build('noop','initial');assert.equal(noop.report.mode,'noop');assert.equal(noop.report.rendered,0);
 assert.equal(fs.existsSync(path.join(noop.out,path.basename(extra))),false);fs.unlinkSync(extra);sameArtifacts(noop.out,initial.out,'no-op artifacts');
 const orphan=path.join(fixture,'frontend/out/works/orphan-from-failed-build.html');
 fs.writeFileSync(orphan,'<html><body>未发布的临时作品</body></html>');
 const prebuilt=build('prebuilt','missing-baseline',[],{PUBLISH_PREBUILT_DIR:initial.out});
 assert.equal(prebuilt.report.mode,'prebuilt');assert.equal(prebuilt.report.rendered,0);sameArtifacts(prebuilt.out,initial.out,'validated preflight reuse');
 const about=path.join(fixture,'frontend/src/components/pages/AboutPage.astro');
 fs.appendFileSync(about,'\n<!-- component cache verification -->\n');
 const component=build('component','noop');assert.equal(component.report.mode,'incremental');assert.ok(component.report.rendered<initial.report.rendered);
 assert.equal(fs.existsSync(path.join(component.out,'works/orphan-from-failed-build.html')),false);
 const componentFull=build('component-full','noop',['--full']);sameArtifacts(component.out,componentFull.out,'component artifacts');
 const edited=structuredClone(sample),work=edited.works.at(-1);
 work.description+=' 增量构建验证。';work.i18n.en.description+=' Incremental build verification.';work.i18n.ja.description+=' 増分ビルドの検証。';
 write(edited);
 const increment=build('edited','component',[],{PUBLISH_PREBUILT_DIR:initial.out});assert.equal(increment.report.mode,'incremental');assert.ok(increment.report.rendered<initial.report.rendered,'unaffected pages must be restored');
 assert.notEqual(readApi(increment,'works/'+work.id+'.json').work.revision,readApi(component,'works/'+work.id+'.json').work.revision);
 assert.ok(increment.report.openApi.reused>0,'unchanged API files must be reused');
 const reference=build('edited-full','component',['--full']);sameArtifacts(increment.out,reference.out,'incremental edits equal a clean full build');
 const added=structuredClone(edited);added.works.push(fixtureTags(structuredClone(ordered[24])));write(added);
 const addition=build('added','edited');assert.equal(addition.report.mode,'incremental');assert.ok(fs.existsSync(path.join(addition.out,'works',ordered[24].slug+'.html')));
 assert.ok(readApi(addition,'manifest.json').items.some(w=>w.id===ordered[24].id));
 const removed=structuredClone(added);const hidden=removed.works.shift();write(removed);
 const deletion=build('removed','added');assert.equal(deletion.report.mode,'incremental');
 for(const prefix of ['','en/','ja/','zh-hant/'])assert.equal(fs.existsSync(path.join(deletion.out,prefix+'works/'+hidden.slug+'.html')),false);
 assert.equal(fs.existsSync(path.join(deletion.out,'works/'+hidden.slug+'.html.md')),false);
 assert.equal(fs.existsSync(path.join(deletion.out,apiRoot,'works/'+hidden.id+'.json')),false);
 assert.ok(!readApi(deletion,'manifest.json').items.some(w=>w.id===hidden.id));
 const deletionReference=build('removed-full','added',['--full']);sameArtifacts(deletion.out,deletionReference.out,'incremental removals equal a clean full build');
 const broken=path.join(deletion.out,'en/works/'+removed.works[0].slug+'.html');fs.unlinkSync(broken);
 const recovered=build('recovered','removed');assert.equal(recovered.report.mode,'full');assert.match(recovered.report.reasons.join(','),/baseline-artifact-missing/);
 const before=outputHashes(recovered.out);
 const failure=spawnSync(process.execPath,[path.join(fixture,'frontend/scripts/build.mjs'),'--out',recovered.out,'--full'],{cwd:path.join(fixture,'frontend'),env:{...process.env,SITE_SNAPSHOT:snapshot,SOURCE_DATE_EPOCH:epoch,PYTHON:'missing-python-for-failure-check'},encoding:'utf8',maxBuffer:8*1024*1024,timeout:240000});
 assert.notEqual(failure.status,0);assert.deepEqual(outputHashes(recovered.out),before,'failed replacement preserves every prior artifact');
 fs.writeFileSync(path.join(root,'.build/incremental-integration-results.json'),JSON.stringify({passed:true,results},null,2));
 assert.ok(path.resolve(sandbox).startsWith(path.resolve(root,'.build')+path.sep));
 fs.rmSync(sandbox,{recursive:true,force:true});
});
