import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  buildR2Keys,
  buildR2PublicUrl,
  computeWorkRevision,
  isSafeHttpUrl,
  normalizeSlug,
  singleCategorySchema,
  submissionFieldsSchema,
  topicUpsertSchema,
  validateTrilingualCompleteness,
  workEditSchema,
} from '../index.js'

test('作者 URL 仅允许带有效主机的 HTTP(S) 绝对地址', () => {
  for (const url of [
    'http://example.org', 'https://例え.jp/path?q=ok#about', 'HTTPS://example.org:8443', 'https://[::1]/',
  ]) {
    assert.equal(isSafeHttpUrl(url), true, url)
  }
  for (const url of [
    '', '//example.org', 'javascript:alert(1)', 'data:text/plain,hello', 'https:example.org',
    'https://', 'https:///example.org', 'https://?example.org', 'https://#example.org',
    'https://\\example.org', 'https://example.org\\profile', 'https://exa\nmple.org',
    'https://user:secret@example.org/', 'https://:80',
  ]) {
    assert.equal(isSafeHttpUrl(url), false, url)
  }
})

test('三语校验拒绝缺失译文、空字段、占位文案及明显中文残留', () => {
  const content = {
    name: '深海随记',
    description: '蓝色大肥鱼在水中漂浮。',
    i18n: {
      en: { name: 'Deep Sea Notes', description: 'A blue fish floats under the water.' },
      ja: { name: '深海日記', description: '青い魚が水の中を漂う。' },
    },
  }
  assert.equal(validateTrilingualCompleteness(content).success, true)
  assert.equal(validateTrilingualCompleteness({ ...content, i18n: { en: content.i18n.en } }).success, false)
  assert.equal(validateTrilingualCompleteness({ ...content, commentary: '很安静。' }).success, false)

  for (const description of ['   ', 'TBD.', 'A blue fish 占位文案']) {
    const result = validateTrilingualCompleteness({
      ...content, i18n: { ...content.i18n, en: { ...content.i18n.en, description } },
    })
    assert.equal(result.success, false, description)
    if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ['i18n', 'en', 'description'])
  }
  for (const description of ['未翻訳', 'これは蓝色の魚です。', content.description]) {
    const result = validateTrilingualCompleteness({
      ...content, i18n: { ...content.i18n, ja: { ...content.i18n.ja, description } },
    })
    assert.equal(result.success, false, description)
  }
  const kanji = { name: '東京', description: '資料保存。' }
  assert.equal(validateTrilingualCompleteness({ ...content, i18n: { ...content.i18n, ja: kanji } }).success, true)
})

test('R2 对象键按摘要分片，并在暂存键中保留投稿 ID', () => {
  const sha256 = 'AB'.repeat(32)
  const hash = sha256.toLowerCase()
  assert.deepEqual(buildR2Keys(sha256, '.GIF'), {
    originalKey: `originals/ab/${hash}.gif`,
    thumbKey: `thumbs/ab/${hash}.webp`,
    displayKey: `display/ab/${hash}.webp`,
    stagingKey: `submissions/sub_${hash.slice(0, 24)}/${hash}.gif`,
  })
  assert.equal(buildR2Keys(hash, 'apng', 'sub_legacy').stagingKey, `submissions/sub_legacy/${hash}.apng`)
  assert.throws(() => buildR2Keys('invalid', 'png'), TypeError)
  assert.throws(() => buildR2Keys(hash, '../png'), TypeError)
  assert.throws(() => buildR2Keys(hash, 'png', '../escape'), TypeError)
})

test('R2 公开地址保留基础路径并分段编码对象键', () => {
  assert.equal(buildR2PublicUrl('https://img.example.org/media/', '作品/a #1?.png'),
    'https://img.example.org/media/%E4%BD%9C%E5%93%81/a%20%231%3F.png')
  assert.throws(() => buildR2PublicUrl('https://img.example.org', 'thumbs/../a.png'), TypeError)
  assert.throws(() => buildR2PublicUrl('https://img.example.org/?raw', 'a.png'), TypeError)
  assert.equal(normalizeSlug('  Café ＦＩＳＨ 2.0 '), 'cafe-fish-2-0')
})

test('修订摘要递归稳定排序 JSON 对象键，并保留数组顺序', async () => {
  const left = { z: '鱼', a: [{ z: 1, a: true }, 'gif'] }
  const right = { a: [{ a: true, z: 1 }, 'gif'], z: '鱼' }
  const expected = createHash('sha256').update('{"a":[{"a":true,"z":1},"gif"],"z":"鱼"}').digest('hex')
  assert.equal(await computeWorkRevision(left), expected)
  assert.equal(await computeWorkRevision(right), expected)
  assert.notEqual(await computeWorkRevision({ ...left, z: '大肥鱼' }), expected)
  assert.notEqual(await computeWorkRevision({ ...left, a: left.a.toReversed() }), expected)
})

test('专题 upsert 保留旧接口白名单并严格校验嵌套作者资料', () => {
  const input = {
    topicId: 'deep-sea', name: '深海', summaryEn: 'An archive', nameJa: '深海', status: 'active', order: 2,
    author: { name: '作者', channels: [{ platform: 'website', url: 'https://example.org/about' }] },
  }
  assert.deepEqual(topicUpsertSchema.parse(input), input)
  assert.deepEqual(topicUpsertSchema.parse({ topicId: 'deep-sea' }), { topicId: 'deep-sea' })
  assert.equal(topicUpsertSchema.parse({ topicId: 'deep-sea', author: null }).author, null)
  assert.equal(topicUpsertSchema.parse({ topicId: 'deep-sea', author: {} }).author, null)

  for (const key of ['id', 'works', 'workIds', 'cover', 'coverWorkId', 'needsPublish', 'i18n']) {
    assert.equal(topicUpsertSchema.safeParse({ ...input, [key]: null }).success, false, key)
  }
  for (const author of [
    { ...input.author, url: 'https://\\example.org' },
    { ...input.author, avatar: 'https://example.org/avatar.png' },
    { name: '作者', channels: [] },
    { name: '作者', channels: [{ ...input.author.channels[0], id: 'forbidden' }] },
    { name: '作者', channels: [{ platform: 'website', url: 'https://#no-host' }] },
  ]) {
    assert.equal(topicUpsertSchema.safeParse({ ...input, author }).success, false)
  }
})

test('投稿和作品编辑只接受单一有效类型，编辑保护冻结字段', () => {
  assert.equal(singleCategorySchema.safeParse(['meme']).success, true)
  assert.equal(singleCategorySchema.safeParse(['meme', 'comic']).success, false)
  assert.equal(singleCategorySchema.safeParse(['meme', 'meme']).success, false)
  const submission = { character: 'deepseek', name: '深海', categoryId: 'illustration' }
  assert.deepEqual(submissionFieldsSchema.parse(submission).characterIds, ['deepseek'])
  assert.equal(submissionFieldsSchema.safeParse({ ...submission, categoryId: ['meme', 'comic'] }).success, false)
  assert.equal(workEditSchema.safeParse({ categoryId: 'meme' }).success, true)
  assert.equal(workEditSchema.safeParse({ categoryId: 'invalid' }).success, false)
  assert.equal(workEditSchema.safeParse({ categoryId: ['meme', 'comic'] }).success, false)
  assert.equal(workEditSchema.safeParse({ categoryId: 'meme', slug: 'new-slug' }).success, false)
})
