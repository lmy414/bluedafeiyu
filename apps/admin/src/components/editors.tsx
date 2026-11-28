import { WORK_LICENSE_TYPES, validateTrilingualCompleteness } from '@dafeiyu/shared';
import type { I18n, Option, Translation, WorkFields } from '../lib/models';
import { options, sources, workKinds } from '../lib/models';
import { Field, SelectField, fieldValue, jsonText, lines } from './ui';

const translations = { name: '名称', description: '说明', commentary: '点评', summary: '简介' };
type TextTranslationField = keyof typeof translations;

export function TranslationFields({ fields, value, required }: { fields: TextTranslationField[]; value?: I18n | null; required?: boolean }) {
  return <div className="field-wide translations">
    {(['en', 'ja'] as const).map(language => <fieldset key={language} lang={language}>
      <legend lang="zh-CN">{language === 'en' ? '英语' : '日语'}</legend>
      {fields.map(field => <div key={field} lang="zh-CN"><Field name={`${language}.${field}`} label={translations[field]} value={value?.[language]?.[field]} multiline={field !== 'name'} required={required && field !== 'commentary'} /></div>)}
    </fieldset>)}
  </div>;
}

export function readTranslations(form: FormData, fields: TextTranslationField[], current?: I18n | null): I18n {
  const result: I18n = {};
  for (const language of ['en', 'ja'] as const) {
    const values = { ...current?.[language] };
    for (const field of fields) {
      const text = fieldValue(form, `${language}.${field}`);
      if (text) values[field] = text;
      else delete values[field];
    }
    if (Object.keys(values).length) result[language] = values;
    else delete result[language];
  }
  return result;
}

const workTranslations = ['name', 'description', 'commentary'] as const;
const extraTranslations = { licenseNote: '授权说明', originNote: '来源说明', seoTitle: '搜索标题', seoDescription: '搜索摘要' } as const;
const licenses = { unknown: '未知', cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-nc': 'CC BY-NC', 'author-permission': '作者许可', 'submitter-permission': '投稿者许可' };
const creditChoices = { named: '公开署名', anonymous: '匿名' };

function text(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

export function WorkEditor({ value, characters, categories, publishing = false }: { value: WorkFields; characters: Option[]; categories: Option[]; publishing?: boolean }) {
  const selected = new Set(value.characterIds ?? []);
  const characterOptions = [...characters, ...[...selected].filter(id => !characters.some(character => character.id === id)).map(id => ({ id, name: id }))];
  return <div className="form-grid">
    <Field label="中文名称" name="name" value={value.name} required />
    <SelectField label="主角色" name="primaryCharacterId" value={value.primaryCharacterId ?? ''} choices={characters} empty="选择主角色" required={publishing} />
    <SelectField label="作品分类" name="categoryId" value={value.categoryId ?? ''} choices={categories} empty="选择分类" required />
    <Field label="标签" name="tags" value={value.tags?.join('，')} hint="用逗号或换行分隔" />
    {!publishing && <><SelectField label="作品类型" name="kind" value={value.kind} choices={options(workKinds)} empty="沿用原值" />
      <SelectField label="来源渠道" name="channel" value={value.channel} choices={options(sources)} empty="沿用原值" /></>}
    <fieldset className="field-wide check-group"><legend>其他关联角色</legend>
      {characterOptions.length ? characterOptions.map(character => <label key={character.id}><input type="checkbox" name="characterIds" value={character.id} defaultChecked={selected.has(character.id)} />{character.name}</label>) : <p className="muted">暂无角色可选</p>}
    </fieldset>
    <Field label="中文说明" name="description" value={value.description} required={publishing} multiline />
    <Field label="中文点评" name="commentary" value={value.commentary} multiline />
    <TranslationFields fields={[...workTranslations]} value={value.i18n} required={publishing} />
    <details className="field-wide edit-details"><summary>更多英日译文</summary><div className="translations">
      {(['en', 'ja'] as const).map(language => <fieldset key={language}>
        <legend>{language === 'en' ? '英语' : '日语'}</legend>
        <Field label="标签译文" name={`${language}.tags`} value={value.i18n?.[language]?.tags?.join('，')} />
        {Object.entries(extraTranslations).map(([key, label]) => <Field key={key} label={label} name={`${language}.${key}`} value={value.i18n?.[language]?.[key as keyof typeof extraTranslations]} />)}
        <Field label="问答译文" name={`${language}.faq`} value={jsonText(value.i18n?.[language]?.faq)} multiline hint="JSON 数组。每项包含 question 和 answer。" />
      </fieldset>)}
    </div></details>
    <fieldset className="field-wide form-grid"><legend>署名、来源与授权</legend>
      <SelectField label="投稿者署名方式" name="submitter.credit" value={text(value.submitter, 'credit')} choices={options(creditChoices)} empty="未指定" />
      <Field label="投稿者署名" name="submitter.name" value={text(value.submitter, 'name')} />
      <Field label="投稿者主页" name="submitter.url" value={text(value.submitter, 'url')} />
      <Field label="投稿者 GitHub" name="submitter.github" value={text(value.submitter, 'github')} />
      <Field label="原作者" name="origin.author" value={text(value.origin, 'author')} />
      <Field label="来源类型" name="origin.type" value={text(value.origin, 'type')} />
      <Field label="来源链接" name="origin.sourceUrl" value={text(value.origin, 'sourceUrl')} />
      <Field label="GitHub Issue 链接" name="origin.issueUrl" value={text(value.origin, 'issueUrl')} />
      <Field label="来源说明" name="origin.note" value={text(value.origin, 'note')} multiline />
      <SelectField label="授权类型" name="license.type" value={text(value.license, 'type')} choices={WORK_LICENSE_TYPES.map(id => ({ id, name: licenses[id] }))} empty="未指定" />
      <Field label="授权链接" name="license.url" value={text(value.license, 'url')} />
      <Field label="授权说明" name="license.note" value={text(value.license, 'note')} multiline />
    </fieldset>
  </div>;
}

function readMetadata(form: FormData, key: string, fields: string[], current: Record<string, unknown> | null | undefined) {
  const next = { ...current };
  for (const field of fields) {
    const value = fieldValue(form, `${key}.${field}`);
    if (value) next[field] = value;
    else delete next[field];
  }
  return Object.keys(next).length ? next : null;
}

function readWorkTranslations(form: FormData, current?: I18n | null) {
  const translations = readTranslations(form, [...workTranslations], current);
  for (const language of ['en', 'ja'] as const) {
    const value: Translation = translations[language] ?? {};
    const tags = lines(fieldValue(form, `${language}.tags`));
    if (tags.length) value.tags = tags;
    else delete value.tags;
    for (const key of Object.keys(extraTranslations) as (keyof typeof extraTranslations)[]) {
      const translated = fieldValue(form, `${language}.${key}`);
      if (translated) value[key] = translated;
      else delete value[key];
    }
    const faq = fieldValue(form, `${language}.faq`);
    if (faq) {
      try {
        const items: unknown = JSON.parse(faq);
        if (!Array.isArray(items) || items.some(item => !item || typeof item.question !== 'string' || typeof item.answer !== 'string')) throw new Error();
        value.faq = items.map(({ question, answer }) => ({ question, answer }));
      } catch {
        throw new Error(`${language === 'en' ? '英语' : '日语'}问答译文须为包含 question 和 answer 的 JSON 数组`);
      }
    } else delete value.faq;
    if (Object.keys(value).length) translations[language] = value;
    else delete translations[language];
  }
  return translations;
}

export function readWork(form: FormData, current: WorkFields, publishing = false): WorkFields {
  const primaryCharacterId = fieldValue(form, 'primaryCharacterId');
  const otherCharacters = form.getAll('characterIds').flatMap(item => typeof item === 'string' ? [item] : []);
  const characterIds = [...new Set(primaryCharacterId ? [primaryCharacterId, ...otherCharacters] : otherCharacters)];
  const categoryId = fieldValue(form, 'categoryId');
  const result = {
    name: fieldValue(form, 'name'),
    description: fieldValue(form, 'description'),
    commentary: fieldValue(form, 'commentary'),
    ...(form.has('kind') && fieldValue(form, 'kind') ? { kind: fieldValue(form, 'kind') } : {}),
    ...(form.has('channel') && fieldValue(form, 'channel') ? { channel: fieldValue(form, 'channel') } : {}),
    ...(primaryCharacterId ? { primaryCharacterId } : {}),
    ...(characterIds.length ? { characterIds } : {}),
    ...(categoryId ? { categoryId } : {}),
    tags: lines(fieldValue(form, 'tags')),
    i18n: readWorkTranslations(form, current.i18n),
    submitter: readMetadata(form, 'submitter', ['credit', 'name', 'url', 'github'], current.submitter),
    origin: readMetadata(form, 'origin', ['author', 'type', 'sourceUrl', 'issueUrl', 'note'], current.origin),
    license: readMetadata(form, 'license', ['type', 'url', 'note'], current.license),
  };
  if (publishing) {
    const validation = validateTrilingualCompleteness(result);
    if (!validation.success) throw new Error(validation.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join(' · '));
  }
  return result;
}

export function changedWorkFields(current: WorkFields, next: WorkFields): WorkFields {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
    }
    return value;
  }
  const empty = (value: unknown) => value == null || value === '' || (typeof value === 'object' && !Object.keys(value).length);
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => {
    const prior = current[key as keyof WorkFields];
    if (empty(prior) && empty(value)) return false;
    if (key === 'characterIds' && Array.isArray(prior) && Array.isArray(value)) {
      return JSON.stringify([...prior].sort()) !== JSON.stringify([...value].sort());
    }
    return JSON.stringify(canonical(prior)) !== JSON.stringify(canonical(value));
  }));
}
