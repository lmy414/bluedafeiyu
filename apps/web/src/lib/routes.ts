import { categoryIds } from './api';
import { guides } from '../content/landing-copy';
import { characterPath, creatorPath, readerPath, topicPath, workPath } from './site';

const staticPages = {
  '/': 'gallery', '/search': 'gallery', '/gifs': 'gallery', '/categories': 'gallery',
  '/characters': 'characters', '/topics': 'topics', '/serials': 'serials', '/videos': 'videos', '/creators': 'creators',
  '/submit': 'submit', '/community': 'community', '/about': 'about', '/friend-links': 'links',
  '/community-projects': 'projects', '/changelog': 'changelog', '/events': 'events', '/events/current': 'events', '/events/archive': 'events',
} as const;

const aliases: Record<string, string> = {
  '/index': '/', '/gallery': '/', '/browse': '/', '/category': '/categories', '/collections': '/topics',
  '/projects': '/community-projects', '/links': '/friend-links', '/gif': '/gifs',
  '/support': '/community', '/open-api': '/about#open-api',
  '/submit-video': '/submit?mode=creator', '/saved': '/', '/videos/oldest': '/videos?sort=oldest',
};

function decode(segment: string) {
  try {
    const value = decodeURIComponent(segment);
    return value && value !== '.' && value !== '..' && !/[\/\\\u0000-\u001f]/.test(value) && value.length <= 200 ? value : '';
  } catch { return ''; }
}

export function resolvePage(path: string) {
  if (Object.hasOwn(staticPages, path)) return { view: staticPages[path as keyof typeof staticPages] };
  const stripped = path.replace(/\.html$/, '');
  if (Object.hasOwn(aliases, stripped)) return { view: 'redirect', href: aliases[stripped]! } as const;
  if (stripped !== path && Object.hasOwn(staticPages, stripped)) return { view: 'redirect', href: stripped } as const;
  const tokens = stripped.split('/').slice(1);
  const [section, encodedId, sub, page] = tokens;
  const id = encodedId ? decode(encodedId) : '';
  if (section === 'topics' && id === 'eden-sin-bloom' && (tokens.length === 2 || tokens.length === 4 && sub === 'page' && /^[1-9]\d{0,5}$/.test(page ?? ''))) {
    return { view: 'redirect', href: tokens.length === 2 ? topicPath('eden-sins-bloom') : readerPath('eden-sins-bloom', Number(page)) } as const;
  }
  if (tokens.length === 2 && id) {
    switch (section) {
      case 'works': return path === stripped ? { view: 'redirect', href: workPath(id) } as const : { view: 'work', id } as const;
      case 'characters': return stripped === path ? { view: 'character', id } as const : { view: 'redirect', href: characterPath(id) } as const;
      case 'topics': {
        if (stripped !== path) return { view: 'redirect', href: topicPath(id) } as const;
        const guide = guides.find((entry) => entry.id === id);
        return guide ? { view: 'guide', guide } as const : { view: 'topic', id } as const;
      }
      case 'creators': return stripped === path ? { view: 'creator', id } as const : { view: 'redirect', href: creatorPath(id) } as const;
      case 'categories': if (categoryIds.some((category) => category === id)) return stripped === path ? { view: 'gallery', id } as const : { view: 'redirect', href: stripped } as const; break;
      case 'events': return stripped === path ? { view: 'event', id } as const : { view: 'redirect', href: stripped } as const;
      case 'page': if (/^[1-9]\d*$/.test(id)) return { view: 'redirect', href: `/?page=${id}` } as const; break;
    }
  }
  if (id && section === 'topics' && sub === 'page' && page && /^[1-9]\d{0,5}$/.test(page) && tokens.length === 4) {
    return stripped === path ? { view: 'reader', id, page: Number(page) } as const : { view: 'redirect', href: readerPath(id, Number(page)) } as const;
  }
  if ((tokens.length === 3 || tokens.length === 4) && tokens.at(-2) === 'page' && /^[1-9]\d{0,5}$/.test(tokens.at(-1) ?? '')) {
    const base = stripped.replace(/\/page\/\d+$/, '');
    if (base === '/videos/oldest') return { view: 'redirect', href: `/videos?sort=oldest&page=${tokens.at(-1)}` } as const;
    if (/^\/(gifs|videos|characters\/[^/]+|categories\/[^/]+)$/.test(base)) return { view: 'redirect', href: `${base}?page=${tokens.at(-1)}` } as const;
  }
  if (section === 'characters' && id && tokens.length === 3 && categoryIds.some((category) => category === sub)) {
    return { view: 'redirect', href: `${characterPath(id)}?category=${sub}` } as const;
  }
  return { view: 'not-found' } as const;
}

export type DirectoryView = 'characters' | 'topics' | 'serials' | 'videos';
