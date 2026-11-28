import assert from 'node:assert/strict';
import test from 'node:test';
import { localizedCharacterName } from '../src/lib/api.js';
import { localizedText, prepareLocale, tr } from '../src/lib/i18n.js';
import { homeMeta } from '../src/content/landing-copy.js';
import { defaultCharacterName } from '../../../packages/shared/src/character-names.js';

const names = [
  ['deepseek', 'DeepSeek娘', 'DeepSeek Chan'],
  ['doubao', '豆包娘', 'Doubao Chan'],
  ['kimi', 'Kimi娘', 'Kimi Chan'],
  ['qwen', '通义千问娘', 'Qwen Chan'],
  ['claude', 'Claude娘', 'Claude Chan'],
  ['gemini', 'Gemini娘', 'Gemini Chan'],
  ['grok', 'Grok娘', 'Grok Chan'],
  ['stepfun', 'Stepfun娘', 'StepFun Chan'],
  ['glm', 'GLM娘', 'GLM Chan'],
  ['gpt', 'GPT娘', 'GPT Chan'],
  ['mimo', 'MiMo娘', 'MiMo Chan'],
  ['minimax', 'MiniMax娘', 'MiniMax Chan'],
  ['mistral', 'Mistral娘', 'Mistral Chan'],
  ['llama', 'Llama娘', 'Llama Chan'],
  ['perplexity', 'Perplexity娘', 'Perplexity Chan'],
  ['rwkv', 'RWKV娘', 'RWKV Chan'],
  ['hunyuan', '混元HY娘', 'Hunyuan Chan'],
  ['novelai', 'NovelAI娘', 'NovelAI Chan'],
  ['huggingface', 'HuggingFace娘', 'Hugging Face Chan'],
  ['zcode', 'Zcode娘', 'Zcode Chan'],
  ['opencode', 'OpenCode娘', 'OpenCode Chan'],
  ['git', 'Git三姐妹', 'Git Sisters', 'Git三姉妹'],
  ['other', '其他角色', 'Other Characters', 'その他のキャラクター'],
  ['owner-picks', '站长自用', "Owner's Picks", '管理人ピックアップ'],
] as const;

test('all 24 archive characters have the agreed English and Japanese names', () => {
  for (const [id, name, en, ja = en] of names) {
    const character = { id, name, i18n: {} };
    assert.equal(localizedCharacterName('zh', character), name, id);
    assert.equal(localizedCharacterName('en', character), en, id);
    assert.equal(localizedCharacterName('ja', character), ja, id);
    assert.equal(defaultCharacterName(id, 'en'), en, id);
    assert.equal(defaultCharacterName(id, 'ja'), ja, id);
  }
});

test('character names prefer translations and fall back by suffix for new characters', () => {
  const official = { id: 'deepseek', name: 'DeepSeek娘', i18n: { en: { name: ' Editor’s DeepSeek ' }, ja: { name: ' ' } } };
  assert.equal(localizedCharacterName('en', official), 'Editor’s DeepSeek');
  assert.equal(localizedCharacterName('ja', official), 'DeepSeek Chan');
  for (const locale of ['en', 'ja'] as const) {
    assert.equal(localizedCharacterName(locale, { id: 'foo', name: 'Foo 娘' }), 'Foo Chan');
    assert.equal(localizedCharacterName(locale, { id: 'foo', name: 'Foo' }), 'Foo');
  }
});

test('localized site names and Traditional Chinese keep 娘', async () => {
  await prepareLocale('zh-hant');
  const siteNames = { zh: '蓝色大肥鱼', 'zh-hant': '藍色大肥魚', en: 'DeepSeek Chan', ja: 'DeepSeek Chan' } as const;
  for (const locale of ['zh', 'zh-hant', 'en', 'ja'] as const) {
    assert.equal(tr(locale, 'site'), siteNames[locale]);
    assert.ok(homeMeta(24, locale).title.startsWith(siteNames[locale]));
  }
  assert.equal(localizedCharacterName('zh-hant', { id: 'gemini', name: 'Gemini娘' }), 'Gemini娘');
  assert.equal(localizedText('zh-hant', 'AI娘和Gemini娘：蓝色大肥鱼和孃'), 'AI娘和Gemini娘：藍色大肥魚和娘');
  assert.equal(localizedText('zh-hant', 'DeepSeek娘'), 'DeepSeek娘');
});
