import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const STATE_VERSION = 1;
export const STATE_FILE = '.build-state.json';
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function filesIn(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry => {
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
    if (state.version!==STATE_VERSION || !state.inputs || !state.routes || !state.outputs || !state.outputs['index.html'] || !state.outputs['sitemap.xml']) return null;
    if(Object.values(state.outputs).some(value=>typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)))return null;
    for (const name of Object.keys(state.outputs)) safeFile(path.dirname(file),name);
    return state;
  } catch { return null; }
}
export function outputHashes(dir) {
  return Object.fromEntries(filesIn(dir).filter(name=>!name.startsWith('data/') && !name.startsWith('.build-') && name!=='build-info.json' && !/\.(gz|br)$/.test(name)).map(name=>[name,hash(fs.readFileSync(safeFile(dir,name)))]));
}
export function verifyPrevious(dir, state) {
  if (!dir || !state) return {ok:false,reason:'missing-or-incompatible-baseline'};
  for (const [relative,digest] of Object.entries(state.outputs)) {
    try { if (hash(fs.readFileSync(safeFile(dir,relative)))!==digest) return {ok:false,reason:'baseline-artifact-changed:'+relative}; }
    catch { return {ok:false,reason:'baseline-artifact-missing:'+relative}; }
  }
  return {ok:true};
}
export function buildInputs(root) {
  const sourceRoots=['frontend/src','frontend/public','frontend/scripts','tools'];
  const codeFiles=sourceRoots.flatMap(dir=>filesIn(path.join(root,dir)).map(name=>dir+'/'+name)).filter(name=>!name.includes('/tests/') && !name.includes('/vendor/') && !name.includes('/__pycache__/') && /\.(astro|mjs|cjs|js|css|ts|tsx|json|py|svg|html|txt|ya?ml|sh)$/i.test(name));
  codeFiles.push('frontend/astro.config.mjs','frontend/package.json','frontend/package-lock.json','frontend/component-library.json');
  codeFiles.push('admin/src/lib/attribution.mjs','admin/src/lib/localization.mjs');
  const digestFiles=names=>hash([...new Set(names)].sort().map(name=>[name,hash(fs.readFileSync(path.join(root,name)))]));
  const dataFiles=filesIn(path.join(root,'data')).map(name=>'data/'+name);
  const assets=filesIn(path.join(root,'dist')).filter(name=>!name.endsWith('.json') && !name.endsWith('.js')).map(name=>'dist/'+name);
  assets.push(...filesIn(path.join(root,'frontend/public')).filter(name=>name.startsWith('vendor/')||/\.(png|jpe?g|gif|webp|ico|ttf|woff2?)$/i.test(name)).map(name=>'frontend/public/'+name));
  const snapshot=process.env.SITE_SNAPSHOT?hash(fs.readFileSync(process.env.SITE_SNAPSHOT)):'';
  const buildFiles=codeFiles.filter(name=>!name.startsWith('frontend/src/')&&!name.startsWith('admin/src/'));
  buildFiles.push('data/site-copy-localizations.json');
  const fonts=[process.env.OG_FONT_BOLD,process.env.OG_FONT_REGULAR,'C:/Windows/Fonts/msyhbd.ttc','C:/Windows/Fonts/msyh.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc','/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc','/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'].filter(file=>file&&fs.existsSync(file)).map(file=>hash(fs.readFileSync(file)));
  const python=spawnSync(process.env.PYTHON||'python3',['-c','import sys, PIL; print(sys.version); print(PIL.__version__)'],{encoding:'utf8'});
  const pythonRuntime=python.status===0?python.stdout:'unavailable';
  const publicEnvironment=Object.entries(process.env).filter(([key])=>key.startsWith('PUBLIC_')).sort(([a],[b])=>a.localeCompare(b));
  const envFiles=['.env','.env.local','.env.production','.env.production.local'].flatMap(name=>[path.join(root,name),path.join(root,'frontend',name)]).filter(file=>fs.existsSync(file)).map(file=>hash(fs.readFileSync(file)));
  return {code:digestFiles(codeFiles),build:digestFiles(buildFiles),content:hash([digestFiles([...dataFiles,...assets]),snapshot]),runtime:hash([process.version,process.platform,process.env.NODE_ENV||'',Intl.DateTimeFormat().resolvedOptions().timeZone,process.env.SKIP_OG||'',process.env.PYTHON||'python3',pythonRuntime,fonts,publicEnvironment,envFiles])};
}
export function makePlan(inputs, routes, previous, validation, force = false) {
  const reasons=[];
  if (force) reasons.push('explicit-full-rebuild');
  if (!validation.ok) reasons.push(validation.reason);
  if (previous && previous.inputs.build!==inputs.build) reasons.push('shared-assets-or-toolchain-changed');
  if (previous && previous.inputs.runtime!==inputs.runtime) reasons.push('build-runtime-changed');
  const full=reasons.length>0;
  if(!full && previous.inputs.code!==inputs.code) reasons.push('astro-template-dependencies-changed');
  const changed=Object.keys(routes).filter(route=>full || previous?.routes[route]!==routes[route]);
  const removed=Object.keys(previous?.routes||{}).filter(route=>!(route in routes));
  const reused=Object.keys(routes).filter(route=>!changed.includes(route));
  const noop=!full && previous.inputs.code===inputs.code && previous.inputs.content===inputs.content && previous.inputs.workTotal===inputs.workTotal && !changed.length && !removed.length;
  const sharedChanges=previous && previous.inputs.workTotal!==inputs.workTotal ? ['navigation.workTotal'] : [];
  return {version:STATE_VERSION,mode:full?'full':noop?'noop':'incremental',reasons,changed,removed,reused,routes,inputs,sharedChanges};
}
export function copyArtifact(from, to, relative) {
  const source=safeFile(from,relative), target=safeFile(to,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  // Copy-on-write where supported; never share writable hard links with a release.
  fs.copyFileSync(source,target,fs.constants.COPYFILE_FICLONE);
}
export function copyImmutableAsset(source, target, previousFile) {
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if (process.env.SITE_REUSE_ASSETS==='1' && previousFile && /\.(png|jpe?g|gif|webp|ico|woff2?|ttf)$/i.test(target)) {
    try {
      const old=fs.lstatSync(previousFile), current=fs.statSync(source);
      if (old.isFile() && (old.mode&0o777)===0o644 && old.size===current.size && hash(fs.readFileSync(previousFile))===hash(fs.readFileSync(source))) {
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
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);return true;
}
export function routeFile(pathname, route) {
  let name=decodeURI(pathname).replace(/^\//,'').replace(/\/$/,'');
  if (!name) return 'index.html';
  if (route.type!=='endpoint' && !name.endsWith('.html')) name+='.html';
  return name;
}
