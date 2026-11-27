import { buildR2PublicUrl, computeWorkRevision, isSafeHttpUrl, normalizeSlug } from '@dafeiyu/shared';
import type { JsonObject, WorkRow } from '../db/schema.js';

export const text = (value: unknown) => typeof value === 'string' ? value : '';
export const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const uniqueStrings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))] : [];
export const safeUrl = (value: unknown): string | null => isSafeHttpUrl(value) ? new URL(value).href : null;
const positive = (value: number) => value > 0 ? value : null;

export function slugCandidate(name: string, id: string, suffix = 0): string {
  const base = normalizeSlug(name).slice(0, 96).replace(/-$/, '') || id;
  if (!suffix) return base;
  return `${base}-${id.slice(-12)}${suffix > 1 ? `-${suffix}` : ''}`;
}

export function translations(i18n: JsonObject, fields: string[]) {
  const result: JsonObject = {};
  for (const lang of ['en', 'ja']) {
    if (!i18n[lang]) continue;
    const source = object(i18n[lang]);
    result[lang] = Object.fromEntries(fields.filter(key => typeof source[key] === 'string' || Array.isArray(source[key])).map(key => [key, source[key]]));
  }
  return result;
}

export function projectOpenWork(work: WorkRow, roles: string[], site: string, media: string, topicIds: string[] = [], creatorIds: string[] = []) {
  const ignoredNames = new Set(['未标注', '未署名', '未知', 'unknown', '本人', 'GPT画的', '上游清单导入']);
  const named = (value: unknown) => { const name = text(value).trim(); return ignoredNames.has(name) ? '' : name; };
  const author = named(work.origin.author);
  const publicName = text(work.submitter.name);
  const explicit = ['named', 'anonymous'].includes(text(work.submitter.credit));
  const attribution = work.submitter.credit === 'anonymous' ? { name: null, url: null, explicit } : {
    name: (explicit ? named(publicName) : author || named(publicName)) || null,
    url: (explicit || !author || author === publicName) ? safeUrl(work.submitter.url) : null, explicit,
  };
  const rawLicense = text(work.license.type);
  const type = ['cc0', 'cc-by', 'cc-by-nc', 'author-permission', 'submitter-permission'].includes(rawLicense) ? rawLicense : 'unknown';
  const copyrightNotice = type === 'cc0' ? '作品标注为 CC0 公共领域；以作品授权说明为准。' : author ? `图片版权归原作者 ${author} 所有。` : '图片版权归原作者所有；原作者未标注。';
  const originalUrl = buildR2PublicUrl(media, work.r2OriginalKey);
  return {
    id: work.id, slug: work.slug, name: work.name, description: work.description, commentary: work.commentary,
    url: `${site}/works/${encodeURIComponent(work.slug)}.html`, detailUrl: `${site}/open-api/v1/works/${encodeURIComponent(work.id)}.json`,
    characterId: work.primaryCharacterId, characterIds: uniqueStrings([work.primaryCharacterId, ...roles]), categoryIds: [work.categoryId], topicIds, creatorIds,
    tags: uniqueStrings(work.tags), createdAt: work.createdAt.toISOString(), updatedAt: work.updatedAt.toISOString(), author: { name: author || null }, attribution,
    source: { type: text(work.origin.type) || 'unknown', url: safeUrl(work.origin.sourceUrl) || safeUrl(work.origin.issueUrl) },
    license: { type, note: text(work.license.note), url: safeUrl(work.license.url) || `${site}/about.html#license-${type}`, copyrightNotice },
    image: {
      originalUrl, thumbnailUrl: work.r2ThumbKey ? buildR2PublicUrl(media, work.r2ThumbKey) : null,
      displayUrl: work.r2DisplayKey ? buildR2PublicUrl(media, work.r2DisplayKey) : null,
      format: work.format.toLowerCase() || null, mimeType: work.mimeType || null, animated: work.isAnimated,
      width: positive(work.width), height: positive(work.height), bytes: positive(work.fileSize), sha256: work.sha256,
    },
    i18n: translations(work.i18n, ['name', 'description', 'commentary', 'tags', 'licenseNote']),
  };
}

export async function openWorkWithRevision(...args: Parameters<typeof projectOpenWork>) {
  const data = projectOpenWork(...args);
  return { ...data, revision: await computeWorkRevision(data) };
}
