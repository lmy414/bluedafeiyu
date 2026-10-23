import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const frontend=path.join(root,'frontend');
const lockBytes=fs.readFileSync(path.join(frontend,'package-lock.json'));
const lock=JSON.parse(lockBytes);
const key=crypto.createHash('sha256').update(lockBytes).update(JSON.stringify([process.version,process.platform,process.arch])).digest('hex');
const stamp=path.join(root,'.build/frontend-dependencies.json');
const installed=()=>Object.keys({...lock.packages[''].dependencies,...lock.packages[''].devDependencies}).every(name=>{
 try{return JSON.parse(fs.readFileSync(path.join(frontend,'node_modules',name,'package.json'),'utf8')).version===lock.packages['node_modules/'+name]?.version;}catch{return false;}
});
let saved;try{saved=JSON.parse(fs.readFileSync(stamp,'utf8'));}catch{}
if(saved?.key===key&&installed())console.log('[frontend-dependencies] locked toolchain unchanged; installation reused');
else {
 const options=['ci','--prefix',frontend,'--include=dev','--no-audit','--no-fund'];
 let command='npm',argv=options;
 if(process.platform==='win32') {
   const npmScript=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
   if(!fs.existsSync(npmScript))throw Error('npm-cli.js must be installed beside the current Node runtime');
   command=process.execPath;argv=[npmScript,...options];
 }
 const result=spawnSync(command,argv,{stdio:'inherit',windowsHide:true});
 if(result.error||result.status!==0)throw Error('Locked frontend dependency install failed');
 if(!installed())throw Error('Installed frontend dependencies do not match the lock file');
 fs.mkdirSync(path.dirname(stamp),{recursive:true});fs.writeFileSync(stamp,JSON.stringify({key}));
 console.log('[frontend-dependencies] locked toolchain installed and verified');
}
