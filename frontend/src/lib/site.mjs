import fs from 'node:fs';
import path from 'node:path';
const root = process.env.SITE_SOURCE || path.resolve(process.cwd(), '..');
const snapshot = process.env.SITE_SNAPSHOT || path.join(root, 'dist/site-data.json');
export const site = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
export const works = site.works.filter(w => w.status === 'published');
export const characterById = new Map(site.characters.map(c => [c.id,c]));
export const categories = site.categories.filter(c => c.status === 'active');
export const topics = site.topics || [];
export const byWorkId = new Map(works.map(w => [w.id,w]));
export const origin = 'https://xn--pssy23gqgbz2d718b.com';
export const url = path => `${origin}${path}`;
export const safeId = id => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
for (const [kind, list, key] of [['作品', works, 'slug'], ['分类', categories, 'id'], ['专题', topics, 'id']]) {
 const seen = new Set();
 for (const row of list) { if (!safeId(row[key]) || seen.has(row[key])) throw new Error(`${kind} ${key} 非法或重复：${row[key]}`); seen.add(row[key]); }
}
