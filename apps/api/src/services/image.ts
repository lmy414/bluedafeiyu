import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ApiError } from '../errors.js';
import { apngFrameCount, convertApng } from './apng.js';

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 80_000_000;
const MAX_SIDE = 16_384;
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const JPG = Buffer.from('ffd8ff', 'hex');

export function imageFormat(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(PNG)) return { format: 'png', mimeType: 'image/png', extension: 'png' } as const;
  if (bytes.subarray(0, 3).equals(JPG)) return { format: 'jpeg', mimeType: 'image/jpeg', extension: 'jpg' } as const;
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return { format: 'gif', mimeType: 'image/gif', extension: 'gif' } as const;
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { format: 'webp', mimeType: 'image/webp', extension: 'webp' } as const;
  throw new ApiError(415, 'invalid_image_format', '仅接受 PNG、JPEG、GIF 和 WebP 图片');
}

export async function inspectImage(bytes: Buffer, maxBytes = MAX_IMAGE_BYTES) {
  if (bytes.length > maxBytes) throw new ApiError(413, 'image_too_large', '图片超过大小上限');
  const format = imageFormat(bytes);
  const metadata = await sharp(bytes, { animated: true, limitInputPixels: MAX_PIXELS }).metadata().catch(() => {
    throw new ApiError(422, 'invalid_image', '无法读取图片');
  });
  const apngFrames = format.format === 'png' ? apngFrameCount(bytes) : 1;
  const pages = Math.max(metadata.pages ?? 1, apngFrames);
  const rawHeight = metadata.pageHeight ?? metadata.height ?? 0;
  const rawWidth = metadata.width ?? 0;
  if (metadata.format !== format.format || !rawWidth || !rawHeight || Math.max(rawWidth, rawHeight) > MAX_SIDE || rawWidth * rawHeight * pages > MAX_PIXELS) {
    throw new ApiError(422, 'invalid_image_dimensions', '图片尺寸或帧数超过上限');
  }
  return { ...format, extension: apngFrames > 1 ? 'apng' : format.extension, width: rawWidth, height: rawHeight, isAnimated: pages > 1,
    sha256: createHash('sha256').update(bytes).digest('hex'), fileSize: bytes.length };
}

export async function prepareImage(bytes: Buffer, maxBytes = MAX_IMAGE_BYTES) {
  const image = await inspectImage(bytes, maxBytes);
  const pipeline = (width: number) => {
    const input = sharp(bytes, { animated: true, limitInputPixels: MAX_PIXELS });
    if (!image.isAnimated) input.autoOrient();
    return input.resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  };
  try {
    if (image.extension === 'apng') {
      const { thumb, display } = await convertApng(bytes, image.width, image.height, apngFrameCount(bytes));
      return { ...image, thumbnail: thumb.bytes, display: display.bytes, thumbWidth: thumb.width, thumbHeight: thumb.height,
        displayWidth: display.width, displayHeight: display.height };
    }
    const thumbnail = await pipeline(480);
    const display = await pipeline(1600);
    const [thumbInfo, displayInfo] = await Promise.all([sharp(thumbnail.data, { animated: true }).metadata(), sharp(display.data, { animated: true }).metadata()]);
    return { ...image, thumbnail: thumbnail.data, display: display.data,
      thumbWidth: thumbnail.info.width, thumbHeight: thumbInfo.pageHeight ?? thumbnail.info.height,
      displayWidth: display.info.width, displayHeight: displayInfo.pageHeight ?? display.info.height };
  } catch (error) { throw new ApiError(422, 'image_decode_failed', '无法完整解码图片', undefined, { cause: error }); }
}
