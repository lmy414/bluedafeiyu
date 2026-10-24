// Narrow ZIP reader: classic, single-disk, unencrypted STORE/DEFLATE only.
// Never extracts paths to disk. Validate the entire container before returning any image.
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

export const ZIP_LIMITS = Object.freeze({
  maxArchiveBytes: 32 * 1024 * 1024,
  maxFiles: 100,
  maxEntries: 200, // includes directory entries
  maxImageBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxRatio: 200,
});
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.apng']);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? (n >>> 1) ^ 0xedb88320 : n >>> 1;
  return n >>> 0;
});

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export function isZip(buffer, name = '') {
  return path.extname(name).toLowerCase() === '.zip'
    || (buffer.length >= 4 && [0x04034b50, 0x06054b50].includes(buffer.readUInt32LE(0)));
}

function fail(reason) { throw new Error(`ZIP 拒绝：${reason}`); }

function extraFields(buffer) {
  let at = 0;
  while (at < buffer.length) {
    if (at + 4 > buffer.length) fail('扩展字段损坏');
    const id = buffer.readUInt16LE(at);
    const size = buffer.readUInt16LE(at + 2);
    if (at + 4 + size > buffer.length) fail('扩展字段截断');
    if ([0x0001, 0x0017, 0x9901].includes(id)) fail('不支持 ZIP64 或加密');
    at += 4 + size;
  }
}

function safeName(bytes, flags) {
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    if (flags & 0x800) fail('UTF-8 文件名损坏');
    // Common Windows Chinese archives omit the UTF-8 flag. No decoded name is used as a disk path.
    try { name = new TextDecoder('gb18030', { fatal: true }).decode(bytes); } catch { fail('文件名编码不支持'); }
  }
  if (!name || name.length > 512 || /[\u0000-\u001f\u007f\\:]/.test(name) || name.startsWith('/')) fail('不安全的成员路径');
  const parts = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail('路径穿越或空路径');
  return name;
}

export function extractZipImages(input, { maxImageBytes = ZIP_LIMITS.maxImageBytes, validateImage } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (typeof validateImage !== 'function') throw new Error('ZIP 必须逐张校验图片');
  const imageCap = Math.min(maxImageBytes, ZIP_LIMITS.maxImageBytes);
  if (!Number.isSafeInteger(imageCap) || imageCap < 1) throw new Error('ZIP 单图上限无效');
  if (buffer.length > ZIP_LIMITS.maxArchiveBytes) fail('压缩包超过 32 MiB');
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) fail('不是有效的非空 ZIP（不接受自解压包）');
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 65535); at--) {
    if (buffer.readUInt32LE(at) === 0x06054b50 && at + 22 + buffer.readUInt16LE(at + 20) === buffer.length) { end = at; break; }
  }
  if (end < 0) fail('缺少完整的中央目录');
  const count = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralAt = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count) fail('不支持分卷');
  if (count === 0xffff || centralSize === 0xffffffff || centralAt === 0xffffffff) fail('不支持 ZIP64');
  if (!count || count > ZIP_LIMITS.maxEntries) fail('条目数超过 200 或压缩包为空');
  if (centralAt + centralSize !== end) fail('中央目录边界无效');

  let cursor = centralAt;
  let declaredTotal = 0;
  let files = 0;
  const entries = [];
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) fail('中央目录损坏');
    const version = buffer.readUInt16LE(cursor + 6);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameSize = buffer.readUInt16LE(cursor + 28);
    const extraSize = buffer.readUInt16LE(cursor + 30);
    const commentSize = buffer.readUInt16LE(cursor + 32);
    const attrs = buffer.readUInt32LE(cursor + 38);
    const offset = buffer.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameSize + extraSize + commentSize;
    if (next > end || !nameSize) fail('成员元数据截断');
    if (version > 20 || flags & ~0x080e || ![0, 8].includes(method)) fail('不支持加密、压缩方法或 ZIP 版本');
    if (buffer.readUInt16LE(cursor + 34) || [compressed, size, offset].includes(0xffffffff)) fail('不支持分卷或 ZIP64');
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameSize);
    const name = safeName(rawName, flags);
    const key = name.normalize('NFC').toLowerCase().replace(/\/$/, '');
    if (names.has(key)) fail('重复成员文件名');
    names.add(key);
    const directory = name.endsWith('/');
    const type = (attrs >>> 16) & 0xf000;
    if (type && type !== (directory ? 0x4000 : 0x8000)) fail('符号链接或特殊文件');
    if ((attrs & 0x40) || (!directory && (attrs & 0x10))) fail('特殊文件或目录属性不一致');
    extraFields(buffer.subarray(cursor + 46 + nameSize, cursor + 46 + nameSize + extraSize));
    const ext = path.posix.extname(name).toLowerCase();
    if (directory ? size !== 0 : !IMAGE_EXT.has(ext)) fail('只允许图片和空目录，不支持嵌套压缩包或其他格式');
    if (!directory && ++files > ZIP_LIMITS.maxFiles) fail('图片数量超过 100');
    if (!directory && (!size || size > imageCap)) fail(`单张图片为空或超过 ${imageCap} 字节`);
    declaredTotal += size;
    if (declaredTotal > ZIP_LIMITS.maxTotalBytes) fail('解压总量超过 64 MiB');
    if (size > Math.max(1, compressed) * ZIP_LIMITS.maxRatio) fail('压缩比超过 200');
    entries.push({ name, rawName, ext, directory, flags, method, crc, compressed, size, offset });
    cursor = next;
  }
  if (cursor !== end || !files) fail('中央目录不完整或没有图片');

  // Check local headers, descriptor lengths and physical spans too: overlapping
  // entries, hidden local entries and central/local disagreement are rejected.
  let physicalEnd = 0;
  const images = [];
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
    const { offset, compressed, size, flags, method, crc, rawName } = entry;
    if (offset !== physicalEnd || offset + 30 > centralAt || buffer.readUInt32LE(offset) !== 0x04034b50) fail('成员重叠、隐藏条目或本地文件头损坏');
    if (buffer.readUInt16LE(offset + 4) > 20 || buffer.readUInt16LE(offset + 6) !== flags || buffer.readUInt16LE(offset + 8) !== method) fail('本地文件头与中央目录不一致');
    const nameSize = buffer.readUInt16LE(offset + 26);
    const extraSize = buffer.readUInt16LE(offset + 28);
    const dataAt = offset + 30 + nameSize + extraSize;
    if (dataAt + compressed > centralAt || !buffer.subarray(offset + 30, offset + 30 + nameSize).equals(rawName)) fail('成员文件名或数据边界不一致');
    extraFields(buffer.subarray(offset + 30 + nameSize, dataAt));
    physicalEnd = dataAt + compressed;
    const values = [crc, compressed, size];
    if (flags & 8) {
      const localValues = [14, 18, 22].map((n) => buffer.readUInt32LE(offset + n));
      if (localValues.some((v, i) => v !== 0 && v !== values[i])) fail('本地尺寸不一致');
      if (physicalEnd + 12 > centralAt) fail('数据描述符截断');
      if (buffer.readUInt32LE(physicalEnd) === 0x08074b50) physicalEnd += 4;
      if (physicalEnd + 12 > centralAt || values.some((v, i) => buffer.readUInt32LE(physicalEnd + 4 * i) !== v)) fail('数据描述符不一致');
      physicalEnd += 12;
    } else if (values.some((v, i) => buffer.readUInt32LE(offset + 14 + 4 * i) !== v)) fail('本地尺寸或 CRC 不一致');
    const payload = buffer.subarray(dataAt, dataAt + compressed);
    let data;
    if (method === 0) {
      if (compressed !== size) fail('STORE 尺寸不一致');
      data = payload;
    } else {
      try {
        const result = inflateRawSync(payload, { maxOutputLength: Math.max(1, Math.min(size, imageCap)), info: true });
        if (result.engine.bytesWritten !== compressed) fail('DEFLATE 存在多余数据');
        data = result.buffer;
      } catch { fail('解压失败或实际解压量超过上限'); }
    }
    if (data.length !== size || crc32(data) !== crc) fail('实际尺寸或 CRC 校验失败');
    if (!entry.directory) {
      try { validateImage(data, entry.ext); } catch (error) { fail(`成员图片校验失败：${error.message}`); }
      images.push({ name: entry.name, ext: entry.ext, buffer: data, index: entries.indexOf(entry) });
    }
  }
  if (physicalEnd !== centralAt) fail('存在未声明的本地数据');
  return images.sort((a, b) => a.index - b.index).map((image, index) => ({ ...image, index }));
}
