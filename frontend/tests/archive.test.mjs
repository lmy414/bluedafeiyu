import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
const root=path.resolve(import.meta.dirname,'../..');
const out=process.env.SITE_OUT_DIR||path.join(root,'.build/site');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'dist/site-data.json'),'utf8'));
const read=file=>parseHTML(fs.readFileSync(path.join(out,file),'utf8')).document;
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(dir===out&&['en','ja','zh-hant'].includes(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.html'))files.push(path.relative(out,file));}}
walk(out);

test('submission initializes after deferred language and character data in all locales',()=>{
 for(const prefix of ['', 'en/', 'ja/', 'zh-hant/']){
  const file=prefix+'submit.html', doc=read(file);
  const scripts=[...doc.querySelectorAll('script[src]')];
  const language=scripts.findIndex(s=>s.getAttribute('src').startsWith('/lang.js'));
  const data=scripts.findIndex(s=>s.getAttribute('src')==='/site-data.js');
  const form=scripts.findIndex(s=>s.getAttribute('src').startsWith('/page-scripts/submit-0.js'));
  assert.ok(language>=0&&data>language&&form>data, file+' dependency order');
  for(const index of [language,data,form])assert.ok(scripts[index].hasAttribute('defer'),file+' must defer dependent scripts');
 }
});

test('all archive pages render one H1, production SEO and reachable local links/images',()=>{
 let pages=0, links=0;
 for(const file of files){
  const doc=read(file);if(!doc.querySelector('body[data-archive]'))continue;pages++;
  assert.equal(doc.querySelectorAll('main h1').length,1,file);
  assert.ok(!doc.querySelector('main').textContent.includes('DEMO'),file);
  assert.match(doc.querySelector('link[rel="canonical"]').getAttribute('href'),/^https:\/\/xn--pssy23gqgbz2d718b\.com\//,file);
  assert.ok(!doc.querySelector('meta[name="robots"]').getAttribute('content').includes('nofollow'),file);
  for(const el of doc.querySelectorAll('a[href],img[src],script[src],link[rel="stylesheet"]')){
   const value=el.getAttribute(el.tagName==='IMG'||el.tagName==='SCRIPT'?'src':'href');
   if(!value||!value.startsWith('/')||value.startsWith('//'))continue;
   const url=new URL(value,'https://xn--pssy23gqgbz2d718b.com');
   const pathname=decodeURIComponent(url.pathname);
   const target=pathname.startsWith('/data/blue-fish/')?path.join(root,'dist',pathname):path.join(out,pathname==='/'?'index.html':pathname);
   assert.ok(fs.existsSync(target),`${file}: ${value}`);links++;
  }
 }
 assert.ok(pages>snapshot.works.length);assert.ok(links>10000);
});

test('lists share one filter bar and a crawlable load-more chain',()=>{
 const all=read('browse.html');
 assert.equal(all.querySelectorAll('#filter-form').length,1);
 assert.equal(all.querySelectorAll('#results .work-card').length,24);
 assert.ok(all.querySelector('noscript a[href="/page/2.html"]'));
 for(const file of ['page/2.html','characters/deepseek/page/3.html','topics/maojing/page/2.html']){
  const doc=read(file);
  assert.equal(doc.querySelectorAll('#results .work-card').length,24,file);
  assert.ok(doc.querySelector('noscript [data-next]'),file);
  assert.equal(doc.querySelector('meta[name="robots"]').getAttribute('content'),'noindex,follow',file);
  for(const nav of doc.querySelectorAll('nav.pagination'))assert.ok(nav.closest('noscript'),file);
 }
 const vendor=read('characters/deepseek.html').querySelector('.model-vendor');
 assert.ok(vendor.textContent.includes('深度求索'));
 assert.match(vendor.querySelector('a').getAttribute('href'),/^https:/);
});

test('all works keep static detail, live analytics IDs and comment threads',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(out,'archive-data.json'),'utf8'));
 assert.deepEqual(new Set(data.works.map(w=>w.id)),new Set(snapshot.works.map(w=>w.id)));
 assert.ok(data.works.every(w=>!Object.hasOwn(w,'stats')),'No frozen demo statistics');
 for(const work of snapshot.works){
  const doc=read(`works/${work.slug}.html`);
  assert.equal(doc.querySelector('[data-static-work]').getAttribute('data-comment-term'),'sticker-'+work.id);
  assert.equal(doc.querySelector('[data-download-work]').getAttribute('data-download-work'),work.id);
  assert.equal(doc.querySelector('[data-comments]').getAttribute('data-comments'),work.id);
  assert.equal(doc.querySelector('body').getAttribute('data-work-id'),work.id);
 }
});
