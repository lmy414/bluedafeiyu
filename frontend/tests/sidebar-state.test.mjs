import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

const source=fs.readFileSync(new URL('../public/components/sidebar-state.js',import.meta.url),'utf8');
function boot(saved, blocked=false) {
  const {window,document}=parseHTML('<html><body></body></html>');
  const storage=new Map([['bluefish-sidebar',saved]]);
  vm.runInNewContext(source,{window,document,Event:window.Event,localStorage:{
    getItem:key=>{if(blocked)throw Error('blocked');return storage.get(key);},
    setItem:(key,value)=>{if(blocked)throw Error('blocked');storage.set(key,value);}
  }});
  return {window,document,storage};
}
test('restores the sidebar while the body is empty, before any content can shift',()=>{
  const {window,document,storage}=boot('collapsed');
  assert.ok(document.body.classList.contains('sidebar-collapsed'));
  document.body.innerHTML='<button data-sidebar-collapse aria-expanded="true"><span>toggle</span></button>';
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.equal(document.querySelector('button').getAttribute('aria-expanded'),'false');
  let resizes=0;window.addEventListener('resize',()=>resizes++);
  document.querySelector('span').dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.equal(storage.get('bluefish-sidebar'),'expanded');
  assert.equal(document.querySelector('button').getAttribute('aria-expanded'),'true');
  assert.equal(resizes,1);
});
test('missing preferences and denied storage leave usable expanded navigation',()=>{
  for(const value of [null,'expanded','invalid'])assert.equal(boot(value).document.body.classList.contains('sidebar-collapsed'),false);
  const {window,document}=boot('collapsed',true);
  document.body.innerHTML='<button data-sidebar-collapse></button>';
  document.querySelector('button').dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.ok(document.body.classList.contains('sidebar-collapsed'));
});
