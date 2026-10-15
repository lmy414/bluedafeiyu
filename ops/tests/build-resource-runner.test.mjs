import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {memorySample} from '../build-resource-runner.mjs';
test('memory sampling reads the complete build cgroup rather than only the parent Node process',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'build-memory-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const proc=path.join(dir,'proc'),cgroup=path.join(dir,'cgroup');
  fs.mkdirSync(path.join(proc,'self'),{recursive:true});fs.mkdirSync(path.join(cgroup,'build.scope'),{recursive:true});
  fs.writeFileSync(path.join(proc,'meminfo'),'MemAvailable: 1572864 kB\n');fs.writeFileSync(path.join(proc,'self/cgroup'),'0::/build.scope\n');
  for(const [file,value] of Object.entries({'memory.current':800*1048576,'memory.peak':900*1048576,'memory.swap.current':10*1048576}))fs.writeFileSync(path.join(cgroup,'build.scope',file),String(value));
  assert.deepEqual(memorySample(proc,cgroup),{availableMiB:1536,currentMiB:800,peakMiB:900,swapMiB:10});
});
test('resource runner propagates build failure so deployment cannot switch current',()=>{
  const runner=path.resolve(import.meta.dirname,'../build-resource-runner.mjs');
  const result=spawnSync(process.execPath,[runner,'failure-check',process.execPath,'-e','process.exit(7)'],{encoding:'utf8',env:{...process.env,BUILD_MIN_AVAILABLE_MB:'0'}});
  assert.equal(result.status,7);assert.match(result.stdout,/"event":"complete"/);assert.match(result.stdout,/"code":7/);
});
