import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';
import { ApiError } from '../errors.js';

export const immutableMedia = 'public, max-age=31536000, immutable';
const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

export function createR2(config: Config) {
  const client = new S3Client({
    region: 'auto', endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return {
    async putObject(bucket: string, key: string, body: Uint8Array, contentType: string, cacheControl?: string) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }), { abortSignal: AbortSignal.timeout(30_000) });
    },
    async getObjectBuffer(bucket: string, key: string, maxBytes = 16 * 1024 * 1024): Promise<Buffer> {
      const { Body, ContentLength } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
      if (!Body) throw new ApiError(404, 'object_not_found', '媒体对象不存在');
      if (ContentLength !== undefined && ContentLength > maxBytes) {
        await Body.transformToWebStream().cancel();
        throw new ApiError(413, 'object_too_large', '媒体对象超过大小上限');
      }
      const reader = Body.transformToWebStream().getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return Buffer.concat(chunks, size);
          size += value.length;
          if (size > maxBytes) throw new ApiError(413, 'object_too_large', '媒体对象超过大小上限');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    },
    async headObject(bucket: string, key: string) {
      try { return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(10_000) }); }
      catch (error) {
        if (error && typeof error === 'object' && '$metadata' in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404) return null;
        throw error;
      }
    },
    async deleteObject(bucket: string, key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(15_000) });
    },
    async copyObject(fromBucket: string, fromKey: string, toBucket: string, toKey: string) {
      await client.send(new CopyObjectCommand({ Bucket: toBucket, Key: toKey, CopySource: `${fromBucket}/${encodeKey(fromKey)}` }), { abortSignal: AbortSignal.timeout(30_000) });
    },
    async checkBucket(bucket: string) {
      await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(5_000) });
    },
    signReadUrl(bucket: string, key: string, expiresIn = 300) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
    },
    publicUrl(key: string) { return `${config.R2_PUBLIC_BASE_URL}/${encodeKey(key)}`; },
  };
}

export type R2Service = ReturnType<typeof createR2>;
