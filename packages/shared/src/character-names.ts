import type { TranslationLocale } from './types/index.js'

const defaultCharacterNames = new Map<string, readonly [en: string, ja?: string]>([
  ['deepseek', ['DeepSeek Chan']],
  ['doubao', ['Doubao Chan']],
  ['kimi', ['Kimi Chan']],
  ['qwen', ['Qwen Chan']],
  ['claude', ['Claude Chan']],
  ['gemini', ['Gemini Chan']],
  ['grok', ['Grok Chan']],
  ['stepfun', ['StepFun Chan']],
  ['glm', ['GLM Chan']],
  ['gpt', ['GPT Chan']],
  ['mimo', ['MiMo Chan']],
  ['minimax', ['MiniMax Chan']],
  ['mistral', ['Mistral Chan']],
  ['llama', ['Llama Chan']],
  ['perplexity', ['Perplexity Chan']],
  ['rwkv', ['RWKV Chan']],
  ['hunyuan', ['Hunyuan Chan']],
  ['novelai', ['NovelAI Chan']],
  ['huggingface', ['Hugging Face Chan']],
  ['zcode', ['Zcode Chan']],
  ['opencode', ['OpenCode Chan']],
  ['git', ['Git Sisters', 'Git三姉妹']],
  ['other', ['Other Characters', 'その他のキャラクター']],
  ['owner-picks', ["Owner's Picks", '管理人ピックアップ']],
])

export function defaultCharacterName(id: string, locale: TranslationLocale) {
  const names = defaultCharacterNames.get(id)
  return locale === 'ja' ? names?.[1] ?? names?.[0] : names?.[0]
}
