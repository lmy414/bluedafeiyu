import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceHash } from '../apps/api/src/routes/hermes/editorial.js';
import type { Wire } from '../apps/api/src/routes/hermes/protocol.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const blueFishDate = '2026-09-15T00:00:00+08:00';
const contentRaw = 'https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/';
const upstreamRaw = 'https://raw.githubusercontent.com/EDMOK/blue-fish-archive/main/';
export const digestPattern = /^[a-f0-9]{64}$/;
export const legacyKeys = ['--legacy', '--content', '--manifest', '--sqlite', '--site', '--api', '--concurrency', '--upstream', '--legacy-release', '--creator-avatars', '--cutover-backup', '--queue', '--ga4'];

export function options(args = process.argv.slice(2)) {
  const result = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (['--dry-run', '--help', '--offline'].includes(arg)) result.set(arg, 'true');
    else if (legacyKeys.includes(arg) && args[i + 1] && !args[i + 1]!.startsWith('--')) result.set(arg, args[++i]!);
    else throw new Error(`无效参数 ${arg}`);
  }
  const home = dirname(resolve(root));
  return {
    dryRun: result.has('--dry-run'), help: result.has('--help'), offline: result.has('--offline'),
    legacy: resolve(result.get('--legacy') || process.env.DAFEIYU_LEGACY_ROOT || join(home, 'bluedafeiyu')),
    content: resolve(result.get('--content') || process.env.DAFEIYU_LEGACY_CONTENT || join(home, 'AI娘表情包')),
    upstream: result.get('--upstream') || process.env.DAFEIYU_LEGACY_UPSTREAM,
    release: result.get('--legacy-release') || process.env.DAFEIYU_LEGACY_RELEASE,
    creatorAvatars: result.get('--creator-avatars') || process.env.DAFEIYU_CREATOR_AVATARS,
    backup: result.get('--cutover-backup'), queue: result.get('--queue'), ga4: result.get('--ga4'),
    manifest: resolve(result.get('--manifest') || join(root, 'scripts', 'r2-migration-manifest.json')),
    sqlite: result.get('--sqlite') || process.env.DAFEIYU_LEGACY_SQLITE,
    site: result.get('--site') || process.env.SITE_PUBLIC_URL,
    api: result.get('--api') || process.env.DAFEIYU_V2_API_URL,
    concurrency: Math.max(1, Math.min(16, Number(result.get('--concurrency')) || 4)),
  };
}

export async function exists(path: string) {
  try { await access(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as T;
}

export async function bounded<T, U>(items: T[], concurrency: number, work: (item: T) => Promise<U>) {
  let cursor = 0;
  const results = new Array<U>(items.length);
  await Promise.all(Array.from({ length: Math.min(Math.floor(concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await work(items[index]!);
    }
  }));
  return results;
}

export type LegacyWork = Wire & { id: string; slug: string; kind: 'submission' | 'owner-picks' | 'blue-fish'; status: 'pending' | 'published' | 'hidden' | 'removed' | 'deleted' };
export type Media = {
  sha256: string; r2OriginalKey: string; r2ThumbKey: string; r2DisplayKey: string;
  width: number; height: number; thumbWidth: number; thumbHeight: number; displayWidth: number; displayHeight: number;
  format: string; mimeType: string; fileSize: number; isAnimated: boolean;
};
export type Asset = { key: string; sha256: string; width: number | null; height: number | null; bytes: number };
export type Manifest = {
  version: 1; uploaded: boolean; generatedAt: string;
  works: Record<string, Media & { workId: string; status: string }>;
  assets: Record<string, Asset>;
  objects?: Record<string, { sha256: string; bytes: number; mime: string }>;
  missing: { id: string; error: string }[];
  summary: { expectedWorks: number; works: number; assets: number; missing: number; verifiedHashes: number; tombstones: number };
};

const recordUrl = (base: string, path: string) => base + path.split('/').map(encodeURIComponent).join('/');
export function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).map(entry => entry.trim()))] : [];
}

export type LegacyPaths = { thumb: string[]; display: string[]; original: string[] };

const legacySite = new URL('https://xn--pssy23gqgbz2d718b.com');
const legacyPathKinds = ['thumb', 'display', 'original'] as const;

export function legacyPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  let path = value.trim();
  if (!path) return;
  if (path.startsWith(contentRaw)) path = path.slice(contentRaw.length);
  else if (path.startsWith(upstreamRaw)) path = `data/blue-fish/${path.slice(upstreamRaw.length)}`;
  if (path.includes('\\')) return;
  const url = URL.parse(path.replace(/^\/?dist\//, ''), legacySite);
  if (url?.hostname !== legacySite.hostname || !['http:', 'https:'].includes(url.protocol) || url.pathname === '/' || url.pathname.startsWith('//')) return;
  return url.pathname;
}

function collectLegacyPaths(rows: LegacyWork[], redirects?: LegacyPaths): LegacyPaths {
  const paths: LegacyPaths = { thumb: [], display: [], original: [] };
  for (const row of rows) {
    paths.thumb.push(row.thumbnailPath, row.thumbUrl);
    paths.display.push(row.fullPath, row.displayUrl);
    paths.original.push(row.path, row.originalUrl);
    if (row.kind === 'blue-fish') {
      // The old site used previews for both card and detail images for the first batch.
      paths.display.push(row.thumbnailPath);
      if (row.historicalOriginal) paths.original.push(`data/blue-fish/${row.historicalOriginal}`);
    }
    for (const kind of legacyPathKinds) paths[kind].push(...stringIds(row.origin?.legacyPaths?.[kind]));
  }
  for (const kind of legacyPathKinds) {
    paths[kind] = [...new Set([...paths[kind], ...(redirects?.[kind] ?? [])].map(legacyPath).filter((path): path is string => Boolean(path)))];
  }
  return paths;
}

async function readLegacyImageRedirects(root: string) {
  const file = join(root, 'ops', 'nginx-legacy-image-redirects.conf');
  const redirects = new Map<string, LegacyPaths>();
  if (!await exists(file)) return redirects;
  const config = await readFile(file, 'utf8');
  for (const [, id, from, to] of config.matchAll(/^# [^\r\n]*· (sticker_\w+)[^\r\n]*\r?\nlocation = (\S+) \{ return 301 (\S+);/gm)) {
    const paths = redirects.get(id!) ?? { thumb: [], display: [], original: [] };
    const kind = /\/previews\//.test(to!) ? 'thumb' : /\/(?:full|large)\//.test(to!) ? 'display' : 'original';
    paths[kind].push(from!);
    redirects.set(id!, paths);
  }
  return redirects;
}

export async function legacyPathsByWork(root: string, works: LegacyWork[], base: LegacyWork[]) {
  const redirects = await readLegacyImageRedirects(root);
  const before = new Map(base.map(row => [row.id, row]));
  return new Map(works.map(row => {
    const original = before.get(row.id);
    const paths = collectLegacyPaths(original && original !== row ? [original, row] : [row], redirects.get(row.id));
    if (original && legacyPathKinds.some(kind => !paths[kind].length)) throw new Error(`旧站作品图片路径不完整 ${row.id}`);
    return [row.id, paths];
  }));
}

export async function loadLegacy(legacy: string) {
  const directory = join(legacy, 'data');
  const files = Object.fromEntries(await Promise.all((await readdir(directory)).filter(file => file.endsWith('.json')).map(async file => [file, await readJson<Wire | Wire[]>(join(directory, file))]))) as Record<string, Wire>;
  const required = (name: string) => {
    const value = files[`${name}.json`];
    if (!value) throw new Error(`旧站清单缺失 ${name}.json`);
    return value;
  };
  const array = (name: string) => {
    const value = required(name);
    if (!Array.isArray(value)) throw new Error(`旧站清单 ${name}.json 不是数组`);
    return value as Wire[];
  };
  const roles = array('characters');
  const categories = array('categories');
  const editorial = required('blue-fish-editorial');
  const frozen = required('blue-fish-ids');
  const overrides = required('blue-fish-original-overrides');
  const localized = required('work-localizations').works;
  const records = [
    ...array('works').map(row => ({ ...row, kind: 'submission' })),
    ...array('owner-picks').map(row => ({ ...row, kind: 'owner-picks' })),
  ] as LegacyWork[];
  for (const raw of array('blue-fish-classification')) {
    const key = raw.sourcePath;
    const layer = editorial[key] || {};
    const ids = frozen[key];
    if (!ids?.id || !ids?.slug) throw new Error(`首批冻结 ID/slug 缺失 ${key}`);
    const name = String(layer.name || raw.name || '').trim();
    const tags = stringIds(layer.tags?.length ? layer.tags : raw.tags);
    const characterId = layer.characterId || raw.characterId;
    const characterIds = stringIds(layer.characterIds ?? raw.characterIds ?? [characterId]);
    const path = layer.originalPath ? recordUrl(contentRaw, layer.originalPath) : recordUrl(upstreamRaw, overrides[key] ?? key);
    let status = layer.status || 'published';
    if (status === 'published' && (!name || !tags.length || !characterId)) status = 'pending';
    records.push({ ...raw, ...layer, id: ids.id, slug: ids.slug, kind: 'blue-fish', status, name, tags, characterId, characterIds,
      categoryIds: layer.categoryIds?.length ? layer.categoryIds : ['meme'], description: String(layer.description || '').trim(), commentary: String(layer.commentary || ''),
      path, historicalOriginal: key, historicalEditorial: layer, thumbnailPath: `data/blue-fish/previews/${String(raw.previewPath || key).split('/').at(-1)}`,
      fullPath: raw.largePath ? `data/blue-fish/${raw.largePath}` : '', createdAt: layer.createdAt || blueFishDate, updatedAt: layer.updatedAt || blueFishDate,
      submitter: layer.submitter || { name: '上游清单导入', github: '' },
      origin: layer.origin || { type: 'internet-found', author: '', sourceUrl: raw.sourceUrl || null, note: '从公开上游清单导入；单条原作者信息待补充' },
      license: layer.license || { type: 'unknown', note: '' },
    });
  }
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const row of records) {
    if (!row.id || !row.slug || ids.has(row.id) || slugs.has(row.slug)) throw new Error(`冻结 ID/slug 缺失或冲突 ${row.id}/${row.slug}`);
    ids.add(row.id); slugs.add(row.slug);
    row.characterIds = stringIds(row.characterIds?.length ? row.characterIds : [row.characterId]);
    row.characterId = row.characterIds.includes(row.characterId) ? row.characterId : row.characterIds[0];
    row.categoryIds = stringIds(row.categoryIds?.length ? row.categoryIds : [row.kind === 'owner-picks' ? 'illustration' : /立绘|设定|三视图/.test(row.name) ? 'setting' : 'meme']);
    const hash = sourceHash(row);
    row.i18n = row.i18n?.sourceHash === hash ? row.i18n : localized[row.id]?.sourceHash === hash ? localized[row.id] : row.i18n || localized[row.id] || {};
  }
  const topicMap = new Map(array('topics').map(row => [row.id, row]));
  const serial = array('serial-topics');
  for (const row of serial) topicMap.set(row.id, { ...topicMap.get(row.id), ...row });
  const video = required('video-archive');
  return { files, roles, categories, works: records, topics: [...topicMap.values()], serialIds: new Set(serial.map(row => row.id)),
    portraits: required('character-portraits').portraits as Record<string, Wire>, creators: video.creators as Wire[], videos: video.videos as Wire[],
    events: array('events'), links: array('friend-links'), editorialCount: Object.keys(editorial).length,
  };
}

export async function readBrandTokens(legacy: string) {
  const file = join(legacy, 'frontend/src/components/archive/CharacterBrandTokens.css');
  if (!await exists(file)) return {};
  const css = await readFile(file, 'utf8');
  const result: Record<string, Wire> = {};
  for (const match of css.matchAll(/([^{}]+)\[data-character-page="([a-z0-9-]+)"\]\s*\{([^{}]*)\}/gi)) {
    const id = match[2]!;
    const theme = match[1]!.includes('[data-theme="dark"]') ? 'dark' : 'light';
    result[id] ??= {};
    result[id]![theme] = { ...result[id]![theme], ...Object.fromEntries([...match[3]!.matchAll(/(--brand-[\w-]+):\s*([^;]+);/g)].map(field => [field[1], field[2]!.trim()])) };
  }
  return result;
}
