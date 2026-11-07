import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {localizeHtml,LOCALES,ORIGIN} from '../scripts/localize-pages.mjs';
import {imageMetadata} from '../src/lib/image-metadata.mjs';
import {createIndependentFriendPages} from '../src/components/archive/FriendWall.mjs';
const repo='https://github.com/HLgangban/gangban-artworks';
for (const license of [repo, ORIGIN+'/about.html#license-author-permission']) {
  for (const locale of LOCALES) test('license URL survives '+locale.id+' '+license,async()=>{
    const meta=imageMetadata({name:'Artwork',slug:'sample',displayUrl:'/image.webp',thumbUrl:'/thumb.webp',license:license===repo?{type:'author-permission',url:repo}:{type:'author-permission'}});
    const html='<html><head><title>Artwork</title><link rel="canonical" href="'+ORIGIN+'/works/sample.html"><script type="application/ld+json">'+JSON.stringify(meta)+'</script></head><body><main><h1>Artwork</h1></main></body></html>';
    const {document}=parseHTML(await localizeHtml(html,'/works/sample.html',locale,{works:[],characters:[]}));
    const result=JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
    assert.equal(result.license,license===repo?repo:ORIGIN+locale.prefix+'/about.html#license-author-permission');
    assert.equal(result.acquireLicensePage,license===repo?repo:ORIGIN+locale.prefix+'/about.html#licensing');
  });
}
test('author repository is rendered on independent friend link wall',()=>{
  const pages=new Map();
  createIndependentFriendPages({esc:s=>s,tr:(_key,zh)=>zh,pageHead:()=>'',icon:()=>'',write:(url,_title,_active,html)=>pages.set(url,html)});
  const {document}=parseHTML(pages.get('/friend-links.html'));
  const link=document.querySelector('a[href="'+repo+'"]');
  assert.ok(link);assert.ok(link.textContent.includes('@798145343h'));
});
