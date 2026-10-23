import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { LOCALES, ORIGIN, localizedPath } from '../scripts/localize-pages.mjs';
import { homeMeta, guides, guidePath, characterIntros } from '../src/lib/landing-copy.mjs';
import { createGuidePages } from '../src/components/archive/GuidePages.mjs';
import { workCharacterIds } from '../../tools/work-characters.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const out = process.env.SITE_OUT_DIR || path.join(root, '.build/site');
const snapshot = JSON.parse(fs.readFileSync(path.join(out, 'site-data.json'), 'utf8'));
const read = route => parseHTML(fs.readFileSync(path.join(out, route.endsWith('/') ? route.slice(1)+'index.html' : route.slice(1)), 'utf8')).document;

test('home SEO uses published counts, brand aliases and a localized working search template', () => {
  for (const locale of LOCALES) {
    const doc = read(localizedPath('/',locale));
    assert.equal(doc.title,homeMeta(snapshot.works.length,locale.id).title);
    assert.equal(doc.querySelector('meta[name="description"]').getAttribute('content'),homeMeta(snapshot.works.length,locale.id).description);
    const graph = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
    const site = graph.find(x=>x['@type']==='WebSite'), organization = graph.find(x=>x['@type']==='Organization');
    for (const alias of ['大肥鱼','大肥魚','藍色大肥魚','Blue Dafeiyu']) assert.ok(site.alternateName.includes(alias));
    assert.equal(site.publisher['@id'],organization['@id']);
    assert.equal(site.inLanguage,locale.html);
    const template = site.potentialAction.target.urlTemplate;
    const search = new URL(template.replace('{search_term_string}',encodeURIComponent('鲸鱼娘')));
    assert.equal(search.pathname,locale.prefix+'/search.html');
    assert.equal(search.searchParams.get('q'),'鲸鱼娘');
    assert.equal(organization.logo,ORIGIN+'/favicon.png');
    assert.equal(organization.name,locale.id==='en'?'DeepSeek Chan':['zh-Hant','ja'].includes(locale.id)?'藍色大肥魚':'蓝色大肥鱼');
  }
});

test('about facts and visible FAQs match structured data in all languages', () => {
  for (const locale of LOCALES) {
    const doc = read(localizedPath('/about.html',locale));
    const count = [...doc.querySelectorAll('[data-about-count] b')].map(x=>Number(x.textContent));
    assert.deepEqual(count,[snapshot.works.length,snapshot.works.filter(w=>workCharacterIds(w).includes('deepseek')).length]);
    assert.ok(doc.querySelector('#what-is-blue-dafeiyu'));
    const schema = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
    const details = [...doc.querySelectorAll('.live-reading-faq details')];
    assert.equal(details.length,4);
    assert.deepEqual(schema.mainEntity.map(x=>[x.name,x.acceptedAnswer.text]),details.map(x=>[x.querySelector('summary').textContent,x.querySelector('p').textContent]));
    for (const anchor of ['license','licensing','analytics','special-thanks']) assert.ok(doc.getElementById(anchor));
  }
});

test('role landing introductions are distinct and link to related character archives', () => {
  for (const locale of LOCALES) {
    const intros = [];
    for (const id of Object.keys(characterIntros)) {
      const doc = read(localizedPath('/characters/'+id+'.html',locale));
      intros.push(doc.querySelector('.character-info .lede').textContent);
      assert.ok(doc.title.includes(id==='gpt'?'GPT':id==='glm'?'GLM':id==='deepseek'?'DeepSeek':id==='claude'?'Claude':id==='gemini'?'Gemini':'Kimi'));
      assert.ok(doc.querySelector('.role-type-links a'));
      assert.ok(doc.querySelector('.role-entry-links a[href="'+locale.prefix+'/characters/'+(id==='deepseek'?'gpt':'deepseek')+'.html"]'));
    }
    assert.equal(new Set(intros).size,Object.keys(characterIntros).length);
  }
});

test('new guides are indexable, discoverable and retain existing curated topic membership', () => {
  const sourceTopics = JSON.parse(fs.readFileSync(path.join(root,'data/topics.json'),'utf8'));
  for (const topic of sourceTopics) assert.deepEqual(snapshot.topics.find(t=>t.id===topic.id).workIds,topic.workIds);
  for (const locale of LOCALES) for (const guide of guides) {
    const route = localizedPath(guidePath(guide),locale), doc = read(route);
    assert.equal(doc.querySelector('meta[name="robots"]').getAttribute('content'),'index,follow');
    assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute('href'),ORIGIN+route);
    assert.ok(doc.querySelectorAll('.work-card').length>0);
    assert.ok(doc.querySelector('a[href="'+locale.prefix+'/characters/'+guide.character+(guide.type?'/'+guide.type:'')+'.html"]'));
    assert.ok(read(localizedPath('/topics.html',locale)).querySelector('a[href="'+route+'"]'));
  }
});

test('submission pages are noindex and omitted from sitemap while retaining locale alternatives', () => {
  const sitemap = fs.readFileSync(path.join(out,'sitemap.xml'),'utf8');
  for (const locale of LOCALES) {
    const doc = read(localizedPath('/submit.html',locale));
    assert.equal(doc.querySelector('meta[name="robots"]').getAttribute('content'),'noindex,follow');
    assert.equal(doc.querySelectorAll('link[hreflang]').length,5);
    assert.ok(!sitemap.includes(ORIGIN+locale.prefix+'/submit.html'));
  }
});

test('a curated topic cannot silently overwrite a reserved editorial guide route',()=>{
  assert.throws(()=>createGuidePages({chars:[],topics:[{id:guides[0].id}]}),/reserved for an editorial guide/);
});
