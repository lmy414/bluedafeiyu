import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
// v2：作品地址页 = 作品列表 + 自动打开浮层。set:html 只允许用于结构化数据（JSON-LD）
const source=read('src/pages/works/[slug].astro');
if(source.includes('readLegacy'))throw new Error('作品页仍使用 readLegacy');
const setHtml=[...source.matchAll(/<[^>]+set:html=/g)].map(m=>m[0]);
if(setHtml.some(tag=>!tag.includes('application/ld+json')))throw new Error('作品页只允许在 JSON-LD 里用 set:html');
for(const need of ['data-open=','sticker-','seoTitle','seoDescription','ogCard('])if(!source.includes(need)&&!read('src/components/v2/Feed.astro').includes(need))throw new Error('作品页缺少 '+need);
for(const file of fs.readdirSync(path.join(root,'src/pages')).filter(x=>x.endsWith('.astro'))){
 const content=read('src/pages/'+file);
 if(content.includes('readLegacy'))throw new Error(`${file} 仍加载旧整页`);
}
for(const p of ['src/layouts/V2.astro','src/components/v2/V2Meta.astro','src/components/v2/Feed.astro','src/components/v2/MediaCard.astro','src/components/SiteFooter.astro','src/lib/v2.mjs','public/v2.js','public/v2.css']) if(!fs.existsSync(path.join(root,p))) throw new Error('Missing v2 file '+p);
// 浮层评论沿用原讨论串：sticker-<作品 id>
if(!read('public/v2.js').includes("'sticker-' + btn.getAttribute('data-comments')"))throw new Error('浮层评论没有按 sticker-<id> 映射');
console.log('v2 pages keep frozen work URLs, JSON-LD only via set:html, comments mapped to sticker-<id>');
