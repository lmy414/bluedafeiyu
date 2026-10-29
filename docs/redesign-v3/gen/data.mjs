// 读取正式构建产物与 data/ 下的源数据，整理成演示页面需要的结构。只读，不修改任何源文件。
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {guides, characterIntros, characterSearchAliases} from '../../../frontend/src/lib/landing-copy.mjs';
import {isGifWork} from '../../../frontend/public/archive/work-format.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const BUILT = path.join(ROOT, '.build/site');
const json = p => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));

export const SITE = 'https://xn--pssy23gqgbz2d718b.com';
export const PAGE_SIZE = 24;
export const KIND = {meme:'梗图', illustration:'插画', standing:'立绘', comic:'漫画', setting:'设定图', other:'其他'};
export const KIND_SEO = {meme:'表情包与梗图', illustration:'二创插画', standing:'立绘', comic:'漫画', setting:'设定图', other:'其他作品'};
export const LICENSED = {cc0:'CC0', 'cc-by':'CC BY', 'cc-by-nc':'CC BY-NC', 'author-permission':'作者授权', 'submitter-permission':'投稿者授权'};
export {guides, characterIntros, characterSearchAliases};

const archive = json('.build/site/archive-data.json');
const serialSource = json('data/serial-topics.json');
const videoArchive = json('data/video-archive.json');
export const events = json('data/events.json').sort((a, b) => b.deadline.localeCompare(a.deadline));
export const friendLinks = json('data/friend-links.json');
export const types = archive.types;

// 角色色值来自正式 tokens.css 的 --art-<id>-b，演示里生成 roles.css 使用。
export const roleColors = Object.fromEntries([...readFileSync(path.join(BUILT, 'tokens.css'), 'utf8')
  .matchAll(/--art-([a-z0-9-]+)-b:\s*(#[0-9a-f]{3,8})/gi)].map(m => [m[1], m[2]]));

export const works = archive.works
  .map(w => ({...w, kinds: w.k || [], kind: (w.k || [])[0] || 'other', time: w.at || 0, gif: isGifWork(w)}))
  .sort((a, b) => b.time - a.time);
export const workById = new Map(works.map(w => [w.id, w]));

// 连载：data/serial-topics.json 的 reader 字段。chapters / state 是本方案建议新增的可选字段，缺省时按 10 页分组。
export const serials = serialSource.map(s => {
  const topic = archive.topics.find(t => t.id === s.id) || s;
  const reader = s.reader;
  const byNumber = new Map(reader.pages.map(p => [p.number, workById.get(p.workId)]).filter(([, w]) => w));
  const numbers = Array.from({length: reader.totalPages}, (_, i) => i + 1);
  const chapters = reader.chapters || numbers.filter(n => n % 10 === 1)
    .map(from => ({title: `第 ${from}–${Math.min(from + 9, reader.totalPages)} 页`, from, to: Math.min(from + 9, reader.totalPages), derived: true}));
  const published = numbers.filter(n => byNumber.has(n));
  const avatar = existsSync(path.join(BUILT, 'author-avatars', s.id + '.webp')) ? '/author-avatars/' + s.id + '.webp' : '';
  return {...topic, ...s, reader, byNumber, numbers, chapters, published, avatar,
    list: s.workIds.map(id => workById.get(id)).filter(Boolean),
    missing: numbers.filter(n => !byNumber.has(n)),
    state: reader.state || (s.status === 'active' ? 'ongoing' : 'completed'),
    cover: workById.get(s.coverWorkId), latest: Math.max(...published)};
});
export const serialWorkIds = new Set(serials.flatMap(s => s.workIds));
export const serialOf = w => serials.find(s => s.workIds.includes(w.id));

// 主图库：不含连载页。连载只在漫画频道、连载目录和阅读器里出现，作品详情页照常保留。
export const gallery = works.filter(w => !serialWorkIds.has(w.id));

export const characters = archive.characters.map(c => {
  const list = gallery.filter(w => (w.cids || []).includes(c.id));
  const kinds = Object.fromEntries(Object.keys(KIND).map(k => [k, list.filter(w => w.kind === k).length]));
  const inSerials = serials.filter(s => s.list.some(w => (w.cids || []).includes(c.id)));
  return {...c, list, count: list.length, kinds, serials: inSerials, intro: characterIntros[c.id]?.[0],
    searchAlias: characterSearchAliases[c.id]?.[0],
    // 代表图优先用立绘，其次插画，最后用最新一件，让角色目录和角色页更像“角色名片”。
    cover: ['standing', 'setting', 'illustration', 'meme'].map(k => list.find(w => w.kind === k && w.w && w.h)).find(Boolean) || list[0]};
}).filter(c => c.count).sort((a, b) => b.count - a.count);
export const characterById = new Map(characters.map(c => [c.id, c]));

export const topics = archive.topics.filter(t => !serials.some(s => s.id === t.id)).map(t => {
  const avatar = existsSync(path.join(BUILT, 'author-avatars', t.id + '.webp')) ? '/author-avatars/' + t.id + '.webp' : '';
  return {...t, avatar, list: t.workIds.map(id => workById.get(id)).filter(Boolean), cover: workById.get(t.coverWorkId)};
});

// 短篇漫画 = 类型为漫画、且不属于任何连载的作品（投稿规则：至少两格，不要求连续剧情）。
export const shortComics = gallery.filter(w => w.kind === 'comic');

const creatorAvatar = uid => existsSync(path.join(BUILT, 'creator-avatars', uid + '.jpg')) ? '/creator-avatars/' + uid + '.jpg' : '';
const creatorRaw = new Map(videoArchive.creators.map(c => [c.uid, c]));
export const videos = videoArchive.videos
  .map(v => ({...v, creator: creatorRaw.get(v.uid)}))
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

// 创作者：与线上 lib/creators.mjs 相同的合并规则（视频作者 + 署名合集的作者），顺序也相同。
const rank = uid => ({'4168597': 0, '4456176': 1}[uid] ?? 2);
export const creators = (() => {
  const map = new Map(videoArchive.creators.map(c => [c.uid, {...c, id: 'bilibili-' + c.uid, href: '/creators/bilibili-' + c.uid + '.html',
    avatar: creatorAvatar(c.uid), images: [], videos: videos.filter(v => v.uid === c.uid), topics: []}]));
  for (const t of [...topics, ...serials].filter(t => t.author)) {
    const uid = (t.author.channels || []).map(c => c.url.match(/space\.bilibili\.com\/(\d+)/)?.[1]).find(Boolean);
    const key = uid || t.id, existing = map.get(key);
    if (existing) {
      existing.images = [...new Map([...existing.images, ...t.list].map(w => [w.id, w])).values()];
      existing.topics.push(t); existing.intro ||= t.author.bio || ''; existing.avatar ||= t.avatar; existing.channels = t.author.channels;
    } else map.set(key, {uid: uid || '', id: uid ? 'bilibili-' + uid : t.id, name: t.author.name, intro: t.author.bio || '',
      avatar: t.avatar || (uid && creatorAvatar(uid)), href: '/creators/' + (uid ? 'bilibili-' + uid : t.id) + '.html',
      homepage: t.author.channels[0].url, channels: t.author.channels, images: t.list, videos: [], topics: [t]});
  }
  return [...map.values()].map(c => {
    const media = [...c.images.map(w => ({kind: 'image', date: w.dt.replaceAll('.', '-'), item: w})),
      ...c.videos.map(v => ({kind: 'video', date: v.publishedAt, item: v}))].sort((a, b) => b.date.localeCompare(a.date));
    return {...c, media, latest: media[0]?.date || '', total: media.length};
  }).sort((a, b) => rank(a.uid) - rank(b.uid) || a.name.localeCompare(b.name));
})();
export const creatorOfSerial = s => creators.find(c => c.topics?.includes(s));

// 线上首页“热门下载”区块的 4 件作品（统计接口不可用时线上也显示这一组）。
export const downloadPicks = ['deepseek202609300025', 'deepseek202610030026', 'claude202610030001', 'deepseek202610030020']
  .map(slug => works.find(w => w.slug === slug)).filter(Boolean);

// 文件预览无法跨域读取线上统计；构建时读取与正式站相同的公开聚合快照。
export async function loadDownloadStats(fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(`${SITE}/cms-api/analytics/public`, {signal: AbortSignal.timeout(10000)});
    if (!response.ok) return null;
    const snapshot = await response.json();
    if (snapshot?.available !== true || !snapshot.works || typeof snapshot.works !== 'object' || Array.isArray(snapshot.works) || !Number.isFinite(Date.parse(snapshot.syncedAt))) return null;
    return snapshot;
  } catch {
    return null;
  }
}
// 线上作品页评论使用的 giscus 配置（archive.js），演示原样沿用，点击后才加载。
export const giscus = {repo:'lmy414/lmy414-blog-comments', repoId:'R_kgDOTUvnVw', category:'Announcements', categoryId:'DIC_kwDOTUvnV84DF4fs'};
export const QQ = {name:'AAAA肥鱼批发市场', number:'1074853711', qr:'/qq-group.png?v=1074853711', join:'https://qm.qq.com/q/THMPEsD42I'};

export const stats = {
  works: works.length, gallery: gallery.length, characters: characters.length, topics: topics.length + guides.length,
  videos: videos.length, comics: shortComics.length + serials.length, shortComics: shortComics.length, serials: serials.length,
  serialPages: serials.reduce((n, s) => n + s.published.length, 0), creators: creators.length,
  gifs: gallery.filter(w => w.gif).length, updated: works[0]?.dt,
};
