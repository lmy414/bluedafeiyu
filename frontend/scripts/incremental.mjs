import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {LEGACY_PREVIEW_DIR} from '../../tools/work-image-integrity.mjs';

export const STATE_VERSION = 2;
export const STATE_FILE = '.build-state.json';
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const astroFiles = ['frontend/astro.config.mjs', 'frontend/package.json', 'frontend/package-lock.json'];
const localeHelpers = ['tools/work-characters.mjs', 'frontend/src/lib/creator-avatars.json'];

function rendererInputs(read) {
  const digests = astroFiles.map(file => hash(read(file).replace(/\r\n/g, '\n')));
  return {
    astro: hash(['astro-prerender-v1', digests]),
    dependencies: digests[2],
    localeHelpers: hash(localeHelpers.map(file => hash(read(file).replace(/\r\n/g, '\n')))),
  };
}

// Releases made before these inputs were recorded can reuse their Astro keys
// when the checked-in renderer and dependency lock still match.
export function recoverRendererInputs(root, release) {
  try {
    const { sourceCommit } = JSON.parse(fs.readFileSync(path.join(release, 'build-info.json'), 'utf8'));
    if (!/^[a-f0-9]{40}$/.test(sourceCommit)) return null;
    return rendererInputs(file => {
      const shown = spawnSync('git', ['-C', root, 'show', sourceCommit + ':' + file], { encoding:'utf8', maxBuffer: 8 * 1024 * 1024 });
      if (shown.status !== 0) throw Error('Missing renderer input: ' + file);
      return shown.stdout;
    });
  } catch { return null; }
}
export function filesIn(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  // Directory transfers may leave in-flight rsync files beside real artifacts.
  return fs.readdirSync(dir, {withFileTypes:true}).filter(entry=>entry.name!=='.rsync-tmp').sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry => {
    const file = path.join(dir,entry.name);
    return entry.isDirectory() ? filesIn(file,base) : entry.isFile() ? [path.relative(base,file).split(path.sep).join('/')] : [];
  });
}
export function safeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\\:]/.test(relative) || relative.split('/').some(p=>p==='..' || p==='.') || path.isAbsolute(relative)) throw Error('Unsafe artifact path: '+relative);
  const file=path.resolve(root,relative);
  if (!path.relative(root,file) || path.relative(root,file).startsWith('..') || path.isAbsolute(path.relative(root,file))) throw Error('Artifact outside output: '+relative);
  return file;
}
export function readState(file) {
  try {
    const state=JSON.parse(fs.readFileSync(file,'utf8'));
    if (state.version!==STATE_VERSION || !state.inputs || !state.routes || !state.pages || !state.sitemap || !state.outputs || !state.outputs['index.html'] || !state.outputs['sitemap.xml']) return null;
    if(Object.values(state.outputs).some(value=>typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)))return null;
    for (const name of Object.keys(state.outputs)) safeFile(path.dirname(file),name);
    return state;
  } catch { return null; }
}
function artifactStamp(file) {
  const stat=fs.lstatSync(file,{bigint:true});
  if(!stat.isFile())throw Error('Expected a regular artifact: '+file);
  return [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
}
export function outputHashes(dir, known = new Map(), stamps = null) {
  const served=filesIn(dir).filter(name=>(!name.startsWith('data/') || name.startsWith(LEGACY_PREVIEW_DIR + '/'))
    && !name.startsWith('.build-') && name!=='build-info.json' && !/\.(gz|br)$/.test(name));
  return Object.fromEntries(served.map(name=>{
    const file=safeFile(dir,name);
    const digest=known.get(name) ?? hash(fs.readFileSync(file));
    if(stamps)stamps[name]=artifactStamp(file);
    return [name,digest];
  }));
}
export function inspectPrevious(dir, state) {
  if (!dir || !state) return {ok:false,reason:'missing-or-incompatible-baseline'};
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return {ok:false,reason:'missing-or-incompatible-baseline'};
  const invalid=[];
  let hashed=0, reused=0;
  for (const [relative,digest] of Object.entries(state.outputs)) {
    try {
      const file=safeFile(dir,relative);
      if (state.artifacts?.[relative]===artifactStamp(file)) {
        reused++;
        continue;
      }
      hashed++;
      if (hash(fs.readFileSync(file))!==digest) invalid.push({file:relative,reason:'baseline-artifact-changed:'+relative});
    } catch {
      invalid.push({file:relative,reason:'baseline-artifact-missing:'+relative});
    }
  }
  if (reused+hashed===0 && invalid.length===0) return {ok:false,reason:'missing-or-incompatible-baseline'};
  if (invalid.length===Object.keys(state.outputs).length) return {ok:false,reason:invalid[0].reason};
  return {ok:true,invalid,hashed,reused};
}
export function verifyPrevious(dir, state) {
  const result=inspectPrevious(dir,state);
  if(!result.ok)return result;
  return result.invalid.length ? {ok:false,reason:result.invalid[0].reason} : {ok:true};
}
export function excludeInvalidArtifacts(state, invalid) {
  for(const {file} of invalid || [])delete state?.outputs[file];
  return state;
}
export function buildInputs(root, previousAssets = {}, assetManifest = {}) {
  const sourceRoots=['frontend/src','frontend/public','frontend/scripts','tools'];
  const snapshotPath = process.env.SITE_SNAPSHOT || path.join(root, 'dist/site-data.json');
  const dist = path.dirname(path.resolve(snapshotPath));
  const codeFiles=sourceRoots.flatMap(dir=>filesIn(path.join(root,dir)).map(name=>dir+'/'+name)).filter(name=>!name.includes('/tests/') && !name.includes('/vendor/') && !name.includes('/__pycache__/') && /\.(astro|mjs|cjs|js|css|ts|tsx|json|py|svg|html|txt|ya?ml|sh)$/i.test(name));
  codeFiles.push('frontend/astro.config.mjs','frontend/package.json','frontend/package-lock.json','frontend/component-library.json');
  codeFiles.push('admin/src/lib/attribution.mjs','admin/src/lib/localization.mjs');
  const digests = new Map();
  const digestFile = name => {
    const file = name.startsWith('dist/') ? path.join(dist, name.slice(5)) : path.join(root, name);
    if (!digests.has(name)) digests.set(name, hash(fs.readFileSync(file)));
    return digests.get(name);
  };
  const digestFiles = names => hash([...new Set(names)].sort().map(name => [name, digestFile(name)]));
  const dataFiles=filesIn(path.join(root,'data')).map(name=>'data/'+name);
  const assets=filesIn(dist).filter(name=>!name.endsWith('.json') && !name.endsWith('.js')).map(name=>'dist/'+name);
  assets.push(...filesIn(path.join(root,'frontend/public')).filter(name=>!name.startsWith('vendor/')&&/\.(png|jpe?g|gif|webp|ico|ttf|woff2?)$/i.test(name)).map(name=>'frontend/public/'+name));
  for (const name of assets) {
    const file = name.startsWith('dist/') ? path.join(dist, name.slice(5)) : path.join(root, name);
    const stamp = artifactStamp(file);
    const prior = previousAssets[name];
    const digest = prior?.stamp === stamp && /^[a-f0-9]{64}$/.test(prior.digest) ? prior.digest : digestFile(name);
    assetManifest[name] = {stamp, digest};
    digests.set(name, digest);
  }
  const snapshot = hash(fs.readFileSync(snapshotPath));
  const localeSources = [
    'frontend/public/lang.js', 'frontend/scripts/site-locales.mjs',
    'frontend/scripts/localize-pages.mjs', 'frontend/scripts/localization-inputs.mjs',
    'frontend/scripts/native-content.mjs', 'frontend/scripts/native-archives.mjs',
    'frontend/src/lib/about-copy.mjs', 'frontend/src/lib/open-api-copy.mjs', 'frontend/src/lib/landing-copy.mjs',
    'frontend/src/lib/events.mjs', 'frontend/src/lib/video-archive.mjs', 'frontend/src/lib/video-copy.mjs', 'frontend/src/lib/video-terminology.mjs',
    'frontend/src/components/home/localize-home.mjs', 'frontend/public/components/image-alt.js', 'frontend/public/archive/work-format.js',
  ];
  const auditSources = ['tools/localization/audit-pages.mjs', 'frontend/src/lib/image-metadata.mjs', 'admin/src/lib/attribution.mjs', 'frontend/src/lib/video-archive.mjs'];
  const sitemapSources = ['frontend/scripts/sitemap-history.mjs', 'frontend/scripts/site-locales.mjs'];
  const dictionaries = codeFiles.filter(name => name.startsWith('frontend/public/lang/'));
  // Shared and otherwise unclassified build tooling invalidates conservatively.
  const otherStages = new Set([...localeSources, ...auditSources, ...sitemapSources, 'tools/localization/audit-summary.mjs']);
  const buildFiles = codeFiles.filter(name => !otherStages.has(name)
    && (name.startsWith('frontend/scripts/') || name.startsWith('tools/') || /^frontend\/[^/]+$/.test(name)));
  const fonts=[process.env.OG_FONT_BOLD,process.env.OG_FONT_REGULAR,'C:/Windows/Fonts/msyhbd.ttc','C:/Windows/Fonts/msyh.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc','/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc','/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'].filter(file=>file&&fs.existsSync(file)).map(file=>hash(fs.readFileSync(file)));
  const python=spawnSync(process.env.PYTHON||'python3',['-c','import sys, PIL; print(sys.version); print(PIL.__version__)'],{encoding:'utf8'});
  const pythonRuntime=python.status===0?python.stdout:'unavailable';
  const publicEnvironment=Object.entries(process.env).filter(([key])=>key.startsWith('PUBLIC_')).sort(([a],[b])=>a.localeCompare(b));
  const envFiles=['.env','.env.local','.env.production','.env.production.local'].flatMap(name=>[path.join(root,name),path.join(root,'frontend',name)]).filter(file=>fs.existsSync(file)).map(file=>hash(fs.readFileSync(file)));
  return {
    code: digestFiles(codeFiles),
    build: digestFiles(buildFiles),
    ...rendererInputs(name => fs.readFileSync(path.join(root, name), 'utf8')),
    localization: digestFiles(localeSources),
    dictionaries: digestFiles(dictionaries),
    assets: digestFiles(assets),
    og: digestFiles(['tools/og_cards.py', 'frontend/public/components/image-placeholder.svg']),
    localeExternal: digestFiles(dataFiles.filter(name=>name!=='data/works.json')),
    audit: digestFiles(auditSources),
    sitemap: digestFiles(sitemapSources),
    content: hash([digestFiles([...dataFiles, ...assets]), snapshot]),
    snapshot,
    runtime: hash([process.version,process.platform,process.env.NODE_ENV||'',Intl.DateTimeFormat().resolvedOptions().timeZone,process.env.SKIP_OG||'',process.env.PYTHON||'python3',pythonRuntime,fonts,publicEnvironment,envFiles]),
  };
}
export function makePlan(inputs, routes, previous, validation, force = false) {
  const reasons=[];
  if (force) reasons.push('explicit-full-rebuild');
  if (!validation.ok) reasons.push(validation.reason);
  if (previous && previous.inputs.runtime!==inputs.runtime) reasons.push('build-runtime-changed');
  const full=reasons.length>0;
  const astroChanged=Boolean(previous && previous.inputs.astro!==inputs.astro);
  const dependenciesCompatible=Boolean(previous && previous.inputs.dependencies===inputs.dependencies);
  const localizationCompatible=dependenciesCompatible && previous.inputs.localeHelpers===inputs.localeHelpers;
  if (!full) {
    if (validation.invalid?.length) reasons.push(...new Set(validation.invalid.map(({reason})=>reason.split(':')[0])));
    if (astroChanged) reasons.push('astro-toolchain-changed');
    if (previous.inputs.build !== inputs.build) reasons.push('build-scripts-changed');
    if (!localizationCompatible || previous.inputs.localization !== inputs.localization) reasons.push('localization-rules-changed');
    if (previous.inputs.audit !== inputs.audit) reasons.push('audit-rules-changed');
    if (previous.inputs.sitemap !== inputs.sitemap) reasons.push('sitemap-rules-changed');
    if (previous.inputs.code !== inputs.code && !reasons.length) reasons.push('astro-template-dependencies-changed');
  }
  const changed=Object.keys(routes).filter(route=>full || astroChanged || previous?.routes[route]!==routes[route]);
  const removed=Object.keys(previous?.routes||{}).filter(route=>!Object.hasOwn(routes,route));
  const dirty=new Set(changed);
  const reused=Object.keys(routes).filter(route=>!dirty.has(route));
  const noop=!full && !reasons.length && previous.inputs.code===inputs.code && previous.inputs.content===inputs.content && !changed.length && !removed.length;
  const astroKey=!full && !astroChanged ? previous.astroKey ?? previous.inputs.build : inputs.astro;
  return {
    version:STATE_VERSION,mode:full?'full':noop?'noop':'incremental',baselineVerified:validation.ok,force,reasons,changed,removed,reused,routes,inputs,astroKey,dependenciesCompatible,localizationCompatible,
    invalidArtifacts:validation.invalid||[], baselineChecks:{hashed:validation.hashed??0,reused:validation.reused??0},
  };
}
export function copyArtifact(from, to, relative) {
  const source=safeFile(from,relative), target=safeFile(to,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  // Only the release runner can opt in. These are finished artifacts and all
  // writes to the staged copy must replace its directory entry.
  if (process.env.SITE_REUSE_ARTIFACTS==='1') {
    const stat=fs.lstatSync(source);
    if (stat.isFile() && (stat.mode&0o777)===0o644) {
      if(fs.existsSync(target))fs.unlinkSync(target);
      try { fs.linkSync(source,target);return; }
      catch(error) { if(!['EXDEV','EPERM','EACCES','ENOTSUP','EMLINK'].includes(error.code)) throw error; }
    }
  }
  fs.copyFileSync(source,target,fs.constants.COPYFILE_FICLONE);
}
export function copyImmutableAsset(source, target, previousFile, verifiedDigest, sourceDigest) {
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if (process.env.SITE_REUSE_ASSETS==='1' && previousFile && /\.(png|jpe?g|gif|webp|ico|woff2?|ttf)$/i.test(target)) {
    try {
      const old=fs.lstatSync(previousFile), current=fs.statSync(source);
      if (old.isFile() && (old.mode&0o777)===0o644 && old.size===current.size && (source === previousFile
        || (verifiedDigest ?? hash(fs.readFileSync(previousFile)))===(sourceDigest ?? hash(fs.readFileSync(source))))) {
        if(fs.existsSync(target)) fs.unlinkSync(target);
        fs.linkSync(previousFile,target);return true;
      }
    } catch { /* A different filesystem or unavailable prior asset uses a normal copy. */ }
  }
  if(fs.existsSync(target))fs.unlinkSync(target);
  fs.copyFileSync(source,target,fs.constants.COPYFILE_FICLONE);return false;
}
export function writeOrReuse(out, relative, content, previousDir, previousState) {
  const target=safeFile(out,relative);
  if (previousDir && previousState?.outputs[relative]===hash(content)) {
    copyArtifact(previousDir,out,relative); return false;
  }
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if (fs.existsSync(target)) fs.unlinkSync(target);
  fs.writeFileSync(target,content);
  return true;
}
export function routeFile(pathname, route) {
  let name=decodeURI(pathname).replace(/^\//,'').replace(/\/$/,'');
  if (!name) return 'index.html';
  if (route.type!=='endpoint' && !name.endsWith('.html')) name+='.html';
  return name;
}
