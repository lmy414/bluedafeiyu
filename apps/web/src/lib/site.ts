import { attribution, field, localizedCharacterName, workMedia, type Work, type Taxon, type Attribution, categoryIds, publicUrl } from './api';
import { copy, localePath, localizedText, tr, type Locale, type Phrase } from './i18n';
import { characterIntros } from '../content/landing-copy';
import { characterQuery } from './character-filter';

export const publicCache = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
export const sourceRepository = 'https://github.com/lmy414/bluedafeiyu';
export const contentRepository = 'https://github.com/lmy414/ai-girl-stickers';
export const weeklyUrl = 'https://weekly.xn--pssy23gqgbz2d718b.com/';
export const issueUrl = `${contentRepository}/issues`;
export function siteOrigin(current: URL) {
  return publicUrl(process.env.PUBLIC_SITE_URL || import.meta.env.PUBLIC_SITE_URL) || current.origin;
}
export function segment(id: string) { return encodeURIComponent(id); }
export function workPath(slug: string) { return `/works/${segment(slug)}.html`; }
export function topicPath(id: string) { return `/topics/${segment(id)}`; }
export function characterPath(id: string) { return `/characters/${segment(id)}`; }
export function creatorPath(id: string) { return `/creators/${segment(id)}`; }
export function readerPath(id: string, page: number) { return `${topicPath(id)}/page/${page}`; }

export const configuredSorts = { newest: 'latest', oldest: 'oldest', downloads: 'downloads', popular: 'popular' } as const;
export type Sort = keyof typeof configuredSorts;
export function getSort(value: string | null): Sort {
  return value === 'oldest' || value === 'popular' || value === 'downloads' ? value : 'newest';
}
export function pageNumber(value?: string | null) {
  const number = value && /^\d+$/.test(value) ? Number(value) : 1;
  return Number.isSafeInteger(number) && number > 0 && number <= 100_000 ? number : 1;
}
export function pageHref(locale: Locale, path: string, search: URLSearchParams, nextPage: number, nextCursor?: string) {
  const params = new URLSearchParams(search);
  if (nextPage === 1) params.delete('page');
  else params.set('page', String(nextPage));
  if (nextCursor) params.set('cursor', nextCursor);
  else params.delete('cursor');
  return localePath(locale, path, characterQuery(params));
}
export function creationHref(locale: Locale, path: string, search: URLSearchParams) {
  const params = new URLSearchParams(search);
  params.delete('page');
  params.delete('cursor');
  if (params.get('creation') === 'non-ai') params.delete('creation');
  else params.set('creation', 'non-ai');
  return localePath(locale, path, characterQuery(params));
}
export function categoryName(locale: Locale, id?: string, category?: Taxon) {
  const known = categoryIds.find((item) => item === id);
  if (category?.name && (locale === 'zh' || locale === 'zh-hant' || category.i18n?.[locale]?.name?.trim() || !known)) return field(locale, category, 'name');
  return known ? tr(locale, known) : id ?? '';
}

export function colorToken(value: unknown) {
  return typeof value === 'string' && /^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(value) ? value : undefined;
}
export function characterName(locale: Locale, work: Work, characters: Taxon[] = []) {
  const id = work.primaryCharacterId ?? work.characterId ?? work.characterIds?.[0];
  const character = work.character ?? work.characters?.find((entry) => entry.id === id) ?? characters.find((entry) => entry.id === id);
  return character ? localizedCharacterName(locale, character) : id ? localizedCharacterName(locale, { id, name: id }) : '';
}

export function characterDescription(locale: Locale, character: Taxon) {
  const intro = (characterIntros as Partial<Record<string, string[]>>)[character.id];
  return field(locale, character, 'description').trim() || (Array.isArray(intro) ? copy(locale, intro) : '');
}

const originLabels: Partial<Record<string, Phrase>> = {
  web: 'originWeb', qq: 'originQq', 'qq-group': 'originQq', 'github-issue': 'originGithub', github: 'originGithub',
  'blue-fish': 'originArchive', manual: 'originEditor', owner: 'originEditor', 'owner-picks': 'originEditor',
  'internet-found': 'originWebFound', 'self-created': 'originOwn', 'author-submitted': 'originAuthor',
  'community-created': 'originCommunity', submission: 'originSubmission',
};
const licenseLabels: Partial<Record<string, Phrase>> = { 'author-permission': 'licenseAuthor', 'submitter-permission': 'licenseSubmitter' };
const standardLicenses: Partial<Record<string, string>> = { cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-nc': 'CC BY-NC' };
const metadataType = (value?: Attribution | string) => (typeof value === 'string' ? value : value?.type ?? value?.code ?? '').trim().toLowerCase();
const unknownNames = new Set(['未标注', '未標註', '未署名', '未知', 'unknown', '本人', 'gpt画的', 'gpt畫的', '上游清单导入', '上游清單匯入']);
const knownName = (value?: string | null) => value?.trim() && !unknownNames.has(value.trim().toLowerCase()) ? value.trim() : '';

function sourceMetadata(locale: Locale, value?: Attribution | string) {
  const { url } = attribution(locale, value);
  const type = metadataType(value);
  const key = Object.hasOwn(originLabels, type) ? originLabels[type] : undefined;
  return { url, label: key ? tr(locale, key) : tr(locale, 'unspecified') };
}

function licenseMetadata(locale: Locale, value?: Attribution | string) {
  const type = metadataType(value);
  const { url } = attribution(locale, value);
  const target = url ? new URL(url) : undefined;
  // The API supplies a policy anchor when no explicit license URL exists.
  const policyAnchor = target && /^\/about(?:\.html)?\/?$/.test(target.pathname) && target.hash === `#license-${type || 'unknown'}`;
  const key = Object.hasOwn(licenseLabels, type) ? licenseLabels[type] : undefined;
  const standard = Object.hasOwn(standardLicenses, type) ? standardLicenses[type] : undefined;
  return { type: standard || key ? type : 'unknown', url: policyAnchor ? undefined : url, label: standard ?? tr(locale, key ?? 'unspecified') };
}

export function imageMetadata(locale: Locale, work: Work) {
  const translation = locale === 'en' || locale === 'ja' ? work.i18n?.[locale] : undefined;
  const origin = work.origin ?? work.source;
  const source = sourceMetadata(locale, origin);
  source.url = publicUrl(work.source?.sourceUrl ?? work.source?.url) ?? source.url;
  const license = licenseMetadata(locale, work.license);
  const statedCredit = work.attribution ?? work.credit;
  const explicit = statedCredit && (typeof statedCredit !== 'object' || statedCredit.explicit !== false);
  const credit = attribution(locale, explicit || statedCredit && attribution(locale, statedCredit).label ? statedCredit : work.submitter);
  credit.label = knownName(credit.label);
  const author = typeof work.author === 'string' ? work.author : work.author?.name;
  const creator = knownName(typeof work.origin === 'object' ? work.origin.author : undefined) || knownName(author) || knownName(work.source?.author);
  const text = (value: Attribution | string | undefined, translated?: string) => localizedText(locale, typeof value === 'object' ? value.note : undefined, translated);
  const statedCopyright = typeof work.license === 'object' ? work.license.copyrightNotice : undefined;
  const notice = license.type === 'cc0' ? ['作品标注为 CC0 公共领域。请参阅本作品授权说明。', 'Marked as CC0 public domain. See the work’s license notes.', 'CC0 パブリックドメインとして表示されています。利用許諾の補足をご確認ください。'] : creator ? [`图片版权归原作者 ${creator} 所有。`, `Copyright belongs to the original creator, ${creator}.`, `著作権は原作者 ${creator} に帰属します。`] : ['图片版权归原作者所有。原作者未标注。', 'Copyright belongs to the original creator. The creator is unrecorded.', '著作権は原作者に帰属します。原作者は未記載です。'];
  const copyright = statedCopyright && (locale === 'zh' || locale === 'zh-hant' || !/[\u3400-\u9fff]/.test(statedCopyright)) ? localizedText(locale, statedCopyright) : copy(locale, notice);
  return { source, license, credit, creator, copyright, sourceNote: text(origin, translation?.originNote) || text(work.source), licenseNote: text(work.license, translation?.licenseNote) };
}
export function workTags(locale: Locale, work: Work) {
  const translated = locale === 'en' || locale === 'ja' ? work.i18n?.[locale]?.tags : undefined;
  return work.tags?.length ? work.tags.map((tag, index) => translated?.[index] || localizedText(locale, tag)) : translated ?? [];
}
export function workImageAlt(title: string, description: string) {
  const name = title.trim();
  const text = description.trim();
  return !name || text.includes(name) ? text : text ? `${name} — ${text}` : name;
}
export function workPreview(locale: Locale, work: Work, characters: Taxon[] = []) {
  const { original, display, thumb, thumbWidth, thumbHeight, displayWidth, displayHeight, format } = workMedia(work);
  const title = field(locale, work, 'name');
  const description = field(locale, work, 'description');
  const characterId = work.primaryCharacterId ?? work.characterId ?? work.characterIds?.[0];
  const categoryId = work.categoryId ?? work.categoryIds?.[0];
  return {
    id: work.id, slug: work.slug, title, description, alt: workImageAlt(title, description),
    commentary: field(locale, work, 'commentary'),
    character: characterName(locale, work, characters),
    category: categoryName(locale, categoryId, work.category),
    characterHref: characterId ? localePath(locale, characterPath(characterId)) : '',
    categoryHref: categoryId ? localePath(locale, `/categories/${segment(categoryId)}`) : '',
    href: localePath(locale, workPath(work.slug)),
    original, display, thumb, thumbWidth, thumbHeight, displayWidth, displayHeight, format,
  };
}

export const navGroups = [
  { label: ['画廊与找图', 'Gallery & discovery', 'ギャラリー・画像検索'], items: [
    { href: '/', key: 'gallery', icon: 'gallery' }, { href: '/characters', key: 'characters', icon: 'characters' },
    { href: '/gifs', key: 'gifs', icon: 'gifs' }, { href: '/topics', key: 'topics', icon: 'topics' },
  ] },
  { label: ['连载与作者', 'Series & creators', '連載・クリエイター'], items: [
    { href: '/serials', key: 'serials', icon: 'serials' }, { href: '/videos', key: 'videos', icon: 'videos' },
    { href: '/creators', key: 'creators', icon: 'edit' }, { href: '/events', key: 'events', icon: 'events' },
  ] },
] as const;
export const additionalItems = [
  { href: '/community', key: 'community' }, { href: '/community-projects', key: 'projects' },
  { href: '/friend-links', key: 'links' }, { href: '/about', key: 'about' }, { href: '/about#open-api', key: 'openApi' },
  { href: '/changelog', key: 'changelog' },
] as const;
