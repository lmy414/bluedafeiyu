import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseHTML} from 'linkedom';
import {isGifWork} from '../public/archive/work-format.js';
import {localizeHtml,LOCALES,ORIGIN,localizedPath} from '../scripts/localize-pages.mjs';

test('GIF grouping reads original metadata or URL and ignores preview extensions and query strings',()=>{
  for(const work of [{format:'gif'},{f:'GIF'},{mimeType:'image/gif'},{mimeType:'image/gif; charset=binary'},{path:'https://example.test/image.GIF?raw=1'},{o:'/originals/动画%2Egif'},{originalUrl:'https://example.test/original.gif#frame'}])assert.equal(isGifWork(work),true,JSON.stringify(work));
  for(const work of [{format:'WEBP',thumbnailPath:'preview.gif',path:'original.webp'},{o:'/image.png?file=animation.gif'},{format:'APNG',isAnimated:true},{o:'/image.webp',isAnimated:true},{}])assert.equal(isGifWork(work),false,JSON.stringify(work));
});

test('GIF grouping preserves the single work type and localizes route metadata, including pagination',async()=>{
  const works=[{id:'gif',format:'GIF',categoryIds:['meme']},{id:'png',format:'PNG',categoryIds:['illustration']}];
  const snapshot={works,characters:[],categories:[],topics:[]};
  const before=structuredClone(works);
  for(const base of ['/gifs.html','/gifs/page/2.html'])for(const locale of LOCALES.filter(l=>['en','ja'].includes(l.id))){
    const html='<html><head><title>GIF 动图</title><link rel="canonical" href="'+ORIGIN+base+'"><meta name="description" content="GIF 作品"></head><body data-archive><main><nav class="breadcrumbs"><a href="/gifs.html">AI 娘 GIF 动图</a><span>第 2 页</span></nav><header class="page-head"><h1>GIF 动图</h1><p class="lede">GIF 作品</p></header></main></body></html>';
    const {document}=parseHTML(await localizeHtml(html,base,locale,snapshot));
    assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'),ORIGIN+localizedPath(base,locale));
    assert.ok(document.title.includes('GIF'));
    assert.ok(document.querySelector('meta[name="description"]').getAttribute('content').includes('1'));
    assert.doesNotMatch(document.querySelector('main').textContent,/动图|第 2 页|作品$/);
  }
  assert.deepEqual(works,before);
});

test('all image tabs link to GIFs, and the static GIF archive contains exactly the GIF originals',()=>{
  const out=process.env.SITE_OUT_DIR||path.resolve(import.meta.dirname,'../../.build/site');
  const catalog=JSON.parse(fs.readFileSync(path.join(out,'archive-data.json'),'utf8'));
  const gifs=catalog.works.filter(isGifWork);
  assert.ok(gifs.length>0);
  for(const locale of LOCALES){
    const read=route=>parseHTML(fs.readFileSync(path.join(out,localizedPath(route,locale).slice(1)),'utf8')).document;
    const page=read('/gifs.html');
    assert.equal(page.querySelector('.gallery-tabs [aria-current="page"]').getAttribute('href'),localizedPath('/gifs.html',locale));
    const slugs=JSON.parse(page.querySelector('#results').dataset.list);
    assert.deepEqual(slugs,gifs.map(w=>w.slug));
    assert.equal(page.querySelector('body').dataset.type,undefined);
    assert.ok(page.querySelector('select[name="type"] option[value="meme"]'));
    for(const route of ['/browse.html','/characters.html','/topics.html'])assert.ok(read(route).querySelector(`.gallery-tabs a[href="${localizedPath('/gifs.html',locale)}"]`));
    const schema=[...page.querySelectorAll('script[type="application/ld+json"]')].map(s=>JSON.parse(s.textContent)).find(s=>s['@type']==='CollectionPage');
    assert.equal(schema.mainEntity.itemListElement.length,Math.min(24,gifs.length));
  }
});
