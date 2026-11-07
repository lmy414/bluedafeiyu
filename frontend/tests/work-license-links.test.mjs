import {workLicenseURL,imageMetadata} from '../src/lib/image-metadata.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createWorkPages} from '../src/components/archive/WorkPages.mjs';

const repository='https://github.com/HLgangban/gangban-artworks';
function render(url) {
  let html;
  const w={id:'test',slug:'test',n:'作品',c:'角色',cid:'other',roles:[],k:[],tg:[],l:'/image.webp',o:'/image.png',f:'PNG',s:'1 KB',w:100,h:100,d:'说明',dt:'2026-11-07',a:'@798145343h',lk:'permission',lt:'许可',rights:{creator:'@798145343h',creditName:'@798145343h',creditText:'图片署名：@798145343h',copyrightNotice:'版权归原作者所有',type:'permission'}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  createWorkPages({works:[w],types:[],topics:[],snapshot:{works:[{id:'test',license:{url}}]},esc,tr:(_k,zh)=>zh,old:(_k,zh)=>zh,icon:()=>'',tagLink:()=>'',workHref:()=>'/works/test.html',grid:()=>'',sectionHead:()=>'',collectionCard:()=>'',breadcrumbs:()=>'',write:(_path,_name,_active,body)=>{html=body();}});
  return parseHTML(html).document;
}

test('explicit repository permission links both the license and copyright notice',()=>{
  const doc=render(repository), links=[...doc.querySelectorAll('.source-note a')];
  assert.equal(links.length,2);
  for(const link of links){assert.equal(link.href,repository);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');}
  assert.equal(doc.querySelector('[data-copyright]').parentElement.href,repository);
});

test('absent or unsafe license URLs retain the original copyright and site-license link',()=>{
  for(const value of [undefined,null,'','javascript:alert(1)','data:text/html,test','//example.com','https://','https://user:pass@example.com','https://example.com/ bad','https:\\example.com']){
    assert.equal(workLicenseURL(value),'');
    const doc=render(value),links=[...doc.querySelectorAll('.source-note a')];
    assert.equal(links.length,1);assert.equal(links[0].href,'/about.html#license');
    assert.equal(doc.querySelector('[data-copyright]').parentElement.tagName,'P');
  }
});

test('valid HTTP(S) license URLs are escaped in generated attributes',()=>{
  assert.equal(workLicenseURL('http://example.com/terms'),'http://example.com/terms');
  const doc=render('https://example.com/terms?x=1&y=%22');
  assert.equal(doc.querySelector('.source-note a').href,'https://example.com/terms?x=1&y=%22');
  assert.equal(doc.querySelector('[onclick]'),null);
});

test('ImageObject license fields use the same validated source URL without inventing a license type',()=>{
  const work={name:'作品',slug:'test',displayUrl:'/image.webp',thumbUrl:'/thumb.webp',origin:{author:'@798145343h'},license:{url:repository}};
  const meta=imageMetadata(work);
  assert.equal(meta.license,repository);assert.equal(meta.acquireLicensePage,repository);
  assert.equal(meta.creator.name,'@798145343h');assert.match(meta.copyrightNotice,/@798145343h/);
  const unsafe=imageMetadata({...work,license:{url:'javascript:alert(1)'}});
  assert.match(unsafe.license,/about\.html#license-unknown$/);assert.match(unsafe.acquireLicensePage,/about\.html#licensing$/);
});
