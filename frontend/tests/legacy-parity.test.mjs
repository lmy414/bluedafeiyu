import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const out=process.env.SITE_OUT_DIR ? path.resolve(process.env.SITE_OUT_DIR) : path.join(root,'.build/site');
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/site-data.json'),'utf8'));
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
test('topic list is empty without producing empty topic pages',()=>{
 assert.equal((data.topics||[]).length,0);
 assert.equal(fs.existsSync(path.join(out,'topics')),false);
});
