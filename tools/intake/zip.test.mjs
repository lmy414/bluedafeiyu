import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractZipImages, ZIP_LIMITS } from './zip.mjs';
import { zip, PNG } from './fixtures/zip.mjs';
import { resolveExtension } from '../../server/queue.mjs';
const read = (data, options = {}) => extractZipImages(data, { validateImage: resolveExtension, ...options });

test('ZIP: STORE/DEFLATE、子目录、中文和空目录，顺序与原始字节保持不变', () => {
  const files = read(zip([
    { name: '图集/', data: Buffer.alloc(0), method: 0, attrs: (0x41ed << 16) >>> 0 },
    { name: '图集/笑脸.PNG', data: PNG, method: 0 },
    { name: '动画.gif', data: Buffer.from('GIF89a1234'), descriptor: true },
    { name: 'image.apng', data: PNG, descriptor: 'unsigned' },
  ], { comment: Buffer.from('comment') }));
  assert.deepEqual(files.map((f) => f.name), ['图集/笑脸.PNG', '动画.gif', 'image.apng']);
  assert.deepEqual(files.map((f) => f.index), [0, 1, 2]);
  assert.deepEqual(files[0].buffer, PNG);
});

test('ZIP: 拒绝路径穿越、绝对路径、Windows 路径、控制字符与重复名称', () => {
  for (const name of ['../x.png', 'dir/../x.png', '/x.png', 'C:/x.png', 'a\\x.png', '//host/x.png', 'a//x.png', './x.png', 'x\0.png', 'a:x.png']) {
    assert.throws(() => read(zip([{ name }])), /ZIP 拒绝/);
  }
  for (const names of [['a.png', 'a.png'], ['A.PNG', 'a.png'], ['é.png', 'e\u0301.png']]) {
    assert.throws(() => read(zip(names.map((name) => ({ name })))), /重复/);
  }
});

test('ZIP: 不支持的格式、嵌套包、伪造图片扩展名整包失败', () => {
  for (const bad of [{ name: 'nested.zip', data: zip([{ name: 'x.png' }]) }, { name: 'note.txt' },
    { name: 'script.png', data: Buffer.from('<script>bad</script>') }, { name: 'fake.jpg', data: PNG },
    { name: 'nested.png', data: zip([{ name: 'x.png' }]) }, { name: 'vector.svg' }]) {
    assert.throws(() => read(zip([{ name: 'good.png' }, bad])), /ZIP 拒绝/);
  }
  assert.throws(() => read(zip([{ name: 'fake.png', data: Buffer.from([0xff, 0xd8, 0xff, 0]) }])), /扩展名/);
});

test('ZIP: 加密、ZIP64、分卷、符号链接、设备文件、未知压缩方法拒绝', () => {
  for (const changes of [{ flags: 1 }, { flags: 0x40 }, { version: 45 }, { method: 9 }, { disk: 1 },
    { attrs: (0xa1ff << 16) >>> 0 }, { attrs: (0x21ff << 16) >>> 0 }, { extra: Buffer.from([1, 0, 0, 0]) }]) {
    assert.throws(() => read(zip([{ name: 'x.png', ...changes }])), /ZIP 拒绝/);
  }
});

test('ZIP: 数量、单图、压缩包、总量和压缩比都有硬上限', () => {
  assert.equal(read(zip([{ name: 'x.png' }]), { maxImageBytes: PNG.length }).length, 1);
  assert.equal(read(zip(Array.from({ length: 100 }, (_, i) => ({ name: `${i}.png` })))).length, 100);
  assert.throws(() => read(zip(Array.from({ length: 101 }, (_, i) => ({ name: `${i}.png` })))), /数量/);
  assert.throws(() => read(zip(Array.from({ length: 201 }, (_, i) => ({ name: `${i}/`, data: Buffer.alloc(0), method: 0 })))), /条目数/);
  assert.throws(() => read(Buffer.alloc(ZIP_LIMITS.maxArchiveBytes + 1)), /32 MiB/);
  assert.throws(() => read(zip([{ name: 'big.png', size: ZIP_LIMITS.maxImageBytes + 1 }])), /单张/);
  assert.throws(() => read(zip([{ name: 'x.png' }]), { maxImageBytes: PNG.length - 1 }), /单张/);
  assert.throws(() => read(zip(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.png`, size: 15 * 1024 * 1024, compressed: 100000 })))), /总量/);
  assert.throws(() => read(zip([{ name: 'bomb.png', data: Buffer.alloc(1024 * 1024) }])), /压缩比/);
});

test('ZIP: 不信声明大小，限制实际膨胀；CRC、截断、目录与本地头不一致拒绝', () => {
  assert.throws(() => read(zip([{ name: 'bomb.png', data: Buffer.alloc(1024 * 1024), size: 50 }])), /实际解压量/);
  for (const changes of [{ crc: 0 }, { localName: 'evil.png' }, { localFlags: 1 }, { offset: 1 },
    { extra: Buffer.from([7, 0, 100, 0]) }, { data: Buffer.alloc(0) }]) {
    assert.throws(() => read(zip([{ name: 'x.png', ...changes }])), /ZIP 拒绝/);
  }
  const normal = zip([{ name: 'x.png' }]);
  for (const size of [0, 2, 25, normal.length - 1, normal.length - 22]) assert.throws(() => read(normal.subarray(0, size)), /ZIP 拒绝/);
  assert.throws(() => read(Buffer.concat([Buffer.from('MZ'), normal])), /ZIP 拒绝/);
  const overlap = zip([{ name: 'x.png' }, { name: 'y.png', offset: 0 }]);
  assert.throws(() => read(overlap), /重叠/);
  const padding = zip([{ name: 'x.png', payload: Buffer.concat([Buffer.from([3, 0]), Buffer.from('padding')]), size: 1 }]);
  assert.throws(() => read(padding), /ZIP 拒绝/);
});
