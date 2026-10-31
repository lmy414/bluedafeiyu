import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const privateMarker='PREVIEW_FIXTURE_PRIVATE_CATALOG';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#2af"/></svg>';

const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});});
const started=child=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('preview server did not start')),15000);child.stdout.on('data',chunk=>{if(String(chunk).includes('[preview]')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`preview server exited ${code}`));});});

test('preview mounts only dist previews and never exposes sibling data catalogs',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'preview-site-'));
  const tools=path.join(root,'tools');
  const site=path.join(root,'site');
  const previews=path.join(root,'dist','data','blue-fish','previews');
  fs.mkdirSync(tools,{recursive:true});
  fs.mkdirSync(site,{recursive:true});
  fs.mkdirSync(previews,{recursive:true});
  fs.copyFileSync(path.join(repo,'tools','preview_site.mjs'),path.join(tools,'preview_site.mjs'));
  fs.writeFileSync(path.join(site,'404.html'),'<!doctype html><meta charset="utf-8"><title>fixture-404</title>');
  fs.writeFileSync(path.join(previews,'test.svg'),svg);
  fs.writeFileSync(path.join(root,'dist','data','work-localizations.json'),JSON.stringify({private:privateMarker}));
  fs.writeFileSync(path.join(root,'dist','data','blue-fish-classification.json'),JSON.stringify({private:privateMarker}));

  const port=await freePort();
  const child=spawn(process.execPath,[path.join(tools,'preview_site.mjs'),'--dir',site,'--port',String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');
  t.after(async()=>{
    if(child.exitCode===null){child.kill();await exited;}
    fs.rmSync(root,{recursive:true,force:true});
  });
  await started(child);
  const base=`http://127.0.0.1:${port}`;

  const image=await fetch(`${base}/data/blue-fish/previews/test.svg`);
  assert.equal(image.status,200);
  assert.match(image.headers.get('content-type')||'',/^image\/svg\+xml/);
  assert.match(await image.text(),/<svg[\s>]/);

  for(const url of [
    '/data/blue-fish/..%2fwork-localizations.json',
    '/data/blue-fish/previews/..%2f..%2fwork-localizations.json',
    '/data/blue-fish/previews/%2e%2e/%2e%2e/blue-fish-classification.json',
    '/data/work-localizations.json',
  ]){
    const response=await fetch(base+url);
    assert.ok([403,404].includes(response.status),`${url} returned ${response.status}`);
    assert.doesNotMatch(response.headers.get('content-type')||'',/application\/json/,url);
    assert.ok(!(await response.text()).includes(privateMarker),`${url} leaked a private catalog`);
  }

  const missing=await fetch(`${base}/`);
  assert.equal(missing.status,404);
  assert.match(await missing.text(),/fixture-404/);
});
