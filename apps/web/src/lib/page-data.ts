import { api, categoryIds, type Filters, type Topic } from './api';
import { topicReading } from '../content/topic-reading';
import type { Locale } from './i18n';
import type { DirectoryView } from './routes';
import { getSort, pageNumber } from './site';
import { workCharacters } from './work-view';
import { characterLimit, parseCharacters } from './character-filter';

export async function loadWork(locale: Locale, id: string) {
  const result = await api.work(id, locale);
  if (!result.ok) return result;
  const work = result.value.work;
  const roles = workCharacters(work);
  if (roles.length && !roles.every(role => role.aliases && role.name !== role.id)) {
    const catalog = await api.characters(locale);
    return { ok: true, value: { ...result.value, work: { ...work, characters: workCharacters(work, catalog.items) } } } as const;
  }
  return result;
}

export async function loadCategoryTotals(filters: Pick<Filters, 'lang' | 'character' | 'creation' | 'q' | 'tag'>) {
  return Promise.all(categoryIds.map(async (id) => {
    const result = await api.works({ ...filters, category: id, pageSize: 1 });
    return { id, total: result.unavailable ? undefined : result.total };
  }));
}

export async function loadGallery(locale: Locale, path: string, params: URLSearchParams, categoryId?: string, characterId?: string) {
  const q = params.get('q')?.trim().slice(0, 100) || undefined;
  const page = pageNumber(params.get('page'));
  const sort = getSort(params.get('sort'));
  const category = categoryId ?? categoryIds.find((entry) => entry === params.get('category'));
  const selectedCharacters = parseCharacters(params);
  const charactersFilter = characterId ? [...new Set([characterId, ...selectedCharacters])].slice(0, characterLimit) : selectedCharacters;
  const creation = params.get('creation') === 'non-ai' ? 'non-ai' : undefined;
  const tag = params.get('tag')?.slice(0, 120);
  const filters = { lang: locale, q, tag, character: charactersFilter.join(','), creation } satisfies Filters;
  const isHome = path === '/' && !q && !category && !selectedCharacters.length && !tag && !creation && sort === 'newest' && page === 1;
  const isGif = path === '/gifs';
  const [listing, characters, categories, profile, categoryTotals, meta] = await Promise.all([
    api.works({ ...filters, page, pageSize: 24, sort, category, animated: isGif ? true : undefined }),
    api.characters(locale), api.categories(locale),
    characterId ? api.character(characterId, locale) : undefined,
    characterId ? loadCategoryTotals(filters) : undefined,
    isHome ? api.siteMeta(locale) : undefined,
  ]);
  const status = profile && !profile.ok ? profile.status : undefined;
  const counts = meta?.ok ? meta.value.counts : undefined;
  return { q, tag, page, isHome, isGif, category, listing, characters, categories, profile, categoryTotals, counts, status, unavailable: listing.unavailable || characters.unavailable || categories.unavailable || Boolean(categoryTotals?.some((entry) => entry.total === undefined)) };
}

export async function archivedTopic(locale: Locale, id: string): Promise<Topic | undefined> {
  const editorial = Object.hasOwn(topicReading, id) ? topicReading[id] : undefined;
  if (!editorial?.works || !editorial.name || !editorial.summary) return;
  const results = await Promise.all(editorial.works.map((workId) => api.work(workId, locale)));
  const works = results.flatMap((result) => result.ok ? [result.value.work] : []);
  const [name, enName, jaName] = editorial.name;
  const [summary, enSummary, jaSummary] = editorial.summary;
  return { id, name: name!, summary, works, cover: works[0], workCount: works.length, i18n: { en: { name: enName, summary: enSummary }, ja: { name: jaName, summary: jaSummary } } };
}

export async function loadTopic(locale: Locale, id: string, readerPage?: number) {
  const [topicResult, pageResult, characters] = await Promise.all([
    readerPage ? undefined : api.topic(id, locale),
    readerPage ? api.topicPage(id, readerPage, locale) : undefined,
    readerPage ? undefined : api.characters(locale),
  ]);
  const reader = pageResult?.ok ? pageResult.value : undefined;
  const topic = topicResult?.ok ? topicResult.value : reader?.topic ?? (topicResult?.status === 404 ? await archivedTopic(locale, id) : undefined);
  const status = !topic ? (topicResult && !topicResult.ok ? topicResult.status : pageResult && !pageResult.ok ? pageResult.status : 404) : undefined;
  return { reader, topic, characters, status };
}

export async function loadDirectory(locale: Locale, view: DirectoryView, query: URLSearchParams) {
  const filters = { lang: locale, page: pageNumber(query.get('page')), pageSize: 24 };
  const [characters, topics, videos] = await Promise.all([
    view === 'characters' ? api.characters(locale) : undefined,
    view === 'topics' || view === 'serials' ? api.topics({ ...filters, serial: view === 'serials' }) : undefined,
    view === 'videos' ? api.videos({ ...filters, creator: query.get('creator')?.slice(0, 64), q: query.get('q')?.slice(0, 100), sort: query.get('sort') === 'oldest' ? 'oldest' : undefined }) : undefined,
  ]);
  const unavailable = (characters ?? topics ?? videos)?.unavailable;
  return { characters, topics, videos, unavailable };
}
