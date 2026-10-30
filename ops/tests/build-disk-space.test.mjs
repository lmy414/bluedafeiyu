import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBuildDiskSpace} from '../build-disk-space.mjs';

const sample = availableMiB => ({bsize:4096, bavail:availableMiB * 256});
test('checks the destination mount even when the root filesystem has plenty of space', () => {
  const checked=[];
  assert.throws(() => assertBuildDiskSpace(['/root', '/business/build'], {
    minimumMiB:2048, exists:()=>true,
    statfs:directory=>{checked.push(directory);return sample(directory.endsWith('build') ? 600 : 17000);}
  }), /600 MiB available, 2048 MiB required/);
  assert.equal(checked.length,2);
});
test('new output directories use their existing parent filesystem and honor the configured threshold', () => {
  const checks=assertBuildDiskSpace(['/business/new/site'], {
    minimumMiB:3072, exists:directory=>!directory.endsWith('site')&&!directory.endsWith('new'),
    statfs:directory=>{assert.ok(directory.endsWith('business'));return sample(4096);}
  });
  assert.equal(checks[0].availableMiB,4096);
  for(const minimumMiB of [-1, NaN, 1.5])assert.throws(()=>assertBuildDiskSpace([], {minimumMiB}), /BUILD_MIN_DISK_MB/);
});
