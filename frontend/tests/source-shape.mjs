import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'src/pages/works/[slug].astro'),'utf8');
for(const name of ['readLegacy','set:html']) if(source.includes(name)) throw new Error(`详情页仍使用 ${name}`);
for(const file of fs.readdirSync(path.join(root,'src/pages')).filter(x=>x.endsWith('.astro'))){
 const content=fs.readFileSync(path.join(root,'src/pages',file),'utf8');
 if(content.includes('readLegacy'))throw new Error(`${file} 仍加载旧整页`);
}
for(const p of ['src/layouts/Site.astro','src/components/SiteHeader.astro','src/components/SiteFooter.astro','src/components/WorkPrimary.astro','src/components/WorkRelated.astro']) if(!fs.existsSync(path.join(root,p))) throw new Error('Missing Astro component '+p);
console.log('All Astro pages avoid legacy whole HTML injection');
