import { and, eq, like, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppContext } from '../../app.js';
import { characters, creators, topics, works } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { object, text } from '../../services/work-data.js';
import { activeCharacter, activeTopic, published, visibleCreator } from './data.js';
import historicalPaths from './legacy-work-paths.json' with { type: 'json' };

const cacheTtl = 60_000;
const variants = ['thumb', 'display', 'original'] as const;
type Variant = typeof variants[number];
type Alias = { id: string; variant: Variant };
type AliasIndex = Map<string, Alias | null>;
const keys = { original: works.r2OriginalKey, thumb: works.r2ThumbKey, display: works.r2DisplayKey };
type ImageKeys = Record<Variant, string>;

const portraitPath = /^\/character-portraits\/([a-z0-9_-]+)\.webp$/;
const creatorPath = /^\/creator-avatars\/(\d+)\.[a-z0-9]+$/;
const authorPath = /^\/author-avatars\/([a-z0-9_-]+)\.[a-z0-9]+$/;
const workOgPath = /^\/og\/archive--(?:(?:zh-hant|en|ja)-)?works-([a-z0-9_-]+)-html\.(?:jpe?g|png|webp)$/;
const shortWorkOgPath = /^\/og\/works-([a-z0-9_-]+)\.(?:jpe?g|png|webp)$/;
const siteOgPath = /^\/og\/[a-z0-9._-]+\.(?:jpe?g|png|webp)$/;
const hashedSubmissionPath = /^\/submissions\/(previews|large|originals)\/[^/]+\/([a-f0-9]{16})\.[a-z0-9]+$/;
const communityImage = '/community/qq-join-6d07ffd364068fdf.png';

function normalizePath(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 4096) return undefined;
  let path: string;
  try { path = decodeURIComponent(value).replaceAll('\\', '/'); }
  catch { return undefined; }
  if (/[\p{Cc}%?#]/u.test(path) || path.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(path) ||
    path.split('/').some(part => part === '..' || part === '.')) return undefined;
  return path.startsWith('/') ? path : `/${path}`;
}

const withoutDist = (path: string) => path.startsWith('/dist/') ? path.slice('/dist'.length) : path;

function addAlias(index: AliasIndex, value: unknown, alias: Alias) {
  const path = normalizePath(value);
  if (!path) return;
  const existing = index.get(path);
  if (existing === undefined) index.set(path, alias);
  else if (existing && existing.id !== alias.id) index.set(path, null);
}

// The first import did not retain the old image paths. These aliases come from
// the legacy work manifests and frozen IDs, and still require a published row.
const historical = new Map<string, Alias | null>();
for (const [id, thumb, display, original] of historicalPaths) {
  if (typeof id !== 'string') continue;
  for (const [variant, paths] of [['thumb', thumb], ['display', display], ['original', original]] as const) {
    if (Array.isArray(paths)) for (const value of paths) addAlias(historical, value, { id, variant });
  }
}

function imageKey(image: ImageKeys, variant: Variant) {
  if (variant === 'thumb') return image.thumb || image.display || image.original;
  if (variant === 'display') return image.display || image.original;
  return image.original;
}

export function createLegacyMediaRoutes({ db, services }: AppContext) {
  const routes = new Hono();
  let cache: { index: AliasIndex; expiresAt: number } | undefined;
  let refreshing: Promise<AliasIndex> | undefined;

  async function loadIndex() {
    const legacyPaths = sql<unknown>`${works.origin}->'legacyPaths'`;
    const sourcePath = sql<string | null>`${works.origin}#>>'{legacy,sourcePath}'`;
    const rows = await db.select({ id: works.id, legacyPaths, sourcePath }).from(works)
      .where(and(published, sql`(${legacyPaths} IS NOT NULL OR ${sourcePath} IS NOT NULL)`));
    const index: AliasIndex = new Map();
    for (const row of rows) {
      const paths = object(row.legacyPaths);
      for (const variant of variants) {
        const aliases = paths[variant];
        if (Array.isArray(aliases)) for (const value of aliases) addAlias(index, value, { id: row.id, variant });
      }
      addAlias(index, row.sourcePath, { id: row.id, variant: 'original' });
    }
    cache = { index, expiresAt: Date.now() + cacheTtl };
    return index;
  }

  function refresh() {
    return refreshing ??= loadIndex().finally(() => { refreshing = undefined; });
  }

  async function workImage(path: string, stripped: string) {
    const cached = cache && cache.expiresAt > Date.now() ? cache.index : undefined;
    const alternate = stripped === path ? `/dist${path}` : stripped;
    const lookup = (index: AliasIndex) => {
      for (const aliases of [index, historical]) {
        for (const key of [path, alternate]) {
          const alias = aliases.get(key);
          if (alias !== undefined) return alias;
        }
      }
      return undefined;
    };
    let alias = lookup(cached ?? await refresh());
    if (alias === undefined && cached) alias = lookup(await refresh());
    if (alias === null) return undefined;
    if (alias) {
      // Recheck visibility and use the current media keys on every cache hit.
      const [row] = await db.select(keys).from(works).where(and(published, eq(works.id, alias.id))).limit(1);
      return row && imageKey(row, alias.variant);
    }

    const hashed = hashedSubmissionPath.exec(stripped);
    if (!hashed?.[2]) return undefined;
    const images = await db.select(keys).from(works).where(and(published, like(works.sha256, `${hashed[2]}%`))).limit(2);
    const image = images.length === 1 ? images[0] : undefined;
    const variant = hashed[1] === 'previews' ? 'thumb' : hashed[1] === 'large' ? 'display' : 'original';
    return image && imageKey(image, variant);
  }

  async function resolve(path: string) {
    const stripped = withoutDist(path);
    if (stripped === '/qq-group.png' || stripped === '/community/qq-1134100615-bc8e49b662df6b84.png') return communityImage;

    const publicUrl = (key: string | null | undefined) => key ? services.r2.publicUrl(key) : undefined;
    const ogSlug = (workOgPath.exec(stripped) ?? shortWorkOgPath.exec(stripped))?.[1];
    if (ogSlug) {
      const [row] = await db.select(keys).from(works).where(and(published, eq(works.slug, ogSlug))).limit(1);
      return publicUrl(row && (row.display || row.thumb));
    }
    if (siteOgPath.test(stripped)) return '/avatar.png';

    const portrait = portraitPath.exec(stripped)?.[1];
    if (portrait) {
      const id = portrait.replace(/-[a-f0-9]{16}$/, '');
      const [row] = await db.select({ key: characters.portraitKey, active: sql<boolean>`${activeCharacter}` }).from(characters)
        .where(or(eq(characters.id, portrait), and(activeCharacter, eq(characters.id, id))))
        .orderBy(sql`${characters.id} = ${portrait} DESC`).limit(1);
      return publicUrl(row?.active ? row.key : undefined);
    }

    const uid = creatorPath.exec(stripped)?.[1];
    if (uid) {
      const [row] = await db.select({ key: creators.avatarKey }).from(creators).where(and(visibleCreator, eq(creators.id, `bilibili-${uid}`))).limit(1);
      return publicUrl(row?.key);
    }

    const topic = authorPath.exec(stripped)?.[1];
    if (topic) {
      const [row] = await db.select({ key: sql<unknown>`${topics.author}->'avatarKey'` }).from(topics)
        .where(and(activeTopic, eq(topics.id, topic))).limit(1);
      return publicUrl(text(row?.key));
    }
    return publicUrl(await workImage(path, stripped));
  }

  routes.get('/legacy-media', async c => {
    c.header('Cache-Control', 'no-store');
    const path = normalizePath(c.req.query('path'));
    if (!path) throw new ApiError(400, 'invalid_legacy_media_path', '旧版图片路径无效');
    const location = await resolve(path);
    if (!location) throw new ApiError(404, 'legacy_media_not_found', '旧版图片路径不存在');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({ ok: true, status: 301, location });
  });
  return routes;
}
