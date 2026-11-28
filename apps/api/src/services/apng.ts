import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { ApiError } from '../errors.js';

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const inheritedChunks = new Set(['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT']);
const invalid = (): never => { throw new ApiError(422, 'invalid_apng', 'APNG 帧结构无效'); };

function* chunks(bytes: Buffer) {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    yield { type, data: bytes.subarray(offset + 8, end - 4), raw: bytes.subarray(offset, end) };
    if (type === 'IEND') return;
    offset = end;
  }
  invalid();
}

export function apngFrameCount(bytes: Buffer): number {
  for (const { type, data } of chunks(bytes)) {
    if (type === 'IDAT') return 1;
    if (type === 'acTL') {
      if (data.length !== 8) invalid();
      const frames = data.readUInt32BE(0);
      if (!frames || frames > 400) invalid();
      return frames;
    }
  }
  return invalid();
}

function pngChunk(type: string, data: Buffer = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length);
  header.write(type, 4, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(data, crc32(header.subarray(4))));
  return [header, data, checksum];
}

type Frame = { width: number; height: number; x: number; y: number; duration: number; dispose: number; blend: number; data: Buffer[] };

function parse(bytes: Buffer, width: number, height: number, count: number) {
  const frames: Frame[] = [];
  const palette: Buffer[] = [];
  let imageHeader: Buffer | undefined;
  let loop = 0;
  let sequence = 0;
  let imageData = false;
  for (const { type, data, raw } of chunks(bytes)) {
    if (type === 'IHDR') imageHeader = Buffer.from(data);
    if (type === 'acTL') loop = data.readUInt32BE(4);
    if (!imageData && inheritedChunks.has(type)) palette.push(raw);
    if (type === 'fcTL') {
      if (data.length !== 26 || data.readUInt32BE(0) !== sequence++ || frames.length >= count) invalid();
      const frame = { width: data.readUInt32BE(4), height: data.readUInt32BE(8), x: data.readUInt32BE(12), y: data.readUInt32BE(16),
        duration: Math.min(65_535, Math.round(1000 * data.readUInt16BE(20) / (data.readUInt16BE(22) || 100))),
        dispose: data[24] ?? -1, blend: data[25] ?? -1, data: [] };
      if (!frame.width || !frame.height || frame.x + frame.width > width || frame.y + frame.height > height || frame.dispose > 2 || frame.blend > 1) invalid();
      frames.push(frame);
    }
    if (type === 'IDAT') {
      if (frames.length > 1) invalid();
      frames[0]?.data.push(data);
      imageData = true;
    }
    if (type === 'fdAT') {
      if (!imageData || data.length < 5 || data.readUInt32BE(0) !== sequence++ || !frames.length) invalid();
      frames.at(-1)?.data.push(data.subarray(4));
    }
  }
  if (!imageHeader || imageHeader.length !== 13 || frames.length !== count || frames.some(frame => !frame.data.length)) return invalid();
  return { frames, palette, imageHeader, loop: Math.min(65_535, loop) };
}

function renderFrame(canvas: Buffer, pixels: Buffer, frame: Frame, canvasWidth: number) {
  for (let row = 0; row < frame.height; row++) {
    const line = ((frame.y + row) * canvasWidth + frame.x) * 4;
    if (!frame.blend) {
      pixels.copy(canvas, line, row * frame.width * 4, (row + 1) * frame.width * 4);
      continue;
    }
    for (let col = 0; col < frame.width; col++) {
      const src = (row * frame.width + col) * 4;
      const dst = line + col * 4;
      const alpha = (pixels[src + 3] ?? 0) / 255;
      if (!alpha) continue;
      const underneath = ((canvas[dst + 3] ?? 0) / 255) * (1 - alpha);
      const combined = alpha + underneath;
      for (let channel = 0; channel < 3; channel++) {
        canvas[dst + channel] = Math.round(((pixels[src + channel] ?? 0) * alpha + (canvas[dst + channel] ?? 0) * underneath) / combined);
      }
      canvas[dst + 3] = Math.round(combined * 255);
    }
  }
}

export async function convertApng(bytes: Buffer, width: number, height: number, count: number) {
  const { frames, palette, imageHeader, loop } = parse(bytes, width, height, count);
  const base = { width, height, channels: 4 } as const;
  let canvas = Buffer.alloc(width * height * 4);
  const scaled = [480, 1600].map(limit => ({ width: Math.min(limit, width), height: Math.max(1, Math.round(height * Math.min(limit, width) / width)), frames: [] as Buffer[] }));
  for (const frame of frames) {
    const before = frame.dispose === 2 ? Buffer.from(canvas) : null;
    const header = Buffer.from(imageHeader);
    header.writeUInt32BE(frame.width, 0);
    header.writeUInt32BE(frame.height, 4);
    const image = Buffer.concat([pngSignature, ...pngChunk('IHDR', header), ...palette, ...frame.data.flatMap(block => pngChunk('IDAT', block)), ...pngChunk('IEND')]);
    const pixels = await sharp(image).toColourspace('srgb').ensureAlpha().raw().toBuffer();
    renderFrame(canvas, pixels, frame, width);
    for (const output of scaled) {
      output.frames.push(await sharp(canvas, { raw: base }).resize(output.width, output.height, { fit: 'fill' }).raw().toBuffer());
    }
    if (before) canvas = before;
    else if (frame.dispose === 1) {
      for (let row = 0; row < frame.height; row++) {
        const start = ((frame.y + row) * width + frame.x) * 4;
        canvas.fill(0, start, start + frame.width * 4);
      }
    }
  }
  const encode = async (output: (typeof scaled)[number]) => ({
    width: output.width, height: output.height,
    bytes: await sharp(Buffer.concat(output.frames), { raw: { width: output.width, height: output.height * count, pageHeight: output.height, channels: 4 } })
      .webp({ quality: 82, loop, delay: frames.map(frame => frame.duration) }).toBuffer(),
  });
  const [thumb, display] = scaled;
  if (!thumb || !display) return invalid();
  return { thumb: await encode(thumb), display: await encode(display) };
}
