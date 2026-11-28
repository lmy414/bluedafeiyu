import { localizedText, type Locale } from './i18n';
import { CATEGORY_IDS, type WorkSummary } from '../../../../packages/shared/src/types/index';
import { defaultCharacterName } from '../../../../packages/shared/src/character-names';

type TextField = 'name' | 'title' | 'description' | 'summary' | 'commentary' | 'intro' | 'seoTitle' | 'seoDescription';
type Translation = Partial<Record<TextField | 'originNote' | 'licenseNote', string>> & { tags?: string[] };
type Translations = Partial<Record<'en' | 'ja', Translation>>;
export interface Taxon {
  id: string;
  name: string;
  description?: string;
  i18n?: Translations;
}
export interface Character extends Taxon {
  aliases?: string[];
  portraitUrl?: string;
  portraitKey?: string;
  portraitWidth?: number;
  portraitHeight?: number;
  brandTokens?: Record<string, string | Record<string, string>>;
  workCount?: number;
}
export interface Attribution {
  name?: string | null;
  label?: string;
  title?: string;
  url?: string | null;
  sourceUrl?: string;
  issueUrl?: string;
  text?: string;
  note?: string;
  type?: string;
  author?: string;
  code?: string;
  copyrightNotice?: string;
  platform?: string;
  explicit?: boolean;
}
export interface Work extends Taxon, Pick<WorkSummary, 'slug'> {
  commentary?: string;
  kind?: string;
  tags?: string[];
  origin?: Attribution | string;
  license?: Attribution | string;
  submitter?: Attribution | string;
  source?: Attribution;
  attribution?: Attribution;
  credit?: Attribution | string;
  author?: Attribution | string | null;
  seoTitle?: string;
  seoDescription?: string;
  createdAt?: string | null;
  publishedAt?: string | null;
  updatedAt?: string;
  primaryCharacterId?: string;
  characterId?: string;
  characterIds?: string[];
  categoryId?: string;
  categoryIds?: string[];
  character?: Character | null;
  characters?: Character[];
  category?: Taxon;
  topicIds?: string[];
  image?: {
    originalUrl?: string; thumbnailUrl?: string; displayUrl?: string;
    thumbWidth?: number; thumbHeight?: number; width?: number; height?: number; format?: string;
    displayWidth?: number; displayHeight?: number; mimeType?: string; bytes?: number;
  };
  originalUrl?: string;
  thumbnailUrl?: string;
  thumbUrl?: string;
  displayUrl?: string;
  r2OriginalKey?: string;
  r2ThumbKey?: string;
  r2DisplayKey?: string;
  thumbWidth?: number;
  thumbHeight?: number;
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
  format?: string;
  mimeType?: string;
  fileSize?: number;
  viewCount?: number;
  downloadCount?: number;
  isAnimated?: boolean;
  ogImageUrl?: string;
}
export interface Topic extends Taxon {
  summary?: string;
  isSerial?: boolean;
  cover?: Work;
  coverWork?: Work;
  coverWorkId?: string;
  coverUrl?: string;
  author?: Attribution & { id?: string; creatorId?: string; avatarUrl?: string; avatarKey?: string; bio?: string; channels?: Attribution[] };
  readerConfig?: { totalPages?: number; credits?: unknown; creditsI18n?: Partial<Record<'en' | 'ja', unknown>> };
  reader?: { totalPages?: number; pages?: Array<{ pageNumber: number; work?: Work; workId?: string }> };
  pages?: Array<{ pageNumber: number; work?: Work; workId?: string }>;
  works?: Array<Work | { work: Work; pageNumber?: number | null }>;
  workCount?: number;
  updatedAt?: string;
}
export interface CreatorPreview { kind: 'image' | 'video' | 'serial'; title: string; href: string; thumbUrl?: string }
export interface Creator {
  id: string;
  uid?: string | number | null;
  name: string;
  homepage?: string;
  intro?: string;
  avatarUrl?: string;
  avatarKey?: string;
  i18n?: Translations;
  channels?: Attribution[];
  workCount?: number;
  videoCount?: number;
  serialCount?: number;
  totalCount?: number;
  latestAt?: string | null;
  previews?: CreatorPreview[];
}
export interface CreatorProfile {
  creator: Creator;
  topics?: Topic[] | ListResponse<Topic>;
  serials?: Topic[] | ListResponse<Topic>;
  works?: Work[] | ListResponse<Work>;
  videos?: Video[] | ListResponse<Video>;
}
export interface Video {
  id: string;
  title: string;
  bvid: string;
  creatorId?: string;
  creator?: Creator;
  url?: string;
  coverUrl?: string;
  publishedAt?: string;
  description?: string;
  i18n?: Translations;
  source?: { url?: string; cover?: string; coverUrl?: string; description?: string; pic?: string };
  review?: { i18n?: Translations };
}
type EventPopupCopy = {
  badge?: string;
  shortLabel?: string;
  headline?: string;
  description?: string;
  highlights?: string[];
  ctaLabel?: string;
  secondaryLabel?: string;
};

export interface EventItem {
  id: string;
  slug: string;
  title: string;
  summary?: string;
  i18n?: Translations;
  startsAt?: string | null;
  endsAt?: string | null;
  status?: 'active' | 'archived';
  payload?: {
    url?: string;
    body?: string;
    repository?: string;
    exhibition?: string;
    cover?: { src?: string; width?: number; height?: number; alt?: string };
    popupVersion?: string | number;
    popup?: EventPopupCopy & {
      enabled?: boolean;
      version?: string | number;
      popupVersion?: string | number;
      ctaUrl?: string;
      secondaryUrl?: string;
      i18n?: Partial<Record<Locale, EventPopupCopy>>;
    };
  };
}
export interface FriendLink extends Taxon {
  url: string;
  kind: 'friend' | 'project';
  avatarUrl?: string;
  avatarKey?: string;
  category?: string;
  projectCategory?: string;
}

type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number };
type WorkNeighbor = Pick<Work, 'id' | 'slug' | 'name'>;
export interface WorkDetail {
  work: Work;
  recommendations: Work[];
  topics: Topic[];
  previous?: WorkNeighbor | null;
  next?: WorkNeighbor | null;
}
type WorkResponse = Partial<WorkDetail> & Partial<Work> & { related?: Work[]; relatedWorks?: Work[]; relatedTopics?: Topic[] };
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize?: number;
  nextPage: number | null;
  nextCursor?: string;
  unavailable: boolean;
}
export type SiteCounts = Partial<Record<'works' | 'characters' | 'videos' | 'topics' | 'serials' | 'creators' | 'totalViews' | 'totalDownloads', number>>;
export interface Filters {
  lang: Locale;
  page?: number;
  cursor?: string;
  pageSize?: number;
  q?: string;
  /** Comma-separated character IDs. A work must contain every requested character. */
  character?: string;
  creation?: 'non-ai';
  category?: string;
  tag?: string;
  topic?: string;
  animated?: boolean;
  serial?: boolean;
  creator?: string;
  sort?: string;
  kind?: string;
  status?: 'active' | 'archived' | 'all';
}
interface ListResponse<T> {
  items?: T[];
  total?: number;
  count?: number;
  page?: number;
  limit?: number;
  pageSize?: number;
  totalPages?: number;
  nextPage?: number | null;
  nextCursor?: string | null;
  hasMore?: boolean;
  pagination?: Omit<ListResponse<T>, 'items' | 'pagination'>;
}

function unwrap(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const { data, ...metadata } = payload;
    if (Array.isArray(data)) return { ...metadata, items: data };
    if (data && typeof data === 'object') return { ...metadata, ...data };
  }
  return payload;
}

const defaultBase = 'http://127.0.0.1:4331';
export function apiBase() {
  return process.env.API_BASE_URL || import.meta.env.API_BASE_URL || defaultBase;
}

async function request<T>(path: string, filters?: Filters, signal = AbortSignal.timeout(3500)): Promise<ApiResult<T>> {
  try {
    const url = new URL(path, apiBase());
    for (const [key, value] of Object.entries(filters ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const reply = await fetch(url, { headers: { Accept: 'application/json' }, signal, redirect: 'error' });
    if (!reply.ok) return { ok: false, status: reply.status };
    const data = unwrap(await reply.json());
    if (!data || typeof data !== 'object' || ('ok' in data && data.ok === false)) return { ok: false, status: 502 };
    return { ok: true, value: data as T };
  } catch {
    return { ok: false, status: 503 };
  }
}

async function list<T>(key: string, filters: Filters, signal?: AbortSignal): Promise<Page<T>> {
  const page = filters.page ?? 1;
  const empty = { items: [], total: 0, page, nextPage: null, unavailable: true };
  const result = await request<ListResponse<T> & Record<string, unknown>>(`/api/v1/${key}`, filters, signal);
  if (!result.ok) return empty;
  const resultBody = result.value;
  const items = Array.isArray(resultBody) ? resultBody : resultBody.items ?? resultBody[key.split('/')[0] ?? ''];
  if (!Array.isArray(items)) return empty;
  const pagination = resultBody.pagination ?? resultBody;
  const total = pagination.total ?? pagination.count ?? resultBody.total ?? items.length;
  const limit = pagination.pageSize ?? pagination.limit ?? filters.pageSize ?? items.length;
  const hasMore = pagination.hasMore ?? (Boolean(pagination.nextCursor) || (pagination.totalPages ? page < pagination.totalPages : page * limit < total));
  return {
    items: items as T[], total, page, pageSize: limit,
    nextPage: pagination.nextPage !== undefined ? pagination.nextPage : hasMore ? page + 1 : null,
    nextCursor: pagination.nextCursor ?? undefined,
    unavailable: false,
  };
}

async function item<T>(key: string, id: string, member: string, lang: Locale): Promise<ApiResult<T>> {
  const result = await request<T & Record<string, unknown>>(`/api/v1/${key}/${encodeURIComponent(id)}`, { lang });
  if (!result.ok) return result;
  const value = result.value[member] ?? result.value;
  if (!value || typeof value !== 'object' || !('id' in value)) return { ok: false, status: 502 };
  return { ok: true, value: value as T };
}

export const api = {
  siteMeta: (lang: Locale) => request<{ counts?: SiteCounts }>('/api/v1/site-meta', { lang }),
  archiveCount: () => request<{ counts: { works: number } }>('/open-api/v1/index.json'),
  archiveCharacters: () => request<{ items: { id: string; count: number }[] }>('/open-api/v1/characters.json'),
  works: (filters: Filters) => list<Work>('works', filters),
  work: async (id: string, lang: Locale): Promise<ApiResult<WorkDetail>> => {
    const result = await request<WorkResponse>(`/api/v1/works/${encodeURIComponent(id)}`, { lang });
    if (!result.ok) return result;
    const value = normalizeWorkDetail(result.value);
    return value ? { ok: true, value } : { ok: false, status: 502 };
  },
  characters: (lang: Locale) => list<Character>('characters', { lang }),
  character: (id: string, lang: Locale) => item<Character>('characters', id, 'character', lang),
  categories: (lang: Locale) => list<Taxon>('categories', { lang }),
  topics: (filters: Filters) => list<Topic>('topics', filters),
  topic: (id: string, lang: Locale) => item<Topic>('topics', id, 'topic', lang),
  topicPage: (id: string, page: number, lang: Locale) => request<{ topic: Topic; work: Work | null; totalPages: number; pageNumber: number; previous: number | null; next: number | null }>(`/api/v1/topics/${encodeURIComponent(id)}/page/${page}`, { lang }),
  creators: (filters: Filters) => list<Creator>('creators', filters),
  creator: async (id: string, lang: Locale): Promise<ApiResult<CreatorProfile>> => {
    const result = await request<CreatorProfile | Creator>(`/api/v1/creators/${encodeURIComponent(id)}`, { lang });
    if (!result.ok) return result;
    const profile = 'creator' in result.value ? result.value : { creator: result.value };
    return profile.creator?.id ? { ok: true, value: profile } : { ok: false, status: 502 };
  },
  videos: (filters: Filters) => list<Video>('videos', filters),
  events: (lang: Locale, status?: Filters['status'], signal?: AbortSignal) => list<EventItem>('events', { lang, status }, signal),
  links: (lang: Locale) => list<FriendLink>('friend-links', { lang }),
};

export function normalizeWorkDetail(payload: unknown): WorkDetail | undefined {
  const record = unwrap(payload) as WorkResponse | undefined;
  const work = record?.work ?? record;
  if (!record || !work?.id || !work.slug || typeof work.name !== 'string') return;
  return {
    work: work as Work,
    recommendations: record.recommendations ?? record.relatedWorks ?? record.related ?? [],
    topics: record.topics ?? record.relatedTopics ?? [],
    previous: record.previous, next: record.next,
  };
}

export const categoryIds = CATEGORY_IDS;
export function field(locale: Locale, record: Partial<Record<TextField, string>> & { i18n?: Translations }, key: TextField, fallback?: string) {
  const translation = locale === 'en' || locale === 'ja' ? record.i18n?.[locale] : undefined;
  return localizedText(locale, record[key] ?? fallback, translation?.[key]);
}

export function localizedCharacterName(locale: Locale, character: Taxon) {
  if (locale === 'zh' || locale === 'zh-hant') return field(locale, character, 'name');
  return character.i18n?.[locale]?.name?.trim()
    || defaultCharacterName(character.id, locale)
    || character.name.trim().replace(/(.+?)\s*娘$/u, '$1 Chan');
}

export function publicUrl(value?: string | null): string | undefined {
  if (typeof value !== 'string' || !value || /[\s\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch { /* Invalid external link. */ }
}

export function mediaUrl(url?: string, key?: string) {
  return publicUrl(url) ?? (key && `https://img.xn--pssy23gqgbz2d718b.com/${key.split('/').map(encodeURIComponent).join('/')}`) ?? '';
}

function dimension(value?: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function workMedia(work: Work) {
  const original = mediaUrl(work.image?.originalUrl ?? work.originalUrl, work.r2OriginalKey);
  const thumb = mediaUrl(work.image?.thumbnailUrl ?? work.thumbnailUrl ?? work.thumbUrl, work.r2ThumbKey);
  const display = mediaUrl(work.image?.displayUrl ?? work.displayUrl, work.r2DisplayKey);
  const width = dimension(work.width ?? work.image?.width);
  const height = dimension(work.height ?? work.image?.height);
  return {
    original, thumb: thumb || display || original, display: display || original || thumb,
    width, height,
    thumbWidth: dimension(work.thumbWidth ?? work.image?.thumbWidth) ?? width,
    thumbHeight: dimension(work.thumbHeight ?? work.image?.thumbHeight) ?? height,
    displayWidth: dimension(work.displayWidth ?? work.image?.displayWidth) ?? (display ? undefined : original ? width : dimension(work.thumbWidth ?? work.image?.thumbWidth)),
    displayHeight: dimension(work.displayHeight ?? work.image?.displayHeight) ?? (display ? undefined : original ? height : dimension(work.thumbHeight ?? work.image?.thumbHeight)),
    format: work.format ?? work.image?.format,
    mimeType: work.mimeType ?? work.image?.mimeType,
    bytes: dimension(work.fileSize) ?? dimension(work.image?.bytes),
  };
}

export function attribution(locale: Locale, value?: Attribution | string) {
  if (typeof value === 'string') return { label: localizedText(locale, value), url: publicUrl(value) };
  return {
    label: localizedText(locale, value?.label || value?.name || value?.title || value?.text || value?.author || value?.note),
    url: publicUrl(value?.url || value?.sourceUrl || value?.issueUrl),
  };
}

export function topicWorks(topic: Topic) {
  return (topic.works ?? []).map((entry) => 'work' in entry ? entry.work : entry).filter(Boolean);
}
