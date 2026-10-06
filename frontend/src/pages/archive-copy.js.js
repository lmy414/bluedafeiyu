import fs from 'node:fs';
import path from 'node:path';
const root=process.env.SITE_SOURCE || path.resolve(process.cwd(),'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
export function GET() {
  const data={...read('data/site-copy-localizations.json'),...read('tools/localization/terminology.json')};
  data.tags={};
  for(const work of read('dist/site-data.json').works)for(const [i,tag]of work.tags.entries())if(!data.tags[tag]&&work.i18n)data.tags[tag]={en:work.i18n.en.tags[i],ja:work.i18n.ja.tags[i]};
  for(const brand of ['蓝色大肥鱼','藍色大肥魚','Blue Fish'])data.texts[brand]={en:'DeepSeek Chan',ja:'DeepSeek Chan'};
  return new Response('window.ArchiveCopy='+JSON.stringify(data).replace(/</g,'\\u003c')+';', {headers:{'Content-Type':'application/javascript; charset=utf-8'}});
}
