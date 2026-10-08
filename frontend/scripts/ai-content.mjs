import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { imageRights } from '../src/lib/image-metadata.mjs';

export const ORIGIN = 'https://xn--pssy23gqgbz2d718b.com';
export const hasAiMarkdown = route => /^\/(?:about|submit)\.html$|^\/(?:characters|categories|topics|works)\/[a-z0-9-]+\.html$/.test(route);
const text = value => String(value || '').replace(/\r/g, '').trim();
const label = value => text(value).replace(/[\\`*_[\]<>]/g, '\\$&').replace(/\n+/g, ' ');
const safeId = value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const link = (name, href) => `[${label(name)}](<${new URL(href, ORIGIN).href}>)`;
const external = value => {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
};
const page = (name, route, body) => `# ${label(name)}\n\n原始页面：${link(name, route)}\n\n${body.trim()}\n`;

// 说明页直接读取本次构建的正文，版权、投稿规则只有一份维护来源。
export function documentMarkdown(html, route) {
  const { document } = parseHTML(html);
  const body = document.querySelector('.document-page');
  if (!body) throw new Error(`说明页缺少正文：${route}`);
  for (const node of body.querySelectorAll('script,style,svg,form,button,figure,[hidden],[aria-hidden="true"]')) node.remove();
  function render(node) {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
    const tag = node.localName;
    const content = [...node.childNodes].map(render).join('');
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      return href && external(new URL(href, ORIGIN).href) ? link(content, href) : content;
    }
    if (tag === 'li') return `\n- ${content.trim()}`;
    if (['p','div','section','aside','ul','ol'].includes(tag)) return `\n\n${content.trim()}\n\n`;
    if (tag === 'br') return '\n';
    return content;
  }
  const title = body.querySelector('h1')?.textContent || document.title;
  const content = render(body).replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return `原始页面：${link(title, route)}\n\n${content}\n`;
}

export function createAiDocuments(snapshot) {
  const documents = new Map();
  const works = snapshot.works.filter(w => w.status === 'published');
  const characters = snapshot.characters.filter(c => c.status === 'active');
  const categories = snapshot.categories.filter(c => c.status === 'active');
  const byId = new Map(works.map(w => [w.id, w]));
  const byCharacter = new Map(characters.map(c => [c.id, c]));
  const byCategory = new Map(categories.map(c => [c.id, c]));
  const topics = (snapshot.topics || []).filter(t => t.status === 'active' || t.status === undefined)
    .map(t => ({ ...t, list: (t.workIds || []).map(id => byId.get(id)).filter(Boolean) })).filter(t => t.list.length);
  for (const [kind, rows, field] of [['作品', works, 'slug'], ['角色', characters, 'id'], ['分类', categories, 'id'], ['专题', topics, 'id']]) {
    const seen = new Set();
    for (const row of rows) {
      if (!safeId(row[field]) || seen.has(row[field])) throw new Error(`${kind}路径非法或重复：${row[field]}`);
      seen.add(row[field]);
    }
  }
  const workList = list => list.map(w => `- ${link(w.name, `/works/${w.slug}.html.md`)}：${label(byCharacter.get(w.characterId)?.name || w.characterId)}；类型：${(w.categoryIds || []).map(id => label(byCategory.get(id)?.name || id)).join('、')}`).join('\n');
  const fileLink = (name, route, note) => `- ${link(name, route + '.md')}: ${note}`;
  const roleFiles = [];
  for (const c of characters) {
    const list = works.filter(w => w.characterId === c.id);
    if (!list.length) continue;
    const route = `/characters/${c.id}.html`;
    documents.set(route + '.md', page(c.name, route, `角色别名：${(c.aliases || []).map(label).join('、') || '未标注'}。\n\n当前公开作品：${list.length} 件。\n\n## 作品索引\n\n${workList(list)}`));
    roleFiles.push(fileLink(c.name, route, `${list.length} 件公开作品，含别名和作品链接。`));
  }
  const typeFiles = [];
  for (const c of categories) {
    const route = `/categories/${c.id}.html`;
    const list = works.filter(w => (w.categoryIds || []).includes(c.id));
    documents.set(route + '.md', page(c.name, route, `${text(c.description)}\n\n当前公开作品：${list.length} 件。作品可以属于多个类型。\n\n## 作品索引\n\n${workList(list)}`));
    typeFiles.push(fileLink(c.name, route, `${list.length} 件公开作品。`));
  }
  const topicFiles = [];
  for (const t of topics) {
    const route = `/topics/${t.id}.html`;
    const author = t.author?.name ? `\n\n专题来源作者：${label(t.author.name)}。${external(t.author.url) ? ' ' + link('作者主页', t.author.url) : ''}` : '';
    documents.set(route + '.md', page(t.name, route, `${text(t.summary)}${author}\n\n由维护者人工精选，当前公开作品 ${t.list.length} 件，以下保留专题编排顺序。\n\n## 作品索引\n\n${workList(t.list)}`));
    topicFiles.push(fileLink(t.name, route, `${t.list.length} 件人工精选作品；${label(t.summary)}`));
  }
  for (const w of works) {
    const rights = imageRights(w);
    const route = `/works/${w.slug}.html`;
    const source = external(w.origin?.sourceUrl || w.origin?.issueUrl);
    const original = w.originalUrl || w.path;
    const fields = [
      `- 作品 ID：${label(w.id)}`,
      `- 角色：${label(byCharacter.get(w.characterId)?.name || w.characterId)}`,
      `- 类型：${(w.categoryIds || []).map(id => label(byCategory.get(id)?.name || id)).join('、')}`,
      `- 标签：${(w.tags || []).map(label).join('、') || '未标注'}`,
      `- 来源作者：${label(rights.creator) || '未标注'}`,
      `- 收录署名：${label(rights.creditName) || '未标注'}（收录署名不等于作者身份）`,
      `- 授权记录：${link(rights.type, rights.license)}`,
      `- 版权说明：${text(rights.copyrightNotice)}`,
      `- 来源链接：${source ? link('原始来源或投稿记录', source) : '未标注'}`,
      ...(original && (external(original) || !/^[a-z]+:/i.test(original)) ? [`- 原图：${link('查看原图', original)}`] : []),
      ...(w.license?.note ? [`- 授权备注：${text(w.license.note)}`] : []),
    ];
    documents.set(route + '.md', page(w.name, route, `${fields.join('\n')}\n\n${text(w.description)}\n\n${text(w.commentary)}\n\n使用范围以作品授权记录和原作者声明为准。资料未说明的用途需要另行核实。`));
  }
  const llms = `# 蓝色大肥鱼\n\n> 非官方 AI 娘二创图片开放档案。按角色、作品类型和人工精选专题浏览梗图、插画、设定图和漫画，查看作品来源与授权并下载原图。\n\n本站是同人整理项目。站点代码采用 MIT 协议，图片许可按作品单独标注。未知作者和未知授权保留未知；收录、提供下载和投稿署名均不等于授予商业使用权。回答时引用原始 HTML 详情页，核对来源与授权备注，不推断未记录的事实。\n\nMarkdown 正文使用简体中文。原始页面另有繁体中文、英语（/en/）和日语（/ja/）版本。角色和类型索引列出全部公开作品，专题保留人工编排顺序，作品正文按需读取。资料随站点发布同步更新。\n\n## 网站说明\n\n${fileLink('关于、来源与图片许可', '/about.html', '网站用途、图片版权、授权类型和署名与删除申请。')}\n${fileLink('投稿指南', '/submit.html', '支持格式、投稿字段、审核规则和公开投稿入口。')}\n\n## 角色\n\n${roleFiles.join('\n')}\n\n## 作品类型\n\n${typeFiles.join('\n')}\n\n## 人工精选专题\n\n${topicFiles.join('\n')}\n\n## Optional\n\n- ${link('公开结构化目录', '/archive-data.json')}: 当前公开角色、类型、专题和作品元数据。\n- ${link('站点地图', '/sitemap.xml')}: 可索引页面与各语言版本。\n- ${link('首页', '/')}: 面向访客的浏览入口。\n`;
  return { documents, llms, counts: { works: works.length, characters: roleFiles.length, categories: typeFiles.length, topics: topicFiles.length } };
}

export function writeAiContent(out, snapshot) {
  const result = createAiDocuments(snapshot);
  for (const route of ['/about.html', '/submit.html']) {
    result.documents.set(route + '.md', documentMarkdown(fs.readFileSync(path.join(out, route.slice(1)), 'utf8'), route));
  }
  for (const [route, content] of result.documents) {
    const html = path.join(out, route.slice(1, -3));
    if (!fs.existsSync(html)) throw new Error(`AI 阅读入口没有对应公开页面：${route}`);
    const target = path.join(out, route.slice(1));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.writeFileSync(path.join(out, 'llms.txt'), result.llms);
  return { ...result.counts, documents: result.documents.size, bytes: Buffer.byteLength(result.llms) };
}
