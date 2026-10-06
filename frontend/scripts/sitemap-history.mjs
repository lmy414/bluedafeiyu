import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser, parseHTML } from 'linkedom';

const text = value => String(value || '').replace(/\s+/gu, ' ').trim();
const attributes = ['href', 'src', 'srcset', 'alt', 'title', 'datetime', 'width', 'height', 'type'];
const ignored = 'script,style,[data-work-stats],[data-stats-note],[data-work-download-count],[data-work-views],.comments-section';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !['dateModified', 'interactionStatistic'].includes(key)).map(key => [key, stable(value[key])]));
}

// Compare content that a crawler reads, excluding live counters and presentation-only attributes.
export function pageFingerprint(html) {
  const document = parseHTML(html).document;
  const main = document.querySelector('main');
  if (!main) throw new Error('Indexable page has no main content');
  for (const node of main.querySelectorAll(ignored)) node.remove();
  const visit = node => {
    if (node.nodeType === 3) return text(node.textContent);
    if (node.nodeType !== 1) return null;
    return [node.localName, attributes.filter(a => node.hasAttribute(a)).map(a => [a, node.getAttribute(a)]), [...node.childNodes].map(visit).filter(v => v !== null && v !== '')];
  };
  const metadata = [...document.querySelectorAll('meta[name="description"],meta[property^="og:"],meta[name^="twitter:"],link[rel="canonical"],link[hreflang]')].map(node => [node.getAttribute('name') || node.getAttribute('property') || node.getAttribute('hreflang') || node.getAttribute('rel'), node.getAttribute('content') || node.getAttribute('href')]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map(node => stable(JSON.parse(node.textContent)));
  return crypto.createHash('sha256').update(JSON.stringify([text(document.title), metadata, schemas, visit(main)])).digest('hex');
}

function pageFile(directory, pathname) {
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')) throw new Error('Invalid sitemap page path');
  const file = path.resolve(directory, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  const relative = path.relative(path.resolve(directory), file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !file.endsWith('.html')) throw new Error('Sitemap page outside release directory');
  return file;
}

function timestamp(value, now) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > now.getTime()) throw new Error('Invalid or future sitemap lastmod: ' + value);
  return new Date(parsed).toISOString();
}

// The previous published sitemap and HTML are the history; no separate mutable database is needed.
export function readSitemapHistory(directory, { origin, now = new Date() }) {
  const records = new Map();
  let seeded = 0;
  const sitemap = path.join(directory, 'sitemap.xml');
  if (!fs.existsSync(sitemap)) return { records, seeded };
  directory = fs.realpathSync(directory);
  const xml = new DOMParser().parseFromString(fs.readFileSync(sitemap, 'utf8'), 'text/xml');
  const entries = [...xml.querySelectorAll('url')];
  if (!entries.length) throw new Error('Previous sitemap has no URL records');
  for (const entry of entries) {
    const url = new URL(entry.querySelector('loc')?.textContent || '');
    if (url.origin !== origin) continue;
    const file = pageFile(directory, url.pathname);
    if (!fs.existsSync(file)) throw new Error('Previous sitemap page missing: ' + url.pathname);
    const prior = entry.querySelector('lastmod')?.textContent;
    // First rollout has no historical lastmod. Preserve the current release's real file time as a baseline.
    const lastmod = timestamp(prior || fs.statSync(file).mtime.toISOString(), now);
    if (!prior) seeded++;
    records.set(url.pathname, { fingerprint: pageFingerprint(fs.readFileSync(file, 'utf8')), lastmod });
  }
  return { records, seeded };
}

export function updateSitemapHistory(paths, directory, previous, { now = new Date() } = {}) {
  const lastmods = new Map();
  let changed = 0, unchanged = 0, added = 0;
  for (const pathname of paths) {
    const fingerprint = pageFingerprint(fs.readFileSync(pageFile(directory, pathname), 'utf8'));
    const prior = previous.records.get(pathname);
    if (prior?.fingerprint === fingerprint) {
      lastmods.set(pathname, timestamp(prior.lastmod, now));
      unchanged++;
    } else {
      lastmods.set(pathname, now.toISOString());
      if (prior) changed++; else added++;
    }
  }
  return { lastmods, changed, unchanged, added, seeded: previous.seeded };
}
