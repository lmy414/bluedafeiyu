// v2 前台的共享数据层：列表页、作品浮层、搜索、分享卡片都从这里取数
// 只读 dist/site-data.json（由 tools/build_site_snapshot.mjs 生成），不改作品 id / slug
import { works as published, site, categories, topics as allTopics, byWorkId } from './site.mjs';
import { workAttribution } from '../../../admin/src/lib/attribution.mjs';
import { imageRights } from './image-metadata.mjs';

export const ORIGIN = 'https://xn--pssy23gqgbz2d718b.com';
export const PAGE_SIZE = 24;

// 站点信息（沿用原站 about / QqModal / WorkInfo 的内容）
export const SITE = {
  group: { name: 'AAAA肥鱼批发市场', number: '1003728058', url: 'https://qm.qq.com/q/4AOX3WfO1O', qr: '/qq-group.png?v=1003728058' },
  repoContent: 'https://github.com/lmy414/ai-girl-stickers',
  repoSource: 'https://github.com/lmy414/bluedafeiyu',
  takedown: 'https://github.com/lmy414/ai-girl-stickers/issues/new?template=takedown-request.yml',
  // 站长的其他平台（社群页「也可以在这里找到我」）
  social: [
    { id: 'bili', name: '哔哩哔哩', key: 'v2.cm.bili', handle: 'UID 321480847', href: 'https://space.bilibili.com/321480847' },
    { id: 'x', name: 'X', key: 'v2.cm.x', handle: '@mirror960896', href: 'https://x.com/mirror960896' }
  ]
};
// 平台图标：B 站小电视、X 标志，单色，跟随 currentColor
export const SOCIAL_ICON = {
  bili: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><path d="M17.81 4.47c.36.36.36.94 0 1.3l-.93.93h1.37A3.75 3.75 0 0 1 22 10.45v6.3a3.75 3.75 0 0 1-3.75 3.75H5.75A3.75 3.75 0 0 1 2 16.75v-6.3A3.75 3.75 0 0 1 5.75 6.7h1.37l-.93-.93a.92.92 0 1 1 1.3-1.3L9.73 6.7h4.54l2.24-2.23a.92.92 0 0 1 1.3 0ZM18.25 8.6H5.75c-1.02 0-1.85.83-1.85 1.85v6.3c0 1.02.83 1.85 1.85 1.85h12.5c1.02 0 1.85-.83 1.85-1.85v-6.3c0-1.02-.83-1.85-1.85-1.85ZM8 11.3c.55 0 1 .45 1 1v1.4a1 1 0 1 1-2 0v-1.4c0-.55.45-1 1-1Zm8 0c.55 0 1 .45 1 1v1.4a1 1 0 1 1-2 0v-1.4c0-.55.45-1 1-1Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z"/></svg>'
};

// 2026 国庆「网站前台设计征集」：开屏弹窗与活动页共用。repo 留空表示活动仓库尚未开放
export const EVENT = {
  id: 'national-day-2026',
  href: '/events/national-day-2026.html',
  img: '/events/national-day-2026.webp', imgW: 720, imgH: 900,
  popupUntil: '2026-11-07T23:59:59+08:00',
  repo: 'https://github.com/lmy414/bluedafeiyu-design-2026',
  gallery: 'https://lmy414.github.io/bluedafeiyu-design-2026/'
};

// 类型短名（卡片角标、筛选条用）；全称用 data/categories.json 的 name
export const SHORT = { meme: '梗图', illustration: '插画', setting: '设定图', comic: '漫画', standing: '立绘', other: '其他' };
export const TYPES = categories.map(c => ({ ...c, short: SHORT[c.id] || c.name }));
const typeById = new Map(TYPES.map(t => [t.id, t]));

// 角色识别色：tokens.css 里有 --art-<角色>-a/b 的直接用，没有的在 v2.css 补
const ART = new Set(['deepseek', 'doubao', 'kimi', 'qwen', 'claude', 'gemini', 'grok', 'other', 'owner-picks', 'gpt', 'glm', 'stepfun', 'mimo']);
const tone = id => (ART.has(id) ? id : 'other');
export const chars = site.characters.filter(c => c.status === 'active').map(c => ({
  ...c, aliases: c.aliases || [], color: 'var(--art-' + tone(c.id) + '-b)', soft: 'var(--art-' + tone(c.id) + '-a)'
}));
export const charById = new Map(chars.map(c => [c.id, c]));
const fallbackChar = id => ({ id, name: id, aliases: [], color: 'var(--art-other-b)', soft: 'var(--art-other-a)' });

// 授权：卡片短标签 + 全称（全称措辞与 WorkInfo.astro 一致）
export const LICENSE = {
  cc0: ['CC0', 'CC0 公共领域'],
  'cc-by': ['CC BY', 'CC BY 署名'],
  'cc-by-nc': ['BY-NC', 'CC BY-NC 署名·非商用'],
  'author-permission': ['作者授权', '原作者明确授权'],
  'submitter-permission': ['投稿授权', '投稿者确认授权收录与下载'],
  unknown: ['授权未明', '授权状态不明']
};
export const licKey = w => (LICENSE[w.license?.type] ? w.license.type : 'unknown');

// 来源：原站 origin 有三种结构（首批 type/sourceUrl、投稿 issueUrl/groupId/via、站长自用）
export const ORIGIN_LABEL = {
  'self-created': '自己创作或生成', 'author-submitted': '原作者本人投稿', 'internet-found': '网络整理',
  'community-created': '社区成员创作', 'github-issue': 'GitHub Issue 投稿', 'qq-group': 'QQ 群投稿', 'site-form': '站内投稿', unknown: '来源不明'
};
const originType = o => {
  if (o?.issueUrl) return 'github-issue';
  if (o?.groupId || o?.type === 'qq-group') return 'qq-group';
  if (o?.via === 'web') return 'site-form';
  return ORIGIN_LABEL[o?.type] ? o.type : 'unknown';
};
const originUrl = o => o?.issueUrl || o?.sourceUrl || '';

// 角色别名、泛词不当 Tag 展示
const aliasWords = new Set();
for (const c of chars) [c.id, c.name, ...c.aliases].forEach(a => aliasWords.add(String(a).toLowerCase()));
['大肥鱼', '鲸鱼娘', 'step', 'chatgpt', 'openai', '拟人化', '二创', '表情包', 'a/'].forEach(a => aliasWords.add(a));
const normTags = tags => [...new Set((tags || []).map(t => String(t).trim()).filter(t => t && !aliasWords.has(t.toLowerCase())))];

export const asset = u => (/^https?:/.test(u || '') ? u : '/' + String(u || '').replace(/^\/+/, ''));
export const abs = u => (/^https?:/.test(u || '') ? u : ORIGIN + asset(u));
export const fmtSize = b => (!b ? '' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
export const fmtDate = s => String(s || '').slice(0, 10).replace(/-/g, '.');

export const works = published
  .map(w => {
    const char = charById.get(w.characterId) || fallbackChar(w.characterId);
    const cats = (w.categoryIds || []).filter(id => typeById.has(id));
    const attribution = workAttribution(w);
    return {
      ...w, char, cats, tagsShown: normTags(w.tags),
      thumb: asset(w.thumbUrl || w.thumbnailPath), large: asset(w.displayUrl || w.fullPath || w.thumbUrl),
      typeShort: cats.map(id => typeById.get(id).short).join(' · '),
      lic: licKey(w), originKind: originType(w.origin), originLink: originUrl(w.origin),
      attribution,
      author: imageRights(w).creditName,
      authorUrl: attribution.url
    };
  })
  .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.slug.localeCompare(a.slug));
export const workBySlug = new Map(works.map(w => [w.slug, w]));

export const byChar = new Map(chars.map(c => [c.id, works.filter(w => w.characterId === c.id)]));
export const activeChars = chars.filter(c => byChar.get(c.id).length).sort((a, b) => byChar.get(b.id).length - byChar.get(a.id).length);
export const ofType = (list, id) => (id ? list.filter(w => w.cats.includes(id)) : list);

// 合集 = 站长人工维护的专题（data/topics.json），不自动归类
export const topics = allTopics.filter(t => t.status === undefined || t.status === 'active').map((t, i) => {
  const list = (t.workIds || []).map(id => byWorkId.get(id)).filter(Boolean).map(w => workBySlug.get(w.slug)).filter(Boolean);
  const cover = workBySlug.get(byWorkId.get(t.coverWorkId)?.slug) || list[0];
  const k = ['deepseek', 'claude', 'gpt', 'stepfun', 'mimo', 'glm', 'qwen'][i % 7];
  return { ...t, list, cover, color: 'var(--art-' + k + '-b)', soft: 'var(--art-' + k + '-a)' };
}).filter(t => t.list.length);

export const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out.length ? out : [[]]; };
// 分页地址：第一页是 base（如 /index.html），之后是 <dir>/page/N.html
export const pageHref = (base, n) => (n === 1 ? base : base.replace(/(index)?\.html$/, '').replace(/\/?$/, '/') + 'page/' + n + '.html');

// 作品浮层数据（/works-v2.json）：字段名尽量短，控制体积
export function overlayData() {
  return Object.fromEntries(works.map(w => [w.slug, {
    i18n: Object.fromEntries(Object.entries(w.i18n || {}).filter(([lang])=>['en','ja'].includes(lang)).map(([lang,value])=>[lang,{...value,tags:w.tagsShown.map(t=>value.tags[w.tags.indexOf(t)])}])),
    n: w.name, c: w.char.name, cid: w.characterId, col: w.char.color, cs: w.char.soft, i: w.thumb, l: w.large, w: w.width, h: w.height,
    d: w.description || '', cm: w.commentary || '', o: w.originalUrl || w.path, f: String(w.format || '').toUpperCase(), s: fmtSize(w.fileSize), bytes: Number(w.fileSize) || 0,
    lk: w.lic, ls: LICENSE[w.lic][0], lt: LICENSE[w.lic][1], ln: w.license?.note || '', a: w.author, k: w.cats, ts: w.typeShort || '作品', tg: w.tagsShown,
    au: w.authorUrl, ac: w.attribution.explicit, sa: imageRights(w).creator, rights: imageRights(w),
    ok: w.originKind, su: w.originLink, dt: fmtDate(w.createdAt), id: w.id
  }]));
}
// 搜索索引（/search-index.json）：只含检索字段
export function searchIndex() {
  return works.map(w => ({ id: w.id, s: w.slug, n: w.name, c: w.char.name, a: w.char.aliases.join(' '), t: (w.tags || []).join(' '), d: w.description || '', i: w.thumb, w: w.width, h: w.height, k: w.cats }));
}

export const GH_ICON = "<svg viewBox=\"0 0 16 16\" width=\"18\" height=\"18\" aria-hidden=\"true\" fill=\"currentColor\"><path d=\"M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z\"/></svg>";

// ---------- 社交分享卡片 ----------
// 页面构建时调用 ogCard() 登记一张卡；frontend/scripts/og-cards.mjs 在 Astro 构建后
// 读取 out/og-jobs.json，调用 tools/og_cards.py 生成 1200×630 JPG，画面就是这一页对应的作品。
import fs from 'node:fs';
import path from 'node:path';
const OG_JOBS_FILE = process.env.OG_JOBS_FILE || path.resolve(process.cwd(), '.astro', 'og-jobs.jsonl');
export function ogCard(id, w, title, sub, tag, quote = false) {
  if (!w) return null;
  const job = { id, img: w.displayUrl || w.fullPath || w.thumbUrl, title, sub, tag, quote };
  try { fs.mkdirSync(path.dirname(OG_JOBS_FILE), { recursive: true }); fs.appendFileSync(OG_JOBS_FILE, JSON.stringify(job) + '\n'); } catch {}
  return { image: '/og/' + id + '.jpg', alt: w.description || w.name };
}
export const pg = cur => (cur > 1 ? ' 第' + cur + '页' : '');
export const typeTabItems = (base, list, activeId, keyPrefix = 'v2.type.') => [
  { href: base, label: '全部', key: 'filter.all', count: list.length, on: !activeId },
  ...TYPES.map(t => ({ id: t.id, href: t.href, label: t.short, key: keyPrefix + t.id, count: list.filter(w => w.cats.includes(t.id)).length, on: t.id === activeId }))
];
