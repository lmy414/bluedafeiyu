#!/usr/bin/env node
// Build an isolated release; only validated output replaces the requested directory.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildLanguagePages,languageSitemap,localizedPath,LOCALES,ORIGIN} from './localize-pages.mjs';
import {readSitemapHistory,updateSitemapHistory} from './sitemap-history.mjs';
import {writeAiContent} from './ai-content.mjs';
import {writeOpenApi} from './open-api.mjs';
import {STATE_VERSION,STATE_FILE,readState,verifyPrevious,hash,makePlan,outputHashes,copyArtifact,copyImmutableAsset,filesIn} from './incremental.mjs';
import {finalizeNavigationCount} from '../src/components/library/navigation-count.mjs';

const started=performance.now();
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(frontend,'..'),dist=process.env.SITE_SNAPSHOT?path.dirname(path.resolve(process.env.SITE_SNAPSHOT)):path.join(root,'dist');
const buildTime=process.env.SOURCE_DATE_EPOCH?new Date(Number(process.env.SOURCE_DATE_EPOCH)*1000):new Date();
let requestedOut,forceClean=false,full=false,planOnly=false,requestedPrevious;
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++) {
 const arg=args[i];
 if(arg==='--out') requestedOut=args[++i];
 else if(arg.startsWith('--out=')) requestedOut=arg.slice(6);
 else if(arg==='--previous') requestedPrevious=args[++i];
 else if(arg==='--force-clean') forceClean=true;
 else if(arg==='--full') full=true;
 else if(arg==='--plan-only') planOnly=true;
 else throw Error('Unknown build argument '+arg);
 if(['--out','--previous'].includes(arg) && (!args[i] || args[i].startsWith('--'))) throw Error(arg+' requires a path');
}
const out=path.resolve(root,requestedOut||'.build/site');
const astroOut=path.join(frontend,'out');
const rel=path.relative(root,out);
if([root,dist,frontend,astroOut,path.parse(out).root].includes(out)||out.split(path.sep).filter(Boolean).length<3)throw Error('Unsafe output path: '+out);
if(rel && !rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(path.sep)[0]!=='.build')throw Error('Output inside repository must be under .build: '+out);
if(fs.existsSync(out) && (fs.lstatSync(out).isSymbolicLink() || (!forceClean && !fs.existsSync(path.join(out,'.build-output')))))throw Error('Existing output is not a marked build result: '+out);
const previousPath=path.resolve(root,requestedPrevious||process.env.SITE_PREVIOUS_DIR||out);
let previous=fs.existsSync(previousPath)?fs.realpathSync(previousPath):previousPath;
const publishedPrevious=previous;
const previousStateFile=process.env.SITE_PREVIOUS_STATE||path.join(previous,STATE_FILE);
let previousState=readState(previousStateFile);
const run=(script,argv=[],cwd=root)=>{
 const result=spawnSync(process.execPath,[script,...argv],{cwd,env:process.env,stdio:'inherit'});
 if(result.error||result.status!==0)throw Error(script+' failed: '+(result.error?.message||result.status));
};
const astro=path.join(frontend,'node_modules/astro/bin/astro.mjs');
if(!fs.existsSync(astro))throw Error('Astro is not installed: run npm ci in frontend/');
fs.mkdirSync(path.join(root,'.build'),{recursive:true});
const planFile=path.join(root,'.build','build-plan-'+process.pid+'.json');
const ogJobsFile=path.join(frontend,'.astro/og-jobs.jsonl');
fs.mkdirSync(path.dirname(ogJobsFile),{recursive:true});fs.writeFileSync(ogJobsFile,'');
process.env.OG_JOBS_FILE=ogJobsFile;
run(path.join(frontend,'scripts/plan-build.mjs'),[root,previous,previousStateFile,planFile,String(full)],frontend);
let plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
let preflight=null;
const candidate=process.env.PUBLISH_PREBUILT_DIR;
if(!full && !planOnly && candidate && fs.existsSync(path.join(candidate,'.build-output'))) {
 const state=readState(path.join(candidate,STATE_FILE));
 const sorted=value=>Object.entries(value).sort(([a],[b])=>a.localeCompare(b));
 if(state && hash(sorted(state.inputs))===hash(sorted(plan.inputs)) && hash(sorted(state.routes))===hash(sorted(plan.routes)) && verifyPrevious(candidate,state).ok) {
   previous=fs.realpathSync(candidate);previousState=state;
   plan=makePlan(plan.inputs,plan.routes,state,{ok:true});
   const built=JSON.parse(fs.readFileSync(path.join(candidate,'build-info.json'),'utf8'));
   preflight={mode:built.mode,rendered:built.rendered,localized:built.localized,seconds:built.seconds,planned:built.planned};
   plan.prebuilt='validated-inputs-and-artifacts';
   console.log('[build-plan] reuse validated preflight artifact');
 }
}
fs.copyFileSync(planFile,path.join(root,'.build/build-plan.json'));
if(planOnly){console.log('[build-plan] analysis complete; no pages rendered');process.exit(0);}
fs.mkdirSync(path.dirname(out),{recursive:true});
const stage=fs.mkdtempSync(path.join(path.dirname(out),'.build-pending-'));
let completed=false;
try {
 let history=previousState?.sitemap||{},ai={},openApi={},localized=0,reusedAssets=0,navigationUpdates=0;
 if(plan.mode==='noop') {
  for(const name of Object.keys(previousState.outputs)) {
    const source=path.join(previous,name),target=path.join(stage,name);
    if(copyImmutableAsset(source,target,path.join(publishedPrevious,name)))reusedAssets++;
  }
  plan.rendered=[];
 } else {
  run(path.join(frontend,'scripts/prepare-language-assets.mjs'));
  process.env.SITE_BUILD_PLAN_FILE=planFile;
  // Astro's incremental cache restores current routes into a fresh output. Old
  // output can retain deleted routes, including files from an unsuccessful build.
  // Keep .build/astro-cache intact; only discard this generated working directory.
  fs.rmSync(astroOut,{recursive:true,force:true});
  run(astro,['build',...(plan.mode==='full'?['--force']:[])],frontend);
  plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
  fs.cpSync(astroOut,stage,{recursive:true,mode:fs.constants.COPYFILE_FICLONE,filter:source=>!source.split(path.sep).includes('.rsync-tmp')});
  // Astro can restore a cached removed page before pruning its cache. The
  // current route plan, plus explicitly public HTML files, defines the release.
  for(const file of filesIn(stage).filter(name=>name.endsWith('.html'))) {
    if(!Object.hasOwn(plan.routes,'/'+file)&&!fs.existsSync(path.join(frontend,'public',file)))fs.rmSync(path.join(stage,file));
  }
  const copy=(relative)=>{
   const source=path.join(dist,relative);
   if(!fs.existsSync(source))throw Error('Missing staged asset '+relative);
   const names=fs.statSync(source).isDirectory()?filesIn(source).map(name=>relative+'/'+name):[relative];
   fs.mkdirSync(path.join(stage,fs.statSync(source).isDirectory()?relative:path.dirname(relative)),{recursive:true});
   for(const name of names)if(copyImmutableAsset(path.join(dist,name),path.join(stage,name),path.join(previous,name)))reusedAssets++;
  };
  for(const file of ['avatar.png','favicon.ico','favicon.png','qq-group.png','credits/shuangshuang.jpg','events/national-day-2026.webp','characters.json','categories.json','blue-fish-ids.json','topics.json','site-data.json','site-data.js','submissions/works.json','owner-picks/works.json'])copy(file);
  for(const dir of ['submissions/previews','submissions/large','owner-picks/previews','author-avatars'])copy(dir);
  if(process.env.SKIP_OG!=='1') {
   const jobs=[...new Map(fs.readFileSync(ogJobsFile,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).map(job=>[job.id,job])).values()];
   const cache=path.join(root,'.build/og-cache');fs.mkdirSync(cache,{recursive:true});
   const jobsJson=path.join(cache,'jobs.json');fs.writeFileSync(jobsJson,JSON.stringify(jobs));
   const result=spawnSync(process.env.PYTHON||'python3',[path.join(root,'tools/og_cards.py'),jobsJson,cache,dist,path.join(dist,'avatar.png')],{cwd:root,stdio:'inherit'});
   if(result.error||result.status!==0)throw Error('Share card generation failed: '+(result.error?.message||result.status));
   fs.mkdirSync(path.join(stage,'og'),{recursive:true});
   for(const job of jobs)if(copyImmutableAsset(path.join(cache,job.id+'.jpg'),path.join(stage,'og',job.id+'.jpg'),path.join(previous,'og',job.id+'.jpg')))reusedAssets++;
   console.log('[og] '+jobs.length+' share cards');
  }
  const snapshot=JSON.parse(fs.readFileSync(path.join(dist,'site-data.json'),'utf8'));
  const bases=filesIn(stage).filter(name=>name.endsWith('.html'));
  const rendered=new Set(plan.rendered||[]);
  const changed=new Set(plan.changed);
  const reuse=[];
  const toLocalize=[];
  for(const file of bases) {
   const sourceHtml=fs.readFileSync(path.join(stage,file),'utf8');
   if(!sourceHtml.includes('data-archive')&&!sourceHtml.includes('class="v2"'))continue;
   const route='/'+file;
   if(plan.mode!=='full'&&!rendered.has(route)&&!changed.has(route)&&previousState?.outputs[file]) {
    for(const locale of LOCALES)copyArtifact(previous,stage,locale.prefix.slice(1)+(locale.prefix?'/':'')+file);
    reuse.push(route);
   }else toLocalize.push(file);
  }
  await buildLanguagePages(stage,snapshot,toLocalize);
  localized=toLocalize.length*LOCALES.length;
  const workTotal=snapshot.works.filter(work=>work.status==='published').length;
  for(const file of filesIn(stage).filter(name=>name.endsWith('.html'))) {
    const target=path.join(stage,file),html=fs.readFileSync(target,'utf8');
    const updated=finalizeNavigationCount(html,workTotal);
    if(updated!==html){fs.writeFileSync(target,updated);navigationUpdates++;}
  }
  ai=writeAiContent(stage,snapshot,{previousDir:plan.mode==='full'?null:previous,previousState});
  console.log('[ai-content] '+JSON.stringify(ai));
  openApi=writeOpenApi(stage,snapshot,{previousDir:plan.mode==='full'?null:previous,previousState});
  console.log('[open-api] '+JSON.stringify(openApi));
  // Retain complete audits; the expensive page render/localization steps are incremental.
  run(path.join(root,'tools/localization/audit-pages.mjs'),[stage,path.join(root,'.build/native-localization-audit.json')]);
  const urls=bases.filter(file=>{
   const html=fs.readFileSync(path.join(stage,file),'utf8');
   return html.includes('data-archive')&&/<meta name="robots" content="index,follow"/.test(html);
  }).map(file=>file==='index.html'?'/':'/'+file);
  let previousSitemap={records:new Map(),seeded:0};
  try {previousSitemap=readSitemapHistory(previous,{origin:ORIGIN,now:buildTime,known:plan.mode==='full'?new Map():new Map(Object.entries(previousState?.sitemap||{}))});}
  catch(error){console.warn('[sitemap] previous history unavailable: '+error.message);}
  const unchangedPaths=new Set(reuse.flatMap(base=>LOCALES.map(locale=>localizedPath(base,locale))));
  const sitemap=updateSitemapHistory(urls.flatMap(base=>LOCALES.map(locale=>localizedPath(base,locale))),stage,previousSitemap,{unchangedPaths,now:buildTime});
  fs.writeFileSync(path.join(stage,'sitemap.xml'),languageSitemap(urls,sitemap.lastmods));
  history=Object.fromEntries(sitemap.records);
  console.log(`[sitemap] ${sitemap.unchanged} unchanged, ${sitemap.changed} changed, ${sitemap.added} new`);
  for(const base of urls)for(const locale of LOCALES) {
   const route=localizedPath(base,locale),file=route.endsWith('/')?route+'index.html':route;
   if(!fs.existsSync(path.join(stage,file.slice(1))))throw Error('Language page missing: '+route);
  }
 }
 const git=(dir)=>spawnSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).stdout?.trim()||null;
 const report={version:STATE_VERSION,mode:preflight?'prebuilt':plan.mode,reasons:preflight?['validated-prebuilt-artifact']:plan.reasons,preflight,sourceCommit:git(root),contentCommit:process.env.CONTENT_DIR?git(process.env.CONTENT_DIR):null,planned:preflight?.planned||{changed:plan.changed.length,reused:plan.reused.length,removed:plan.removed.length,sharedChanges:plan.sharedChanges},rendered:(plan.rendered||[]).length,localized,reusedAssets,navigationUpdates,markdown:ai,openApi,seconds:Number(((performance.now()-started)/1000).toFixed(2))};
 const state={version:STATE_VERSION,inputs:plan.inputs,routes:plan.routes,outputs:outputHashes(stage),sitemap:history};
 fs.writeFileSync(path.join(stage,STATE_FILE),JSON.stringify(state));
 fs.writeFileSync(path.join(stage,'.build-plan.json'),JSON.stringify(plan,null,2));
 fs.writeFileSync(path.join(stage,'build-info.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(stage,'.build-output'),'frontend/scripts/build.mjs\n');
 fs.writeFileSync(path.join(root,'.build/build-plan.json'),JSON.stringify(plan,null,2));
 if(fs.existsSync(out))fs.rmSync(out,{recursive:true});
 fs.renameSync(stage,out);completed=true;
 console.log('[build-result] '+JSON.stringify(report));
 console.log('[astro] output '+out);
} finally {
 if(!completed)fs.rmSync(stage,{recursive:true,force:true});
 fs.rmSync(planFile,{force:true});
}
