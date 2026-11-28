import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { computeWorkRevision } from '@dafeiyu/shared';
import type { WorkRow } from '../db/schema.js';
import { createOpenApi } from '../routes/public/open-api.js';
import { prepareImage } from '../services/image.js';
import { clientIp, createRateLimiter } from '../services/ratelimit.js';
import { slugCandidate } from '../services/work-data.js';
import { unpackImages } from '../services/zip.js';

const site = 'https://site.example';
const media = 'https://images.example';
const now = new Date('2026-11-27T00:00:00.000Z');
const sha256 = 'a'.repeat(64);
const work: WorkRow = {
  id: 'sticker_aaaaaaaaaaaaaaaaaaaaaaaa', slug: 'example', name: '测试图片', description: '图片说明', commentary: '', kind: 'submission', channel: 'web', submissionId: null,
  sha256, primaryCharacterId: 'first', categoryId: 'meme', tags: ['测试'], r2OriginalKey: 'originals/aa/a.png', r2ThumbKey: 'thumbs/aa/a.webp', r2DisplayKey: 'display/aa/a.webp',
  format: 'png', mimeType: 'image/png', isAnimated: false, width: 1200, height: 600, fileSize: 972, thumbWidth: 480, thumbHeight: 240, displayWidth: 1200, displayHeight: 600,
  submitter: { credit: 'anonymous', name: 'Private Name', url: 'https://private.example' },
  origin: { type: 'qq', author: '示例作者', sourceUrl: 'https://artist.example/', groupId: 'secret-group' },
  license: { type: 'cc0' }, i18n: { en: { name: 'Example', description: 'An example', sourceHash: 'private' } }, status: 'published',
  revision: '', viewCount: 0, downloadCount: 0, publishedAt: now, createdAt: now, updatedAt: now,
};

test('rate limiter keeps active keys bounded and expires attempts at the window boundary', () => {
  let time = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, maxKeys: 1, now: () => time });
  assert.deepEqual(limiter.consume('ip'), { allowed: true, remaining: 1, retryAfter: 0 });
  time = 200;
  assert.equal(limiter.consume('ip').allowed, true);
  assert.equal(limiter.consume('ip').retryAfter, 1);
  assert.equal(limiter.consume('different-ip').allowed, false);
  time = 1000;
  assert.equal(limiter.consume('ip').allowed, true);
  time = 2000;
  assert.equal(limiter.consume('different-ip').allowed, true);
});

test('trusted proxy handling selects the configured hop and ignores unsolicited forwarding', () => {
  assert.equal(clientIp('127.0.0.1', '6.7.8.9, 1.2.3.4', 1), '1.2.3.4');
  assert.equal(clientIp('::ffff:127.0.0.1', '6.7.8.9, 1.2.3.4'), '127.0.0.1');
  assert.equal(clientIp('127.0.0.1', 'invalid', 1), '127.0.0.1');
});

test('slug candidates are deterministic and revision hashes handle object key order', async () => {
  assert.equal(slugCandidate('Néw Image!', work.id), 'new-image');
  assert.equal(slugCandidate('蓝色', work.id), work.id);
  assert.equal(slugCandidate('Néw Image!', work.id, 1), 'new-image-aaaaaaaaaaaa');
  assert.notEqual(slugCandidate('Néw Image!', work.id, 2), slugCandidate('Néw Image!', work.id, 1));
  assert.equal(await computeWorkRevision({ a: 1, b: 2 }), await computeWorkRevision({ b: 2, a: 1 }));
  assert.notEqual(await computeWorkRevision({ a: 1 }), await computeWorkRevision({ a: 2 }));
});

test('OpenAPI emits stable public v1 documents, source rights and original R2 URLs', async () => {
  const categories = [{ id: 'meme', name: '梗图', description: '' }];
  const topic = { id: 'example-topic', name: '测试专题', summary: '', coverWorkId: work.id, workIds: [work.id],
    sortOrder: 0, updatedAt: now, i18n: {}, author: { name: '作者', channels: [{ url: 'https://space.bilibili.com/123', platform: 'bilibili' }] } };
  const snapshot = { roles: new Map([[work.id, ['second']]]), characters: [{ id: 'first', name: '一', aliases: [] }, { id: 'second', name: '二', aliases: [] }],
    categories, topics: [topic], works: [work, { ...work, id: 'removed', status: 'hidden' as const }] };
  const { documents, revision } = await createOpenApi(snapshot, { site, media });
  const document = (path: string) => documents.get(`/open-api/v1/${path}`);
  const detail = document(`works/${work.id}.json`);
  assert.equal(detail?.apiVersion, 1);
  assert.equal(document('works/page/1.json')?.next, null);
  assert.equal(document('works/page/2.json'), undefined);
  assert.equal(document('works/removed.json'), undefined);
  assert.equal(document('characters/second/categories/meme.json')?.total, 1);
  assert.equal(document('creators/bilibili-123.json')?.total, 1);
  assert.equal(document(`tags/tag-${createHash('sha256').update('测试').digest('hex')}.json`)?.total, 1);
  assert.match(JSON.stringify(detail), /https:\/\/images\.example\/originals\/aa\/a\.png/);
  assert.doesNotMatch(JSON.stringify(detail), /Private Name|private\.example|secret-group|sourceHash/);
  assert.equal(revision, (await createOpenApi(snapshot, { site, media })).revision);
  assert.notEqual(revision, (await createOpenApi({ ...snapshot, works: [{ ...work, description: '更改' }] }, { site, media })).revision);
  const empty = await createOpenApi({ ...snapshot, works: [] }, { site, media });
  assert.equal(empty.documents.get('/open-api/v1/works/page/1.json')?.total, 0);
  assert.equal(empty.documents.get('/open-api/v1/topics/example-topic.json'), undefined);
});

test('image derivatives use real dimensions and ZIP decoding rejects non-images and understated output', async () => {
  const bytes = await sharp({ create: { width: 960, height: 480, channels: 4, background: '#66aaff' } }).png().toBuffer();
  const derived = await prepareImage(bytes);
  assert.deepEqual([derived.width, derived.height, derived.thumbWidth, derived.thumbHeight, derived.displayWidth, derived.displayHeight], [960, 480, 480, 240, 960, 480]);
  const archive = Buffer.from(zipSync({ 'example.png': bytes }));
  assert.deepEqual(unpackImages(archive)[0]?.bytes, bytes);
  const central = archive.readUInt32LE(archive.length - 22 + 16);
  archive.writeUInt32LE(1, central + 24);
  assert.throws(() => unpackImages(archive));
  assert.throws(() => unpackImages(Buffer.from(zipSync({ 'example.html': bytes }))));
});

test('animated thumbnails and display images retain frame count and report per-frame dimensions', async () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAAQABAAACAkwBACH5BAUMAAAALAAAAAABAAEAgExpcQAA/wICTAEAOw==', 'base64');
  const image = await prepareImage(gif);
  assert.equal(image.isAnimated, true);
  assert.deepEqual([image.width, image.height, image.thumbWidth, image.thumbHeight, image.displayWidth, image.displayHeight], [1, 1, 1, 1, 1, 1]);
  assert.equal((await sharp(image.thumbnail, { animated: true }).metadata()).pages, 2);
  assert.equal((await sharp(image.display, { animated: true }).metadata()).pages, 2);
});

test('APNG uploads preserve both frames and their durations in WebP output', async () => {
  const apng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAQAAAAAAAAAAAAEACgAA+Sm2eQAAABFJREFUeJxj/M/A8J+BgYEBAA0FAgDgB2sCAAAAGmZjVEwAAAABAAAAAgAAAAEAAAAAAAAAAAADABkAAAb6EuQAAAAVZmRBVAAAAAJ4nGNkYPj/n4GBgQEACwcCAEgTs00AAAAASUVORK5CYII=', 'base64');
  const image = await prepareImage(apng);
  assert.equal(image.extension, 'apng');
  assert.equal(image.isAnimated, true);
  assert.deepEqual([image.width, image.height], [2, 1]);
  const metadata = await sharp(image.display, { animated: true }).metadata();
  assert.equal(metadata.pages, 2);
  assert.deepEqual(metadata.delay, [100, 120]);
});
