import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {upstreamOriginalPath} from '../upstream-original-path.mjs';
const editorial=JSON.parse(fs.readFileSync(new URL('../../data/blue-fish-editorial.json',import.meta.url)));
test('verified upstream paths preserve frozen keys and only replace original destinations',()=>{
 const overrides=Object.entries(editorial).filter(([,e])=>e.upstreamOriginalPath);
 assert.equal(overrides.length,146);
 for(const [source,e] of overrides){assert.ok(source.startsWith('media/'));assert.equal(e.originalPath,undefined);assert.equal(upstreamOriginalPath(source,e),e.upstreamOriginalPath);assert.notEqual(source,e.upstreamOriginalPath);}
});
test('legacy original paths remain unchanged and unsafe override paths fail closed',()=>{
 assert.equal(upstreamOriginalPath('media/旧名字.png'),'media/旧名字.png');
 for(const upstreamOriginalPathValue of ['../x.png','media/../x.png','https://example.com/x.png','media/x.png?x=1'])assert.throws(()=>upstreamOriginalPath('media/old.png',{upstreamOriginalPath:upstreamOriginalPathValue}));
});
