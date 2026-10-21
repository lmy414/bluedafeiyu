import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { zip } from 'fflate';
import { installTopicDownloads } from '../public/archive/topic-download.js';

async function until(predicate) {
  for (let i=0;i<100;i++) {
    if (predicate()) return;
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.fail('Download UI did not reach the expected state');
}

async function fixture(run) {
  const original = { document:globalThis.document, window:globalThis.window, fetch:globalThis.fetch };
  const { document, window } = parseHTML(`<body><button data-download-topic="sample">ZIP</button><dialog id="topic-download-dialog"><h2></h2><p data-topic-status></p><progress data-topic-progress></progress><ul data-topic-failures></ul><button data-topic-retry></button><button data-topic-save></button><button data-topic-close></button></dialog></body>`);
  const dialog=document.querySelector('dialog'), events=[],downloads=[];
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const create=document.createElement.bind(document);
  document.createElement=name=>{
    const element=create(name);
    if(name==='a')element.click=()=>downloads.push(element.download);
    return element;
  };
  const data={topics:[{id:'sample',name:'Sample',slugs:['one','two']}],works:['one','two'].map((slug,i)=>({id:slug,slug,n:slug,o:`https://example.test/${i}.png`}))};
  let failSecond=false;
  globalThis.document=document;globalThis.window={gtag:(...args)=>events.push(args)};
  globalThis.fetch=async url=>failSecond&&url.endsWith('/1.png')?new Response('',{status:404}):new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});
  installTopicDownloads({load:async()=>data,loadZip:async()=>({zip}),tx:(_key,text)=>text,toast:()=>{}});
  const click=selector=>document.querySelector(selector).dispatchEvent(new window.Event('click',{bubbles:true}));
  try { await run({document,events,downloads,click,setFailure:value=>{failSecond=value;}}); }
  finally { Object.assign(globalThis,original); }
}

test('one topic event includes its ID even after automatic download and repeated manual saves',async()=>{
  await fixture(async({events,downloads,click})=>{
    click('[data-download-topic]');await until(()=>downloads.length===1);
    click('[data-topic-save]');click('[data-topic-save]');
    assert.equal(downloads.length,3);assert.equal(events.length,1);
    assert.equal(events[0][0],'event');assert.equal(events[0][1],'topic_download');
    assert.equal(events[0][2].topic_id,'sample');assert.equal(events[0][2].image_count,2);
    click('[data-topic-close]');click('[data-download-topic]');await until(()=>events.length===2);
    assert.equal(downloads.length,4);
  });
});

test('partial download, retry and full save stay one event in the same download session',async()=>{
  await fixture(async({document,events,downloads,click,setFailure})=>{
    setFailure(true);click('[data-download-topic]');
    await until(()=>document.querySelector('[data-topic-progress]').hidden&& !document.querySelector('[data-topic-save]').hidden);
    assert.equal(events.length,0);
    click('[data-topic-save]');assert.equal(events.length,1);assert.equal(events[0][2].failed_count,1);
    setFailure(false);click('[data-topic-retry]');await until(()=>downloads.length===2);
    assert.equal(events.length,1);
  });
});

test('cancelled and completely failed sessions do not emit topic_download',async()=>{
  await fixture(async({document,events,click})=>{
    click('[data-download-topic]');click('[data-topic-close]');
    await new Promise(resolve=>setImmediate(resolve));assert.equal(events.length,0);
    globalThis.fetch=async()=>new Response('',{status:404});
    click('[data-download-topic]');await until(()=>document.querySelector('[data-topic-progress]').hidden&& !document.querySelector('[data-topic-retry]').hidden);
    assert.equal(events.length,0);assert.equal(document.querySelector('[data-topic-save]').hidden,true);
  });
});
