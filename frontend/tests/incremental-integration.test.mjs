import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {outputHashes} from '../scripts/incremental.mjs';

const root=path.resolve(import.meta.dirname,'../..');
function sameArtifacts(left,right,message,untrackedRight=[]) {
 const a=outputHashes(left),b=outputHashes(right);
 for(const name of untrackedRight)delete b[name];
 const differences=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(name=>a[name]!==b[name]);
 assert.deepEqual(differences,[],message);
}
test('real Astro builds: no-op, edits, additions, removals, cold-cache fallback and atomic failure', {timeout:1200000},()=>{
 const sandbox=fs.mkdtempSync(path.join(root,'.build/incremental-fixture-'));
 const fixture=path.join(sandbox,'source');fs.mkdirSync(fixture);
 const logRoot=path.join(root,'.build/incremental-integration');fs.mkdirSync(logRoot,{recursive:true});
 const results=[];
 const copy=name=>{fs.mkdirSync(path.dirname(path.join(fixture,name)),{recursive:true});fs.cpSync(path.join(root,name),path.join(fixture,name),{recursive:true,mode:fs.constants.COPYFILE_FICLONE});};
 for(const name of ['frontend/src','frontend/public','frontend/scripts','frontend/package.json','frontend/package-lock.json','frontend/astro.config.mjs','frontend/component-library.json','tools','admin/src/lib','data','package.json','dist'])copy(name);
 fs.symlinkSync(path.join(root,'frontend/node_modules'),path.join(fixture,'frontend/node_modules'),process.platform==='win32'?'junction':'dir');
 const videos=path.join(fixture,'data/video-archive.json');
 const videoData=JSON.parse(fs.readFileSync(videos,'utf8'));
 videoData.videos=videoData.videos.filter(video=>video.i18n?.en && video.i18n?.ja).slice(0,25);
 assert.equal(videoData.videos.length,25,'fixture needs native translations and real video pagination');
 fs.writeFileSync(videos,JSON.stringify(videoData));
 const original=JSON.parse(fs.readFileSync(path.join(root,'dist/site-data.json'),'utf8'));
 const candidates=original.works.filter(work=>{
   const image=work.displayUrl||work.fullPath||work.thumbUrl||work.thumbnailPath||'';
   return image && !image.startsWith('http') && fs.existsSync(path.join(root,'dist',decodeURIComponent(image).replace(/^\//,'')));
 });
 assert.ok(candidates.length>24,'integration fixtures need 25 complete local images');
 // Editorial guides require these characters even when the newest 24 works
 // all belong to the same character. Keep the fixture independent of intake order.
 const required=['deepseek','gemini'].map(id=>candidates.find(w=>(w.characterIds||[w.characterId]).includes(id)));
 const legacyWork=candidates.find(work=>work.thumbUrl?.replace(/^\//,'').startsWith('data/blue-fish/previews/'));
 assert.ok(required.every(Boolean) && legacyWork,'integration fixtures need the guide characters and a legacy preview');
 required.push(legacyWork);
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
   return {out,report,plan:JSON.parse(fs.readFileSync(path.join(out,'.build-plan.json'),'utf8'))};
 }
 const htmlRendered=build=>build.plan.rendered.filter(route=>route.endsWith('.html')).sort();
 const assertEnglishOnly = (release, previous) => {
   assert.equal(release.report.mode,'incremental');
   assert.ok(release.report.locales.en.generated > 0);
   for (const locale of ['zh','zh-Hant','ja']) {
     assert.equal(release.report.locales[locale].generated,0,locale+' should reuse all pages');
     assert.ok(release.report.locales[locale].reused > 0);
     assert.equal(release.report.locales[locale].reused,previous.report.locales[locale].generated + previous.report.locales[locale].reused);
   }
   assert.equal(release.report.audit.byLocale.ja.scanned,0);
   assert.equal(release.report.sitemap.previousPagesRead,0);
 };
 write(sample);
 const initial=build('initial',null,['--full']);assert.equal(initial.report.mode,'full');
 const legacyFile=decodeURIComponent(legacyWork.thumbUrl).replace(/^\//,'');
 assert.deepEqual(fs.readFileSync(path.join(initial.out,legacyFile)),fs.readFileSync(path.join(fixture,'dist',legacyFile)));
 assert.ok(outputHashes(initial.out)[legacyFile],'legacy previews must be in the release inventory');
 assert.equal(fs.existsSync(path.join(initial.out,'data/blue-fish-classification.json')),false);
 for(const name of ['apple-touch-icon.png','apple-touch-icon-precomposed.png']) {
   const png=fs.readFileSync(path.join(initial.out,name));
   assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');
   assert.equal(png.readUInt32BE(16),180);assert.equal(png.readUInt32BE(20),180);
 }
 for(const prefix of ['','en/','ja/','zh-hant/'])assert.ok(fs.readFileSync(path.join(initial.out,prefix,'index.html'),'utf8').includes('href="/apple-touch-icon.png"'));
 const sitemap=fs.readFileSync(path.join(initial.out,'sitemap.xml'),'utf8');
 const origin='https://xn--pssy23gqgbz2d718b.com';
 const workPath='/works/'+sample.works[0].slug+'.html';
 for(const prefix of ['','/en','/ja','/zh-hant'])assert.ok(sitemap.includes('<loc>'+origin+prefix+workPath+'</loc>'));
 assert.ok(!sitemap.includes('<loc>'+origin+'/search.html</loc>'));
 const apiRoot='open-api/v1/';
 const readApi=(release,file)=>JSON.parse(fs.readFileSync(path.join(release.out,apiRoot,file),'utf8'));
 assert.equal(readApi(initial,'works.json').total,sample.works.length);
 assert.ok(fs.readFileSync(path.join(initial.out,'about.html'),'utf8').includes('id="open-data-api"'));
 for(const locale of ['en','ja','zh-hant'])assert.ok(fs.readFileSync(path.join(initial.out,locale,'about.html'),'utf8').includes('data-open-api-docs'));
 const extra=path.join(initial.out,'not-a-release-artifact.txt');fs.writeFileSync(extra,'temporary, unverified file');
 const noop=build('noop','initial');assert.equal(noop.report.mode,'noop');assert.equal(noop.report.rendered,0);
 assert.equal(fs.existsSync(path.join(noop.out,path.basename(extra))),false);
 sameArtifacts(noop.out,initial.out,'no-op artifacts',[path.basename(extra)]);
 const serialSample=structuredClone(sample);
 const [cover,page]=serialSample.works;
 serialSample.characters.push({id:'series-only',name:'Series Only',aliases:[],status:'active'});
 page.characterIds=[...new Set([...(page.characterIds||[page.characterId]),'series-only'])];
 serialSample.topics=[{id:'integration-series',name:'测试连载',summary:'按原稿页码阅读故事。',coverWorkId:cover.id,workIds:[cover.id,page.id],i18n:{en:{name:'Test series',summary:'Read the story in its original page order.'},ja:{name:'テスト連載',summary:'原稿のページ順に物語を読みます。'}},reader:{totalPages:1,credits:'',pages:[{number:1,workId:page.id}]}}];
 write(serialSample);
 const serialIncremental=build('serial-added','noop');assert.equal(serialIncremental.report.mode,'incremental');
 const serialGallery=fs.readFileSync(path.join(serialIncremental.out,'browse.html'),'utf8');
 assert.ok(!serialGallery.includes('data-slug="'+cover.slug+'"'));
 assert.ok(!serialGallery.includes('data-slug="'+page.slug+'"'));
 assert.ok(fs.readFileSync(path.join(serialIncremental.out,'serials.html'),'utf8').includes('data-comic-series="integration-series"'));
 for(const prefix of ['','en/','ja/','zh-hant/']){
   const emptyRole=fs.readFileSync(path.join(serialIncremental.out,prefix,'characters/series-only.html'),'utf8');
   assert.ok(emptyRole.includes('href="/'+prefix+'serials.html"'));
   assert.ok(!emptyRole.includes('data-slug="'+page.slug+'"'));
   assert.ok(fs.existsSync(path.join(serialIncremental.out,prefix,'works',page.slug+'.html')));
   const ordinaryRole=fs.readFileSync(path.join(serialIncremental.out,prefix,'characters/deepseek.html'),'utf8');
   assert.ok(!ordinaryRole.includes('data-slug="'+cover.slug+'"'));
   assert.ok(!ordinaryRole.includes('data-slug="'+page.slug+'"'));
 }
 const serialFull=build('serial-added-full','noop',['--full']);sameArtifacts(serialIncremental.out,serialFull.out,'serial membership incremental artifacts');
 write(sample);
 const orphan=path.join(fixture,'frontend/out/works/orphan-from-failed-build.html');
 fs.mkdirSync(path.dirname(orphan),{recursive:true});
 fs.writeFileSync(orphan,'<html><body>未发布的临时作品</body></html>');
 const prebuilt=build('prebuilt','missing-baseline',[],{PUBLISH_PREBUILT_DIR:initial.out,SITE_HANDOFF_PREBUILT:'1'});
 assert.equal(prebuilt.report.mode,'prebuilt');assert.equal(prebuilt.report.rendered,0);
 assert.equal(fs.existsSync(path.join(prebuilt.out,path.basename(extra))),false);
 sameArtifacts(prebuilt.out,initial.out,'validated preflight reuse',[path.basename(extra)]);
 // Prebuilt reuse does not mutate Astro's cache, which still contains the
 // serial fixture. Restore the ordinary fixture before measuring template reuse.
 const componentBaseline=build('component-baseline','prebuilt',['--full']);
 sameArtifacts(componentBaseline.out,initial.out,'component cache baseline',[path.basename(extra)]);
 const about=path.join(fixture,'frontend/src/components/pages/AboutPage.astro');
 // Exercise a rendered component change, rather than a compiler-optional comment.
 const aboutSource=fs.readFileSync(about,'utf8'),documentMarker='data-document-content>';
 assert.ok(aboutSource.includes(documentMarker),'component mutation must target the current document wrapper');
 fs.writeFileSync(about,aboutSource.replace(documentMarker,documentMarker+'<span hidden data-component-cache-verification></span>'));
 const component=build('component','component-baseline');
 assert.equal(component.report.mode,'incremental');
 assert.deepEqual(htmlRendered(component),['/about.html']);
 assert.equal(component.report.localized,4);
 assert.ok(fs.readFileSync(path.join(component.out,'about.html'),'utf8').includes('data-component-cache-verification'));
 assert.equal(fs.existsSync(path.join(component.out,'works/orphan-from-failed-build.html')),false);
 const componentFull=build('component-full','noop',['--full']);sameArtifacts(component.out,componentFull.out,'component artifacts');
 const homepageCSS=path.join(fixture,'frontend/src/components/library/Home.css');
 const homeCSS=fs.readFileSync(homepageCSS,'utf8');
 fs.writeFileSync(homepageCSS,homeCSS+'\n.hero{--integration-build-scope:1}\n');
 const styles=build('home-styles','component-full');
 assert.equal(styles.report.mode,'incremental');
 assert.ok(htmlRendered(styles).includes('/index.html'));
 assert.ok(!htmlRendered(styles).includes('/about.html'));
 assert.ok(!htmlRendered(styles).some(route=>route.startsWith('/works/')));
 const stylesFull=build('home-styles-full','component-full',['--full']);
 sameArtifacts(styles.out,stylesFull.out,'private stylesheet incremental artifacts');

 const translatedVideo=videoData.videos.toSorted((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.bvid.localeCompare(b.bvid))[0];
 translatedVideo.i18n.en.description+=' Video translation dependency check.';
 fs.writeFileSync(videos,JSON.stringify(videoData));
 const translated=build('video-translation','home-styles-full');
 assert.match(fs.readFileSync(path.join(translated.out,'en/videos.html'),'utf8'),/Video translation dependency check\./);
 assert.ok(fs.existsSync(path.join(translated.out,'en/videos/oldest/page/2.html')));
 assert.ok(!htmlRendered(translated).includes('/videos.html'),'a translation-only edit need not render the base route');
 assertEnglishOnly(translated,stylesFull);
 const translatedFull=build('video-translation-full','home-styles-full',['--full']);
 sameArtifacts(translated.out,translatedFull.out,'translation and nested routes equal full build');

 const englishEdit=structuredClone(sample);
 const englishWork=englishEdit.works.at(-1);
 englishWork.i18n.en.description+=' English-only artwork description.';
 write(englishEdit);
 const english=build('english-work','video-translation-full');
 assertEnglishOnly(english,translatedFull);
 assert.match(fs.readFileSync(path.join(english.out,'en/works',englishWork.slug+'.html'),'utf8'),/English-only artwork description\./);
 const englishFull=build('english-work-full','video-translation-full',['--full']);
 sameArtifacts(english.out,englishFull.out,'English-only incremental artifacts');

 const dictionary=path.join(fixture,'frontend/public/lang/en.js');
 const englishDictionary=fs.readFileSync(dictionary,'utf8');
 assert.ok(englishDictionary.includes('DeepSeek Chan (archive)'));
 fs.writeFileSync(dictionary,englishDictionary.replace('DeepSeek Chan (archive)','DeepSeek Chan artwork archive'));
 const dictionaryEdit=build('english-dictionary','english-work-full');
 assertEnglishOnly(dictionaryEdit,englishFull);
 assert.match(fs.readFileSync(path.join(dictionaryEdit.out,'en/works',englishWork.slug+'.html'),'utf8'),/DeepSeek Chan artwork archive/);
 const dictionaryFull=build('english-dictionary-full','english-work-full',['--full']);
 sameArtifacts(dictionaryEdit.out,dictionaryFull.out,'dictionary-only incremental artifacts');

 fs.appendFileSync(path.join(fixture,'tools/localization/audit-pages.mjs'),'\n// Audit rule fingerprint fixture.\n');
 const audit=build('audit-only','english-dictionary-full');
 assert.ok(audit.report.reasons.includes('audit-rules-changed'));
 assert.deepEqual(htmlRendered(audit),[]);
 assert.equal(audit.report.localized,0);
 assert.equal(audit.report.audit.scanned,englishFull.report.audit.scanned);
 assert.equal(audit.report.audit.reused,0);
 assert.equal(audit.report.sitemap.fingerprinted,0);
 assert.equal(audit.report.sitemap.previousPagesRead,0);
 sameArtifacts(audit.out,dictionaryFull.out,'audit-only artifacts');

 fs.appendFileSync(path.join(fixture,'frontend/scripts/sitemap-history.mjs'),'\n// Sitemap rule fingerprint fixture.\n');
 const sitemapRule=build('sitemap-rule-only','audit-only');
 assert.ok(sitemapRule.report.reasons.includes('sitemap-rules-changed'));
 assert.deepEqual(htmlRendered(sitemapRule),[]);
 assert.equal(sitemapRule.report.localized,0);
 assert.equal(sitemapRule.report.audit.scanned,0);
 assert.ok(sitemapRule.report.sitemap.previousPagesRead > 0);
 sameArtifacts(sitemapRule.out,audit.out,'sitemap rule change preserves lastmod and other artifacts');

 const edited=structuredClone(sample),work=edited.works.at(-1);
 work.description+=' 增量构建验证。';work.i18n.en.description+=' Incremental build verification.';work.i18n.ja.description+=' 増分ビルドの検証。';
 write(edited);
 const increment=build('edited','sitemap-rule-only',[],{PUBLISH_PREBUILT_DIR:initial.out});assert.equal(increment.report.mode,'incremental');assert.ok(increment.report.rendered<initial.report.rendered,'unaffected pages must be restored');
 assert.notEqual(readApi(increment,'works/'+work.id+'.json').work.revision,readApi(component,'works/'+work.id+'.json').work.revision);
 assert.ok(increment.report.openApi.reused>0,'unchanged API files must be reused');
 const reference=build('edited-full','sitemap-rule-only',['--full']);sameArtifacts(increment.out,reference.out,'incremental edits equal a clean full build');
 const added=structuredClone(edited);added.works.push(fixtureTags(structuredClone(ordered[24])));write(added);
 const addition=build('added','edited');assert.equal(addition.report.mode,'incremental');assert.ok(fs.existsSync(path.join(addition.out,'works',ordered[24].slug+'.html')));
 assert.ok(readApi(addition,'manifest.json').items.some(w=>w.id===ordered[24].id));
 // Keep the guide-required roles pinned above; remove an ordinary fixture work.
 const removed=structuredClone(added);const [hidden]=removed.works.splice(required.length,1);write(removed);
 const deletion=build('removed','added');assert.equal(deletion.report.mode,'incremental');
 for(const prefix of ['','en/','ja/','zh-hant/'])assert.equal(fs.existsSync(path.join(deletion.out,prefix+'works/'+hidden.slug+'.html')),false);
 assert.equal(fs.existsSync(path.join(deletion.out,'works/'+hidden.slug+'.html.md')),false);
 assert.equal(fs.existsSync(path.join(deletion.out,apiRoot,'works/'+hidden.id+'.json')),false);
 assert.ok(!readApi(deletion,'manifest.json').items.some(w=>w.id===hidden.id));
 const deletionReference=build('removed-full','added',['--full']);sameArtifacts(deletion.out,deletionReference.out,'incremental removals equal a clean full build');
 const missing='en/works/'+removed.works[0].slug+'.html';
 const incomplete=path.join(fixture,'.build/removed-missing');
 fs.cpSync(deletion.out,incomplete,{recursive:true,mode:fs.constants.COPYFILE_FICLONE,filter:source=>source!==path.join(deletion.out,missing)});
 assert.equal(fs.existsSync(path.join(incomplete,missing)),false);
 const recovered=build('recovered','removed-missing');
 assert.equal(recovered.report.mode,'incremental');
 assert.match(recovered.report.reasons.join(','),/baseline-artifact-missing/);
 assert.deepEqual(htmlRendered(recovered),[]);
 assert.equal(recovered.report.localized,1);
 assert.equal(recovered.report.locales.en.generated,1);
 sameArtifacts(recovered.out,deletion.out,'repair restores one missing localized artifact');

 fs.appendFileSync(path.join(fixture,'tools/stage_data.mjs'),'\n// Build orchestration fixture.\n');
 const toolchain=build('toolchain','recovered');
 assert.equal(toolchain.report.mode,'incremental');
 assert.ok(toolchain.report.reasons.includes('build-scripts-changed'));
 assert.deepEqual(htmlRendered(toolchain),[]);
 assert.equal(toolchain.report.localized,0);
 assert.equal(toolchain.report.audit.scanned,0);
 assert.equal(toolchain.report.sitemap.previousPagesRead,0);
 sameArtifacts(toolchain.out,recovered.out,'orchestration changes preserve cached artifacts');

 const before=outputHashes(recovered.out);
 const failure=spawnSync(process.execPath,[path.join(fixture,'frontend/scripts/build.mjs'),'--out',recovered.out,'--full'],{cwd:path.join(fixture,'frontend'),env:{...process.env,SITE_SNAPSHOT:snapshot,SOURCE_DATE_EPOCH:epoch,PYTHON:'missing-python-for-failure-check'},encoding:'utf8',maxBuffer:8*1024*1024,timeout:240000});
 assert.notEqual(failure.status,0);assert.deepEqual(outputHashes(recovered.out),before,'failed replacement preserves every prior artifact');
 fs.writeFileSync(path.join(root,'.build/incremental-integration-results.json'),JSON.stringify({passed:true,results},null,2));
 assert.ok(path.resolve(sandbox).startsWith(path.resolve(root,'.build')+path.sep));
 fs.rmSync(sandbox,{recursive:true,force:true});
});
