import {applyNativeArchives} from './native-archives.mjs';
import {aboutCopy,aboutQuestions} from '../src/lib/about-copy.mjs';
import { videoArchive } from '../src/lib/video-archive.mjs';
import { videoTerminology } from '../src/lib/video-terminology.mjs';
const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function applyNativeContent(document,api,base,snapshot) {
  if(api.current==='zh-Hant'&&/^\/characters\/[^/]+\.html$/.test(base)){
    const scope=document.querySelector('.character-page');
    if(scope){
      for(const node of scope.querySelectorAll('.character-cover-credit strong,.work-card .work-title,.character-version-description,[data-character-scene] option'))node.textContent=api.contentText(node.textContent);
      for(const node of scope.querySelectorAll('.live-character-portrait img,.work-card img'))if(node.hasAttribute('alt'))node.setAttribute('alt',api.contentText(node.getAttribute('alt')));
      for(const node of scope.querySelectorAll('[data-preview][aria-label]'))node.setAttribute('aria-label',api.contentText(node.getAttribute('aria-label')));
    }
  }
  const native=['en','ja'].includes(api.current);
  if(!native)return;
  const videoById = new Map(videoArchive.videos.map(v => [v.bvid, v]));
  const creatorNames = videoArchive.creators.map(c => c.name);
  for (const card of document.querySelectorAll('[data-video-bvid]')) {
    const video = videoById.get(card.getAttribute('data-video-bvid'));
    const value = video?.i18n?.[api.current];
    if (value) {
      for (const field of ['title', 'description']) {
        const target=card.querySelector(`[data-video-${field}]`);
        if(target)target.textContent=videoTerminology(value[field], api.current, video.characterIds, creatorNames);
      }
    }
  }
  for (const el of document.querySelectorAll('[data-creator-intro]')) {
    const c = videoArchive.creators.find(c => c.uid === el.getAttribute('data-creator-intro'));
    if(c?.i18n?.[api.current]) el.textContent = videoTerminology(c.i18n[api.current], api.current, videoArchive.videos.filter(v => v.uid === c.uid).flatMap(v => v.characterIds), creatorNames);
  }
  // Keep the approved brand wording in the visible FAQ identical to its schema.
  for(const el of document.querySelectorAll('[data-i18n^="d.about."]')) {
    const key=el.getAttribute('data-i18n').slice('d.about.'.length), index=api.current==='en'?1:2;
    const question=key.match(/^faq\.(\d+)\.([qa])$/);
    const text=question?aboutQuestions[Number(question[1])]?.[index+(question[2]==='a'?3:0)]:aboutCopy[key]?.[index];
    if(text)el.textContent=text;
  }
  const bySlug=new Map(snapshot.works.map(w=>[w.slug,w]));
  const localized=w=>w?.i18n?.[api.current];
  const textMap=new Map();for(const w of snapshot.works){const value=localized(w);if(value)for(const field of ['name','description','commentary'])if(w[field]&&!textMap.has(w[field]))textMap.set(w[field],value[field]);}
  for(const topic of snapshot.topics||[]){const value=topic.i18n?.[api.current];if(value)for(const field of ['name','summary'])if(topic[field]&&value[field])textMap.set(topic[field],value[field]);}
  const nativeText=text=>textMap.get(String(text).trim())||api.contentText(text);
  for(const card of document.querySelectorAll('.work-card[data-slug]')) {
    const w=bySlug.get(card.getAttribute('data-slug')),value=localized(w);if(!value)continue;
    card.querySelector('.work-title').textContent=value.name;
    card.querySelector('img')?.setAttribute('alt',value.description||value.name);
    const description=card.querySelector('.character-version-description');if(description)description.textContent=value.description||value.name;
    for(const trigger of card.querySelectorAll('[data-preview][aria-label]'))trigger.setAttribute('aria-label',api.fmt('d.quickView','Preview')+' '+value.name);
    for(const role of card.querySelectorAll('.card-meta a')){const id=role.getAttribute('data-character-id')||w.characterId,dot=role.querySelector('i');role.replaceChildren();if(dot)role.appendChild(dot);role.appendChild(document.createTextNode(api.characterName(id,id)));}
  }
  const work=bySlug.get(base.match(/^\/works\/([^/]+)\.html$/)?.[1]),value=localized(work);
  if(work&&value) {
    const set=(selector,text)=>{const el=document.querySelector(selector);if(el)el.textContent=text;};
    set('main h1',value.name);set('.work-description',value.description);set('.fish-comment p',value.commentary);
    const originNote=document.querySelector('[data-origin-note-text]');
    if(originNote){if(value.originNote)originNote.textContent=value.originNote;else originNote.closest('[data-origin-note]')?.remove();}
    set('.breadcrumbs > span:last-child',value.name);
    for(const role of document.querySelectorAll('.detail-role')){const id=role.getAttribute('data-character-id')||work.characterId,dot=role.querySelector('i');role.replaceChildren();if(dot)role.appendChild(dot);role.appendChild(document.createTextNode(api.characterName(id,id)));}
    document.querySelector('.detail-image img')?.setAttribute('alt',value.description||value.name);
    const license=document.querySelector('.work-facts small');if(license)license.textContent=value.licenseNote;
    for(const tag of document.querySelectorAll('.detail-info .tags a')) {
      const original=new URL(tag.getAttribute('href'),'https://example.test').searchParams.get('q');const index=work.tags.indexOf(original);
      if(index>=0)tag.textContent=value.tags[index];
    }
    const section=document.createElement('section');section.className='section work-faq';section.setAttribute('data-work-faq','');
    section.innerHTML='<h2>'+escape(api.current==='en'?'About this work':'この作品について')+'</h2><div class="reading-faq">'+value.faq.map(q=>'<details><summary>'+escape(q.question)+'</summary><div>'+escape(q.answer)+'</div></details>').join('')+'</div>';
    document.querySelector('[data-static-work]')?.after(section);
    const schema=document.createElement('script');schema.type='application/ld+json';schema.textContent=JSON.stringify({'@context':'https://schema.org','@type':'FAQPage',inLanguage:api.current,mainEntity:value.faq.map(q=>({'@type':'Question',name:q.question,acceptedAnswer:{'@type':'Answer',text:q.answer}}))}).replace(/</g,'\\u003c');document.head.appendChild(schema);
  }
  // These names are actual credits, not site branding or prose.
  const identities=new Set(['上善无形',...videoArchive.creators.map(c => c.name),...(snapshot.topics||[]).map(t=>t.author?.name),...snapshot.works.flatMap(w=>[w.origin?.author,w.submitter?.name])].filter(v=>v&&v.length>1&&!['本人','原作者未标注','上游清单导入','蓝色大肥鱼'].includes(v)));
  const protectedText='.work-facts dd,.work-detail .source-note,[data-i18n="v2.cm.owner"],.author-profile h1,.author-name,.topic-author b,.topic-author .author-initial';
  const authoredText='.work-card,.detail-info h1,.detail-info .tags,.work-description,.fish-comment p,.detail-role,.breadcrumbs > span:last-child,.detail-image img,.work-facts small,[data-work-faq]';
  for(const el of document.querySelectorAll('*')) {
    if(el.closest('[data-i18n^="d.about."],[data-i18n^="d.guide."],[data-i18n="d.homeTitle"]'))continue;
    if(identities.has(el.textContent.trim()) || el.closest('script,style,code,pre,textarea,.lang-fallback,.work-card,'+protectedText) || (value && el.closest(authoredText)))continue;
    for(const node of el.childNodes)if(node.nodeType===3)node.textContent=nativeText(node.textContent);
    for(const attr of ['alt','title','aria-label','placeholder'])if(el.hasAttribute(attr))el.setAttribute(attr,nativeText(el.getAttribute(attr)));
    if(el.tagName==='META'&&!/image|url/.test(el.getAttribute('name')||el.getAttribute('property')||''))el.setAttribute('content',api.contentText(el.getAttribute('content')));
  }
  for(const meta of document.querySelectorAll('meta[property="og:image:alt"],meta[name="twitter:image:alt"]'))meta.setAttribute('content',value ? value.description||value.name : nativeText(meta.getAttribute('content')));
  const author=document.querySelector('.work-facts > div:first-child dd');if(author?.textContent==='原作者未标注')author.textContent=api.contentText(author.textContent);
  const archive=applyNativeArchives(document,api,base,snapshot);
  if(archive)for(const meta of document.querySelectorAll('meta[property="og:image:alt"],meta[name="twitter:image:alt"]'))meta.setAttribute('content',archive.title);
  return {work,value,archive};
}
