import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {archivePages,archiveContext} from '../src/lib/archive.mjs';
import {buildInputs,readState,verifyPrevious,makePlan,filesIn,hash} from './incremental.mjs';
const [root,previousDir,stateFile,target,force]=process.argv.slice(2);
const previous=readState(stateFile);
const models=Object.fromEntries([...archivePages].map(([url,page])=>[url,page.cacheKey]));
const routes={};
const inputs=buildInputs(root);
inputs.workTotal=archiveContext.works.length;
for (const file of filesIn(path.join(root,'frontend/src/pages'))) {
  if(file.endsWith('.astro')) {
    const route='/'+file.replace(/\.astro$/,'.html');
    if(!route.includes('['))routes[route]=models[route]||hash(inputs);
    else {
      const pattern='^'+route.split('/').map(segment=>segment.startsWith('[')?segment.replace(/^\[[^\]]+\]/,'[^/]+'):segment.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'$';
      const regex=new RegExp(pattern);
      for(const [url,key] of Object.entries(models))if(regex.test(url))routes[url]=key;
    }
  } else if(file.endsWith('.js')) {
    const endpoint=await import(pathToFileURL(path.join(root,'frontend/src/pages',file)).href);
    const paths=endpoint.getStaticPaths ? await endpoint.getStaticPaths() : [{params:{}}];
    for(const item of paths) {
      const route='/'+file.slice(0,-3).replace(/\[([^\]]+)\]/g,(_,key)=>{
        if(item.params[key]===undefined) throw Error('Unknown endpoint parameter: '+file);
        return item.params[key];
      });
      routes[route]=hash(inputs);
    }
  }
}
const plan=makePlan(inputs,routes,previous,verifyPrevious(previousDir,previous),force==='true');
fs.writeFileSync(target,JSON.stringify(plan,null,2));
console.log(`[build-plan] ${plan.mode}: ${plan.changed.length} changed, ${plan.reused.length} reusable, ${plan.removed.length} removed${plan.reasons.length?'; '+plan.reasons.join(', '):''}`);
