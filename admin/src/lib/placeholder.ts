/** 历史导入时写入的占位说明，视同缺失。 */
const PLACEHOLDER_DESCRIPTIONS = [/^首批收录自蓝色大肥鱼档案馆/, /原投稿未逐张命名/, /^GitHub Issue #\d+ 多图投稿/]

export function isPlaceholderDescription(value: unknown): boolean {
  const text = String(value ?? '').trim()
  return !text || PLACEHOLDER_DESCRIPTIONS.some((pattern) => pattern.test(text))
}