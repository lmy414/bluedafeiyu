import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { PgTable } from 'drizzle-orm/pg-core';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { creators, topics, videos, works } from '../db/schema.js';
import type { TopicRow, WorkRow } from '../db/schema.js';

const config = loadConfig({ DATABASE_URL: 'postgres://test@127.0.0.1/test', R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', SESSION_SECRET: 'b'.repeat(32) });
const media = config.R2_PUBLIC_BASE_URL;
const day = (n: number) => new Date(Date.UTC(2026, 0, n));
const billedId = 'bilibili-4168597';
const biliHomepage = 'https://space.bilibili.com/4168597';
const profile: typeof creators.$inferSelect = { id: billedId, uid: '4168597', name: 'Video artist', homepage: biliHomepage,
  intro: '', avatarKey: null, status: 'active', lastSyncedAt: day(3), syncPage: 1, syncLease: null, retryAt: null, error: null, createdAt: day(1), updatedAt: day(3) };
const makeTopic = (id: string, overrides: Partial<TopicRow> = {}): TopicRow => ({ id, name: id, summary: '', coverWorkId: null,
  author: { name: 'Bilibili Alias', bio: 'Collected watercolor drawings', avatarKey: 'assets/avatars/topics/bili.webp',
    channels: [{ platform: 'bilibili', url: biliHomepage }, { platform: 'gallery', url: 'https://gallery.example/' }] },
  i18n: {}, status: 'active', isSerial: false, readerConfig: {}, sortOrder: 0, createdAt: day(1), updatedAt: day(2), ...overrides });
const makeWork = (id: string, publishedDay: number, status: WorkRow['status'] = 'published'): WorkRow => ({ id, slug: `${id}-slug`, name: id,
  description: 'Work description', commentary: '', kind: 'submission', channel: 'web', submissionId: null, sha256: 'a'.repeat(64),
  primaryCharacterId: 'primary', categoryId: 'meme', tags: [], r2OriginalKey: `originals/${id}.png`, r2ThumbKey: `thumbs/${id}.webp`, r2DisplayKey: `display/${id}.webp`,
  format: 'png', mimeType: 'image/png', isAnimated: false, width: 100, height: 50, fileSize: 400, thumbWidth: 100, thumbHeight: 50, displayWidth: 100, displayHeight: 50,
  submitter: {}, origin: {}, license: {}, i18n: {}, revision: 'revision', status, viewCount: 0, downloadCount: 0,
  createdAt: day(publishedDay), updatedAt: day(publishedDay), publishedAt: day(publishedDay) });

const series = makeTopic('serial', { isSerial: true, coverWorkId: 'cover', updatedAt: day(5), readerConfig: { totalPages: 8 } });
const authored = [makeTopic('bili-art'), makeTopic('bili-art-duplicate'), makeTopic('draft-garage', { status: 'draft' }), series,
  makeTopic('maojing', { author: { name: '猫鲸', bio: 'Indie paintings', avatarKey: 'assets/avatars/topics/maojing.webp',
    channels: [{ platform: 'blog', url: 'https://maojing.example/' }, { platform: 'invalid', url: 'javascript:alert(1)' }] } }),
  makeTopic('no-media', { author: { name: 'Empty illustrator' } })];
const images = [makeWork('gallery-work', 4), makeWork('serial-page', 7), makeWork('cover', 9), makeWork('indie', 2),
  makeWork('indie-newer', 3), makeWork('hidden', 10, 'hidden'), makeWork('draft-only', 11)];
const joins = [
  ['bili-art', 'gallery-work'], ['bili-art-duplicate', 'gallery-work'], ['bili-art', 'serial-page'], ['bili-art', 'cover'],
  ['serial', 'serial-page'], ['draft-garage', 'draft-only'], ['maojing', 'indie'], ['maojing', 'indie-newer'], ['maojing', 'hidden'],
];
const clip: typeof videos.$inferSelect = { id: 'video-1', creatorId: billedId, bvid: 'BV1test', title: 'Video title',
  source: { cover: 'https://images.example/video.webp' }, review: {}, lease: null, status: 'approved', createdAt: day(1), updatedAt: day(6), publishedAt: day(6) };
const undatedClip = { ...clip, id: 'video-undated', bvid: 'BV2test', publishedAt: null };
const clips = [clip, undatedClip, { ...clip, id: 'video-2', status: 'hidden' as const }];

const asSqlValue = (value: unknown) => value instanceof Date ? value.toISOString() : value;
function record<T extends PgTable>(table: T, row: T['$inferSelect']) {
  return Object.keys(getTableColumns(table)).map(key => asSqlValue(row[key]));
}
const mediaColumns = (row: WorkRow) => [row.id, row.slug, row.name, row.r2ThumbKey, row.thumbWidth, row.thumbHeight, asSqlValue(row.createdAt), asSqlValue(row.publishedAt)];

function testApp() {
  const db = drizzle(async (statement, params) => {
    if (statement.includes('from "creators"')) {
      const profiles = [profile, { ...profile, id: 'bilibili-500', uid: '500', name: 'A video-only author' }];
      return { rows: profiles.filter(row => !statement.includes('"creators"."id" =') || params.includes(row.id)).map(row => record(creators, row)) };
    }
    if (statement.includes('from "topics"')) {
      assert.match(statement, /"topics"\."author" is not null/);
      assert.equal(params[0], 'active');
      return { rows: authored.filter(topic => topic.status === 'active').map(row => record(topics, row)) };
    }
    if (statement.includes('from "topic_works" inner join "works"')) {
      assert.match(statement, /st\.is_serial\s+AND st\.status = 'active'/);
      assert(params.includes('published'));
      const rows = joins.flatMap(([topicId, workId]) => {
        const image = images.find(row => row.id === workId && row.status === 'published');
        if (!image || !params.includes(topicId)) return [];
        return [[...mediaColumns(image), topicId, image.id === 'cover' || image.id === 'serial-page']];
      });
      return { rows };
    }
    if (statement.includes('from "works"')) {
      const rows = images.filter(row => params.includes(row.id) && row.status === 'published');
      if (statement.includes(' limit ')) {
        assert(params.includes(100));
        assert.match(statement, /"published_at" DESC NULLS LAST/);
        return { rows: rows.sort((a, b) => Number(b.publishedAt) - Number(a.publishedAt)).map(row => record(works, row)) };
      }
      return { rows: rows.map(mediaColumns) };
    }
    if (statement.includes('from "videos"')) {
      assert(params.includes('approved'));
      const rows = clips.filter(row => params.includes(row.creatorId) && row.status === 'approved');
      if (statement.includes(' limit ')) {
        assert(params.includes(24));
        return { rows: rows.map(row => record(videos, row)) };
      }
      return { rows: rows.map(row => [row.id, row.creatorId, row.bvid, row.title, asSqlValue(row.publishedAt), row.source.cover]) };
    }
    if (statement.includes('from "work_characters"')) return { rows: [['indie', 'secondary']] };
    if (statement.includes('from "topic_works" inner join "topics"')) {
      const rows = joins.flatMap(([topicId, workId]) => {
        const topic = authored.find(row => row.id === topicId && row.status === 'active');
        return topic && params.includes(workId) ? [[workId, topicId, topic.author]] : [];
      });
      return { rows };
    }
    assert.fail(`Unexpected query: ${statement}`);
  }) as unknown as Database;
  return createApp({ config, db });
}

test('creator directory merges a Bilibili profile with signed topics and counts each serial once', async () => {
  const app = testApp();
  const response = await app.request('/api/v1/creators?pageSize=2');
  assert.equal(response.status, 200);
  const { items, total, page, nextPage } = await response.json();
  assert.deepEqual({ total, page, nextPage }, { total: 4, page: 1, nextPage: 2 });
  assert.deepEqual(items.map((row: { id: string }) => row.id), [billedId, 'maojing']);
  const [bili] = items;
  assert.equal(bili.name, 'Video artist');
  assert.equal(bili.homepage, biliHomepage);
  assert.equal(bili.lastSyncedAt, day(3).toISOString());
  assert.equal(bili.intro, 'Collected watercolor drawings');
  assert.equal(bili.avatarUrl, `${media}/assets/avatars/topics/bili.webp`);
  assert.deepEqual(bili.channels.map((channel: { url: string }) => channel.url), [biliHomepage, 'https://gallery.example/']);
  assert.equal(bili.workCount, 1);
  assert.equal(bili.videoCount, 2);
  assert.equal(bili.serialCount, 1);
  assert.equal(bili.totalCount, 4);
  assert.equal(bili.latestAt, day(6).toISOString());
  assert.deepEqual(bili.previews, [
    { kind: 'video', title: 'Video title', href: 'https://www.bilibili.com/video/BV1test', thumbUrl: 'https://images.example/video.webp' },
    { kind: 'serial', title: 'serial', href: '/topics/serial', thumbUrl: `${media}/thumbs/cover.webp` },
    { kind: 'image', title: 'gallery-work', href: '/works/gallery-work-slug.html', thumbUrl: `${media}/thumbs/gallery-work.webp` },
  ]);
  const searched = await app.request('/api/v1/creators?q=WATERCOLOR');
  assert.equal(searched.status, 200);
  assert.deepEqual((await searched.json()).items.map((row: { id: string }) => row.id), [billedId]);
  const secondPage = await app.request('/api/v1/creators?page=2&pageSize=2');
  assert.equal(secondPage.status, 200);
  assert.deepEqual((await secondPage.json()).items.map((row: { id: string; latestAt: string | null }) => [row.id, row.latestAt]), [['bilibili-500', null], ['no-media', null]]);
});

test('pure topic artists have a detail page with published full works and preserved author metadata', async () => {
  const app = testApp();
  const response = await app.request('/api/v1/creators/maojing');
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.creator.uid, '');
  assert.equal(detail.creator.name, '猫鲸');
  assert.equal(detail.creator.homepage, 'https://maojing.example/');
  assert.equal(detail.creator.avatarKey, 'assets/avatars/topics/maojing.webp');
  assert.equal(detail.creator.workCount, 2);
  assert.equal(detail.creator.totalCount, 2);
  assert.equal(detail.creator.channels.length, 1);
  assert.deepEqual(detail.topics.map((topic: { id: string }) => topic.id), ['maojing']);
  assert.deepEqual(detail.serials, []);
  assert.deepEqual(detail.videos, []);
  assert.deepEqual(detail.works.map((work: { id: string }) => work.id), ['indie-newer', 'indie']);
  assert.deepEqual(detail.works[1].characterIds, ['primary', 'secondary']);
  assert.deepEqual(detail.works[1].topicIds, ['maojing']);
  assert.deepEqual(detail.works[1].creatorIds, ['maojing']);
  assert.equal(detail.works[1].image.originalUrl, `${media}/originals/indie.png`);
  const absent = await app.request('/api/v1/creators/not-found');
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).error, 'creator_not_found');
});

test('a merged creator detail keeps separate topic, serial, work and video lists', async () => {
  const response = await testApp().request(`/api/v1/creators/${billedId}`);
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.deepEqual(detail.topics.map((topic: { id: string }) => topic.id), ['bili-art', 'bili-art-duplicate']);
  assert.deepEqual(detail.serials.map((topic: { id: string }) => topic.id), ['serial']);
  assert.deepEqual(detail.works.map((work: { id: string }) => work.id), ['gallery-work']);
  assert.deepEqual(detail.videos.map((video: { id: string }) => video.id), [clip.id, undatedClip.id]);
  assert.equal(detail.videos[0].creator.intro, detail.creator.intro);
});
