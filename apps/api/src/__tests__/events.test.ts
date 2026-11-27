import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Database, DbTransaction } from '../db/client.js';

const config = loadConfig({ DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
  R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', SESSION_SECRET: 'b'.repeat(32) });
const admin = '/api/v1/admin/events';
const columns = ['id', 'slug', 'title', 'summary', 'i18n', 'payload', 'status', 'starts_at', 'ends_at'] as const;
const base = { slug: 'design-contest', title: '设计征集' };
const popup = { version: '2', badge: '正在征集', highlights: ['提交设计稿'], ctaUrl: '/events/design-contest', secondaryUrl: 'https://gallery.example/',
  i18n: { en: { headline: 'Submit a design' } } };
const eventInput = { ...base, summary: '提交你的站点设计', startsAt: '2025-01-01T08:00:00+08:00', endsAt: '2099-01-01T00:00:00Z',
  i18n: { en: { title: 'Design contest', summary: 'Submit a design', popup: { ctaLabel: 'Join' } }, ja: { title: 'デザイン募集' } },
  payload: { body: '活动详情', url: '/events/design-contest', repository: 'https://github.com/example/contest', exhibition: '/events/archive',
    cover: { src: '/images/contest.webp', width: 720, height: 900 }, popup },
};

function eventApp(authenticated = true) {
  const stored = new Map<string, Record<string, unknown>>();
  const audit: { id: unknown; action: unknown; diff: unknown }[] = [];
  const purged: string[][] = [];
  const result = (row: Record<string, unknown>) => columns.map(column => row[column]);
  const value = (column: string, raw: unknown) => typeof raw === 'string' && (column === 'i18n' || column === 'payload') ? JSON.parse(raw) : raw;
  const db = drizzle(async (statement, params) => {
    if (statement.startsWith('insert into "events"')) {
      assert.match(statement, /on conflict do nothing returning/);
      const bindings = /values \(([^)]+)\)/.exec(statement)?.[1]?.split(', ');
      assert(bindings);
      const row: Record<string, unknown> = Object.fromEntries(columns.map((column, i) => {
        const binding = bindings[i];
        if (binding?.startsWith('$')) return [column, value(column, params[Number(binding.slice(1)) - 1])];
        return [column, column === 'i18n' ? {} : null];
      }));
      assert.equal(typeof row.id, 'string');
      const id = String(row.id);
      if (stored.has(id) || [...stored.values()].some(existing => existing.slug === row.slug)) return { rows: [] };
      stored.set(id, row);
      return { rows: [result(row)] };
    }
    if (statement.startsWith('update "events"')) {
      const id = String(params.at(-1));
      const previous = stored.get(id);
      assert(previous);
      const assignments = [...(statement.split(' where ')[0] ?? '').matchAll(/"([a-z_]+)" = \$(\d+)/g)];
      const patch = Object.fromEntries(assignments.map(([, column, index]) => [column, value(column ?? '', params[Number(index) - 1])]));
      if ([...stored.values()].some(row => row.id !== id && row.slug === patch.slug)) throw Object.assign(new Error('Unique violation'), { code: '23505' });
      const updated = { ...previous, ...patch };
      stored.set(id, updated);
      return { rows: [result(updated)] };
    }
    if (statement.startsWith('delete from "events"')) {
      const id = String(params[0]);
      const row = stored.get(id);
      if (!row) return { rows: [] };
      stored.delete(id);
      return { rows: [[row.slug]] };
    }
    if (statement.includes('from "events"')) {
      if (statement.includes('"events"."id" =')) {
        const row = stored.get(String(params[0]));
        return { rows: row ? [result(row)] : [] };
      }
      assert.match(statement, /order by "events"\."starts_at" desc, "events"\."id" asc$/);
      const rows = [...stored.values()];
      const now = new Date().toISOString();
      const subset = params.length ? rows.filter(row => {
        const ended = typeof row.ends_at === 'string' && row.ends_at < now;
        const started = row.starts_at == null || String(row.starts_at) <= now;
        const active = row.status === 'active' && started && !ended;
        const archived = row.status === 'archived' || (row.status === 'active' && ended);
        return (params[0] === 'active' && active) || (params.includes('archived') && archived);
      }) : rows;
      return { rows: subset.sort((a, b) => Number(b.starts_at == null) - Number(a.starts_at == null) ||
        String(b.starts_at).localeCompare(String(a.starts_at)) || String(a.id).localeCompare(String(b.id))).map(result) };
    }
    if (statement.startsWith('insert into "audit_events"')) {
      assert.deepEqual(params.slice(0, 3), ['owner', 'owner-test', 'event']);
      audit.push({ id: params[3], action: params[4], diff: params[5] ? JSON.parse(String(params[5])) : undefined });
      return { rows: [] };
    }
    if (statement.startsWith('select count(') || statement.includes('from "friend_links"')) return { rows: [] };
    return assert.fail(`Unexpected query: ${statement}`);
  });
  Object.assign(db, { transaction: async (action: (tx: DbTransaction) => unknown) => action(db as unknown as DbTransaction) });
  const app = createApp({ db: db as unknown as Database, config, services: {
    authenticateAdmin: async () => authenticated ? { id: 'owner-test', email: 'owner@example.com', role: 'owner' } : null,
    cloudflare: { async purgePaths(paths) { purged.push([...paths]); }, async purgePrefixes() {} },
  } });
  const write = (method: 'POST' | 'PATCH' | 'DELETE', path: string, input?: unknown) => app.request(path, {
    method, headers: { Origin: config.SITE_PUBLIC_URL, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  return { app, write, audit, purged };
}

test('admin events are published immediately, preserve popup settings on edits, and can be archived or deleted', async () => {
  const { app, write, audit, purged } = eventApp();
  const created = await write('POST', admin, eventInput);
  assert.equal(created.status, 201);
  const row = await created.json();
  assert.equal(row.id, base.slug);
  assert.equal(row.status, 'active');
  assert.equal(row.startsAt, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(row.i18n, eventInput.i18n);
  assert.deepEqual(row.payload, { ...eventInput.payload, popup: { ...popup, enabled: true } });
  const idPath = `${admin}/${row.id}`;
  const detail = await app.request(idPath);
  assert.equal(detail.status, 200);
  assert.deepEqual(await detail.json(), row);

  const [publicEvents, siteMeta] = await Promise.all([app.request('/api/v1/events'), app.request('/api/v1/site-meta')]);
  assert.equal(publicEvents.status, 200);
  assert.deepEqual(await publicEvents.json(), { items: [row], total: 1 });
  assert.equal(siteMeta.status, 200);
  assert.deepEqual((await siteMeta.json()).events, [row]);

  const edited = await write('PATCH', idPath, { status: 'archived', slug: 'contest-recap', payload: { popup: { version: '3', enabled: false } } });
  assert.equal(edited.status, 200);
  const archived = await edited.json();
  assert.equal(archived.status, 'archived');
  assert.deepEqual(archived.payload, { ...row.payload, popup: { ...popup, version: '3', enabled: false } });
  assert.deepEqual((await (await app.request('/api/v1/events?status=active')).json()).items, []);
  assert.deepEqual((await (await app.request('/api/v1/events?status=archived')).json()).items, [archived]);
  assert.deepEqual((await (await app.request('/api/v1/site-meta')).json()).events, []);

  const hidden = await (await write('POST', admin, { id: 'internal-draft', slug: 'draft', title: '预告', status: 'hidden', startsAt: null })).json();
  const listed = await app.request(admin);
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { items: [hidden, archived], total: 2 });
  assert.deepEqual((await (await app.request('/api/v1/events?status=all')).json()).items, [archived]);

  const removed = await write('DELETE', idPath);
  assert.equal(removed.status, 204);
  assert.equal((await app.request(idPath)).status, 404);
  assert.equal((await (await write('DELETE', idPath)).json()).error, 'event_not_found');
  assert.deepEqual(audit.map(({ id, action }) => [id, action]), [[row.id, 'create'], [row.id, 'update'], ['internal-draft', 'create'], [row.id, 'delete']]);
  assert.deepEqual(audit[1]?.diff, { fields: ['slug', 'status', 'payload'], status: { from: 'active', to: 'archived' } });
  for (const prefix of ['', '/zh-hant', '/en', '/ja']) {
    for (const path of ['/', '/events', '/events/current', '/events/archive', '/events/contest-recap']) {
      assert(purged[1]?.includes(prefix + path));
      assert(purged[3]?.includes(prefix + path));
    }
    assert(purged[0]?.includes(`${prefix}/events/design-contest`));
    assert(purged[1]?.includes(`${prefix}/events/design-contest`));
  }
});

test('admin event writes validate links and time windows and reject duplicate slugs', async () => {
  const { write, audit, purged } = eventApp();
  const unsafe = 'javascript:alert(1)';
  for (const payload of [{ url: unsafe }, { repository: unsafe }, { exhibition: unsafe }, { cover: { src: unsafe } },
    { popup: { ctaUrl: unsafe } }, { popup: { secondaryUrl: unsafe } }, { popup: { i18n: { en: { ctaUrl: unsafe } } } },
    { url: '//other.example/path' }, { popup: { ctaUrl: '/\\other.example' } }]) {
    const response = await write('POST', admin, { ...base, payload });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, 'invalid_input');
  }
  const reversed = await write('POST', admin, { ...eventInput, endsAt: '2024-01-01T00:00:00Z' });
  assert.equal(reversed.status, 422);
  assert.equal((await reversed.json()).error, 'invalid_event_window');
  assert.deepEqual(audit, []);
  assert.deepEqual(purged, []);

  assert.equal((await write('POST', admin, eventInput)).status, 201);
  const indexUrl = `${admin}/${base.slug}`;
  const invalidPatch = await write('PATCH', indexUrl, { endsAt: '2024-01-01T00:00:00Z' });
  assert.equal(invalidPatch.status, 422);
  assert.equal((await invalidPatch.json()).error, 'invalid_event_window');
  const duplicate = await write('POST', admin, { ...eventInput, id: 'another-id' });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, 'event_exists');
  assert.equal((await write('POST', admin, { ...base, slug: 'other-event' })).status, 201);
  const duplicatePatch = await write('PATCH', indexUrl, { slug: 'other-event' });
  assert.equal(duplicatePatch.status, 409);
  assert.equal((await duplicatePatch.json()).error, 'event_exists');
  const openEnded = await write('PATCH', indexUrl, { endsAt: null });
  assert.equal(openEnded.status, 200);
  assert.equal((await openEnded.json()).endsAt, null);
});

test('admin events require an owner and existing mutation origin checks apply', async () => {
  const anonymous = eventApp(false);
  assert.equal((await anonymous.app.request(admin)).status, 401);
  assert.equal((await anonymous.write('POST', admin, base)).status, 401);
  const { app } = eventApp();
  const forbidden = await app.request(admin, { method: 'POST', headers: { Origin: 'https://other.example' }, body: JSON.stringify(base) });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, 'invalid_origin');
});
