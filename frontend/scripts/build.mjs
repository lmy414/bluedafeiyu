#!/usr/bin/env node
// Build an isolated release; only validated output replaces the requested directory.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readSitemapHistory,updateSitemapHistory,languageSitemap,sitemapWorkImage} from './sitemap-history.mjs';
import {localizedPath,LOCALES,ORIGIN} from './site-locales.mjs';
import {STATE_VERSION,STATE_FILE,readState,hash,outputHashes,copyImmutableAsset,filesIn,excludeInvalidArtifacts} from './incremental.mjs';
import {buildShareCards} from './og-output.mjs';
import {assertReleaseWorkImages,LEGACY_PREVIEW_DIR} from '../../tools/work-image-integrity.mjs';

const started=performance.now();
let phaseStart=started;
const timings=JSON.parse(process.env.SITE_PREPARATION_TIMINGS || '{}');
const endPhase=name=>{
 const now=performance.now();
 timings[name]=Number(((now-phaseStart)/1000).toFixed(2));
 console.log(`[build-phase] ${name} ${timings[name]}s`);
 phaseStart=now;
};
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
const run=(script,argv=[],cwd=root,env={})=>{
 const result=spawnSync(process.execPath,[script,...argv],{
  cwd,env:{...process.env,...env},stdio:['inherit','inherit','pipe'],encoding:'utf8',maxBuffer:8*1024*1024,
 });
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error||result.status!==0){
  const diagnostic=result.stderr?.split(/\r?\n/).find(line=>/^(?:\w*Error:|FATAL ERROR)/.test(line.trim()))?.trim();
  const reason=result.error?.message??result.signal??result.status;
  throw Error(script+' failed: '+reason+(diagnostic ? ' · '+diagnostic : ''));
 }
};
const astro=path.join(frontend,'node_modules/astro/bin/astro.mjs');
if(!fs.existsSync(astro))throw Error('Astro is not installed: run npm ci in frontend/');
fs.mkdirSync(path.join(root,'.build'),{recursive:true});
const planFile=path.join(root,'.build','build-plan-'+process.pid+'.json');
const pageResultFile=path.join(root,'.build','build-pages-'+process.pid+'.json');
const auditStateFile=path.join(root,'.build','audit-state-'+process.pid+'.json');
const ogJobsFile=path.join(frontend,'.astro/og-jobs.jsonl');
fs.mkdirSync(path.dirname(ogJobsFile),{recursive:true});fs.writeFileSync(ogJobsFile,'');
process.env.OG_JOBS_FILE=ogJobsFile;
const candidate=!planOnly && process.env.PUBLISH_PREBUILT_DIR ? path.resolve(process.env.PUBLISH_PREBUILT_DIR) : '';
const previousSitemapFile=path.join(publishedPrevious,'sitemap.xml');
const baselineSitemap=fs.existsSync(previousSitemapFile) ? hash(fs.readFileSync(previousSitemapFile)) : null;
run(path.join(frontend,'scripts/plan-build.mjs'),[root,previous,previousStateFile,planFile,String(full),candidate,baselineSitemap||''],frontend);
let plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
const preflight=plan.preflight;
const assetManifest=plan.assetManifest;
if(preflight)previous=fs.realpathSync(candidate);
fs.copyFileSync(planFile,path.join(root,'.build/build-plan.json'));
endPhase('plan');
if(planOnly){fs.rmSync(planFile,{force:true});console.log('[build-plan] analysis complete; no pages rendered');process.exit(0);}
fs.mkdirSync(path.dirname(out),{recursive:true});
const stage=fs.mkdtempSync(path.join(path.dirname(out),'.build-pending-'));
let completed=false;
try {
 const reusedStateFile=preflight ? path.join(previous,STATE_FILE) : previousStateFile;
 const baseline=plan.baselineVerified ? readState(reusedStateFile) : null;
 if(plan.baselineVerified&&!baseline)throw Error('Build baseline changed after planning');
 const reusableState=plan.force ? null : excludeInvalidArtifacts(baseline,plan.invalidArtifacts);
 const knownOutputs=new Map();
 let history=reusableState?.sitemap||{},pages=reusableState?.pages||{},audit=reusableState?.audit;
 let localeInputHash=reusableState?.localeInputHash,localeInputs=reusableState?.localeInputs;
 let ogFingerprint=reusableState?.ogFingerprint,ogJobs=reusableState?.ogJobs,ogStats;
 let localeStats, auditStats, sitemapStats;
 let ai={},openApi={},localized=0,reusedLanguagePages=0,reusedAssets=0;
 if(plan.mode==='noop') {
  for(const [name,digest] of Object.entries(reusableState.outputs)) {
    const source=path.join(previous,name),target=path.join(stage,name);
    let handedOff=false;
    if(preflight && process.env.SITE_HANDOFF_PREBUILT==='1' && fs.lstatSync(source).isFile()) {
     fs.mkdirSync(path.dirname(target),{recursive:true});
     try { fs.linkSync(source,target); handedOff=true; }
     catch(error) { if(error.code!=='EXDEV' && error.code!=='EPERM' && error.code!=='ENOTSUP')throw error; }
    }
    if(!handedOff && copyImmutableAsset(source,target,path.join(publishedPrevious,name),previous===publishedPrevious ? digest : undefined))reusedAssets++;
    knownOutputs.set(name,digest);
  }
  plan.rendered=[];
  const pageCount = Object.keys(pages).length;
  reusedLanguagePages=pageCount*LOCALES.length;
  localeStats = Object.fromEntries(LOCALES.map(({id}) => [id, {generated: 0, reused: pageCount}]));
  auditStats = {scanned: 0, reused: Object.keys(audit?.pages || {}).length};
  sitemapStats = {fingerprinted: 0, reused: Object.keys(history).length, previousPagesRead: 0};
  endPhase('reuse');
 } else {
  run(path.join(frontend,'scripts/prepare-language-assets.mjs'));
  // Astro can restore cached pages directly into the fresh release directory.
  run(astro,['build',...(plan.mode==='full'?['--force']:[])],frontend,{SITE_BUILD_PLAN_FILE:planFile,ASTRO_OUT_DIR:stage});
  plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
  endPhase('astro');
  const copy=(relative)=>{
   const source=path.join(dist,relative);
   if(!fs.existsSync(source))throw Error('Missing staged asset '+relative);
   const names=fs.statSync(source).isDirectory()?filesIn(source).map(name=>relative+'/'+name):[relative];
   fs.mkdirSync(path.join(stage,fs.statSync(source).isDirectory()?relative:path.dirname(relative)),{recursive:true});
   for(const name of names){
    const digest=reusableState?.outputs[name];
    const sourceDigest=assetManifest['dist/'+name]?.digest;
    if(copyImmutableAsset(path.join(dist,name),path.join(stage,name),path.join(previous,name),digest,sourceDigest)){
     reusedAssets++;
    }
    if(sourceDigest)knownOutputs.set(name,sourceDigest);
   }
  };
  for(const file of ['avatar.png','favicon.ico','credits/shuangshuang.jpg','events/national-day-2026.webp','characters.json','categories.json','blue-fish-ids.json','topics.json','site-data.json','site-data.js','submissions/works.json','owner-picks/works.json'])copy(file);
  for(const dir of ['submissions/previews','submissions/large','owner-picks/previews',LEGACY_PREVIEW_DIR,'author-avatars','character-portraits','community'])copy(dir);
  const icons=spawnSync(process.env.PYTHON||'python3',[path.join(root,'tools/prepare_apple_touch_icons.py'),path.join(dist,'favicon.png'),stage],{stdio:'inherit'});
  if(icons.error||icons.status!==0)throw Error('Apple touch icon generation failed: '+(icons.error?.message||icons.status));
  if(process.env.SKIP_OG!=='1') {
   const result=buildShareCards({jobsFile:ogJobsFile,root,dist,stage,previous,state:reusableState,inputs:plan.inputs,assets:assetManifest,knownOutputs});
   ogFingerprint=result.fingerprint;
   ogJobs=result.jobKeys;
   ogStats={reused:result.reused,checked:result.checked};
   reusedAssets+=result.reused;
  }
  endPhase('assets');
  // Run localization and audit in separate processes so their DOMs cannot
  // accumulate in one heap.
  run(path.join(frontend,'scripts/build-page-output.mjs'),[
   stage,planFile,previous,reusedStateFile,pageResultFile,
  ]);
  let urls;
  {
   const result=JSON.parse(fs.readFileSync(pageResultFile,'utf8'));
   ({urls,pages,localeInputHash,localeInputs,localized,reusedLanguagePages,localeStats,ai,openApi}=result);
   for(const [name,digest] of result.knownOutputs)knownOutputs.set(name,digest);
   Object.assign(timings,result.timings);
  }
  phaseStart=performance.now();
  const previousAudit = plan.mode !== 'full' && plan.dependenciesCompatible && baseline?.inputs.audit === plan.inputs.audit ? baseline.audit : null;
  fs.writeFileSync(auditStateFile,JSON.stringify({previous:previousAudit,digests:Object.fromEntries(knownOutputs)}));
  run(path.join(root,'tools/localization/audit-pages.mjs'),[
   stage,path.join(root,'.build/native-localization-audit.json'),auditStateFile,
  ]);
  audit=JSON.parse(fs.readFileSync(auditStateFile,'utf8'));
  auditStats=audit.stats;
  endPhase('audit');
  const snapshot=JSON.parse(fs.readFileSync(path.join(stage,'site-data.json'),'utf8'));
  let previousSitemap={records:new Map(),seeded:0};
  let previousPagesRead = 0;
  try {
   if (baseline && plan.dependenciesCompatible && ['sitemap', 'runtime'].every(key => baseline.inputs[key] === plan.inputs[key])) {
    previousSitemap = {records: new Map(Object.entries(baseline.sitemap)), seeded: 0};
   } else {
    previousSitemap = readSitemapHistory(publishedPrevious, {origin: ORIGIN, now: buildTime});
    previousPagesRead = previousSitemap.records.size;
   }
  } catch(error){console.warn('[sitemap] previous history unavailable: '+error.message);}
  const paths = urls.flatMap(base => LOCALES.map(locale => localizedPath(base, locale)));
  const unchangedPaths = new Set();
  for (const route of paths) {
   const file = (route.endsWith('/') ? route + 'index.html' : route).slice(1);
   if (!fs.existsSync(path.join(stage, file))) throw Error('Language page missing: ' + route);
   const digest = knownOutputs.get(file);
   if (reusableState && digest && digest === reusableState.outputs[file]) unchangedPaths.add(route);
  }
  const sitemap=updateSitemapHistory(paths,stage,previousSitemap,{unchangedPaths,now:buildTime});
  const sitemapImages=new Map();
  for(const work of snapshot.works||[]){
    if(work.status!=='published')continue;
    const image=sitemapWorkImage(work);
    // Never advertise the placeholder: an unindexed image is better than a blank result.
    if(image)sitemapImages.set('/works/'+work.slug+'.html',image);
  }
  fs.writeFileSync(path.join(stage,'sitemap.xml'),languageSitemap(urls,sitemap.lastmods,sitemapImages));
  history=Object.fromEntries(sitemap.records);
  sitemapStats = {fingerprinted: sitemap.fingerprinted, reused: paths.length - sitemap.fingerprinted, previousPagesRead};
  console.log(`[sitemap] ${sitemap.unchanged} unchanged, ${sitemap.changed} changed, ${sitemap.added} new`);
  endPhase('sitemap');
 }
 // Check the finished stage, including noop and validated prebuilt output.
 assertReleaseWorkImages(stage);
 const git=(dir)=>spawnSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).stdout?.trim()||null;
 const artifacts={};
 const outputs=outputHashes(stage,knownOutputs,artifacts);
 const state={version:STATE_VERSION,inputs:plan.inputs,astroKey:plan.astroKey,routes:plan.routes,pages,audit,outputs,artifacts,assetManifest,sitemap:history,baselineSitemap,localeInputHash,localeInputs,ogFingerprint,ogJobs};
 delete plan.assetManifest;
 endPhase('inventory');
 const report={
  version:STATE_VERSION,mode:preflight?'prebuilt':plan.mode,
  reasons:preflight?['validated-prebuilt-artifact']:plan.reasons,preflight:preflight||null,
  sourceCommit:git(root),contentCommit:process.env.CONTENT_DIR?git(process.env.CONTENT_DIR):null,
  planned:preflight?.planned||{changed:plan.changed.length,reused:plan.reused.length,removed:plan.removed.length},
  rendered:(plan.rendered||[]).length,localized,reusedLanguagePages,locales:localeStats,reusedAssets,og:ogStats,markdown:ai,openApi,audit:auditStats,sitemap:sitemapStats,timings,
  baselineChecks:plan.baselineChecks,
  seconds:Number(((performance.now()-started)/1000).toFixed(2)),
 };
 fs.writeFileSync(path.join(stage,STATE_FILE),JSON.stringify(state));
 fs.writeFileSync(path.join(stage,'.build-plan.json'),JSON.stringify(plan,null,2));
 fs.writeFileSync(path.join(stage,'build-info.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(stage,'.build-output'),'frontend/scripts/build.mjs\n');
 fs.writeFileSync(path.join(root,'.build/build-plan.json'),JSON.stringify(plan,null,2));
 if(fs.existsSync(out))fs.rmSync(out,{recursive:true});
 fs.renameSync(stage,out);completed=true;
 console.log('[build-result] '+JSON.stringify(report));
 console.log('[astro] output '+out);
} catch(error) {
 console.error('[build] '+error.message);
 process.exitCode=1;
} finally {
 if(!completed)fs.rmSync(stage,{recursive:true,force:true});
 fs.rmSync(planFile,{force:true});
 fs.rmSync(pageResultFile,{force:true});
 fs.rmSync(auditStateFile,{force:true});
}
