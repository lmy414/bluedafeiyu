import fs from 'node:fs';
import path from 'node:path';
const root = process.env.SITE_SOURCE || (fs.existsSync(path.join(process.cwd(),'data/friend-links.json')) ? process.cwd() : path.resolve(process.cwd(),'..'));

export function validateFriendLinks(rows) {
  if (!Array.isArray(rows)) throw Error('友情链接清单必须是数组');
  const ids = new Set();
  const urls = new Set();
  for (const row of rows) {
    let url;
    try {url = new URL(row.url);} catch {throw Error('友情链接 URL 无效：' + row.id);}
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error('友情链接只支持无凭据的 HTTP/HTTPS URL：' + row.id);
    const destination = new URL(url);
    destination.hash = '';
    const urlKey = destination.href.replace(/\/$/, '');
    if (urls.has(urlKey)) throw Error('友情链接 URL 重复：' + row.id);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) || ids.has(row.id)) throw Error('友情链接 ID 无效或重复：' + row.id);
    if (!['project','website'].includes(row.category) || !row.name?.trim() || !row.description?.trim()) throw Error('友情链接缺少分类、名称或介绍：' + row.id);
    for (const locale of ['en','ja']) if (!row.i18n?.[locale]?.name?.trim() || !row.i18n?.[locale]?.description?.trim()) throw Error('友情链接缺少译文：' + row.id + '/' + locale);
    ids.add(row.id);
    urls.add(urlKey);
  }
  return rows;
}

export const friendLinks = validateFriendLinks(JSON.parse(fs.readFileSync(path.join(root,'data/friend-links.json'),'utf8')));
