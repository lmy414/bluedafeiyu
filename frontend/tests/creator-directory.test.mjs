import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {archiveDate,archiveCreators,creatorDirectoryEntries} from '../src/lib/creators.mjs';
import {createPrimitives} from '../src/components/archive/primitives.mjs';
import {createCreatorViews} from '../src/components/archive/CreatorViews.mjs';
import {compareCreatorRows,installCreatorRails} from '../public/components/creator-directory.js';

test('directory groups only explicitly authored serial pages into one cover and leaves archive inputs intact',()=>{
  assert.equal(archiveDate('2026-11-02T18:00:00.509Z'),'2026-11-02T18:00:00.509Z');
  assert.equal(archiveDate('2026.11.02'),'2026-11-02');
  const image=id=>({id,slug:id,n:id,i:'/preview.webp',w:150,h:200,dt:'2026.11.01'});
  const pages=['cover','page-1','page-2'].map(image);
  const topic={id:'serial',name:'Serial title',updatedAt:'2026-11-02',reader:{},cover:pages[0],list:pages,author:{name:'ADK',channels:[{platform:'Art',url:'https://example.com/artist'}]}};
  const creators=archiveCreators([topic],{creators:[],videos:[]});
  const before=structuredClone(creators);
  const [entry]=creatorDirectoryEntries(creators,[topic]);
  assert.deepEqual(creators,before);
  assert.equal(entry.total,1);assert.equal(entry.serialCount,1);assert.equal(entry.images.length,0);
  assert.equal(entry.media.length,1);assert.equal(entry.media[0].item.id,'cover');
  const ctx={...createPrimitives({translations:{en:{},ja:{}},modelVendors:{}}),write:()=>{},card:()=>'',videoCard:()=>''};
  const {creatorDirectory}=createCreatorViews(ctx,creators);
  const {document}=parseHTML(creatorDirectory([entry]));
  assert.equal(document.querySelectorAll('.creator-directory-preview').length,1);
  assert.equal(document.querySelector('[data-creator-series]').getAttribute('href'),'/topics/serial.html');
  assert.match(document.querySelector('.creator-directory-counts strong').textContent,/1 部连载/);
  assert.equal(document.querySelector('[data-creator-series]').getAttribute('target'),'_blank');
  const many={...entry,serialCount:0,media:Array.from({length:12},(_,i)=>({kind:'image',item:image('art-'+i),date:'2026-11-02T18:00:00Z'}))};
  const limited=parseHTML(creatorDirectory([many])).document;
  assert.equal(limited.querySelectorAll('.creator-directory-preview').length,8);
  assert.equal(limited.querySelector('.creator-directory-preview time').textContent,'2026-11-03');
});

test('creator sorting supports update date, count and name with deterministic ties',()=>{
  const rows=[{dataset:{name:'A',latest:'2026-11-01',total:'3'}},{dataset:{name:'C',latest:'2026-11-03',total:'2'}},{dataset:{name:'B',latest:'2026-11-02',total:'5'}}];
  const sorted=sort=>[...rows].sort((a,b)=>compareCreatorRows(a,b,sort)).map(r=>r.dataset.name);
  assert.deepEqual(sorted('latest'),['C','B','A']);assert.deepEqual(sorted('count'),['B','A','C']);assert.deepEqual(sorted('name'),['A','B','C']);
});

test('horizontal rails consume wheel movement only while they can scroll and preserve zoom and page scrolling',()=>{
  let handler;
  const rail={scrollLeft:0,clientWidth:600,scrollWidth:1200,addEventListener:(_event,fn)=>{handler=fn;}};
  installCreatorRails({querySelectorAll:()=>[rail]});
  let prevented=0;
  const wheel=(extra={})=>handler({deltaY:100,deltaX:0,deltaMode:0,preventDefault:()=>prevented++,...extra});
  wheel();assert.equal(rail.scrollLeft,100);assert.equal(prevented,1);
  wheel({ctrlKey:true});assert.equal(rail.scrollLeft,100);
  wheel({shiftKey:true});assert.equal(rail.scrollLeft,100);
  rail.scrollLeft=600;wheel();assert.equal(prevented,1);
  wheel({deltaY:-100});assert.equal(rail.scrollLeft,500);assert.equal(prevented,2);
});
