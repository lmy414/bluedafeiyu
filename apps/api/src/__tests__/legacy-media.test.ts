import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { createR2 } from '../services/r2.js';

const config = loadConfig({ DATABASE_URL: 'postgres://test@127.0.0.1/test', R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', SESSION_SECRET: 'b'.repeat(32) });
const media = config.R2_PUBLIC_BASE_URL;
const thumb = '/submissions/previews/deepseek/artwork.webp';
const display = '/submissions/large/deepseek/artwork.webp';
const original = '/submissions/originals/deepseek/artwork.png';
const digest = '4a9d9001e2c3d4f5';

function work(id: string, overrides = {}) {
  return {
    id, slug: id, status: 'published', sha256: '', keys: [`originals/${id}.png`, `thumbs/${id}.webp`, `display/${id}.webp`],
    legacyPaths: null as Record<string, string[]> | null, sourcePath: null as string | null, ...overrides,
  };
}

function preview() {
  const main = work('art', { legacyPaths: { thumb: [thumb, '/owner-picks/previews/AI 娘.webp'], display: [display], original: [`/dist${original}`] } });
  const fallback = work('fallback', { keys: ['originals/fallback.png', '', 'display/fallback.webp'], legacyPaths: { thumb: ['/thumb/fallback.webp'] } });
  const oldest = work('oldest', { keys: ['originals/oldest.png', '', ''], sourcePath: 'media/historical.png',
    legacyPaths: { thumb: ['/thumb/oldest.webp'], display: ['/display/oldest.webp'] } });
  const ogThumb = work('og-thumb', { keys: ['originals/og-thumb.png', 'thumbs/og-thumb.webp', ''] });
  const hashMatch = work('hashed', { sha256: digest + '0'.repeat(48) });
  const realLegacy = work('sticker_issue_01_001');
  const rows = [main, fallback, oldest, ogThumb, hashMatch, realLegacy];
  let indexReads = 0;
  const db = drizzle(async (statement, params) => {
    if (statement.includes('from "works"')) {
      assert.equal(params[0], 'published');
      const published = rows.filter(row => row.status === 'published');
      if (statement.includes("->'legacyPaths'")) {
        indexReads++;
        return { rows: published.filter(row => row.legacyPaths || row.sourcePath).map(row => [row.id, row.legacyPaths, row.sourcePath]) };
      }
      if (statement.includes('"sha256" like') || statement.includes('"sha256" LIKE')) {
        assert.equal(params[2], 2);
        return { rows: published.filter(row => row.sha256.startsWith(String(params[1]).slice(0, -1))).slice(0, 2).map(row => row.keys) };
      }
      const key = statement.includes('"slug" =') ? 'slug' : 'id';
      return { rows: published.filter(row => row[key] === params[1]).map(row => statement.includes('legacyOgKey') && row.id === 'art' ? [...row.keys, 'og/legacy/archive--works-art-html.jpg'] : row.keys) };
    }
    if (statement.includes('from "characters"')) {
      assert(params.includes('active'));
      const [, exact, , base] = params;
      if (exact === 'deepseek-35015284f47eb01c') return { rows: [['private.png', false]] };
      if ([exact, base].includes('deepseek')) return { rows: [['assets/portraits/deepseek.webp', true]] };
      return { rows: [] };
    }
    if (statement.includes('from "creators"')) {
      assert.match(statement, /"last_synced_at" is not null/);
      assert.match(statement, /cv\.status = 'approved'/);
      return { rows: params.includes('bilibili-4168597') ? [['assets/avatars/creators/bilibili-4168597.webp']] : [] };
    }
    if (statement.includes('from "topics"')) {
      assert.equal(params[0], 'active');
      return { rows: params.includes('maojing') ? [['assets/avatars/topics/maojing.webp']] : [] };
    }
    assert.fail(`Unexpected query: ${statement}`);
  }) as unknown as Database;
  const r2 = createR2(config);
  r2.headObject = async (_bucket, key) => key === 'og/legacy/archive-home.jpg' ? { $metadata: {} } : null;
  const app = createApp({ db, config, services: { r2 } });
  const request = (path?: string) => app.request(path === undefined ? '/api/v1/legacy-media' : `/api/v1/legacy-media?path=${encodeURIComponent(path)}`);
  return { request, main, rows, indexReads: () => indexReads };
}

async function redirects(response: Response, location: string) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600');
  assert.deepEqual(await response.json(), { ok: true, status: 301, location });
}

async function misses(response: Response) {
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(body.error, 'legacy_media_not_found');
  assert.equal(body.location, undefined);
}

test('legacy work aliases preserve variants, decode paths, and look up original manifests by frozen ID', async () => {
  const { request, indexReads } = preview();
  const examples = [
    [thumb, 'thumbs/art.webp'], [`/dist${display}`, 'display/art.webp'], [original, 'originals/art.png'],
    ['owner-picks\\previews\\AI%20%E5%A8%98.webp', 'thumbs/art.webp'], ['media/historical.png', 'originals/oldest.png'],
    ['/thumb/fallback.webp', 'display/fallback.webp'], ['/thumb/oldest.webp', 'originals/oldest.png'],
    ['/display/oldest.webp', 'originals/oldest.png'], ['/submissions/previews/deepseek/issue-01-001.webp', 'thumbs/sticker_issue_01_001.webp'],
  ] as const;
  for (const [path, key] of examples) await redirects(await request(path), `${media}/${key}`);
  assert.equal(indexReads(), 1);
});

test('a legacy work index refreshes on first use, miss and expiry and checks published status on every hit', async t => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const { request, main, indexReads } = preview();
  await redirects(await request(thumb), `${media}/thumbs/art.webp`);
  const added = '/owner-picks/previews/newly-imported.webp';
  main.legacyPaths = { thumb: [added, thumb] };
  await redirects(await request(added), `${media}/thumbs/art.webp`);
  assert.equal(indexReads(), 2);

  main.status = 'hidden';
  await misses(await request(thumb));
  main.status = 'deleted';
  await misses(await request(added));
  assert.equal(indexReads(), 2);
  now += 60_000;
  await misses(await request(added));
  assert.equal(indexReads(), 3);
});

test('an ambiguous path or SHA prefix never redirects to an arbitrary work', async () => {
  const { request, rows } = preview();
  const prefixPath = `/submissions/previews/other/${digest}.webp`;
  await redirects(await request(prefixPath), `${media}/thumbs/hashed.webp`);
  await redirects(await request(`/dist/submissions/large/other/${digest}.webp`), `${media}/display/hashed.webp`);
  await redirects(await request(`/submissions/originals/other/${digest}.png`), `${media}/originals/hashed.png`);
  await misses(await request(`/submissions/previews/other/${digest}f.webp`));

  const duplicate = work('duplicate', { sha256: digest + 'f'.repeat(48), legacyPaths: { thumb: [thumb] } });
  rows.push(duplicate);
  await misses(await request(prefixPath));
  await misses(await request(thumb));
  duplicate.status = 'hidden';
  await redirects(await request(prefixPath), `${media}/thumbs/hashed.webp`);
  rows.find(row => row.id === 'hashed')!.status = 'deleted';
  await misses(await request(prefixPath));
});

test('a dist alias is tried after the exact path and cannot override a distinct registered path', async () => {
  const { request, rows } = preview();
  rows.push(work('dist-image', { legacyPaths: { thumb: [`/dist${thumb}`] } }));
  await redirects(await request(thumb), `${media}/thumbs/art.webp`);
  await redirects(await request(`/dist${thumb}`), `${media}/thumbs/dist-image.webp`);
});

test('legacy portrait and author avatars resolve only for visible entities', async () => {
  const { request } = preview();
  const examples = [
    ['/character-portraits/deepseek-35015284f47eb01b.webp', 'assets/portraits/deepseek.webp'],
    ['/dist/character-portraits/deepseek.webp', 'assets/portraits/deepseek.webp'],
    ['/creator-avatars/4168597.jpg', 'assets/avatars/creators/bilibili-4168597.webp'],
    ['/author-avatars/maojing.webp', 'assets/avatars/topics/maojing.webp'],
  ] as const;
  for (const [path, key] of examples) await redirects(await request(path), `${media}/${key}`);
  for (const path of ['/character-portraits/deepseek-35015284f47eb01c.webp', '/character-portraits/inactive.webp',
    '/creator-avatars/123.png', '/author-avatars/draft-topic.webp']) await misses(await request(path));
});

test('legacy OG images and community aliases resolve to the requested fallback targets', async () => {
  const { request, main, indexReads } = preview();
  for (const locale of ['', 'zh-hant-', 'en-', 'ja-']) {
    await redirects(await request(`/og/archive--${locale}works-art-html.jpg`), `${media}/og/legacy/archive--works-art-html.jpg`);
  }
  await redirects(await request('/og/works-og-thumb.webp'), `${media}/thumbs/og-thumb.webp`);
  await redirects(await request('/og/archive-home.jpg'), `${media}/og/legacy/archive-home.jpg`);
  await redirects(await request('/og/archive-home.png'), `${media}/assets/site/avatar.png`);
  await redirects(await request('/qq-group.png'), `${media}/assets/site/qq-group.png`);
  await redirects(await request('/dist/community/qq-1134100615-bc8e49b662df6b84.png'), `${media}/assets/site/community/qq-1134100615-bc8e49b662df6b84.png`);
  main.status = 'hidden';
  await misses(await request('/og/archive--works-art-html.png'));
  main.status = 'deleted';
  await misses(await request('/og/works-art.jpg'));
  assert.equal(indexReads(), 0);
});

test('malformed, non-path, traversal and control inputs return a non-cacheable 400', async () => {
  const { request, indexReads } = preview();
  for (const path of [undefined, '', '/dist/../abc.webp', '/dist/%2e%2e/abc.webp', '/dist/%252e%252e/abc.webp',
    '/dist\\..\\abc.webp', '/dist/%00abc.webp', '/dist/\u0085abc.webp', '/dist/%E0%A4.webp', 'https://other.example/image.png', '//other.example/image.png']) {
    const response = await request(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).error, 'invalid_legacy_media_path');
  }
  assert.equal(indexReads(), 0);
});
