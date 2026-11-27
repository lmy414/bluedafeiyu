import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { RemoteCallback } from 'drizzle-orm/pg-proxy';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { works } from '../db/schema.js';
import type { WorkRow } from '../db/schema.js';

const config = loadConfig({
  DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
  R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', SESSION_SECRET: 'b'.repeat(32),
});

function appFor(execute: RemoteCallback) {
  return createApp({ db: drizzle(execute) as unknown as Database, config });
}

test('both health paths report success without querying the database', async () => {
  const app = appFor(async () => assert.fail('Health checks should not query the database'));
  for (const path of ['/health', '/api/v1/health']) {
    const response = await app.request(path);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }
});

test('event listing selects public activity by status and marks ended activity archived for the web client', async () => {
  const started = new Date(Date.now() - 172_800_000).toISOString();
  const ended = new Date(Date.now() - 86_400_000).toISOString();
  const payload = { url: 'https://event.example/', cover: { src: 'https://img.example/cover.webp', width: 720, height: 900 } };
  const live = ['live', 'live-slug', '进行中活动', '简介', { en: { title: 'Live event' } }, payload, 'active', started, null];
  const past = ['past', 'past-slug', '已结束活动', '简介', {}, payload, 'active', started, ended];
  const archive = ['archived', 'archived-slug', '归档活动', '简介', {}, payload, 'archived', started, null];

  const app = appFor(async (statement, params) => {
    assert.match(statement, /order by "events"\."starts_at" desc, "events"\."id" asc$/i);
    const statuses = params.filter(value => value === 'active' || value === 'archived');
    if (statuses.length === 1) {
      assert.match(statement, /"starts_at" <= \$\d+/);
      assert.match(statement, /"ends_at" >= \$\d+/);
      return { rows: [live] };
    }
    assert.match(statement, /"ends_at" < \$\d+/);
    if (statuses.length === 2) {
      assert.deepEqual(statuses, ['archived', 'active']);
      return { rows: [archive, past] };
    }
    assert.deepEqual(statuses, ['active', 'archived', 'active']);
    return { rows: [archive, live, past] };
  });

  for (const query of ['', '?status=active']) {
    const response = await app.request(`/api/v1/events${query}`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, { items: [{ id: 'live', slug: 'live-slug', title: '进行中活动', summary: '简介', i18n: { en: { title: 'Live event' } },
      payload, status: 'active', startsAt: started, endsAt: null }], total: 1 });
  }
  const archived = await app.request('/api/v1/events?status=archived');
  assert.equal(archived.status, 200);
  const archiveResult = await archived.json();
  assert.equal(archiveResult.total, 2);
  assert.deepEqual(archiveResult.items.map((item: { id: string; status: string }) => [item.id, item.status]), [['archived', 'archived'], ['past', 'archived']]);
  const all = await app.request('/api/v1/events?status=all');
  assert.equal(all.status, 200);
  const allResult = await all.json();
  assert.equal(allResult.total, 3);
  assert.deepEqual(allResult.items.map((item: { id: string; status: string }) => [item.id, item.status]), [['archived', 'archived'], ['live', 'active'], ['past', 'archived']]);
  assert.equal((await app.request('/api/v1/events?status=hidden')).status, 400);
});

test('video sorting reverses for oldest and otherwise uses latest with a stable ID tie-breaker', async () => {
  for (const [query, order] of [['', 'desc nulls last'], ['oldest', 'asc'], ['newest', 'desc nulls last'], ['unknown', 'desc nulls last']] as const) {
    let checkedOrder = false;
    const app = appFor(async (statement, params) => {
      assert.equal(params[0], 'approved');
      if (statement.startsWith('select count(')) return { rows: [[0]] };
      assert.match(statement, new RegExp(`order by "videos"\."published_at" ${order}, "videos"\."id" asc limit`, 'i'));
      checkedOrder = true;
      return { rows: [] };
    });
    const response = await app.request(query ? `/api/v1/videos?sort=${query}` : '/api/v1/videos');
    assert.equal(response.status, 200);
    assert.equal(checkedOrder, true);
    assert.deepEqual((await response.json()).items, []);
  }
});

function workFixture(overrides: Partial<WorkRow> = {}): WorkRow {
  const date = new Date('2026-11-27T00:00:00Z');
  return {
    id: 'sticker_example', slug: 'test-work', name: '作品标题', description: '图片说明', commentary: '肥鱼说',
    kind: 'submission', channel: 'web', submissionId: null, sha256: 'a'.repeat(64), primaryCharacterId: 'whale', categoryId: 'meme', tags: [],
    r2OriginalKey: 'originals/test-work.png', r2ThumbKey: 'thumbs/test-work.webp', r2DisplayKey: 'display/test-work.webp',
    format: 'png', mimeType: 'image/png', isAnimated: false, width: 800, height: 600, fileSize: 123_456,
    thumbWidth: 480, thumbHeight: 360, displayWidth: 800, displayHeight: 600,
    submitter: {}, origin: { type: 'web', sourceUrl: 'https://artist.example/work', note: '来自作者的公开画集', internalId: 'private' },
    license: {}, i18n: {}, status: 'published', revision: 'revision', viewCount: 123, downloadCount: 45, publishedAt: date, createdAt: date, updatedAt: date,
    ...overrides,
  };
}

function workRecord(work: WorkRow) {
  const columns = Object.keys(getTableColumns(works)) as Array<keyof WorkRow>;
  return columns.map(key => {
    const value = work[key];
    return value instanceof Date ? value.toISOString() : value;
  });
}

test('work listing intersects primary and related characters for comma-separated and repeated filters', async () => {
  const rows = [
    { work: workFixture({ id: 'both', slug: 'both', primaryCharacterId: 'deepseek' }), related: ['claude'] },
    { work: workFixture({ id: 'only-deepseek', slug: 'only-deepseek', primaryCharacterId: 'deepseek' }), related: [] },
    { work: workFixture({ id: 'only-claude', slug: 'only-claude', primaryCharacterId: 'claude' }), related: [] },
  ];
  const limitIds = ['x'.repeat(64), ...Array.from({ length: 11 }, (_, i) => `role-${i}`)];
  const cases = [
    { query: 'character=deepseek,claude', ids: ['deepseek', 'claude'], expected: ['both'] },
    { query: 'character=deepseek&character=claude', ids: ['deepseek', 'claude'], expected: ['both'] },
    { query: `character=${'deepseek,'.repeat(12)}deepseek&character=%20claude%20,deepseek`, ids: ['deepseek', 'claude'], expected: ['both'] },
    { query: 'character=deepseek', ids: ['deepseek'], expected: ['both', 'only-deepseek'] },
    { query: `character=${limitIds.join(',')}`, ids: limitIds, expected: [] },
  ];
  for (const { query, ids, expected } of cases) {
    const app = appFor(async (statement, params) => {
      if (statement.includes('from "work_characters"')) return { rows: [['both', 'claude']] };
      const characterCondition = String.raw`\("works"\."primary_character_id" = \$\d+ or EXISTS \(SELECT 1 FROM work_characters wc WHERE wc\.work_id = "works"\."id" AND wc\.character_id = \$\d+\)\)`;
      assert.match(statement, new RegExp(ids.map(() => characterCondition).join(' and ')));
      const criteria = ['published', ...ids.flatMap(id => [id, id])];
      const isCount = statement.startsWith('select count(');
      assert.deepEqual(params, isCount ? criteria : [...criteria, 5]);
      const matches = rows.filter(({ work, related }) => ids.every(id => work.primaryCharacterId === id || related.includes(id)));
      return { rows: isCount ? [[matches.length]] : matches.map(({ work }) => workRecord(work)) };
    });
    const response = await app.request(`/api/v1/works?${query}&pageSize=5`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, expected.length);
    assert.deepEqual(result.items.map((item: { id: string }) => item.id), expected);
  }
});

test('work listing rejects too many distinct characters and invalid character IDs', async () => {
  const app = appFor(async () => assert.fail('Invalid filters should not query the database'));
  const tooMany = Array.from({ length: 13 }, (_, i) => `character=role-${i}`).join('&');
  for (const query of [tooMany, 'character=deepseek,,claude', 'character=', 'character=deepseek&character=%20',
    'character=deepseek,%2Fclaude', `character=${'x'.repeat(65)}`]) {
    const response = await app.request(`/api/v1/works?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error, 'invalid_filters');
  }
});

test('non-AI creation filters by the exact tag and combines with character and category filters', async () => {
  const fixtures = [
    workFixture({ id: 'handmade-match', slug: 'handmade-match', primaryCharacterId: 'deepseek', tags: ['非AI', '原创'] }),
    workFixture({ id: 'handmade-other-category', slug: 'handmade-other-category', primaryCharacterId: 'deepseek', tags: ['非AI'], categoryId: 'comic' }),
    workFixture({ id: 'handmade-single-role', slug: 'handmade-single-role', primaryCharacterId: 'deepseek', tags: ['非AI'] }),
    workFixture({ id: 'similar-tag', slug: 'similar-tag', primaryCharacterId: 'deepseek', tags: ['非AI创作'] }),
  ];
  const related = new Set(['handmade-match', 'handmade-other-category', 'similar-tag']);

  for (const combined of [false, true]) {
    const app = appFor(async (statement, params) => {
      if (statement.includes('from "work_characters"')) return { rows: params.filter(id => typeof id === 'string' && related.has(id)).map(id => [id, 'claude']) };
      assert.match(statement, / and "works"\."tags" @> \$\d+/);
      if (combined) assert.match(statement, /wc\.character_id = \$\d+\)\) and \("works"\."primary_character_id".*wc\.character_id = \$\d+\)\) and "works"\."category_id" = \$\d+ and "works"\."tags" @>/);
      const filters = ['published', ...(combined ? ['deepseek', 'deepseek', 'claude', 'claude', 'meme'] : []), '{"非AI"}'];
      const isCount = statement.startsWith('select count(');
      assert.deepEqual(params, isCount ? filters : [...filters, 5]);
      const matches = fixtures.filter(work => work.tags.includes('非AI') && (!combined || (related.has(work.id) && work.categoryId === 'meme')));
      return { rows: isCount ? [[matches.length]] : matches.map(workRecord) };
    });
    const query = combined ? '&character=deepseek,claude&category=meme' : '';
    const response = await app.request(`/api/v1/works?creation=non-ai&pageSize=5${query}`);
    assert.equal(response.status, 200);
    const { items, total } = await response.json();
    const expected = combined ? ['handmade-match'] : ['handmade-match', 'handmade-other-category', 'handmade-single-role'];
    assert.equal(total, expected.length);
    assert.deepEqual(items.map((item: { id: string }) => item.id), expected);
  }

  const app = appFor(async () => assert.fail('Invalid filters should not query the database'));
  const invalid = await app.request('/api/v1/works?creation=ai');
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid_filters');
});

test('work detail exposes public media and source fields with complete character data in relation order', async () => {
  const work = workFixture();
  const primary = { id: 'whale', name: '鲸鱼娘', aliases: ['鲸鲸'], i18n: { en: { name: 'Whale girl' } } };
  const secondary = { id: 'assistant', name: '助手', aliases: ['搭档'], i18n: { ja: { name: 'アシスタント' } } };
  const app = appFor(async (statement, params) => {
    if (statement.includes('from "works"') && statement.includes('"works"."slug" =')) {
      assert(params.includes(work.slug));
      return { rows: [workRecord(work)] };
    }
    if (statement.includes('from "work_characters"')) return { rows: [[secondary.id]] };
    if (statement.includes('from "characters"')) {
      assert.deepEqual(params, [primary.id, secondary.id]);
      return { rows: [secondary, primary].map(row => [row.id, row.name, row.aliases, row.i18n]) };
    }
    return { rows: [] };
  });
  const response = await app.request(`/api/v1/works/${work.slug}`);
  assert.equal(response.status, 200);
  const { work: result } = await response.json();
  assert.equal(result.commentary, work.commentary);
  assert.deepEqual(result.source, { type: 'web', url: 'https://artist.example/work', note: '来自作者的公开画集' });
  assert.equal(result.viewCount, work.viewCount);
  assert.equal(result.downloadCount, work.downloadCount);
  assert.equal(result.fileSize, work.fileSize);
  assert.equal(result.mimeType, work.mimeType);
  assert.equal(result.revision, work.revision);
  assert.deepEqual(result.character, primary);
  assert.deepEqual(result.characters, [primary, secondary]);
});
