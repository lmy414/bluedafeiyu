import { field, workMedia, type Character, type Work } from './api';
import { copy, htmlLang, localePath, tr, type Locale } from './i18n';
import { categoryName, imageMetadata, workPath, workTags } from './site';
import { characterAliases, releaseDate, workCharacters } from './work-view';

const genres: Record<string, string[]> = {
  meme: ['表情包', 'meme', 'スタンプ'], illustration: ['二创插画', 'fan illustration', 'ファンイラスト'],
  setting: ['设定图', 'design sheet', '設定画'], comic: ['漫画', 'comic', '漫画'],
  standing: ['立绘', 'character art', '立ち絵'], other: ['其他作品', 'fan work', 'ファン作品'],
};

export function workSeo(locale: Locale, work: Work, origin: string, catalog: Character[]) {
  const canonical = new URL(localePath(locale, workPath(work.slug)), origin).href;
  const name = field(locale, work, 'name');
  const recorded = field(locale, work, 'description');
  const commentary = field(locale, work, 'commentary');
  const media = workMedia(work);
  const tags = workTags(locale, work);
  const roles = workCharacters(work, catalog).map(role => ({ '@type': 'Thing', name: field(locale, role, 'name'), alternateName: characterAliases(locale, role) }));
  const character = roles[0]?.name ?? '';
  const aliases = [...new Set(roles.flatMap(role => role.alternateName))];
  const id = work.categoryId ?? work.categoryIds?.[0] ?? 'other';
  const genre = categoryName(locale, id, work.category);
  const kind = copy(locale, Object.hasOwn(genres, id) ? genres[id]! : genres.other!);
  const head = copy(locale, [`《${name}》${character}${kind}`, `${name} · ${character} ${kind}`.trim(), `「${name}」${character}の${kind}`]);
  const suffix = ` | ${tr(locale, 'site')}`;
  const topic = [...new Set([aliases[0], tags[0]].filter(Boolean))].join(' · ');
  const truncated = Array.from(topic).slice(0, Math.max(0, 60 - Array.from(head + suffix + ' - ').length)).join('').trim();
  const title = `${head}${truncated ? ` - ${truncated}` : ''}${suffix}`;
  const subtitle = [character, aliases.length && `(${aliases.join(locale === 'en' ? ', ' : '、')})`, kind, tags.slice(0, 3).join(locale === 'en' ? ', ' : '、')].filter(Boolean).join(' · ');
  const description = `${[field(locale, work, 'seoDescription') || recorded || commentary || name, subtitle].filter(Boolean).join(' ')} ${copy(locale, ['可查看高清图片、原始来源和授权，并下载原图。', 'View the full image, its source and license, and download the original.', '高画質画像、出典、利用許諾を確認し、原画をダウンロードできます。'])}`;
  const rights = imageMetadata(locale, work);
  const about = new URL(localePath(locale, '/about'), origin).href;
  const archiveCredit = copy(locale, ['蓝色大肥鱼（整理收录）', 'Blue Dafeiyu (archived by)', '藍色大肥魚（収録・整理）']);
  const date = releaseDate(work);
  const mime: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', apng: 'image/apng', avif: 'image/avif' };
  const format = media.format?.toLowerCase() ?? '';
  return { title, description, image: {
    '@context': 'https://schema.org', '@type': 'ImageObject', '@id': `${canonical}#image`,
    name, caption: [recorded, commentary !== recorded ? commentary : ''].filter(Boolean).join('\n') || name, description: recorded || commentary || description,
    contentUrl: media.original || media.display || undefined, thumbnailUrl: media.thumb || undefined, url: canonical,
    width: media.width, height: media.height, encodingFormat: media.mimeType || (Object.hasOwn(mime, format) ? mime[format] : undefined),
    contentSize: media.bytes ? `${media.bytes} B` : undefined,
    uploadDate: work.createdAt || date, datePublished: date, dateModified: work.updatedAt || date, inLanguage: htmlLang[locale],
    creator: rights.creator ? { '@type': 'Person', name: rights.creator } : undefined,
    creditText: [rights.credit.label, archiveCredit].filter(Boolean).join(locale === 'en' ? '; ' : '；'), copyrightNotice: rights.copyright,
    license: rights.license.url || `${about}#license-${rights.license.type}`, acquireLicensePage: rights.license.url || `${about}#licensing`,
    keywords: tags.join(', '), genre, about: roles,
  } };
}
