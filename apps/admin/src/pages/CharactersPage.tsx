import { useState } from 'react';
import { TranslationFields, readTranslations } from '../components/editors';
import { ErrorText, Field, Panel, Results, SelectField, Status, Table, fieldValue, jsonText, lines, objectValue, readForm, useToast } from '../components/ui';
import { adminApi, recordPath } from '../lib/api';
import { useList, useMutation } from '../lib/hooks';
import { options, publicMedia, safeUrl, taxonomyStatuses } from '../lib/models';
import type { Taxon } from '../lib/models';

type Kind = 'characters' | 'categories';
const colorKey = '--character-accent';

function TaxonomyEditor({ kind, row, close, reload }: { kind: Kind; row?: Taxon; close: () => void; reload: () => void }) {
  const mutation = useMutation();
  const upload = useMutation();
  const notify = useToast();
  const character = kind === 'characters';
  const label = character ? '角色' : '分类';
  const [portrait, setPortrait] = useState(safeUrl(row?.portraitUrl) ?? publicMedia(row?.portraitKey));
  const color = row?.brandTokens?.[colorKey];
  const saved = () => {
    notify(`${label}已保存`);
    reload();
    close();
  };

  return <Panel focus title={row ? `编辑${label} ${row.name}` : `新建${label}`} action={<button onClick={close}>收起</button>}>
    <div className="panel-body stack">
      <form className="form-grid" onSubmit={event => {
        const form = readForm(event);
        void mutation.run(async () => {
          const body = {
            ...(!row ? { id: fieldValue(form, 'id') } : {}),
            name: fieldValue(form, 'name'), description: fieldValue(form, 'description'),
            status: fieldValue(form, 'status') === 'inactive' ? 'hidden' : fieldValue(form, 'status'), sortOrder: Number(fieldValue(form, 'sortOrder')),
            i18n: readTranslations(form, ['name', 'description'], row?.i18n),
            ...(character ? { aliases: lines(fieldValue(form, 'aliases')), brandTokens: objectValue(form, 'brandTokens', '其他主题变量') ?? {} } : {}),
          };
          const accent = fieldValue(form, 'accent');
          if (character && body.brandTokens) {
            if (accent && !/^#[\da-f]{6}$/i.test(accent)) throw new Error('强调色须为 6 位十六进制颜色，例如 #1d6ef5');
            if (accent) body.brandTokens[colorKey] = accent;
            else delete body.brandTokens[colorKey];
          }
          await adminApi(row ? recordPath(kind, row.id) : `/${kind}`, { method: row ? 'PATCH' : 'POST', body });
        }, saved);
      }}>
        {row ? <div><strong>标识</strong><p className="mono">{row.id}</p></div> : <Field label="角色标识" name="id" required hint="使用小写字母、数字和连字符" />}
        <Field label="中文名称" name="name" value={row?.name} required />
        <SelectField label="状态" name="status" value={row?.status ?? 'active'} choices={options(taxonomyStatuses)} />
        <Field label="显示顺序" name="sortOrder" type="number" value={row?.sortOrder ?? 0} required />
        {character && <><Field label="别名" name="aliases" value={row?.aliases?.join('，')} multiline hint="用逗号或换行分隔" />
          <Field label="角色主题强调色" name="accent" value={typeof color === 'string' ? color : ''} placeholder="#1d6ef5" />
          <Field label="其他主题变量" name="brandTokens" value={jsonText(Object.fromEntries(Object.entries(row?.brandTokens ?? {}).filter(([key]) => key !== colorKey)))} multiline hint="JSON 对象" /></>}
        <Field label="中文说明" name="description" value={row?.description} multiline />
        <TranslationFields fields={['name', 'description']} value={row?.i18n} />
        <div className="actions field-wide"><button className="primary" disabled={mutation.busy}>保存{label}</button></div>
        <div className="field-wide"><ErrorText message={mutation.error} /></div>
      </form>
      {character && row && <form className="stack separated" onSubmit={event => {
        const body = readForm(event);
        void upload.run(() => adminApi<{ portraitKey?: string; portraitUrl?: string }>(`${recordPath(kind, row.id)}/portrait`, { method: 'POST', body }), result => {
          setPortrait(safeUrl(result.portraitUrl) ?? publicMedia(result.portraitKey));
          notify('立绘已上传');
          reload();
        });
      }}>
        <h3>透明立绘</h3>
        {portrait && <div className="portrait checker draft-corners"><img src={portrait} alt={`${row.name}的透明立绘`} /></div>}
        <label className="field">选择 PNG 或 WebP<input type="file" name="file" accept="image/png,image/webp" required /></label>
        <div className="actions"><button disabled={upload.busy}>{upload.busy ? '正在上传…' : '上传立绘'}</button></div>
        <ErrorText message={upload.error} />
      </form>}
    </div>
  </Panel>;
}

export function CharactersPage() {
  const [kind, setKind] = useState<Kind>('characters');
  const [editId, setEditId] = useState<string | null>();
  const list = useList<Taxon>(`/${kind}`);
  const row = list.rows.find(item => item.id === editId);
  const editing = Boolean(row || editId === null);

  return <>
    <Panel title={kind === 'characters' ? '角色档案' : '作品分类'} action={kind === 'characters' && <button className="primary" onClick={() => setEditId(null)}>新建角色</button>}>
      <div className="segment" aria-label="词表选择" role="group">{(['characters', 'categories'] as const).map(key => <button key={key} type="button" aria-pressed={kind === key} onClick={() => { setKind(key); setEditId(undefined); }}>{key === 'characters' ? '角色' : '分类'}</button>)}</div>
      <Results state={list}><Table label={kind === 'characters' ? '角色档案' : '作品分类'} columns={['名称', '标识', '别名', '顺序', '状态']}>
        {list.rows.map(item => <tr key={item.id}>
          <th scope="row"><button className="text-button" onClick={() => setEditId(item.id)}>{item.name}</button></th><td className="mono">{item.id}</td><td>{item.aliases?.join('、') || '—'}</td><td className="mono">{item.sortOrder ?? '—'}</td><td><Status value={item.status} labels={taxonomyStatuses} /></td>
        </tr>)}
      </Table></Results>
    </Panel>
    {editing && <TaxonomyEditor key={`${kind}:${editId}`} kind={kind} row={row} reload={list.reload} close={() => setEditId(undefined)} />}
  </>;
}
