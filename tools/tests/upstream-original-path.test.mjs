import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {upstreamOriginalPath} from '../upstream-original-path.mjs';
import {SNAPSHOT_SITE_FILES,SITE_ALLOWLIST,writeSiteSnapshotFiles} from '../../ops/admin/publish-worker.mjs';
const file='data/blue-fish-original-overrides.json';
const mapping=JSON.parse(fs.readFileSync(new URL('../../'+file,import.meta.url)));
const editorial=JSON.parse(fs.readFileSync(new URL('../../data/blue-fish-editorial.json',import.meta.url)));
test('146 verified mappings preserve frozen keys outside CMS editorial',()=>{
 assert.equal(Object.keys(mapping).length,146);
 for(const [source,target] of Object.entries(mapping)){assert.ok(source.startsWith('media/'));assert.ok(editorial[source]);assert.equal(editorial[source].upstreamOriginalPath,undefined);assert.equal(upstreamOriginalPath(source,mapping),target);assert.notEqual(source,target);}
});
test('legacy paths remain unchanged and unsafe overrides fail closed',()=>{
 assert.equal(upstreamOriginalPath('media/旧名字.png'),'media/旧名字.png');
 for(const value of ['../x.png','media/../x.png','https://example.com/x.png','media/x.png?x=1'])assert.throws(()=>upstreamOriginalPath('media/old.png',{'media/old.png':value}));
});
test('CMS snapshot export cannot replace the independent original mapping',()=>{
 assert.ok(!SNAPSHOT_SITE_FILES.includes(file));assert.ok(!SITE_ALLOWLIST.includes(file));
 const siteDir=fs.mkdtempSync(path.join(os.tmpdir(),'original-override-cms-'));fs.mkdirSync(path.join(siteDir,'data'));
 const before=JSON.stringify(mapping);fs.writeFileSync(path.join(siteDir,file),before);
 const files=Object.fromEntries(SNAPSHOT_SITE_FILES.map(p=>[p,'[]\n']));
 writeSiteSnapshotFiles({siteDir},files);
 assert.equal(fs.readFileSync(path.join(siteDir,file),'utf8'),before);
 assert.equal(fs.readFileSync(path.join(siteDir,'data/blue-fish-editorial.json'),'utf8'),'[]\n');
});
