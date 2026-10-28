import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

const source = fs.readFileSync(new URL('../public/work-stats.js',import.meta.url),'utf8');
test('work views carry explicit detail or preview context without creating page views',async()=>{
  const {document,window}=parseHTML('<html><body><a data-download-work="sample">Download</a></body></html>');
  const events=[];
  window.gtag=(...args)=>events.push(args);
  vm.runInNewContext(source,{document,window,fetch:async()=>({ok:true,json:async()=>({available:false})}),AbortSignal});
  await window.WorkStats.ready;
  for(const viewType of ['detail','preview',undefined,'invalid'])document.dispatchEvent(new window.CustomEvent('work:show',{detail:{id:'sample',viewType}}));
  document.dispatchEvent(new window.CustomEvent('work:show',{detail:{id:'invalid id',viewType:'preview'}}));
  document.dispatchEvent(new window.CustomEvent('work:show'));
  document.querySelector('a').dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.deepEqual(events.map(args=>args[1]),['work_view','work_view','work_view','work_view','work_download']);
  assert.deepEqual(events.slice(0,4).map(args=>args[2].view_type),['detail','preview','unknown','unknown']);
  assert.equal(events.at(-1)[2].view_type,undefined);
  for(const event of events){assert.equal(event[2].work_id,'sample');assert.equal(event[2].send_to,'G-4LWN9Z2WT2');}
  document.dispatchEvent(new window.Event('site:langchange'));
  assert.equal(events.length,5);
});
