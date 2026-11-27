import { createHash } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { requiredEnv } from './runtime.js';

export function openR2() {
  const account = requiredEnv('R2_ACCOUNT_ID');
  if (!/^[a-f\d]{32}$/i.test(account)) throw new Error('R2_ACCOUNT_ID 非法');
  return new S3Client({
    region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'), secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY') },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export function putObject(r2: S3Client, bucket: string, key: string, bytes: Uint8Array, mime: string) {
  return r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mime,
    ...(bucket === (process.env.R2_MEDIA_BUCKET || 'dafeiyu-media') && { CacheControl: 'public, max-age=31536000, immutable' }),
  }));
}

export async function putVerifiedMedia(r2: S3Client, bucket: string, key: string, bytes: Uint8Array, mime: string) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const object = { Bucket: bucket, Key: key };
  const head = await r2.send(new HeadObjectCommand(object)).catch((error: { $metadata?: { httpStatusCode?: number } }) => {
    if (error.$metadata?.httpStatusCode === 404) return null;
    throw error;
  });
  if (head?.ContentLength === bytes.length && head.ContentType === mime) {
    if (head.Metadata?.sha256 === digest) return;
    if (!head.Metadata?.sha256) {
      const existing = await r2.send(new GetObjectCommand(object));
      if (existing.Body && createHash('sha256').update(await existing.Body.transformToByteArray()).digest('hex') === digest) return;
    }
  }
  await r2.send(new PutObjectCommand({ ...object, Body: bytes, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable',
    Metadata: { sha256: digest }, ContentMD5: createHash('md5').update(bytes).digest('base64'),
  }));
  const verified = await r2.send(new HeadObjectCommand(object));
  if (verified.ContentLength !== bytes.length || verified.Metadata?.sha256 !== digest) throw new Error(`R2 回读校验失败 ${key}`);
}
