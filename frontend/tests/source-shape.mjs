import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
// Data-driven pages share escaped local view components. Detail stays visible
// without JavaScript and the frozen conversation ID remains on the article.
const source=read('src/pages/works/[slug].astro');
if(source.includes('readLegacy'))throw new Error('作品页仍使用 readLegacy');
if(!source.includes('ArchivePage')||!source.includes('archivePages'))throw new Error('作品路由未使用共用页面组件');
const detail=read('src/components/archive/WorkPages.mjs');
for(const need of ['data-static-work','sticker-${esc(w.id)}','data-download-work','w.rights.creditText','w.rights.copyrightNotice'])if(!detail.includes(need))throw new Error('作品详情缺少 '+need);
for(const file of fs.readdirSync(path.join(root,'src/pages')).filter(x=>x.endsWith('.astro'))){
 const content=read('src/pages/'+file);
 if(content.includes('readLegacy'))throw new Error(`${file} 仍加载旧整页`);
}
for(const p of ['src/layouts/Archive.astro','src/components/archive/WorkCards.mjs','src/components/archive/Listing.mjs','src/components/archive/PreviewDialog.astro','public/archive/filter-select.js']) if(!fs.existsSync(path.join(root,p))) throw new Error('Missing shared component '+p);
// 浮层评论沿用原讨论串：sticker-<作品 id>
const app=read('public/archive/archive.js');
for(const script of ['archive.js','filter-select.js','work-card.js']){
 const result=spawnSync(process.execPath,['--check',path.join(root,'public/archive',script)],{encoding:'utf8'});
 if(result.status!==0)throw new Error('脚本语法错误：'+script+'\n'+result.stderr);
}
if(!app.includes("'term':'sticker-'+btn.dataset.comments"))throw new Error('评论没有按 sticker-<id> 映射');
if(app.includes('previewOnly')||app.includes('art-file'))throw new Error('DEMO 投稿处理器混入正式站');
if(!read('src/lib/archive.mjs').includes('overlayData()'))throw new Error('页面未使用权威数据');
if(!read('src/lib/archive-seo.mjs').includes('imageMetadata(workBySlug.get(w.slug)'))throw new Error('未复用正式版权元数据');
console.log('Archive components preserve authoritative data, static detail, analytics and frozen comment IDs');
