/* eslint-disable @typescript-eslint/no-explicit-any */
/** Field inspection only. Generation belongs to the Hermes Agent runtime. */
import { isPlaceholderDescription } from './placeholder'
export { isPlaceholderDescription }
export const FILL_FIELDS = [
  'name',
  'description',
  'commentary',
  'tags',
  'categories',
  'dimensions',
  'i18n',
] as const
export type FillField = (typeof FILL_FIELDS)[number]

export function authorDescription(work: any, submission?: any): string {
  for (const value of [
    submission?.fields?.description,
    submission?.fields?.note,
    work?.legacyData?.description,
  ]) {
    if (typeof value === 'string' && !isPlaceholderDescription(value)) return value.trim()
  }
  return ''
}
export function missingFields(work: any): FillField[] {
  const blank = (value: unknown) => !String(value ?? '').trim()
  const fields: FillField[] = []
  if (blank(work.name)) fields.push('name')
  if (isPlaceholderDescription(work.description)) fields.push('description')
  if (blank(work.commentary)) fields.push('commentary')
  if (!Array.isArray(work.tags) || !work.tags.some((tag: any) => !blank(tag?.value ?? tag)))
    fields.push('tags')
  if (!Array.isArray(work.categories) || !work.categories.length) fields.push('categories')
  if (!Number(work.width) || !Number(work.height)) fields.push('dimensions')
  return fields
}
