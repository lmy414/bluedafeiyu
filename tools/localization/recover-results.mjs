import fs from 'node:fs';
import path from 'node:path';
import {sourceHash,sourceText,validateI18n} from './contract.mjs';
const snapshot=JSON.parse(fs.readFileSync('dist/site-data.json','utf8'));
const originals=new Map(snapshot.works.map(w=>[w.id,w]));
const output='.build/work-localizations.generated.json';
const aggregate=JSON.parse(fs.readFileSync(output,'utf8'));let recovered=0;
for(const dir of ['.build/localization-runs','.build/localization-runs-resume']) {
  if(!fs.existsSync(dir))continue;
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.output.json')).sort().reverse();
  for(const file of files) {
    try {
      const input=JSON.parse(fs.readFileSync(path.join(dir,file.replace('.output.json','.input.json')),'utf8'));
      const result=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
      for(const item of result.works||[]) {
        const original=originals.get(item.id),source=input.sources.find(w=>w.id===item.id);if(!original||!source||aggregate.works[item.id]?.sourceHash===sourceHash(original))continue;
        const {id,...facts}=source;if(JSON.stringify(facts)!==JSON.stringify(sourceText(original)))continue;
        try{aggregate.works[item.id]={sourceHash:sourceHash(original),...validateI18n({en:item.en,ja:item.ja},original)};recovered++;}catch{}
      }
    }catch{}
  }
}
fs.writeFileSync(output,JSON.stringify(aggregate,null,2)+'\n');
const missing=snapshot.works.filter(w=>aggregate.works[w.id]?.sourceHash!==sourceHash(w)).map(w=>w.id);
console.log(JSON.stringify({recovered,completed:Object.keys(aggregate.works).length,missing}));
const copyPath='data/site-copy-localizations.json',copy=JSON.parse(fs.readFileSync(copyPath,'utf8'));
let copyRecovered=0;
for(const file of fs.readdirSync('.build/localization-copy').filter(f=>/^batch-\d+\.json$/.test(f))){
  // These saved batches have already passed validation.
  const result=JSON.parse(fs.readFileSync(path.join('.build/localization-copy',file),'utf8'));
  for(const item of result.data.texts||[])if(!copy.texts[item.source]){copy.texts[item.source]={en:item.en,ja:item.ja};copyRecovered++;}
}
fs.writeFileSync(copyPath,JSON.stringify(copy,null,2)+'\n');console.log(JSON.stringify({copyRecovered,copyCompleted:Object.keys(copy.texts).length}));
