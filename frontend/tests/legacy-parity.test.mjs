import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const out=process.env.SITE_OUT_DIR ? path.resolve(process.env.SITE_OUT_DIR) : path.join(root,'.build/site');
const data=JSON.parse(fs.readFileSync(process.env.SITE_SNAPSHOT ? path.resolve(process.env.SITE_SNAPSHOT) : path.join(root,'dist/site-data.json'),'utf8'));
const html=rel=>fs.readFileSync(path.join(out,rel),'utf8');
test('all published work URLs and original root routes exist',()=>{
 for(const p of ['index.html','category.html','topics.html','about.html','submit.html','projects.html','changelog.html','404.html'])assert.ok(fs.existsSync(path.join(out,p)),p);
 const pages=fs.readdirSync(path.join(out,'works')).filter(p=>p.endsWith('.html'));
 assert.equal(pages.length,data.works.length);
 for(const work of data.works)assert.ok(pages.includes(`${work.slug}.html`),work.slug);
});
test('each active category has a static landing page and canonical',()=>{
 const categories=data.categories.filter(c=>c.status==='active');
 const files=fs.readdirSync(path.join(out,'categories')).filter(p=>p.endsWith('.html'));
 assert.equal(files.length,categories.length);
 for(const cat of categories){const doc=html(`categories/${cat.id}.html`);assert.ok(doc.includes(`categories/${cat.id}.html`));assert.ok(doc.includes('href="/works/'));}
});
test('public snapshot, assets and robots are present; private intake assets excluded',()=>{
 for(const rel of ['avatar.png','site-data.js','site-data.json','lang.js','robots.txt','page-styles/index.css','page-scripts/submit-0.js'])assert.ok(fs.existsSync(path.join(out,rel)),rel);
 assert.equal(fs.existsSync(path.join(out,'.github')),false);
 assert.equal(fs.existsSync(path.join(out,'submissions/originals')),false);
 // Local preview may mount blue-fish shared previews; deployment output omits them.
});
test('work detail metadata, commentary and conversation id remain tied to published slug',()=>{
 for(const work of data.works){const doc=html(`works/${work.slug}.html`);assert.ok(doc.includes(`/works/${work.slug}.html`));assert.ok(doc.includes(`sticker-${work.id}`));assert.ok(doc.includes('application/ld+json'));assert.ok(doc.includes(work.name));}
});
test('active topics produce static pages with a shared collection layout and original authors',()=>{
 const topics=data.topics||[];
 const topicDir=path.join(out,'topics');
 const pages=fs.existsSync(topicDir) ? fs.readdirSync(topicDir).filter(p=>p.endsWith('.html')).sort() : [];
 assert.deepEqual(pages,topics.map(t=>`${t.id}.html`).sort(),'专题页面必须与快照 ID 精确对应');
 // 无有效专题时不要求 topics/ 目录存在（getStaticPaths 为空，构建不会生成这一点）。
 if(!topics.length)return;
 for(const topic of topics){
  const doc=html(`topics/${topic.id}.html`);
  assert.ok(doc.includes('href="/works/'),`${topic.id} 应有作品入口`);
  assert.ok(doc.includes('work-grid'),`${topic.id} 应展示作品流`);
  if(topic.author){
   // 作者型专题：作者名、首选渠道 URL 与独立版式标记都要出现在页面上。
   // 快照里的 & 到了 HTML 属性 / 文本里会转义成 &amp;，两种都认。
   const seen=text=>doc.includes(text)||doc.includes(text.replace(/&/g,'&amp;'));
   assert.ok(seen(topic.author.name),`${topic.id} 应显示作者名`);
   assert.ok(seen(topic.author.channels[0].url),`${topic.id} 应显示首选渠道链接`);
   assert.ok(doc.includes('topic-author'),`${topic.id} 应使用作者版式`);
  }else{
   assert.ok(doc.includes('topic-hero'),`${topic.id} 应使用共用合集头部`);
   assert.ok(doc.includes('work-grid'),`${topic.id} 应使用共用作品卡片`);
   assert.ok(!doc.includes('topic-author'),`${topic.id} 不应出现作者版式标记`);
  }
 }
});
