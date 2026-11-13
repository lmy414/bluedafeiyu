import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=file=>fs.readFileSync(new URL(file,import.meta.url),'utf8');
test('redesigned directories reuse the established homepage frame and controls',()=>{
 const shell=read('../src/components/archive/DirectoryPage.astro');
 assert.match(shell,/<HomeBody activePage=\{kind\}>/);
 assert.match(shell,/home\/HomePage.css/);
 assert.match(shell,/components\/home-controls.js/);
 assert.doesNotMatch(shell,/layouts\/Archive|archive\/archive.js/);
 for(const route of ['videos','creators','community-projects'])assert.match(read('../src/pages/'+route+'.astro'),/DirectoryPage/);
});
test('shared sidebar selects exactly the requested directory route',()=>{
 const source=read('../src/components/home/HomeBody.astro');
 for(const [route,id] of [['videos','videos'],['creators','creators'],['community-projects','communityProjects'],['friend-links','friendWall']]){
  const line=source.split('\n').find(line=>line.includes('href="/'+route+'.html"'));
  assert.ok(line.includes("aria-current={activePage==='"+id+"'?'page':undefined}"));
  assert.ok(line.includes("'is-active':activePage==='"+id+"'"));
 }
});
