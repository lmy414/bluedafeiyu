import { createHash } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppContext } from '../../app.js';
import { categories, characters, topicWorks, topics, workCharacters, works } from '../../db/schema.js';
import type { JsonObject, TopicRow, WorkRow } from '../../db/schema.js';
import { topicCreatorId } from '../../services/publish.js';
import { openWorkWithRevision, safeUrl, text, translations, uniqueStrings } from '../../services/work-data.js';
import { topicAuthorChannels } from './data.js';

const ROOT = '/open-api/v1';
const PAGE_SIZE = 100;
const compare = (a: string, b: string) => a < b ? -1 : Number(a > b);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type Topic = Pick<TopicRow, 'id' | 'name' | 'summary' | 'coverWorkId' | 'author' | 'i18n' | 'updatedAt' | 'sortOrder'> & { workIds: string[] };
type Snapshot = {
  works: WorkRow[];
  roles: Map<string, string[]>;
  characters: Array<Pick<typeof characters.$inferSelect, 'id' | 'name' | 'aliases'>>;
  categories: Array<Pick<typeof categories.$inferSelect, 'id' | 'name' | 'description'>>;
  topics: Topic[];
};

export async function createOpenApi(snapshot: Snapshot, { site, media, pageSize = PAGE_SIZE }: { site: string; media: string; pageSize?: number }) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new RangeError('Invalid OpenAPI page size');
  const endpoint = (route: string) => `${site}${ROOT}/${route}`;
  const published = snapshot.works.filter(work => work.status === 'published').sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf() || compare(b.slug, a.slug));
  const knownWorks = new Set(published.map(work => work.id));
  const topics = snapshot.topics.map(topic => ({ ...topic, workIds: uniqueStrings(topic.workIds).filter(id => knownWorks.has(id)) }))
    .filter(topic => topic.workIds.length).sort((a, b) => a.sortOrder - b.sortOrder || compare(a.id, b.id));
  const groupsByWork = new Map<string, { topicIds: string[]; creatorIds: string[] }>();
  const authors = new Map<string, { id: string; name: string; bio: string; homepage: string | null;
    channels: Array<{ platform: string; label: string; url: string }>; topicIds: string[]; workIds: string[]; url: string; worksUrl: string }>();
  const topicCreators = new Map<string, string>();

  for (const topic of topics) {
    if (topic.author) {
      const author = topic.author;
      const channels = topicAuthorChannels(author);
      const id = topicCreatorId(topic.id, author);
      const creator = authors.get(id) ?? { id, name: text(author.name), bio: text(author.bio), homepage: safeUrl(author.url) || channels[0]?.url || null,
        channels: [], topicIds: [], workIds: [], url: `${site}/creators/${id}.html`, worksUrl: endpoint(`creators/${id}.json`) };
      creator.channels = [...new Map([...creator.channels, ...channels].map(channel => [channel.url, channel])).values()];
      creator.topicIds.push(topic.id);
      creator.workIds = uniqueStrings([...creator.workIds, ...topic.workIds]);
      authors.set(id, creator);
      topicCreators.set(topic.id, id);
    }
    for (const workId of topic.workIds) {
      const links = groupsByWork.get(workId) ?? { topicIds: [], creatorIds: [] };
      links.topicIds.push(topic.id);
      groupsByWork.set(workId, links);
    }
  }
  for (const creator of authors.values()) for (const workId of creator.workIds) groupsByWork.get(workId)?.creatorIds.push(creator.id);

  const full = await Promise.all(published.map(row => {
    const groups = groupsByWork.get(row.id);
    return openWorkWithRevision(row, snapshot.roles.get(row.id) ?? [], site, media, groups?.topicIds, groups?.creatorIds.sort());
  }));
  type OpenWork = (typeof full)[number];
  const summary = (work: OpenWork) => ({ id: work.id, name: work.name, revision: work.revision, detailUrl: work.detailUrl, originalUrl: work.image.originalUrl });
  const byWork = new Map(full.map(work => [work.id, work]));
  const documents = new Map<string, JsonObject>();
  const put = (file: string, data: JsonObject) => documents.set(`${ROOT}/${file}`, { apiVersion: 1, ...data });
  const group = (file: string, metadata: JsonObject, list: OpenWork[]) => put(file, { ...metadata, total: list.length, items: list.map(summary) });
  const orderedIds = (ids: string[]) => ids.flatMap(id => { const work = byWork.get(id); return work ? [work] : []; });
  const characterRows = snapshot.characters.map(character => {
    const file = `characters/${character.id}.json`;
    const list = full.filter(work => work.characterIds.includes(character.id));
    const row = { id: character.id, name: character.name, aliases: uniqueStrings(character.aliases), count: list.length, worksUrl: endpoint(file) };
    group(file, { character: row }, list);
    for (const category of snapshot.categories) group(`characters/${character.id}/categories/${category.id}.json`,
      { characterId: character.id, categoryId: category.id }, list.filter(work => work.categoryIds.includes(category.id)));
    return row;
  });
  const categoryRows = snapshot.categories.map(category => {
    const file = `categories/${category.id}.json`;
    const list = full.filter(work => work.categoryIds.includes(category.id));
    const row = { ...category, count: list.length, worksUrl: endpoint(file) };
    group(file, { category: row }, list);
    return row;
  });
  const byTag = new Map<string, OpenWork[]>();
  for (const work of full) for (const tag of work.tags) {
    const members = byTag.get(tag) ?? [];
    members.push(work);
    byTag.set(tag, members);
  }
  const tagRows = [...byTag.entries()].sort(([a], [b]) => compare(a, b)).map(([name, list]) => {
    const id = `tag-${hash(name)}`;
    const file = `tags/${id}.json`;
    const row = { id, name, count: list.length, worksUrl: endpoint(file) };
    group(file, { tag: row }, list);
    return row;
  });
  const topicRows = topics.map(topic => {
    const file = `topics/${topic.id}.json`;
    const row = { id: topic.id, name: topic.name, summary: topic.summary,
      coverWorkId: topic.coverWorkId && topic.workIds.includes(topic.coverWorkId) ? topic.coverWorkId : topic.workIds[0], workIds: topic.workIds,
      creatorId: topicCreators.get(topic.id) ?? null, count: topic.workIds.length, updatedAt: topic.updatedAt.toISOString(),
      url: `${site}/topics/${topic.id}.html`, worksUrl: endpoint(file), i18n: translations(topic.i18n, ['name', 'summary']) };
    group(file, { topic: row }, orderedIds(topic.workIds));
    return row;
  });
  const creatorRows = [...authors.values()].sort((a, b) => compare(a.id, b.id)).map(({ workIds, ...author }) => {
    const row = { ...author, count: workIds.length };
    group(`creators/${author.id}.json`, { creator: row }, orderedIds(workIds));
    return row;
  });
  const taxonomy = { characters: characterRows, categories: categoryRows, tags: tagRows, topics: topicRows, creators: creatorRows };
  put('taxonomy.json', taxonomy);
  for (const [kind, items] of Object.entries(taxonomy)) put(`${kind}.json`, { total: items.length, items });
  put('works.json', { total: full.length, items: full });
  for (const work of full) put(`works/${work.id}.json`, { work });
  const totalPages = Math.max(1, Math.ceil(full.length / pageSize));
  for (let page = 1; page <= totalPages; page++) put(`works/page/${page}.json`, { page, pageSize, total: full.length, totalPages,
    previous: page > 1 ? endpoint(`works/page/${page - 1}.json`) : null, next: page < totalPages ? endpoint(`works/page/${page + 1}.json`) : null,
    items: full.slice((page - 1) * pageSize, page * pageSize) });
  const entries = full.map(summary).sort((a, b) => compare(a.id, b.id));
  const revision = hash(JSON.stringify({ apiVersion: 1, pageSize, taxonomy, entries }));
  put('manifest.json', { revision, total: full.length, items: entries });
  const counts = { works: full.length, ...Object.fromEntries(Object.entries(taxonomy).map(([kind, rows]) => [kind, rows.length])) };
  put('index.json', { revision, counts, pageSize, totalPages, endpoints: { manifest: endpoint('manifest.json'), taxonomy: endpoint('taxonomy.json'),
    works: endpoint('works.json'), firstPage: endpoint('works/page/1.json'), ...Object.fromEntries(Object.keys(taxonomy).map(kind => [kind, endpoint(`${kind}.json`)])) },
    documentation: `${site}/about.html#open-data-api` });
  return { documents, revision, counts };
}

type CachedCatalog = { key: string; data: ReturnType<typeof createOpenApi> };

async function loadSnapshot(db: AppContext['db'], cached: CachedCatalog | undefined) {
  return db.transaction(async tx => {
    // The snapshot changes on writes committed by the API, Hermes, or an external import.
    const [version] = await tx.select({ key: sql<string>`pg_current_snapshot()::text` }).from(sql`(SELECT 1) snapshot_version`);
    const key = version?.key ?? '';
    if (cached?.key === key) return { key, cached: cached.data } as const;
    const workRows = await tx.select().from(works).where(eq(works.status, 'published'));
    const characterRows = await tx.select({ id: characters.id, name: characters.name, aliases: characters.aliases }).from(characters)
      .where(eq(characters.status, 'active')).orderBy(asc(characters.sortOrder), asc(characters.id));
    const categoryRows = await tx.select({ id: categories.id, name: categories.name, description: categories.description }).from(categories)
      .where(eq(categories.status, 'active')).orderBy(asc(categories.sortOrder), asc(categories.id));
    const topicRows = await tx.select().from(topics).where(eq(topics.status, 'active'));
    const links = await tx.select().from(topicWorks).orderBy(asc(topicWorks.position), asc(topicWorks.workId));
    const characterLinks = await tx.select().from(workCharacters).orderBy(asc(workCharacters.characterId));
    const roles = new Map<string, string[]>();
    const byTopic = new Map<string, string[]>();
    for (const { workId, characterId } of characterLinks) roles.set(workId, [...(roles.get(workId) ?? []), characterId]);
    for (const { topicId, workId } of links) {
      const members = byTopic.get(topicId) ?? [];
      members.push(workId);
      byTopic.set(topicId, members);
    }
    return { key, snapshot: { works: workRows, roles, characters: characterRows, categories: categoryRows,
      topics: topicRows.map(topic => ({ ...topic, workIds: [...(topic.isSerial && topic.coverWorkId ? [topic.coverWorkId] : []), ...(byTopic.get(topic.id) ?? [])] })) } } as const;
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

const knownPath = /^(?:(?:index|manifest|taxonomy|works|characters|categories|tags|topics|creators)|(?:works|characters|categories|tags|topics|creators)\/[\w-]+|works\/page\/[1-9]\d*|characters\/[\w-]+\/categories\/[\w-]+)\.json$/;

export function createOpenApiRoutes(ctx: AppContext) {
  const routes = new Hono();
  let cache: CachedCatalog | undefined;
  routes.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'If-None-Match');
    c.header('Access-Control-Expose-Headers', 'ETag');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });
  routes.get('*', async c => {
    const file = c.req.path.slice(ROOT.length + 1);
    if (!knownPath.test(file)) return c.json({ apiVersion: 1, error: 'not_found' }, 404);
    const loaded = await loadSnapshot(ctx.db, cache);
    let dataPromise = loaded.cached ?? (cache?.key === loaded.key ? cache.data : undefined);
    if (!dataPromise && loaded.snapshot) {
      dataPromise = createOpenApi(loaded.snapshot, { site: ctx.config.SITE_PUBLIC_URL, media: ctx.config.R2_PUBLIC_BASE_URL });
      cache = { key: loaded.key, data: dataPromise };
    }
    if (!dataPromise) throw new Error('OpenAPI snapshot unavailable');
    const { documents } = await dataPromise.catch((error: unknown) => {
      if (cache?.data === dataPromise) cache = undefined;
      throw error;
    });
    const data = documents.get(`${ROOT}/${file}`);
    if (!data) return c.json({ apiVersion: 1, error: 'not_found' }, 404);
    const body = `${JSON.stringify(data)}\n`;
    const etag = `"${hash(body)}"`;
    c.header('Cache-Control', 'public, max-age=60, s-maxage=180');
    c.header('ETag', etag);
    if (c.req.header('if-none-match')?.split(',').some(token => token.trim().replace(/^W\//, '') === etag || token.trim() === '*')) return c.body(null, 304);
    c.header('Content-Type', 'application/json; charset=utf-8');
    return c.body(body);
  });
  return routes;
}
