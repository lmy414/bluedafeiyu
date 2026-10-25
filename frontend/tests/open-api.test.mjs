import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {API_ROOT, API_ORIGIN, createOpenApi, writeOpenApi} from '../scripts/open-api.mjs';
import {outputHashes} from '../scripts/incremental.mjs';

const image = id => ({id, slug: id.replaceAll('_', '-'), name: id, status: 'published',
  characterId: 'deepseek', characterIds: ['deepseek'], categoryIds: ['meme'], tags: ['晚安/..', '鲸鱼娘'],
  path: `https://raw.githubusercontent.com/example/images/main/${id}.gif`, thumbnailPath: 'submissions/previews/example.webp',
  format: 'gif', mimeType: 'image/gif', isAnimated: true, width: 128, height: 256, fileSize: 1234,
  sha256: 'a'.repeat(64), createdAt: '2026-10-25T12:00:00Z', updatedAt: '2026-10-25T12:00:00Z',
  submitter: {credit: 'anonymous', name: 'private-name', github: 'private-account', url: 'https://example.com/private'},
  origin: {author: '真实作者', sourceUrl: 'https://example.com/art', groupId: 'private-group'},
  license: {type: 'cc-by-nc', note: '署名且非商用'}, internalReview: 'private-review',
  i18n: {sourceHash: 'private-translation-hash', en: {name: 'Good night', tags: ['Good night', 'Whale girl'], internal: 'private-translation'}, ja: {name: 'おやすみ'}}});
const fixture = () => ({
  characters: [{id: 'deepseek', name: 'DeepSeek娘', aliases: ['鲸鱼娘'], status: 'active'}, {id: 'claude', name: 'Claude娘', status: 'active'}, {id: 'draft', status: 'draft'}],
  categories: [{id: 'meme', name: '梗图', status: 'active'}, {id: 'comic', name: '漫画', status: 'active'}],
  works: [image('work_one'), {...image('work_two'), characterIds: ['claude', 'deepseek'], characterId: 'claude', categoryIds: ['comic'],
    createdAt: '2026-10-26T12:00:00Z', tags: ['晚安/..']}, {...image('hidden_work'), status: 'removed'}],
  topics: [{id: 'chosen', name: '人工精选', status: 'active', coverWorkId: 'hidden_work', workIds: ['work_two', 'hidden_work', 'work_one', 'work_two'],
    author: {name: '原作者', channels: [{platform: 'Bilibili', url: 'https://space.bilibili.com/123'}]}},
    {id: 'second', name: '第二作品集', status: 'active', workIds: ['work_one'], author: {name: '原作者', channels: [{platform: 'Bilibili', url: 'https://space.bilibili.com/123'}]}},
    {id: 'draft', status: 'draft', workIds: ['work_one']}, {id: 'empty', status: 'active', workIds: ['hidden_work']}]
});
const json = (result, file) => JSON.parse(result.documents.get(`${API_ROOT}/${file}`));

test('静态目录支持多角色、类型交集、中文标签、作者作品集和人工专题顺序', () => {
  const result = createOpenApi(fixture(), {pageSize: 1});
  assert.equal(json(result, 'works.json').total, 2);
  assert.deepEqual(json(result, 'characters/deepseek/categories/comic.json').items.map(w => w.id), ['work_two']);
  assert.deepEqual(json(result, 'characters/claude/categories/meme.json').items, []);
  const chosen = json(result, 'topics/chosen.json');
  assert.deepEqual(chosen.items.map(w => w.id), ['work_two', 'work_one']);
  assert.equal(chosen.topic.coverWorkId, 'work_two');
  const tags = json(result, 'tags.json').items;
  assert.equal(tags.find(t => t.name === '晚安/..').count, 2);
  for (const tag of tags) {
    assert.match(tag.id, /^tag-[a-f0-9]{64}$/);
    assert.ok(result.documents.has(new URL(tag.worksUrl).pathname));
  }
  assert.equal(json(result, 'creators.json').items.length, 1);
  assert.equal(json(result, 'creators/bilibili-123.json').total, 2);
  assert.deepEqual(json(result, 'works/work_one.json').work.creatorIds, ['bilibili-123']);
  assert.equal(json(result, 'works/page/1.json').next, `${API_ORIGIN}${API_ROOT}/works/page/2.json`);
  assert.equal(json(result, 'works/page/2.json').next, null);
  const full = [...result.documents.values()].join('');
  for (const hidden of ['hidden_work', 'private-name', 'private-account', 'private-group', 'private-review', 'private-translation']) assert.ok(!full.includes(hidden), hidden);
  assert.equal(result.documents.has(`${API_ROOT}/topics/draft.json`), false);
  assert.equal(result.documents.has(`${API_ROOT}/topics/empty.json`), false);
});

test('外部原图、动画信息和逐作品授权保持准确，不把匿名投稿者当作者', () => {
  const data = fixture();
  data.works[0].origin.sourceUrl = 'javascript:alert(1)';
  const work = json(createOpenApi(data), 'works/work_one.json').work;
  assert.equal(work.image.originalUrl, data.works[0].path);
  assert.equal(work.image.thumbnailUrl, `${API_ORIGIN}/submissions/previews/example.webp`);
  assert.equal(work.image.animated, true);
  assert.equal(work.image.bytes, 1234);
  assert.equal(work.image.sha256, 'a'.repeat(64));
  assert.equal(work.author.name, '真实作者');
  assert.equal(work.attribution.name, null);
  assert.equal(work.attribution.url, null);
  assert.equal(work.license.type, 'cc-by-nc');
  assert.equal(work.license.note, '署名且非商用');
  assert.equal(work.source.url, null);
  assert.equal(work.i18n.en.name, 'Good night');
});

test('数据摘要确定且独立于其他作品变化；完整清单能检测编辑、新增和下架', () => {
  const data = fixture(), before = createOpenApi(data);
  assert.deepEqual([...createOpenApi(data).documents], [...before.documents]);
  data.works[0].description = '修改正文但没有修改 updatedAt';
  const edited = createOpenApi(data);
  const previous = new Map(json(before, 'manifest.json').items.map(w => [w.id, w.revision]));
  const current = new Map(json(edited, 'manifest.json').items.map(w => [w.id, w.revision]));
  assert.notEqual(current.get('work_one'), previous.get('work_one'));
  assert.equal(current.get('work_two'), previous.get('work_two'));
  assert.notEqual(edited.revision, before.revision);
  data.works[0].status = 'hidden';
  data.works.push(image('work_new'));
  const after = createOpenApi(data), inventory = json(after, 'manifest.json').items.map(w => w.id);
  assert.ok(!inventory.includes('work_one'));
  assert.ok(inventory.includes('work_new'));
  assert.equal(after.documents.has(`${API_ROOT}/works/work_one.json`), false);
});

test('每个索引指向真实 JSON，下载清单与详情保持一致，空目录也有第一页', () => {
  const result = createOpenApi(fixture());
  for (const document of result.documents.values()) {
    const data = JSON.parse(document);
    assert.equal(data.apiVersion, 1);
    for (const item of data.items || []) {
      if (!item.detailUrl) continue;
      const detail = JSON.parse(result.documents.get(new URL(item.detailUrl).pathname)).work;
      assert.equal(detail.id, item.id);
      assert.equal(detail.revision, item.revision);
      if (item.originalUrl) assert.equal(detail.image.originalUrl, item.originalUrl);
    }
  }
  const empty = fixture(); empty.works = [];
  assert.deepEqual(json(createOpenApi(empty), 'works/page/1.json').items, []);
});

test('增量写入复用相同文件，新的发布目录不保留下架作品和失效标签', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-api-test-'));
  try {
    const first = path.join(dir, 'first'), second = path.join(dir, 'second'), data = fixture();
    writeOpenApi(first, data);
    data.works[0].status = 'removed';
    const report = writeOpenApi(second, data, {previousDir: first, previousState: {outputs: outputHashes(first)}});
    assert.ok(report.reused > 0);
    assert.ok(report.written > 0);
    assert.equal(fs.existsSync(path.join(second, API_ROOT.slice(1), 'works/work_one.json')), false);
    assert.equal(fs.readFileSync(path.join(first, API_ROOT.slice(1), 'works/work_one.json'), 'utf8').includes('work_one'), true);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('无效路径、重复 ID、错误分类和危险原图地址使构建失败', () => {
  for (const mutate of [
    data => { data.works[0].id = '../escape'; },
    data => { data.works[0].slug = '../escape'; },
    data => { data.works[1].id = data.works[0].id; },
    data => { data.works[0].categoryIds = ['missing']; },
    data => { data.works[0].characterIds = ['missing']; },
    data => { data.works[0].path = 'javascript:alert(1)'; }
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => createOpenApi(data), /开放 API/);
  }
});
