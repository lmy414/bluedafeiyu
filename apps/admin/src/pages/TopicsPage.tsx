import { useRef, useState } from 'react';
import { TranslationFields, readTranslations } from '../components/editors';
import { ErrorText, Field, Pagination, Panel, Results, SearchForm, SelectField, Status, Table, fieldValue, readForm, useToast } from '../components/ui';
import { adminApi, recordPath } from '../lib/api';
import { useList, useMutation, useResource } from '../lib/hooks';
import { options, safeUrl, thumbnail, topicStatuses } from '../lib/models';
import type { Topic, TopicWork, Work } from '../lib/models';

const topicTypes = { standard: '普通专题', author: '作者专题', serial: '连载漫画' };
type TopicType = keyof typeof topicTypes;

const topicType = (topic?: Topic): TopicType => topic?.isSerial ? 'serial' : topic?.author ? 'author' : 'standard';

function optionalHttpUrl(value: string, label: string) {
  if (!value) return undefined;
  if (!/^https?:\/\//i.test(value) || !safeUrl(value)) throw new Error(`${label}须为 HTTP 或 HTTPS 地址`);
  return value;
}

function readAuthor(form: FormData, current: Topic['author']) {
  const name = fieldValue(form, 'authorName');
  const bio = fieldValue(form, 'authorBio');
  const url = optionalHttpUrl(fieldValue(form, 'authorUrl'), '作者主页');
  const channels = fieldValue(form, 'authorChannels').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [platform, address, label] = line.split('|').map(item => item.trim());
    if (!platform || !address) throw new Error('作者渠道每行须填写平台和链接，用竖线分隔');
    return { platform, url: optionalHttpUrl(address, '作者渠道'), ...(label ? { label } : {}) };
  });
  if (!name || !channels.length) throw new Error('作者专题须填写作者名和至少一个渠道');
  return { ...current, name, bio, url, channels };
}

function authorChannels(author?: Topic['author']) {
  const channels = author?.channels;
  if (!Array.isArray(channels)) return '';
  return channels.map((value: { platform?: string; url?: string; label?: string }) => [value.platform, value.url, value.label].filter(Boolean).join(' | ')).join('\n');
}

function TopicEditor({ topic, close, done }: { topic?: Topic; close: () => void; done: () => void }) {
  const mutation = useMutation();
  const notify = useToast();
  const [type, setType] = useState<TopicType>(topicType(topic));
  const [works, setWorks] = useState<TopicWork[]>(() => [...(topic?.works ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
  const [coverWorkId, setCover] = useState(topic?.coverWorkId ?? '');
  const [totalPages, setTotalPages] = useState(topic?.readerConfig?.totalPages ?? 1);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const dragging = useRef<string | null>(null);
  const candidates = useList<Work>('/works', { q: search, status: 'published', page, pageSize: 24 });
  const isSerial = type === 'serial';
  const usedPages = new Set(works.flatMap(work => work.workId !== coverWorkId && work.pageNumber != null && work.pageNumber >= 1 && work.pageNumber <= totalPages ? [work.pageNumber] : []));
  const missing = Math.max(0, totalPages - usedPages.size);

  function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    setWorks(previous => {
      const from = previous.findIndex(item => item.workId === fromId);
      const to = previous.findIndex(item => item.workId === toId);
      const item = previous[from];
      if (!item || to < 0) return previous;
      const next = [...previous];
      next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function toggle(work: Work) {
    if (works.some(item => item.workId === work.id)) remove(work.id);
    else setWorks(previous => [...previous, { workId: work.id, name: work.name, pageNumber: null }]);
  }

  function remove(id: string) {
    setWorks(previous => previous.filter(item => item.workId !== id));
    if (coverWorkId === id) setCover('');
  }

  return <Panel focus title={topic ? `编排 ${topic.name}` : '新建专题'} action={<button onClick={close}>收起</button>}>
    <div className="panel-body stack">
      <form id="topic-editor" className="form-grid" onSubmit={event => {
        const form = readForm(event);
        void mutation.run(async () => {
          const id = topic?.id ?? fieldValue(form, 'id');
          if (!/^[a-z\d]+(?:-[a-z\d]+)*$/.test(id)) throw new Error('专题标识须使用小写字母、数字和连字符');
          const order = works.map((work, index) => ({ workId: work.workId, position: index, pageNumber: isSerial && work.workId !== coverWorkId ? work.pageNumber ?? null : null }));
          if (isSerial) {
            const bodyWorks = order.filter(work => work.workId !== coverWorkId);
            if (bodyWorks.some(work => work.pageNumber === null || !Number.isInteger(work.pageNumber) || work.pageNumber < 1 || work.pageNumber > totalPages)) throw new Error('请填写每张正文作品的有效原稿页码');
            if (new Set(bodyWorks.map(work => work.pageNumber)).size !== bodyWorks.length) throw new Error('每个原稿页码只能关联一件作品');
          }
          const body = {
            ...(!topic ? { id } : {}),
            name: fieldValue(form, 'name'), summary: fieldValue(form, 'summary'), status: fieldValue(form, 'status'),
            sortOrder: Number(fieldValue(form, 'sortOrder')), isSerial, coverWorkId: coverWorkId || null,
            readerConfig: isSerial ? {
              ...topic?.readerConfig, totalPages,
              credits: fieldValue(form, 'credits'), creditsI18n: { en: fieldValue(form, 'creditsEn'), ja: fieldValue(form, 'creditsJa') },
            } : null,
            author: type === 'author' || (type === 'serial' && fieldValue(form, 'authorName')) ? readAuthor(form, topic?.author) : null,
            i18n: readTranslations(form, ['name', 'summary'], topic?.i18n), works: order,
          };
          await adminApi(topic ? recordPath('topics', topic.id) : '/topics', { method: topic ? 'PATCH' : 'POST', body });
        }, () => { notify('专题编排已保存'); done(); });
      }}>
        {topic ? <div><strong>专题标识</strong><p className="mono">{topic.id}</p></div> : <Field label="专题标识" name="id" required placeholder="comic-series" />}
        <Field label="中文名称" name="name" value={topic?.name} required />
        <SelectField label="专题类型" value={type} choices={options(topicTypes)} onChange={value => setType(value as TopicType)} />
        <SelectField label="状态" name="status" value={topic?.status ?? 'draft'} choices={options(topicStatuses)} />
        <Field label="显示顺序" name="sortOrder" type="number" value={topic?.sortOrder ?? 0} required />
        <Field label="中文简介" name="summary" value={topic?.summary} multiline required />
        <TranslationFields fields={['name', 'summary']} value={topic?.i18n} />
        {type !== 'standard' && <fieldset className="field-wide form-grid"><legend>作者资料</legend>
          <Field label="作者名称" name="authorName" value={typeof topic?.author?.name === 'string' ? topic.author.name : ''} required={type === 'author'} />
          <Field label="作者主页" name="authorUrl" type="url" value={typeof topic?.author?.url === 'string' ? topic.author.url : ''} />
          <Field label="作者简介" name="authorBio" value={typeof topic?.author?.bio === 'string' ? topic.author.bio : ''} multiline />
          <Field label="作者渠道" name="authorChannels" value={authorChannels(topic?.author)} multiline required={type === 'author'} hint="每行：平台 | 链接 | 显示文字（可空）。第一行是首选渠道。" />
        </fieldset>}
        {isSerial && <fieldset className="field-wide form-grid"><legend>阅读器</legend>
          <label className="field">原稿总页数<input type="number" name="totalPages" min="1" max="20000" required value={totalPages || ''} onChange={event => setTotalPages(Number(event.target.value))} /></label>
          <Field label="中文制作人员" name="credits" value={topic?.readerConfig?.credits} />
          <Field label="英文制作人员" name="creditsEn" value={(topic?.readerConfig?.creditsI18n as { en?: string } | undefined)?.en} />
          <Field label="日文制作人员" name="creditsJa" value={(topic?.readerConfig?.creditsI18n as { ja?: string } | undefined)?.ja} />
        </fieldset>}
      </form>
      <div className="topic-layout separated">
        <section className="stack"><h3>已收录作品 <span className="mono">{works.length}</span></h3>
          <SelectField label="专题封面" choices={works.map(item => ({ id: item.workId, name: item.name || item.workId }))} empty={isSerial ? '无独立封面' : '默认首张'} value={coverWorkId} onChange={setCover} />
          <p className="muted">可拖拽排序，也可使用上移、下移按钮。{isSerial && `有 ${missing} 页缺图，阅读器会保留缺页位置。`}</p>
          {works.length ? <ol className="reorder-list">{works.map((work, index) => {
            const name = work.name || work.workId;
            const before = works[index - 1];
            const after = works[index + 1];
            return <li key={work.workId} onDragOver={event => { if (dragging.current) event.preventDefault(); }} onDrop={event => {
              if (!dragging.current) return;
              event.preventDefault();
              reorder(dragging.current, work.workId);
              dragging.current = null;
            }}>
              <span className="drag-grip" draggable aria-hidden="true" onDragStart={event => {
                dragging.current = work.workId;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', work.workId);
              }} onDragEnd={() => { dragging.current = null; }}>⠿</span>
              <div className="item-label"><strong>{name}</strong>{coverWorkId === work.workId && <small>封面</small>}</div>
              {isSerial && coverWorkId !== work.workId && <label className="page-number">页码<input type="number" min="1" max={totalPages} value={work.pageNumber ?? ''} aria-label={`${name}的原稿页码`} onChange={event => {
                const number = event.target.value === '' ? null : Number(event.target.value);
                setWorks(previous => previous.map(item => item.workId === work.workId ? { ...item, pageNumber: number } : item));
              }} /></label>}
              <div className="actions"><button aria-label={`上移 ${name}`} disabled={!before} onClick={() => before && reorder(work.workId, before.workId)}>上移</button>
                <button aria-label={`下移 ${name}`} disabled={!after} onClick={() => after && reorder(work.workId, after.workId)}>下移</button>
                <button aria-label={`移出 ${name}`} onClick={() => remove(work.workId)}>移出</button></div>
            </li>;
          })}</ol> : <p className="empty">尚未收录作品</p>}
        </section>
        <section className="stack"><h3>从作品库添加</h3><SearchForm label="搜索可收录的作品" onSearch={value => { setSearch(value); setPage(1); }} />
          <Results state={candidates} empty="未找到已上线作品"><div className="topic-candidates">{candidates.rows.map(work => <label key={work.id}>
            <input type="checkbox" checked={works.some(item => item.workId === work.id)} onChange={() => toggle(work)} />
            {thumbnail(work) && <img className="thumb" src={thumbnail(work)} alt="" loading="lazy" />}<span>{work.name || work.id}</span>
          </label>)}</div></Results>
          <Pagination page={page} pageSize={24} data={candidates.data} onPage={setPage} />
        </section>
      </div>
      <ErrorText message={mutation.error} />
      <div className="actions"><button form="topic-editor" type="submit" className="primary" disabled={mutation.busy}>保存专题与编排</button></div>
    </div>
  </Panel>;
}

export function TopicsPage() {
  const [selected, setSelected] = useState<string | null>();
  const [q, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const list = useList<Topic>('/topics', { q, page, pageSize: 25 });
  const detail = useResource<Topic>(selected ? recordPath('topics', selected) : null);

  return <>
    <Panel title="专题列表" action={<button className="primary" onClick={() => setSelected(null)}>新建专题</button>}>
      <SearchForm label="搜索专题" onSearch={value => { setQuery(value); setPage(1); }} />
      <Results state={list}><Table label="专题列表" columns={['专题', '类型', '状态', '顺序']}>
        {list.rows.map(topic => <tr key={topic.id}><th scope="row"><button className="text-button" onClick={() => setSelected(topic.id)}>{topic.name}</button><small className="mono">{topic.id}</small></th>
          <td>{topicTypes[topicType(topic)]}</td><td><Status value={topic.status} labels={topicStatuses} /></td><td className="mono">{topic.sortOrder ?? '—'}</td></tr>)}
      </Table></Results>
      <Pagination page={page} pageSize={25} data={list.data} onPage={setPage} />
    </Panel>
    <ErrorText message={detail.error} />
    {detail.loading && <p className="empty">正在读取专题…</p>}
    {(selected === null || detail.data) && <TopicEditor key={selected ?? ''} topic={detail.data} close={() => setSelected(undefined)} done={() => { setSelected(undefined); list.reload(); }} />}
  </>;
}
