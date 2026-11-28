import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { createApp, createServices } from '../app.js';
import { loadConfig } from '../config.js';
import type { Database } from '../db/client.js';

const config = loadConfig({ DATABASE_URL: 'postgres://test@127.0.0.1/test', R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', SESSION_SECRET: 'b'.repeat(32), TRUST_PROXY_HOPS: '1' });
const id = 'sticker_example';
const slug = 'example-work';

function counters(status = 'published', beforeUpdate = () => {}) {
  let viewCount = 10;
  let downloadCount = 4;
  const db = drizzle(async (statement, params) => {
    assert.match(statement, /"works"\."status" = \$\d+/);
    assert.equal(params[0], 'published');
    if (statement.startsWith('update')) {
      assert.deepEqual(params, ['published', id]);
      beforeUpdate();
      if (statement.includes('set "view_count" = "works"."view_count" + 1')) viewCount++;
      else {
        assert.match(statement, /set "download_count" = "works"\."download_count" \+ 1/);
        downloadCount++;
      }
      return { rows: [[id, slug, viewCount, downloadCount]] };
    }
    const found = status === 'published' && params.some(value => value === id || value === slug);
    return { rows: found ? [[id, slug, viewCount, downloadCount]] : [] };
  }) as unknown as Database;
  const app = createApp({ db, config });
  const request = (key: string, action: 'view' | 'download', agent = 'Mozilla/5.0', ip = '198.51.100.20') => app.request(
    `/api/v1/works/${key}/${action}`, { method: 'POST', headers: { 'User-Agent': agent, 'X-Forwarded-For': ip } },
    { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
  );
  return { request };
}

async function countResult(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return response.json();
}

test('view and download increments use independent cooldowns keyed by the resolved ID and client IP', async t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const { request } = counters();
  assert.deepEqual(await countResult(await request(`${slug}.html`, 'view')), { id, slug, viewCount: 11, downloadCount: 4, counted: true });
  assert.deepEqual(await countResult(await request(id, 'download')), { id, slug, viewCount: 11, downloadCount: 5, counted: true });

  now += 59_999;
  assert.deepEqual(await countResult(await request(`${id}.html`, 'view')), { id, slug, viewCount: 11, downloadCount: 5, counted: false });
  assert.deepEqual(await countResult(await request(slug, 'download')), { id, slug, viewCount: 11, downloadCount: 5, counted: false });
  assert.deepEqual(await countResult(await request(slug, 'view', 'Mozilla/5.0', '198.51.100.21')), { id, slug, viewCount: 12, downloadCount: 5, counted: true });

  now++;
  assert.deepEqual(await countResult(await request(id, 'view')), { id, slug, viewCount: 13, downloadCount: 5, counted: true });
});

test('concurrent requests count only one event per client, work and action', async () => {
  const { request } = counters();
  const responses = await Promise.all([request(slug, 'view'), request(id, 'view'), request(`${slug}.html`, 'view')]);
  const results = await Promise.all(responses.map(countResult));
  assert.equal(results.filter(row => row.counted).length, 1);
  assert.deepEqual(await countResult(await request(slug, 'view')), { id, slug, viewCount: 11, downloadCount: 4, counted: false });
});

test('an unsuccessful update releases its cooldown reservation', async t => {
  const errorLog = t.mock.method(console, 'error', () => {});
  let fail = true;
  const { request } = counters('published', () => {
    if (fail) throw new Error('Database unavailable');
  });
  assert.equal((await request(slug, 'view')).status, 500);
  assert.equal(errorLog.mock.callCount(), 1);
  fail = false;
  assert.deepEqual(await countResult(await request(id, 'view')), { id, slug, viewCount: 11, downloadCount: 4, counted: true });
});

test('crawler requests read counters without reserving cooldown slots', async () => {
  const { request } = counters();
  for (const agent of ['GOOGLEBOT', 'Spider', 'web-crawler', 'SlUrP', 'BingPreview', 'HeadlessChrome', 'Lighthouse']) {
    assert.deepEqual(await countResult(await request(slug, 'download', agent)), { id, slug, viewCount: 10, downloadCount: 4, counted: false });
  }
  assert.deepEqual(await countResult(await request(id, 'download')), { id, slug, viewCount: 10, downloadCount: 5, counted: true });
});

test('unknown and unpublished works return no-store 404 for both counter endpoints', async () => {
  for (const [key, status] of [['missing', 'published'], [slug, 'hidden']] as const) {
    for (const action of ['view', 'download'] as const) {
      const response = await counters(status).request(key, action);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal((await response.json()).error, 'work_not_found');
    }
  }
});

test('site and admin summaries expose numeric totals from published works', async () => {
  const db = drizzle(async (statement, params) => {
    if (statement.includes('sum(')) {
      assert.match(statement, /coalesce\(sum\("view_count"\), 0\).*coalesce\(sum\("download_count"\), 0\)/);
      assert.deepEqual(params, ['published']);
      return { rows: [['2', '40', '17']] };
    }
    return { rows: statement.startsWith('select count(') ? [['0']] : [] };
  }) as unknown as Database;
  const services = createServices(db, config);
  const app = createApp({ db, config, services: { r2: { ...services.r2, async checkBucket() {} },
    authenticateAdmin: async () => ({ id: 'owner', email: 'owner@example.com', role: 'owner' }) } });
  const site = await app.request('/api/v1/site-meta');
  assert.equal(site.status, 200);
  assert.deepEqual((await site.json()).counts, { works: 2, totalViews: 40, totalDownloads: 17, characters: 0, categories: 0, topics: 0, serials: 0, videos: 0, creators: 0 });
  const admin = await app.request('/api/v1/admin/dashboard');
  assert.equal(admin.status, 200);
  const { totalViews, totalDownloads } = await admin.json();
  assert.deepEqual({ totalViews, totalDownloads }, { totalViews: 40, totalDownloads: 17 });
});
