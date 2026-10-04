import test from 'node:test';
import assert from 'node:assert/strict';
import { zip, unzipSync } from 'fflate';
import { topicMembers, downloadMembers, zipMembers, entryName, DownloadLimitError, MAX_IMAGE_BYTES, MAX_ZIP_BYTES } from '../public/archive/topic-zip.js';
import { copyImage } from '../public/archive/image-copy.js';
import { createCollectionCards } from '../src/components/archive/CollectionCards.mjs';
import { parseHTML } from 'linkedom';

const work = i => ({ id: 'stable_'+i, slug: 'work-'+i, n: '同名:/图片', c: '猫鲸', o: `https://example.test/original-${i}.${i%2?'gif':'png'}`, f: i%2?'GIF':'PNG', bytes: 3 });
const bytes = i => new Uint8Array([i, 37, 255]);
const response = value => new Response(value, { headers: { 'Content-Type':'image/png' } });

test('optional homepage topic card keeps download button separate from its navigation link',()=>{
 const {collectionCard}=createCollectionCards({esc:String,old:(_key,text)=>text,icon:()=>'',tr:(_key,text)=>text});
 const topic={id:'x',name:'合集',summary:'介绍',list:[{i:'/image.png',w:10,h:10}]};
 const ordinary=parseHTML(collectionCard(topic)).document;
 assert.equal(ordinary.querySelectorAll('[data-download-topic]').length,0);
 const home=parseHTML(collectionCard(topic,{download:true})).document;
 assert.equal(home.querySelector('[data-download-topic]').dataset.downloadTopic,'x');
 assert.ok(home.querySelector('a[href="/topics/x.html"]'));
 assert.ok(!home.querySelector('a button'));
});

test('topic ZIP includes all 65 ordered public members and preserves original bytes/formats',async()=>{
 const works=Array.from({length:65},(_,i)=>work(i));
 const data={works:[...works,work(99)],topics:[{id:'maojing',slugs:works.map(w=>w.slug)}]};
 const members=topicMembers(data,'maojing');
 assert.deepEqual(members.works,works);
 const calls=[];
 let active=0,peak=0;
 const result=await downloadMembers(members.works,{signal:new AbortController().signal,fetchImpl:async url=>{
  calls.push(url);peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,1));active--;
  return response(bytes(Number(/original-(\d+)/.exec(url)[1])));
 }});
 assert.equal(peak,3);assert.equal(result.failed.length,0);assert.equal(calls.length,65);
 const unpacked=unzipSync(await zipMembers(works,result.files,zip));
 assert.equal(Object.keys(unpacked).length,65);
 works.forEach((w,i)=>assert.deepEqual(unpacked[entryName(w,i)],bytes(i)));
 assert.ok(Object.keys(unpacked)[1].endsWith('.gif'));
 assert.equal(new Set(Object.keys(unpacked)).size,65);
 assert.ok(Object.keys(unpacked).every(name=>!name.includes('/')&&!name.includes(':')));
});

test('failed originals can retry without downloading successful originals again',async()=>{
 const works=[work(0),work(1)];const calls=[];let fail=true;
 const fetchImpl=async url=>{calls.push(url);return url===works[1].o&&fail?new Response('missing',{status:404}):response(bytes(1));};
 const first=await downloadMembers(works,{signal:new AbortController().signal,fetchImpl});
 assert.deepEqual(first.failed,[works[1]]);assert.equal(first.files.size,1);
 fail=false;
 const second=await downloadMembers(works,{signal:new AbortController().signal,fetchImpl,files:first.files});
 assert.equal(second.failed.length,0);assert.equal(calls.filter(url=>url===works[0].o).length,1);
 assert.equal(Object.keys(unzipSync(await zipMembers(works,second.files,zip))).length,2);
});

test('cancelling interrupts active fetches and does not start the remaining queue',async()=>{
 const controller=new AbortController();let calls=0;
 const pending=downloadMembers(Array.from({length:10},(_,i)=>work(i)),{signal:controller.signal,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{
  calls++;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 })});
 controller.abort();
 await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls,3);
});

test('size limits reject known totals and unknown/chunked oversized originals',async()=>{
 await assert.rejects(downloadMembers([{...work(0),bytes:MAX_ZIP_BYTES+1}],{fetchImpl:()=>assert.fail('must not fetch')}),DownloadLimitError);
 const huge=new Uint8Array(MAX_IMAGE_BYTES+1);
 const cache=new Map();
 await assert.rejects(downloadMembers([{...work(0),bytes:0}],{files:cache,fetchImpl:async()=>response(huge)}),DownloadLimitError);
 assert.equal(cache.size,0);
 const medium=new Uint8Array(18*1024*1024);
 await assert.rejects(downloadMembers(Array.from({length:6},(_,i)=>({...work(i),bytes:0})),{fetchImpl:async()=>response(medium)}),DownloadLimitError);
});

test('invalid topics, missing public members and non-image responses fail explicitly',async()=>{
 assert.throws(()=>topicMembers({works:[work(0)],topics:[{id:'x',slugs:['work-0','hidden']}]},'x'));
 assert.throws(()=>topicMembers({works:[],topics:[]},'x'));
 const result=await downloadMembers([work(0)],{fetchImpl:async()=>new Response('<html>error</html>')});
 assert.equal(result.failed.length,1);assert.equal(result.files.size,0);
});

test('image clipboard write starts in the user gesture before asynchronous PNG fetch resolves',async()=>{
 const originals=Object.getOwnPropertyDescriptors(globalThis);
 let resolveFetch, written;
 Object.defineProperty(globalThis,'isSecureContext',{value:true,configurable:true});
 Object.defineProperty(globalThis,'navigator',{value:{clipboard:{write(items){written=items[0];return Promise.resolve();}}},configurable:true});
 Object.defineProperty(globalThis,'ClipboardItem',{value:class {constructor(data){this.data=data;}},configurable:true});
 Object.defineProperty(globalThis,'fetch',{value:()=>new Promise(resolve=>{resolveFetch=resolve;}),configurable:true});
 try {
  const pending=copyImage('/preview.png');
  assert.ok(written.data['image/png'] instanceof Promise);
  resolveFetch(response(bytes(3)));
  await pending;assert.deepEqual(new Uint8Array(await (await written.data['image/png']).arrayBuffer()),bytes(3));
 } finally {
  for(const key of ['isSecureContext','navigator','ClipboardItem','fetch']){if(originals[key])Object.defineProperty(globalThis,key,originals[key]);else delete globalThis[key];}
 }
});
