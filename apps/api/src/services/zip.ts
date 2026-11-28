import { Inflate } from 'fflate';
import { ApiError } from '../errors.js';
import { MAX_IMAGE_BYTES } from './image.js';

export const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_OUTPUT = 64 * 1024 * 1024;
const MAX_FILES = 20;

function invalid(): never { throw new ApiError(422, 'invalid_zip', 'ZIP 文件结构或解压大小无效'); }
function zipLimit(): never { throw new ApiError(413, 'zip_limit', 'ZIP 超过文件数或解压大小上限'); }

export function unpackImages(zip: Buffer): { name: string; bytes: Buffer }[] {
  if (zip.length > MAX_ZIP_BYTES) zipLimit();
  let end = zip.length - 22;
  while (end >= 0 && zip.length - end <= 65_557) {
    if (zip.readUInt32LE(end) === 0x06054b50 && zip.readUInt16LE(end + 20) + end + 22 === zip.length) break;
    end--;
  }
  if (end < 0 || zip.length - end > 65_557) invalid();
  const entries = zip.readUInt16LE(end + 10);
  const dirStart = zip.readUInt32LE(end + 16);
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || zip.readUInt16LE(end + 8) !== entries || dirStart + zip.readUInt32LE(end + 12) !== end) invalid();
  if (entries > 100) zipLimit();
  const files: { name: string; bytes: Buffer }[] = [];
  let offset = dirStart;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > end || zip.readUInt32LE(offset) !== 0x02014b50) invalid();
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    if (offset > end || !name || /(^[/\\]|[\\\u0000]|(?:^|\/)\.\.(?:\/|$))/.test(name)) invalid();
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').at(-1) === '.DS_Store') continue;
    if (!/\.(?:a?png|gif|webp|jpe?g)$/i.test(name)) throw new ApiError(422, 'zip_non_image', 'ZIP 只接受 PNG、APNG、JPEG、GIF 和 WebP 图片');
    total += size;
    if (files.length >= MAX_FILES || size > MAX_IMAGE_BYTES || total > MAX_ZIP_OUTPUT) zipLimit();
    if ((flags & 1) || (method !== 0 && method !== 8) || local + 30 > dirStart || zip.readUInt32LE(local) !== 0x04034b50 || zip.readUInt16LE(local + 8) !== method) invalid();
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    if (start + compressedSize > dirStart) invalid();
    const compressed = zip.subarray(start, start + compressedSize);
    let bytes: Buffer;
    if (!method) {
      if (compressedSize !== size) invalid();
      bytes = compressed;
    } else {
      const chunks: Uint8Array[] = [];
      let written = 0;
      const stream = new Inflate((chunk: Uint8Array) => {
        written += chunk.length;
        if (written > size) invalid();
        chunks.push(chunk);
      });
      try {
        for (let i = 0; i < compressed.length; i += 8192) stream.push(compressed.subarray(i, i + 8192), i + 8192 >= compressed.length);
      } catch { invalid(); }
      if (written !== size) invalid();
      bytes = Buffer.concat(chunks, written);
    }
    files.push({ name, bytes });
  }
  if (offset !== end || !files.length) invalid();
  return files;
}
