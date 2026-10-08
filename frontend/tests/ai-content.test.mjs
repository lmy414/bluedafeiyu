import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiDocuments, documentMarkdown, hasAiMarkdown } from '../scripts/ai-content.mjs';

const fixture = () => ({
  characters: [{ id: 'deepseek', name: 'DeepSeek娘', aliases: ['鲸鱼娘'], status: 'active' }],
  categories: [{ id: 'comic', name: '漫画', status: 'active' }],
  works: [
    { id: 'one', slug: 'one', name: '公开作品', status: 'published', characterId: 'deepseek', categoryIds: ['comic'], tags: ['测试'],
      submitter: { credit: 'named', name: '投稿者' }, origin: {}, license: { type: 'unknown' }, description: '已有描述' },
    { id: 'two', slug: 'two', name: '另一作品', status: 'published', characterId: 'deepseek', categoryIds: ['comic'],
      origin: { author: '原作者', sourceUrl: 'https://example.com/original' }, license: { type: 'author-permission', note: '只允许非商业使用' } },
    { id: 'hidden', slug: 'hidden', name: '已下架作品', status: 'removed', characterId: 'deepseek', categoryIds: ['comic'] },
  ],
  topics: [{ id: 'chosen', name: '人工精选', status: 'active', workIds: ['two', 'hidden', 'one'] },
    { id: 'draft', name: '草稿专题', status: 'draft', workIds: ['one'] }, { id: 'empty', name: '空专题', status: 'active', workIds: ['hidden'] }],
});
test('阅读入口排除下架与草稿，保留专题的完整编排顺序', () => {
  const { documents, llms, counts } = createAiDocuments(fixture());
  const topic = documents.get('/topics/chosen.html.md');
  assert.ok(topic.indexOf('/works/two.html.md') < topic.indexOf('/works/one.html.md'));
  assert.deepEqual(counts, { works: 2, characters: 1, categories: 1, topics: 1 });
  assert.equal(documents.has('/works/hidden.html.md'), false);
  assert.equal(documents.has('/topics/draft.html.md'), false);
  assert.equal(documents.has('/topics/empty.html.md'), false);
  assert.ok(!llms.includes('草稿专题'));
  assert.ok(documents.get('/characters/deepseek.html.md').includes('鲸鱼娘'));
});
test('不把投稿者署名当成作者，不扩大作品授权', () => {
  const { documents } = createAiDocuments(fixture());
  const unknown = documents.get('/works/one.html.md');
  assert.ok(unknown.includes('来源作者：未标注'));
  assert.ok(unknown.includes('收录署名：投稿者'));
  assert.ok(unknown.includes('license-unknown'));
  assert.ok(documents.get('/works/two.html.md').includes('只允许非商业使用'));
  const bad = fixture(); bad.works[0].slug = '../escape';
  assert.throws(() => createAiDocuments(bad), /路径非法/);
});
test('说明正文取自公开页面，去除表单和导航，保留真实政策与链接', () => {
  const md = documentMarkdown('<html><body><nav>导航</nav><main><div class="document-page"><h1>许可</h1><p>图片授权未明，<a href="/about.html#licensing">申请许可</a>。</p><ul><li>仅记录许可。</li></ul><form>内部表单</form><p hidden>内部提示</p></div></main></body></html>', '/about.html');
  assert.ok(md.includes('# 许可'));
  assert.ok(md.includes('https://xn--pssy23gqgbz2d718b.com/about.html#licensing'));
  for (const word of ['导航', '内部表单', '内部提示']) assert.ok(!md.includes(word));
  assert.ok(hasAiMarkdown('/works/one.html'));
  assert.ok(!hasAiMarkdown('/characters/deepseek/page/2.html'));
});
