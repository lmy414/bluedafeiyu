import { field, localizedCharacterName, workMedia, type Character, type WorkDetail, type Work } from './api';
import { copy, htmlLang, localePath, localizedText, tr, type Locale } from './i18n';
import { characterPath, imageMetadata, issueUrl, topicPath, workPath, workPreview, workTags } from './site';
import { characterSearchAliases } from '../content/landing-copy';

export function workLabels(locale: Locale) {
  const c = (zh: string, en: string, ja: string) => copy(locale, [zh, en, ja]);
  return {
    fish: locale === 'zh-hant' ? '大肥魚說' : c('大肥鱼说', 'DeepSeek Chan’s notes', 'DeepSeek Chanのひとこと'),
    description: c('画面说明', 'Image description', '画像の説明'),
    author: c('来源作者', 'Original creator', '原作者'),
    unknownAuthor: c('原作者未标注', 'Original creator unrecorded', '原作者は未記載'),
    credit: c('图片署名', 'Image credit', '画像クレジット'),
    sourceNote: c('来源说明', 'Source notes', '出典の補足'),
    viewSource: c('查看原始来源', 'View original source', '元の出典を見る'),
    licenseGuide: c('授权说明', 'License guide', '利用許諾の案内'),
    specs: c('图片规格', 'Image specifications', '画像仕様'),
    date: c('收录时间', 'Archived on', '収録日'),
    stats: c('浏览 / 下载', 'Views / Downloads', '閲覧 / ダウンロード'),
    views: c('次浏览', 'views', '回閲覧'),
    downloads: c('次下载', 'downloads', '回ダウンロード'),
    commentsHint: c('评论由 GitHub Discussions 托管，登录 GitHub 后可以留言。', 'Comments are hosted on GitHub Discussions. Sign in to GitHub to join in.', 'コメントは GitHub Discussions で管理されています。GitHub にログインして参加できます。'),
    copy: c('复制链接', 'Copy link', 'リンクをコピー'),
    copied: c('已复制作品链接', 'Work link copied', '作品リンクをコピーしました'),
    back: c('返回图库', 'Back to gallery', 'ギャラリーに戻る'),
    related: c('接着看这些', 'Keep browsing', 'こちらもどうぞ'),
    retry: c('重新加载', 'Retry', '再読み込み'),
  };
}

export function workCharacters(work: Work, catalog: Character[] = []) {
  const primary = work.primaryCharacterId ?? work.characterId ?? work.character?.id;
  const related = new Map(catalog.map(character => [character.id, character]));
  for (const character of [...(work.characters ?? []), ...(work.character ? [work.character] : [])]) {
    const known = related.get(character.id);
    related.set(character.id, { ...known, ...character, aliases: character.aliases ?? known?.aliases, i18n: { ...known?.i18n, ...character.i18n } });
  }
  const ids = new Set([primary, ...(work.characterIds ?? []), ...(work.characters ?? []).map(character => character.id)]);
  return [...ids].flatMap(id => {
    if (!id) return [];
    const character = related.get(id);
    return [{ ...character, id, name: character?.name ?? id }];
  });
}

export function characterAliases(locale: Locale, character: Character) {
  const known = Object.hasOwn(characterSearchAliases, character.id) ? characterSearchAliases[character.id as keyof typeof characterSearchAliases] : undefined;
  return [...new Set([...(character.aliases ?? []).map(alias => localizedText(locale, alias)), ...(known ? [copy(locale, known)] : [])])].filter(Boolean);
}

export function releaseDate(work: Work) {
  return [work.publishedAt, work.createdAt, work.updatedAt].find(date => date && Number.isFinite(Date.parse(date))) ?? undefined;
}

type Fact = { text: string; href?: string; external?: boolean; linkLabel?: string; note?: string; notice?: string };
type WorkLink = { label: string; href: string };
export type WorkPreview = ReturnType<typeof workPreview>;

export function workView(locale: Locale, detail: WorkDetail, catalog: Character[] = []) {
  const { work, topics, recommendations, next, previous } = detail;
  const roles = workCharacters(work, catalog);
  const preview = workPreview(locale, work, roles);
  const media = workMedia(work);
  const meta = imageMetadata(locale, work);
  const labels = workLabels(locale);
  const date = releaseDate(work);
  const digits = new Intl.NumberFormat(htmlLang[locale], { maximumFractionDigits: 1 });
  const size = media.bytes && (media.bytes >= 1024 * 1024 ? `${digits.format(media.bytes / (1024 * 1024))} MB` : media.bytes >= 1024 ? `${digits.format(media.bytes / 1024)} KB` : `${digits.format(media.bytes)} B`);
  const specs = [media.format?.toUpperCase(), media.width && media.height && `${media.width} × ${media.height}`, size].filter(Boolean).join(' · ');
  const licenseHref = meta.license.url ?? `${localePath(locale, '/about')}#license-${meta.license.type}`;
  const facts = {
    author: { text: meta.creator || labels.unknownAuthor },
    credit: { text: meta.credit.label, href: meta.credit.url, external: true },
    source: { text: meta.source.label, href: meta.source.url, linkLabel: labels.viewSource, external: true },
    sourceNote: { text: meta.sourceNote },
    license: { text: meta.license.label, href: licenseHref, linkLabel: meta.license.url ? undefined : labels.licenseGuide, external: Boolean(meta.license.url), note: meta.licenseNote, notice: meta.copyright },
    specs: { text: specs },
    date: { text: date ? new Intl.DateTimeFormat(htmlLang[locale], { dateStyle: 'medium', timeZone: 'Asia/Shanghai' }).format(new Date(date)) : '' },
  } satisfies Record<string, Fact>;
  const neighbor = (item: WorkDetail['next']) => item?.slug ? localePath(locale, workPath(item.slug)) : '';
  const cover = (item: Work) => workPreview(locale, item, catalog);
  const topicLinks = new Map(topics.map(topic => [topic.id, field(locale, topic, 'name')]));
  for (const id of work.topicIds ?? []) if (!topicLinks.has(id)) topicLinks.set(id, id);
  const links: Record<'characters' | 'category' | 'tags' | 'topics', WorkLink[]> = {
    characters: roles.map(role => ({ label: localizedCharacterName(locale, role), href: localePath(locale, characterPath(role.id)) })),
    category: preview.categoryHref ? [{ label: preview.category, href: preview.categoryHref }] : [],
    tags: workTags(locale, work).map((tag, index) => ({ label: `#${tag}`, href: localePath(locale, '/', `?${new URLSearchParams({ tag: work.tags?.[index] ?? tag })}`) })),
    topics: [...topicLinks].map(([id, label]) => ({ label, href: localePath(locale, topicPath(id)) })),
  };
  return {
    ...preview, facts: facts as Record<keyof typeof facts, Fact>, specs, links,
    previous: neighbor(previous), next: neighbor(next),
    viewCount: work.viewCount, downloadCount: work.downloadCount,
    recommendations: recommendations.filter(item => item.slug !== work.slug).map(cover),
  };
}

export const workRightsForm = `${issueUrl}/new?template=takedown-request.yml`;
export type WorkView = ReturnType<typeof workView>;
