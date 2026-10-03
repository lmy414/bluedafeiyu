import { workAttribution } from '../../../admin/src/lib/attribution.mjs';

const ORIGIN = 'https://xn--pssy23gqgbz2d718b.com';
const LICENSE_TYPES = new Set(['cc0', 'cc-by', 'cc-by-nc', 'author-permission', 'submitter-permission']);
const UNKNOWN_NAMES = new Set(['未标注', '未署名', '未知', 'unknown', '本人', 'GPT画的', '上游清单导入']);
const named = value => {
  const name = String(value || '').trim();
  return name && !UNKNOWN_NAMES.has(name) ? name : '';
};
const abs = value => new URL(value, ORIGIN + '/').href;

// 投稿者的展示署名不等于作者身份；未知信息保留为说明，不生成虚构 Person。
export function imageRights(work) {
  const attribution = workAttribution(work);
  const creator = named(work.origin?.author);
  const credit = named(attribution.name) || (!attribution.explicit ? named(work.submitter?.name) : '');
  const type = LICENSE_TYPES.has(work.license?.type) ? work.license.type : 'unknown';
  return {
    type,
    creator,
    creditName: credit,
    creditText: (credit ? `${credit}；` : '') + '蓝色大肥鱼（整理收录）',
    copyrightNotice: type === 'cc0'
      ? '作品标注为 CC0 公共领域；以作品授权说明为准。'
      : creator ? `图片版权归原作者 ${creator} 所有。` : '图片版权归原作者所有；原作者未标注。',
    license: `${ORIGIN}/about.html#license-${type}`,
    acquireLicensePage: `${ORIGIN}/about.html#licensing`
  };
}

export function imageMetadata(work, { description, genre } = {}) {
  const rights = imageRights(work);
  return {
    '@context': 'https://schema.org', '@type': 'ImageObject',
    name: work.name, description: description || work.description || '',
    contentUrl: abs(work.displayUrl), thumbnailUrl: abs(work.thumbUrl),
    uploadDate: work.createdAt,
    ...(rights.creator ? { creator: { '@type': 'Person', name: rights.creator } } : {}),
    creditText: rights.creditText, copyrightNotice: rights.copyrightNotice,
    license: rights.license, acquireLicensePage: rights.acquireLicensePage,
    keywords: (work.tags || []).join(','), genre,
    url: `${ORIGIN}/works/${work.slug}.html`
  };
}
