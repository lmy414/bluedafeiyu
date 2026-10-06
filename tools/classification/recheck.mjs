import fs from 'node:fs';
import path from 'node:path';
import { piVision } from './pi-vision.mjs';
import { WORK_TYPE_RULES } from '../../admin/src/lib/work-types.mjs';
const run=path.resolve(process.argv[2]||'.build/classification-20261007');
const resultsFile=path.join(run,'results.json');
const results=JSON.parse(fs.readFileSync(resultsFile,'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(run,'manifest.json'),'utf8'));
const allowed=new Set(JSON.parse(fs.readFileSync('data/categories.json','utf8')).map(x=>x.id));
const rows=manifest.filter(x=>(results[x.id].confidence<.7||['comic','standing','setting','other'].includes(results[x.id].type))&&!results[x.id].individualReview&&!results[x.id].humanReviewed);
if(!fs.existsSync(path.join(run,'initial-results.json')))fs.copyFileSync(resultsFile,path.join(run,'initial-results.json'));
let cursor=0,done=0,changed=0;
console.log(JSON.stringify({individualReviews:rows.length}));
await Promise.all(Array.from({length:8},async()=>{
  while(cursor<rows.length){
    const row=rows[cursor++];let value;
    for(let attempt=0;attempt<3;attempt++){
      try {
        const result=await piVision('仅检查这一张图。先辨别它是否有两个及以上明确漫画分格或分镜。反应、对比、不同角色或并列笑点也可以构成漫画，不要求叙事、时间顺序或情节推进。三视图、结构拆解和普通拼贴不自动算漫画。有多格漫画分镜不能归梗图。没有明确梗/反应的普通人物归立绘或插画。严格根据实际画面判断，不参考标题。只输出 JSON {"id":"'+row.id+'","type":"一个类型 id","confidence":0.95,"reason":"具体画面依据"}。\n'+WORK_TYPE_RULES,[row.image]);
        fs.writeFileSync(path.join(run,'individual-'+row.id+'.json'),JSON.stringify(result,null,2));
        value=result.data;
        if(value.id!==row.id||!allowed.has(value.type)||typeof value.confidence!=='number'||value.confidence<0||value.confidence>1||typeof value.reason!=='string'||!value.reason.trim())throw Error('Invalid individual result');
        if(value.type!==results[row.id].type)changed++;
        results[row.id]={...results[row.id],...value,individualReview:true,model:result.model,provider:result.provider};
        fs.writeFileSync(resultsFile+'.tmp',JSON.stringify(results,null,2));fs.renameSync(resultsFile+'.tmp',resultsFile);
        console.log(JSON.stringify({done:++done,total:rows.length,changed}));break;
      }catch(error){console.log(JSON.stringify({id:row.id,attempt,error:error.message}));if(attempt===2)throw error;}
    }
  }
}));
