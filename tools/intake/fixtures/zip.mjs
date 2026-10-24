// Small independent ZIP fixture writer; can deliberately emit inconsistent headers.
import { deflateRawSync } from 'node:zlib';
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
function checksum(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function zip(entries, { comment = Buffer.alloc(0) } = {}) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const entry of entries) {
    const rawName = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(entry.name);
    const localName = entry.localName ? Buffer.from(entry.localName) : rawName;
    const data = entry.data ?? PNG;
    const method = entry.method ?? 8;
    const payload = entry.payload ?? (method === 8 ? deflateRawSync(data) : data);
    const size = entry.size ?? data.length;
    const compressed = entry.compressed ?? payload.length;
    const crc = entry.crc ?? checksum(data);
    const flags = entry.flags ?? (0x800 | (entry.descriptor ? 8 : 0));
    const extra = entry.extra ?? Buffer.alloc(0);
    const localExtra = entry.localExtra ?? extra;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(entry.version ?? 20, 4);
    local.writeUInt16LE(entry.localFlags ?? flags, 6);
    local.writeUInt16LE(method, 8);
    if (!entry.descriptor) {
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed, 18); local.writeUInt32LE(size, 22);
    }
    local.writeUInt16LE(localName.length, 26); local.writeUInt16LE(localExtra.length, 28);
    const tail = entry.descriptor ? Buffer.alloc(entry.descriptor === 'unsigned' ? 12 : 16) : Buffer.alloc(0);
    const start = tail.length === 16 ? 4 : 0;
    if (tail.length) {
      if (start) tail.writeUInt32LE(0x08074b50);
      tail.writeUInt32LE(crc, start); tail.writeUInt32LE(compressed, start + 4); tail.writeUInt32LE(size, start + 8);
    }
    locals.push(local, localName, localExtra, payload, tail);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(entry.version ?? 20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed, 20); central.writeUInt32LE(size, 24);
    central.writeUInt16LE(rawName.length, 28); central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(entry.disk ?? 0, 34); central.writeUInt32LE(entry.attrs ?? 0, 38);
    central.writeUInt32LE(entry.offset ?? offset, 42);
    directory.push(central, rawName, extra);
    offset += local.length + localName.length + localExtra.length + payload.length + tail.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, central, end, comment]);
}
