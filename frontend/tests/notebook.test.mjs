import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {selectHomeRanking,HOME_RANKING_COUNT} from '../public/components/home-rankings.js';
import {renderPreviewMetadata} from '../public/components/preview-metadata.js';
import {createIndependentFriendPages} from '../src/components/archive/FriendWall.mjs';
import {friendLinks} from '../src/lib/friend-links.mjs';
import {localizeHtml,LOCALES} from '../scripts/localize-pages.mjs';

test('home view and download rankings use only actual metrics and retain deterministic ties',()=>{
  const works=Array.from({length:20},(_,i)=>({id:'id-'+i,slug:'work-'+i,at:i}));
  const snapshot={available:true,works:Object.fromEntries(works.slice(0,18).map((w,i)=>[w.id,{views:i,downloads:20-i}]))};
  snapshot.works['id-18']={views:-1,downloads:NaN};
  snapshot.works['id-19']={views:'99',downloads:null};
  const before=JSON.stringify(works);
  assert.equal(HOME_RANKING_COUNT,12);
  assert.deepEqual(selectHomeRanking(works,snapshot,'popular').map(w=>w.id),works.slice(6,18).reverse().map(w=>w.id));
  assert.deepEqual(selectHomeRanking(works,snapshot,'downloads').map(w=>w.id),works.slice(0,12).map(w=>w.id));
  assert.deepEqual(selectHomeRanking(works,{...snapshot,available:false},'popular'),[]);
  assert.deepEqual(selectHomeRanking(works,{available:true,works:{}},'downloads'),[]);
  assert.deepEqual(selectHomeRanking(works,{available:true,works:{'id-1':{views:0}}},'popular'),[]);
  assert.equal(JSON.stringify(works),before);
});

test('preview preserves original attribution, safe source URLs, true zero and unavailable statistics',()=>{
  const work={id:'stable-id',description:'Full description',createdAt:'2026-11-05T12:00:00Z',updatedAt:'2026-11-05T13:00:00Z',author:{name:'原作者'},attribution:{name:'投稿者',url:'javascript:alert(1)'},source:{url:'https://example.com/original'},image:{width:200,height:300},license:{copyrightNotice:'Original rights',note:'Attribution required',url:'https://example.com/license'},i18n:{en:{description:'Native description',licenseNote:'Native license note'}}};
  const options={translate:(_key,fallback,vars)=>fallback.replace(/\{(\w+)\}/g,(_,name)=>vars?.[name]??''),names:value=>String(value).replace('原作者','不得改作者'),language:'en',url:value=>'/en'+value};
  const {document}=parseHTML(renderPreviewMetadata(work,{available:true,syncedAt:'2026-11-05T14:00:00Z',works:{'stable-id':{views:7,downloads:0}}},options));
  const value=key=>document.querySelector(`[data-preview-field="${key}"] dd`).textContent;
  assert.equal(value('id'),'stable-id');assert.equal(value('author'),'原作者');assert.equal(value('credit'),'投稿者');
  assert.equal(value('views'),'7');assert.equal(value('downloads'),'0');
  assert.match(value('created'),/2026-11-05 12:00:00 UTC/);
  assert.equal(document.querySelector('[data-preview-field="credit"] a'),null);
  assert.equal(document.querySelector('[data-preview-field="source"] a').href,work.source.url);
  assert.equal(document.querySelector('.preview-complete-description').textContent,'Native description');
  assert.equal(value('license'),'Native license note');
  for(const snapshot of [null,{available:false},{available:true,works:{}}]){
    const doc=parseHTML(renderPreviewMetadata(work,snapshot,options)).document;
    for(const field of ['views','downloads'])assert.equal(doc.querySelector(`[data-preview-field="${field}"] dd`).textContent,'统计不可用');
  }
  const unsafe=parseHTML(renderPreviewMetadata({...work,description:'<img onerror="bad">',author:{name:'<script>bad</script>'}},null,options)).document;
  assert.equal(unsafe.querySelector('script,img'),null);
});

test('community projects and friend links have separate localized pages and unchanged external destinations',async()=>{
  const pages=[];
  createIndependentFriendPages({esc:value=>String(value),tr:(_key,zh)=>zh,pageHead:(_eyebrow,title,lead)=>`<header class="page-head"><h1>${title}</h1><p class="lede">${lead}</p></header>`,icon:()=>'',write:(...args)=>pages.push(args)});
  assert.deepEqual(pages.map(p=>p[0]),['/community-projects.html','/friend-links.html']);
  for(const [route,,active,content,options] of pages){
    const category=route.includes('community-')?'project':'website';
    const expected=friendLinks.filter(row=>row.category===category).map(row=>row.url);
    for(const locale of LOCALES){
      const doc=parseHTML(await localizeHtml(`<html><head><title>Page</title><link rel="canonical" href="https://xn--pssy23gqgbz2d718b.com${route}"><meta name="description"></head><body data-archive data-i18n-page="${active}" ${options.attrs}><main>${content}</main></body></html>`,route,locale,{works:[],characters:[],topics:[]})).document;
      assert.deepEqual([...doc.querySelectorAll('.friend-wall-card')].map(a=>a.href),expected);
      assert.equal(doc.querySelectorAll('[data-friend-section]').length,1);
      assert.equal(doc.querySelector('.friend-wall-tabs'),null);
      assert.ok(doc.title.length>10);
      if(locale.id==='en')assert.match(doc.title,route.includes('community-')?/Community projects/:/Friend links/);
    }
  }
});
