import {hash, writeOrReuse} from './incremental.mjs';
import {imageRights} from '../src/lib/image-metadata.mjs';
import {workAttribution, safeHomepage} from '../../admin/src/lib/attribution.mjs';
import {workCharacterIds} from '../../tools/work-characters.mjs';

export const API_ROOT = '/open-api/v1';
export const API_ORIGIN = 'https://xn--pssy23gqgbz2d718b.com';
export const API_PAGE_SIZE = 100;
const text = value => typeof value === 'string' ? value : '';
const unique = values => [...new Set(values)];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const endpoint = relative => `${API_ORIGIN}${API_ROOT}/${relative}`;
const absolute = value => {
  if (!text(value).trim()) return null;
  try { return safeHomepage(new URL(value, API_ORIGIN + '/').href) || null; }
  catch { return null; }
};
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const strings = values => unique((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.trim()));
const publicTranslations = (value, fields) => Object.fromEntries(['en', 'ja'].filter(lang => value?.[lang]).map(lang => [lang,
  Object.fromEntries(fields.filter(key => typeof value[lang][key] === 'string' || Array.isArray(value[lang][key])).map(key => [key, value[lang][key]]))
]));

function validateKeys(rows, field, kind) {
  const seen = new Set();
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value) || seen.has(value)) {
      throw new Error(`开放 API ${kind} ${field} 非法或重复：${value}`);
    }
    seen.add(value);
  }
}

// Public records are deliberately projected. Intake state, submitter accounts,
// localization source hashes and internal editorial fields never enter this API.
export function createOpenApi(snapshot, {pageSize = API_PAGE_SIZE} = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('开放 API 分页大小无效');
  const documents = new Map();
  const put = (file, data) => documents.set(`${API_ROOT}/${file}`, JSON.stringify({apiVersion: 1, ...data}) + '\n');
  const characters = snapshot.characters.filter(c => c.status === 'active');
  const categories = snapshot.categories.filter(c => c.status === 'active');
  const published = snapshot.works.filter(w => w.status === 'published').slice()
    .sort((a, b) => compare(text(b.createdAt), text(a.createdAt)) || compare(b.slug, a.slug));
  for (const [rows, field, kind] of [[published, 'id', '作品'], [published, 'slug', '作品'], [characters, 'id', '角色'], [categories, 'id', '类型']]) validateKeys(rows, field, kind);
  const byId = new Map(published.map(w => [w.id, w]));
  const characterIds = new Set(characters.map(c => c.id)), categoryIds = new Set(categories.map(c => c.id));
  const topics = (snapshot.topics || []).filter(t => t.status === 'active' || t.status === undefined)
    .map(t => ({...t, workIds: unique((t.workIds || []).filter(id => byId.has(id)))})).filter(t => t.workIds.length);
  validateKeys(topics, 'id', '专题');
  topics.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || compare(a.id, b.id));

  const creators = new Map(), topicCreators = new Map();
  for (const topic of topics.filter(t => t.author)) {
    const author = topic.author;
    const channels = (author.channels || []).map(c => ({platform: text(c.platform), label: text(c.label), url: safeHomepage(c.url)})).filter(c => c.url);
    const uid = channels.map(c => c.url.match(/^https?:\/\/space\.bilibili\.com\/(\d+)(?:[/?#]|$)/)?.[1]).find(Boolean);
    const id = uid ? 'bilibili-' + uid : topic.id;
    const creator = creators.get(id) || {id, name: text(author.name), bio: text(author.bio), homepage: safeHomepage(author.url) || channels[0]?.url || null,
      channels: [], topicIds: [], workIds: [], url: `${API_ORIGIN}/creators/${id}.html`, worksUrl: endpoint(`creators/${id}.json`)};
    creator.channels = [...new Map([...creator.channels, ...channels].map(c => [c.url, c])).values()];
    creator.topicIds.push(topic.id);
    creator.workIds = unique([...creator.workIds, ...topic.workIds]);
    creators.set(id, creator);
    topicCreators.set(topic.id, id);
  }

  const works = published.map(w => {
    const roles = workCharacterIds(w);
    const types = strings(w.categoryIds);
    if (!roles.length || roles.some(id => !characterIds.has(id)) || types.length !== 1 || !categoryIds.has(types[0])) {
      throw new Error(`开放 API 作品分类无效：${w.id}`);
    }
    const rights = imageRights(w), attribution = workAttribution(w);
    const originalUrl = absolute(w.originalUrl || w.path);
    if (!originalUrl) throw new Error(`开放 API 缺少有效原图地址：${w.id}`);
    const work = {
      id: w.id, slug: w.slug, name: text(w.name), description: text(w.description), commentary: text(w.commentary),
      url: `${API_ORIGIN}/works/${w.slug}.html`, detailUrl: endpoint(`works/${w.id}.json`),
      characterId: roles.includes(w.characterId) ? w.characterId : roles[0], characterIds: roles, categoryIds: types,
      topicIds: topics.filter(t => t.workIds.includes(w.id)).map(t => t.id),
      creatorIds: [...creators.values()].filter(c => c.workIds.includes(w.id)).map(c => c.id),
      tags: strings(w.tags), createdAt: text(w.createdAt) || null, updatedAt: text(w.updatedAt || w.createdAt) || null,
      author: {name: rights.creator || null},
      attribution: {name: rights.creditName || null, url: attribution.url || null, explicit: attribution.explicit},
      source: {type: text(w.origin?.type) || 'unknown', url: safeHomepage(w.origin?.sourceUrl) || safeHomepage(w.origin?.issueUrl) || null},
      license: {type: rights.type, note: text(w.license?.note), url: rights.license, copyrightNotice: rights.copyrightNotice},
      image: {originalUrl, thumbnailUrl: absolute(w.thumbUrl || w.thumbnailPath), displayUrl: absolute(w.displayUrl || w.fullPath || w.thumbUrl || w.thumbnailPath),
        format: text(w.format).toLowerCase() || null, mimeType: text(w.mimeType) || null, animated: Boolean(w.isAnimated),
        width: positive(w.width), height: positive(w.height), bytes: positive(w.fileSize), sha256: /^[a-f0-9]{64}$/i.test(w.sha256 || '') ? w.sha256.toLowerCase() : null},
      i18n: publicTranslations(w.i18n, ['name', 'description', 'commentary', 'tags', 'licenseNote'])
    };
    return {...work, revision: hash(work)};
  });
  const apiById = new Map(works.map(w => [w.id, w]));
  const summary = w => ({id: w.id, name: w.name, revision: w.revision, detailUrl: w.detailUrl, originalUrl: w.image.originalUrl});
  const group = (file, metadata, list) => {
    put(file, {...metadata, total: list.length, items: list.map(summary)});
  };
  const characterRows = characters.map(c => {
    const list = works.filter(w => w.characterIds.includes(c.id));
    const row = {id: c.id, name: text(c.name), aliases: strings(c.aliases), count: list.length, worksUrl: endpoint(`characters/${c.id}.json`)};
    group(`characters/${c.id}.json`, {character: row}, list);
    for (const type of categories) {
      group(`characters/${c.id}/categories/${type.id}.json`, {characterId: c.id, categoryId: type.id}, list.filter(w => w.categoryIds.includes(type.id)));
    }
    return row;
  });
  const categoryRows = categories.map(c => {
    const list = works.filter(w => w.categoryIds.includes(c.id));
    const row = {id: c.id, name: text(c.name), description: text(c.description), count: list.length, worksUrl: endpoint(`categories/${c.id}.json`)};
    group(`categories/${c.id}.json`, {category: row}, list);
    return row;
  });
  const tagRows = unique(works.flatMap(w => w.tags)).sort(compare).map(name => {
    const id = 'tag-' + hash(name), list = works.filter(w => w.tags.includes(name));
    const row = {id, name, count: list.length, worksUrl: endpoint(`tags/${id}.json`)};
    group(`tags/${id}.json`, {tag: row}, list);
    return row;
  });
  const topicRows = topics.map(t => {
    const row = {id: t.id, name: text(t.name), summary: text(t.summary),
      coverWorkId: t.workIds.includes(t.coverWorkId) ? t.coverWorkId : t.workIds[0], workIds: t.workIds,
      creatorId: topicCreators.get(t.id) || null, count: t.workIds.length, updatedAt: text(t.updatedAt) || null,
      url: `${API_ORIGIN}/topics/${t.id}.html`, worksUrl: endpoint(`topics/${t.id}.json`), i18n: publicTranslations(t.i18n, ['name', 'summary'])};
    group(`topics/${t.id}.json`, {topic: row}, t.workIds.map(id => apiById.get(id)));
    return row;
  });
  const creatorRows = [...creators.values()].sort((a, b) => compare(a.id, b.id)).map(c => {
    const {workIds, ...fields} = c;
    const row = {...fields, count: workIds.length};
    group(`creators/${c.id}.json`, {creator: row}, workIds.map(id => apiById.get(id)));
    return row;
  });
  const taxonomy = {characters: characterRows, categories: categoryRows, tags: tagRows, topics: topicRows, creators: creatorRows};
  put('taxonomy.json', taxonomy);
  for (const [name, items] of Object.entries(taxonomy)) put(`${name}.json`, {total: items.length, items});
  put('works.json', {total: works.length, items: works});
  for (const work of works) put(`works/${work.id}.json`, {work});
  const totalPages = Math.max(1, Math.ceil(works.length / pageSize));
  for (let page = 1; page <= totalPages; page++) {
    put(`works/page/${page}.json`, {page, pageSize, total: works.length, totalPages,
      previous: page > 1 ? endpoint(`works/page/${page - 1}.json`) : null,
      next: page < totalPages ? endpoint(`works/page/${page + 1}.json`) : null, items: works.slice((page - 1) * pageSize, page * pageSize)});
  }
  // The manifest is a complete inventory, so consumers can detect removals by
  // comparing IDs without a server-side change log or a retained private tombstone.
  const entries = works.map(summary).sort((a, b) => compare(a.id, b.id));
  const revision = hash({apiVersion: 1, pageSize, taxonomy, entries});
  put('manifest.json', {revision, total: works.length, items: entries});
  const counts = {works: works.length, ...Object.fromEntries(Object.entries(taxonomy).map(([kind, rows]) => [kind, rows.length]))};
  put('index.json', {revision, counts, pageSize, totalPages, endpoints: {
    manifest: endpoint('manifest.json'), taxonomy: endpoint('taxonomy.json'), works: endpoint('works.json'), firstPage: endpoint('works/page/1.json'),
    ...Object.fromEntries(Object.keys(taxonomy).map(kind => [kind, endpoint(`${kind}.json`)]))
  }, documentation: `${API_ORIGIN}/about.html#open-data-api`});
  return {documents, revision, counts};
}

export function writeOpenApi(out, snapshot, {previousDir, previousState} = {}) {
  const result = createOpenApi(snapshot);
  let written = 0, reused = 0;
  for (const [route, content] of result.documents) {
    if (writeOrReuse(out, route.slice(1), content, previousDir, previousState)) written++;
    else reused++;
  }
  return {...result.counts, revision: result.revision, documents: result.documents.size, written, reused};
}
