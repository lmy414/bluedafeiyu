import { api, field, publicUrl, topicWorks, workMedia, type Creator, type CreatorPreview, type Page, type Topic, type Video, type Work } from './api';
import type { Locale } from './i18n';
import { topicPath, workPath } from './site';

export function creatorChannels(creator: Pick<Creator, 'homepage' | 'channels'>) {
  const links = new Map<string, string>();
  for (const channel of creator.channels ?? []) {
    const href = publicUrl(channel.url);
    if (href) links.set(href, channel.label || channel.platform || new URL(href).hostname);
  }
  const homepage = publicUrl(creator.homepage);
  if (homepage && !links.has(homepage)) {
    const host = new URL(homepage).hostname;
    links.set(homepage, host === 'space.bilibili.com' ? 'Bilibili' : host === 'github.com' ? 'GitHub' : host === 'x.com' ? 'X' : host);
  }
  return [...links].map(([href, label]) => ({ href, label }));
}

export function topicCreator(topic?: Topic): Creator | undefined {
  const author = topic?.author;
  if (!author?.name || !topic) return;
  const urls = [author.url, ...(author.channels ?? []).map((channel) => channel.url)];
  const uid = urls.flatMap((value) => {
    const url = publicUrl(value);
    if (!url) return [];
    const { hostname, pathname } = new URL(url);
    const id = hostname === 'space.bilibili.com' ? /^\/(\d+)(?:\/|$)/.exec(pathname)?.[1] : undefined;
    return id ? [id] : [];
  })[0];
  return { id: author.creatorId || author.id || (uid ? `bilibili-${uid}` : topic.id), uid, name: author.name, homepage: author.url ?? undefined, channels: author.channels, avatarUrl: author.avatarUrl, avatarKey: author.avatarKey, intro: author.bio };
}

async function allPages<T>(load: (page: number) => Promise<Page<T>>) {
  const first = await load(1);
  const items = [...first.items];
  let page = first.nextPage;
  let previous = 1;
  while (page && page > previous) {
    const next = await load(page);
    if (next.unavailable) return { items, unavailable: true };
    items.push(...next.items);
    previous = page;
    page = next.nextPage;
  }
  return { items, unavailable: first.unavailable };
}

export async function authoredTopics(lang: Locale) {
  const [collections, series] = await Promise.all([false, true].map((serial) => allPages((page) => api.topics({ lang, serial, page, pageSize: 100 }))));
  return { items: [...(collections?.items ?? []), ...(series?.items ?? [])].filter((topic) => topic.author?.name), unavailable: Boolean(collections?.unavailable || series?.unavailable) };
}

const itemsOf = <T>(list?: T[] | { items?: T[] }) => Array.isArray(list) ? list : list?.items ?? [];
const totalOf = <T>(list?: T[] | { items?: T[]; total?: number; pagination?: { total?: number } }) => Array.isArray(list) ? list.length : list?.pagination?.total ?? list?.total ?? list?.items?.length;
const mergeTopics = (first: Topic[], second: Topic[]) => [...new Map([...second, ...first].map((topic) => [topic.id, topic])).values()];

export const videoCover = (video: Video) => publicUrl(video.coverUrl ?? video.source?.coverUrl ?? video.source?.cover ?? video.source?.pic);
export const videoHref = (video: Video) => publicUrl(video.url || video.source?.url) ?? `https://www.bilibili.com/video/${encodeURIComponent(video.bvid)}`;

function representativeWorks(locale: Locale, topics: Topic[], videos: Video[]): CreatorPreview[] {
  const posters = topics.flatMap((topic): CreatorPreview[] => {
    const cover = topic.coverWork ?? topic.cover;
    if (topic.isSerial) return [{ kind: 'serial', title: field(locale, topic, 'name'), href: topicPath(topic.id), thumbUrl: publicUrl(topic.coverUrl) || (cover ? workMedia(cover).thumb : undefined) }];
    return cover ? [{ kind: 'image', title: field(locale, cover, 'name'), href: workPath(cover.slug), thumbUrl: workMedia(cover).thumb }] : [];
  });
  return [...posters, ...videos.map((video): CreatorPreview => ({ kind: 'video', title: field(locale, { ...video, i18n: video.i18n ?? video.review?.i18n }, 'title'), href: videoHref(video), thumbUrl: videoCover(video) }))].filter((item) => item.thumbUrl).slice(0, 3);
}

function stats(creator: Creator, counts: { workCount?: number; videoCount?: number; serialCount?: number }) {
  const workCount = creator.workCount ?? counts.workCount;
  const videoCount = creator.videoCount ?? counts.videoCount;
  const serialCount = creator.serialCount ?? counts.serialCount;
  return { ...creator, workCount, videoCount, serialCount, totalCount: creator.totalCount ?? ([workCount, videoCount, serialCount].some((n) => n !== undefined) ? (workCount ?? 0) + (videoCount ?? 0) + (serialCount ?? 0) : undefined) };
}

export async function creatorDirectory(lang: Locale, page: number): Promise<Page<Creator>> {
  const size = 24;
  const current = await api.creators({ lang, page, pageSize: size });
  if (current.items.length > 0 && current.items.every((creator) => creator.totalCount !== undefined && creator.previews !== undefined)) return current;
  const [registered, authored] = await Promise.all([allPages((p) => api.creators({ lang, page: p, pageSize: 100 })), authoredTopics(lang)]);
  const entries = new Map(registered.items.map((creator) => [creator.id, creator]));
  const groups = new Map<string, Topic[]>();
  for (const topic of authored.items) {
    const author = topicCreator(topic)!;
    const existing = entries.get(author.id);
    entries.set(author.id, existing ? { ...author, ...existing, channels: [...(existing.channels ?? []), ...(author.channels ?? [])] } : author);
    groups.set(author.id, [...(groups.get(author.id) ?? []), topic]);
  }
  const items = await Promise.all([...entries.values()].slice((page - 1) * size, page * size).map(async (creator) => {
    const topics = groups.get(creator.id) ?? [];
    const hasPreviews = creator.previews !== undefined;
    const video = creator.uid && (creator.videoCount === undefined || !hasPreviews) ? await api.videos({ lang, creator: creator.id, pageSize: 3 }) : undefined;
    const imageCount = topics.filter((topic) => !topic.isSerial).reduce((count, topic) => count + (topic.workCount ?? 0), 0);
    return { ...stats(creator, { workCount: authored.unavailable ? undefined : imageCount, videoCount: video?.unavailable ? undefined : video?.total ?? (creator.uid ? undefined : 0), serialCount: authored.unavailable ? undefined : topics.filter((topic) => topic.isSerial).length }),
      previews: creator.previews ?? representativeWorks(lang, topics, video?.items ?? []) };
  }));
  return { items, total: entries.size, page, pageSize: size, nextPage: page * size < entries.size ? page + 1 : null, unavailable: registered.unavailable && !entries.size };
}

export async function loadCreator(lang: Locale, id: string, videoPage: number) {
  const result = await api.creator(id, lang);
  const profile = result.ok ? result.value : undefined;
  const needsTopics = !profile || profile.topics === undefined || profile.serials === undefined;
  const authored = needsTopics ? await authoredTopics(lang) : undefined;
  const matched = authored?.items.filter((topic) => topicCreator(topic)?.id === id) ?? [];
  const knownAuthor = topicCreator(matched[0]);
  if (!profile && !knownAuthor) return { status: result.ok ? 502 : result.status === 404 && authored?.unavailable ? 503 : result.status } as const;

  const creator = profile ? { ...knownAuthor, ...profile.creator, channels: [...(profile.creator.channels ?? []), ...matched.flatMap((topic) => topic.author?.channels ?? [])] } : knownAuthor!;
  const sourceTopics = itemsOf(profile?.topics);
  const serials = mergeTopics([...itemsOf(profile?.serials), ...sourceTopics.filter((topic) => topic.isSerial)], matched.filter((topic) => topic.isSerial));
  const topics = mergeTopics(sourceTopics.filter((topic) => !topic.isSerial), matched.filter((topic) => !topic.isSerial));
  const embedded = itemsOf(profile?.videos);
  const embeddedTotal = Math.max(totalOf(profile?.videos) ?? embedded.length, creator.videoCount ?? 0);
  const images = itemsOf(profile?.works);
  const supplemented = profile?.works === undefined || (creator.workCount ?? totalOf(profile?.works) ?? 0) > images.length;
  const pageSize = 24;
  const videoOffset = (videoPage - 1) * pageSize;
  const localVideoPage = profile?.videos !== undefined && (embeddedTotal <= embedded.length || videoPage === 1 && embedded.length >= Math.min(pageSize, embeddedTotal));
  const [sourceWorks, videos] = await Promise.all([
    supplemented ? Promise.all(topics.map(async (topic) => {
      if (topic.works) return topicWorks(topic);
      const detail = await api.topic(topic.id, lang);
      return detail.ok ? topicWorks(detail.value) : [];
    })).then((groups) => groups.flat()) : [],
    localVideoPage ? { items: embedded.slice(videoOffset, videoOffset + pageSize), total: embeddedTotal, page: videoPage, pageSize, nextPage: videoOffset + pageSize < embeddedTotal ? videoPage + 1 : null, unavailable: false } satisfies Page<Video>
      : result.ok || creator.uid ? api.videos({ lang, creator: id, page: videoPage, pageSize }) : undefined,
  ]);
  const works = [...new Map([...sourceWorks, ...images].map((work: Work) => [work.id, work])).values()];
  if (profile?.works !== undefined && supplemented) {
    const date = (work: Work) => work.publishedAt ?? work.createdAt ?? '';
    works.sort((a, b) => date(b).localeCompare(date(a)) || a.slug.localeCompare(b.slug));
  }
  return { creator: stats(creator, { workCount: Math.max(totalOf(profile?.works) ?? 0, works.length), videoCount: videos?.unavailable ? undefined : videos?.total ?? 0, serialCount: serials.length }), topics, serials, works, videos, status: undefined } as const;
}
