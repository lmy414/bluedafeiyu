import { api, categoryIds, field, type Page, type Work, workMedia } from './api';
import { copy, htmlLang, localePath, locales, prepareLocale, tr, type Locale } from './i18n';
import { guides, guidePath } from '../content/landing-copy';
import { nationalDay } from '../content/national-day';
import { topicReading } from '../content/topic-reading';
import { topicCreator } from './creators';
import { archivedTopic } from './page-data';
import { characterDescription, characterPath, creatorPath, imageMetadata, publicCache, readerPath, segment, siteOrigin, topicPath, workPath, workTags } from './site';

const staticPaths = ['/', '/categories', '/gifs', '/characters', '/topics', '/serials', '/videos', '/creators', '/submit', '/community', '/about', '/friend-links', '/community-projects', '/changelog', '/events', '/events/current', '/events/archive', `/events/${nationalDay.id}`, ...guides.map(guidePath), ...Object.keys(topicReading).map(topicPath)];
const textHeaders = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': publicCache };
const absolute = (origin: string, locale: Locale, path: string) => new URL(localePath(locale, path), origin).href;
const md = (value: string) => value.replace(/[\\`*_[\]<>]/g, '\\$&');
const xml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);

async function all<T>(load: (page: number) => Promise<Page<T>>, first = 1) {
  const items: T[] = [];
  let page: number | null = first;
  while (page) {
    const result: Page<T> = await load(page);
    if (result.unavailable) return { items, unavailable: true };
    items.push(...result.items);
    page = result.nextPage && result.nextPage > page ? result.nextPage : null;
  }
  return { items, unavailable: false };
}

async function discoverWorks(locale: Locale) {
  const [catalog, serials] = await Promise.all([
    all((page) => api.works({ lang: locale, page, pageSize: 100 })),
    all((page) => api.topics({ lang: locale, serial: true, page, pageSize: 100 })),
  ]);
  const details = await Promise.all(serials.items.map(async topic => {
    if (topic.pages?.length || topic.reader?.pages?.length) return { topic, unavailable: false };
    const detail = await api.topic(topic.id, locale);
    return { topic: detail.ok ? detail.value : topic, unavailable: !detail.ok };
  }));
  const combined = new Map(catalog.items.map((item) => [item.id, item]));
  for (const { topic } of details) {
    const cover = topic.coverWork ?? topic.cover;
    if (cover) combined.set(cover.id, cover);
    for (const entry of topic.pages ?? topic.reader?.pages ?? []) if (entry.work) combined.set(entry.work.id, entry.work);
  }
  return { items: [...combined.values()], serials: details.map(({ topic }) => topic), unavailable: catalog.unavailable || serials.unavailable || details.some(({ unavailable }) => unavailable) };
}

function response(body: string, contentType: string, status = 200) {
  return new Response(body, { status, headers: { ...textHeaders, 'Content-Type': `${contentType}; charset=utf-8`, ...(status !== 200 && { 'Cache-Control': 'no-store' }) } });
}

function workDocument(work: Work, locale: Locale, origin: string) {
  const t = (key: Parameters<typeof tr>[1]) => tr(locale, key);
  const metadata = imageMetadata(locale, work);
  const media = workMedia(work);
  const formatted = ([metadata.source, metadata.license, metadata.credit]).map((entry) => entry.url ? `[${md(entry.label || entry.url)}](<${entry.url}>)` : md(entry.label || t('unspecified')));
  return [
    `# ${md(field(locale, work, 'name'))}`, field(locale, work, 'description'), field(locale, work, 'commentary'),
    `- ID: \`${work.id}\``, `- ${t('detail')}: <${absolute(origin, locale, workPath(work.slug))}>`,
    media.original && `- ${t('download')}: <${media.original}>`,
    `- ${t('source')}: ${formatted[0]} ${metadata.sourceNote}`.trimEnd(),
    `- ${t('license')}: ${formatted[1]} ${metadata.licenseNote}`.trimEnd(),
    `- ${t('credit')}: ${formatted[2]}`,
    workTags(locale, work).map((tag) => `#${md(tag)}`).join(' · '), '',
  ].filter((line, index) => line || index === 0).join('\n\n') + '\n';
}

export async function seoResponse(locale: Locale, path: string, url: URL) {
  const origin = siteOrigin(url);
  const canonical = (name: string) => absolute(origin, locale, name);
  if (path === '/robots.txt') return response(`User-agent: *\nDisallow: /admin/\nDisallow: /api/\nDisallow: /cms-api/\nSitemap: ${new URL('/sitemap.xml', origin).href}\n`, 'text/plain');
  if (path === '/sitemap.xml') {
    const [works, characters, topics, creators, events] = await Promise.all([
      discoverWorks('zh'), api.characters('zh'), all((page) => api.topics({ lang: 'zh', serial: false, page, pageSize: 100 })),
      all((page) => api.creators({ lang: 'zh', page, pageSize: 100 })), api.events('zh', 'all'), prepareLocale('zh-hant'),
    ]);
    if ([works, characters, topics, creators, events].some((result) => result.unavailable)) return response(tr(locale, 'unavailable'), 'text/plain', 503);
    const urls = new Map<string, string | undefined>(staticPaths.map((name) => [name, undefined]));
    const images = new Map(works.items.map(item => [workPath(item.slug), item]));
    for (const item of works.items) urls.set(workPath(item.slug), item.updatedAt ?? item.publishedAt ?? undefined);
    for (const item of characters.items) urls.set(characterPath(item.id), undefined);
    for (const item of creators.items) urls.set(creatorPath(item.id), undefined);
    for (const item of events.items) urls.set(`/events/${segment(item.slug)}`, undefined);
    for (const id of categoryIds) urls.set(`/categories/${id}`, undefined);
    for (const item of [...topics.items, ...works.serials]) {
      urls.set(topicPath(item.id), item.updatedAt);
      const author = topicCreator(item);
      if (author) urls.set(creatorPath(author.id), undefined);
      for (const page of item.pages ?? item.reader?.pages ?? []) urls.set(readerPath(item.id, page.pageNumber), page.work?.updatedAt ?? item.updatedAt);
    }
    const entries = [...urls].flatMap(([name, modified]) => {
      const alternates = locales.map((lang) => `<xhtml:link rel="alternate" hreflang="${htmlLang[lang]}" href="${xml(absolute(origin, lang, name))}"/>`).join('');
      const lastmod = modified && !Number.isNaN(Date.parse(modified)) ? `<lastmod>${new Date(modified).toISOString().slice(0, 10)}</lastmod>` : '';
      const work = images.get(name);
      const media = work && workMedia(work);
      return locales.map((lang) => {
        const display = media?.display;
        const image = work && display ? `<image:image><image:loc>${xml(display)}</image:loc><image:title>${xml(field(lang, work, 'name'))}</image:title><image:caption>${xml(field(lang, work, 'description') || field(lang, work, 'commentary') || field(lang, work, 'name'))}</image:caption></image:image>` : '';
        return `<url><loc>${xml(absolute(origin, lang, name))}</loc>${lastmod}${alternates}${image}</url>`;
      });
    });
    return response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries.join('\n')}\n</urlset>`, 'application/xml');
  }
  if (path === '/llms.txt' || path === '/llms-full.txt') {
    const t = (key: Parameters<typeof tr>[1]) => tr(locale, key);
    const indexes = [ ['gallery', '/'], ['characters', '/characters'], ['topics', '/topics'], ['serials', '/serials'], ['videos', '/videos'], ['creators', '/creators'], ['community', '/community'], ['about', '/about'], ['events', '/events'], ['projects', '/community-projects'], ['links', '/friend-links'], ['changelog', '/changelog'] ] as const;
    const overview = [`# ${t('site')}`, `> ${t('aboutCopy')}`, `## ${t('nav')}`, ...indexes.map(([key, name]) => `- [${t(key)}](${canonical(name)})`), ...guides.map((guide) => `- [${md(copy(locale, guide.name))}](${canonical(guidePath(guide))}): ${md(copy(locale, guide.summary))}`), `- [OpenAPI v1](${new URL('/open-api/v1/index.json', origin).href})`, `- [llms-full.txt](${canonical('/llms-full.txt')})`].join('\n');
    if (path === '/llms.txt') return response(`${overview}\n`, 'text/plain');
    const [works, characters, topics] = await Promise.all([discoverWorks(locale), api.characters(locale), all((page) => api.topics({ lang: locale, serial: false, page, pageSize: 100 }))]);
    if (works.unavailable || characters.unavailable || topics.unavailable) return response(t('unavailable'), 'text/plain', 503);
    const references = [
      '', `## ${t('characters')}`,
      ...characters.items.map((item) => `- [${md(field(locale, item, 'name'))}](${canonical(`${characterPath(item.id)}.md`)}): ${md(characterDescription(locale, item))}`),
      '', `## ${t('topics')}`,
      ...[...topics.items, ...works.serials].map((item) => `- [${md(field(locale, item, 'name'))}](${canonical(`${topicPath(item.id)}.md`)}): ${md(field(locale, item, 'summary'))}`),
      '', ...works.items.map((work) => workDocument(work, locale, origin)),
    ];
    return response(`${overview}\n${references.join('\n')}\n`, 'text/plain');
  }
  const match = /^\/(works|characters|topics)\/([^/]+)\.md$/.exec(path);
  if (!match) return;
  let id: string;
  try { id = decodeURIComponent(match[2]!); } catch { return response(tr(locale, 'notFound'), 'text/plain', 404); }
  if (!id || id.length > 200 || /[/\\\u0000-\u001f]/.test(id)) return response(tr(locale, 'notFound'), 'text/plain', 404);
  if (match[1] === 'works') {
    const result = await api.work(id, locale);
    if (!result.ok) return response(tr(locale, result.status === 404 ? 'notFound' : 'unavailable'), 'text/plain', result.status === 404 ? 404 : 503);
    if (result.value.work.slug !== id) return Response.redirect(canonical(`/works/${segment(result.value.work.slug)}.md`), 301);
    return response(workDocument(result.value.work, locale, origin), 'text/markdown');
  }
  if (match[1] === 'characters') {
    const result = await api.character(id, locale);
    if (!result.ok) return response(tr(locale, result.status === 404 ? 'notFound' : 'unavailable'), 'text/plain', result.status === 404 ? 404 : 503);
    const character = result.value;
    return response(`# ${md(field(locale, character, 'name'))}\n\n${characterDescription(locale, character)}\n\n<${canonical(characterPath(id))}>\n`, 'text/markdown');
  }
  const guide = guides.find((entry) => entry.id === id);
  if (guide) return response(`# ${md(copy(locale, guide.name))}\n\n${copy(locale, guide.summary)}\n\n<${canonical(guidePath(guide))}>\n`, 'text/markdown');
  const result = await api.topic(id, locale);
  const topic = result.ok ? result.value : result.status === 404 ? await archivedTopic(locale, id) : undefined;
  if (!topic) return response(tr(locale, !result.ok && result.status !== 404 ? 'unavailable' : 'notFound'), 'text/plain', !result.ok && result.status !== 404 ? 503 : 404);
  return response(`# ${md(field(locale, topic, 'name'))}\n\n${field(locale, topic, 'summary')}\n\n<${canonical(topicPath(id))}>\n`, 'text/markdown');
}
