const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kind=(api,id)=>api.fmt('v2.type.'+id,id);
function context(base,api,snapshot){
  const topicId=base.match(/^\/topics\/([^/]+)(?:\/page\/\d+)?\.html$/)?.[1];
  const topic=topicId&&(snapshot.topics||[]).find(t=>t.id===topicId);
  if(topic){
    const value=topic.i18n?.[api.current];
    const name=value?.name||api.contentText(topic.name);
    const works=topic.workIds.map(id=>snapshot.works.find(w=>w.id===id)).filter(Boolean);
    return {topic,works,name,title:api.current==='en'?name+' · AI girl art collection':name+'・AI娘作品集',summary:value?.summary||api.contentText(topic.summary)};
  }
  const role=base.match(/^\/characters\/([^/]+)(?:\/(meme|illustration|setting|comic|standing|other))?(?:\/page\/\d+)?\.html$/);
  const category=base.match(/^\/categories\/([^/]+)(?:\/page\/\d+)?\.html$/);
  const character=role&&snapshot.characters.find(c=>c.id===role[1]);
  const type=category?.[1]||(role?.[2]&&role[2]!=='page'?role[2]:null);
  if(!character&&!category)return null;
  const works=snapshot.works.filter(w=>(!character||w.characterId===character.id)&&(!type||w.categoryIds?.includes(type)));
  const name=character?api.characterName(character.id,character.name):api.current==='en'?'AI characters':'AIキャラクター';
  const title=type?(api.current==='en'?name+' · '+kind(api,type):name+'の'+kind(api,type)):(api.current==='en'?name+' fan art archive':name+'の二次創作アーカイブ');
  return {character,type,works,name,title};
}
export function nativeArchiveName(base,api,snapshot){
  const c=context(base,api,snapshot),page=base.match(/\/page\/(\d+)\.html$/)?.[1];
  return c?c.title+(page?(api.current==='en'?' · Page '+page:' · '+page+'ページ目'):''):undefined;
}
export function applyNativeArchives(document,api,base,snapshot){
  const language=api.current;
  if(!['en','ja'].includes(language))return null;
  const en=language==='en';
  const roleName=id=>api.characterName(id,snapshot.characters.find(c=>c.id===id)?.name||id);
  // Aliases are character identifiers; use the canonical localized identity for names in non-Latin scripts.
  const aliases=c=>[...new Set((c.aliases||[]).map(a=>/[\u3400-\u9fff]/u.test(a)?roleName(c.id):a))].filter(a=>a!==roleName(c.id));
  for(const card of document.querySelectorAll('.role-card')){
    const id=card.getAttribute('href')?.match(/\/characters\/([^/]+)\.html/)?.[1],c=snapshot.characters.find(c=>c.id===id);
    if(!c)continue;
    card.querySelector('h3').textContent=roleName(c.id);
    card.querySelector('p').textContent=aliases(c).join(' / ')||roleName(c.id);
    card.querySelector('img')?.setAttribute('alt',roleName(c.id));
  }
  for(const link of document.querySelectorAll('.role-entry-links a')){
    const id=link.getAttribute('href')?.match(/\/characters\/([^/]+)\.html/)?.[1];
    if(id)link.textContent=en?roleName(id)+' stickers and fan art':roleName(id)+'のネタ画像・二次創作';
  }
  const c=context(base,api,snapshot);if(!c)return null;
  if(c.topic){
    const heading=document.querySelector('main h1');if(heading)heading.textContent=c.name;
    const lead=document.querySelector('.topic-hero .lede,.page-head .lede');if(lead)lead.textContent=c.summary;
    const page=base.match(/\/page\/(\d+)\.html$/)?.[1];
    const crumb=document.querySelector('.breadcrumbs > span:last-child');if(crumb)crumb.textContent=page?(en?'Page '+page:page+'ページ目'):c.name;
    const description=en?`${c.summary} This collection includes ${c.works.length} works. Each work retains its description, source, attribution and license information.`:`${c.summary} ${c.works.length}件の作品を収録し、各作品の説明、出典、クレジット、ライセンス情報を保持しています。`;
    return {title:c.title+(page?(en?' · Page ':' · ')+page+(en?'':'ページ目'):'')+' | DeepSeek Chan',description};
  }
  const native=w=>w.i18n[language];
  const heading=document.querySelector('main h1');
  if(heading){
    (c.type?heading.querySelector('.marker-highlight')||heading:heading).textContent=c.type?c.title:c.name;
    if(!c.type){const small=document.createElement('small');small.textContent=en?'Fan art archive':'二次創作アーカイブ';heading.appendChild(small);}
  }
  const page=base.match(/\/page\/(\d+)\.html$/)?.[1];
  const crumb=document.querySelector('.breadcrumbs > span:last-child');if(crumb)crumb.textContent=page?(en?'Page '+page:page+'ページ目'):c.title;
  for(const link of document.querySelectorAll('.breadcrumbs a')){
    const id=link.getAttribute('href')?.match(/^\/characters\/([^/]+)\.html$/)?.[1];if(id)link.textContent=roleName(id);
  }
  let description;
  if(c.type){
    description=en?`Explore ${kind(api,c.type).toLowerCase()} featuring ${c.name}. This archive includes ${c.works.length} ${c.works.length===1?'work':'works'}. View each image, check its source and attribution, and download the original.`:`${c.name}の${kind(api,c.type)}を${c.works.length}件収録。画像の説明、出典、クレジットを確認し、元画像をご覧いただけます。`;
    const section=document.querySelector('main > .intro-panel');
    const samples=c.works.slice(0,3).map(w=>en?'“'+native(w).name+'”':'「'+native(w).name+'」').join(en?', ':'、');
    const notes=en?{comic:'Comics may span several panels. Open the work to read it at full size.',setting:'Designs vary by creator. Check the original source for character details.',meme:'Search by dialogue, mood or chat situation, then open a work to download its original.',illustration:'Open a work to see the full composition, original source and artist credit.'}:{comic:'複数のコマがある漫画は、作品の詳細ページで拡大してお読みください。',setting:'デザインは作者ごとに異なります。設定の詳細は各作品の出典をご確認ください。',meme:'セリフ、気分、会話の場面で検索し、作品の詳細から元画像をご覧ください。',illustration:'作品の詳細では、全体の構図、出典、作者のクレジットをご確認いただけます。'};
    if(section){
      section.querySelector('h2').textContent=en?'Explore this archive':'このアーカイブの見方';
      const extra=en?{standing:'These works show an isolated character, usually against a plain background.',other:'These works have unusual formats or cannot be confidently assigned to another type.'}:{standing:'シンプルな背景で、キャラクターの全身や姿を見せる作品です。',other:'特殊な形式や、ほかの種類に分類しにくい作品をまとめています。'};
      section.querySelector('p').textContent=(en?`This archive brings together ${kind(api,c.type).toLowerCase()} featuring ${c.name}, including ${samples}. `:`${c.name}の${kind(api,c.type)}をまとめています。収録作品には${samples}などがあります。`)+(notes[c.type]||extra[c.type]||'');
      const link=section.querySelector('a');if(link)link.textContent=c.character?(en?'Back to '+c.name+'’s archive':c.name+'のアーカイブへ'):(en?'Browse by character':'キャラクターから探す');
    }
  }else{
    const available=snapshot.categories.filter(t=>c.works.some(w=>w.categoryIds.includes(t.id))).map(t=>kind(api,t.id));
    description=en?`Explore ${c.works.length} archived ${c.works.length===1?'work':'works'} featuring ${c.name}. Browse ${available.join(', ').toLowerCase()}, view each image and check its source and attribution.`:`${c.name}の二次創作を${c.works.length}件収録。${available.join('・')}を探し、各作品の出典とクレジットをご確認いただけます。`;
    const alias=document.querySelector('.character-info .alias'),names=aliases(c.character);if(alias)alias.textContent=names.length?(en?'Also known as: ':'別名：')+names.join(' / '):(en?'Fan art archive':'二次創作アーカイブ');
    for(const link of document.querySelectorAll('.character-info .tags a')){
      const tag=new URL(link.getAttribute('href'),'https://example.test').searchParams.get('q'),w=c.works.find(w=>w.tags.includes(tag));
      if(w)link.textContent=native(w).tags[w.tags.indexOf(tag)];
    }
    const section=document.querySelector('.role-reading');
    if(section){
      const counts=snapshot.categories.map(t=>[t,c.works.filter(w=>w.categoryIds.includes(t.id)).length]).filter(([,n])=>n);
      const frequencies=new Map();for(const w of c.works)w.tags.forEach((tag,i)=>{const prev=frequencies.get(tag);frequencies.set(tag,{count:(prev?.count||0)+1,text:prev?.text||native(w).tags[i]});});
      const tags=[...frequencies.values()].sort((a,b)=>b.count-a.count).slice(0,4).map(t=>t.text).join(en?', ':'、');
      section.querySelector('h2').textContent=en?'Inside '+c.name+'’s archive':c.name+'の収録作品';
      section.querySelector('p').textContent=(en?`This archive currently includes ${c.works.length} ${c.works.length===1?'work':'works'} featuring ${c.name}. `:`${c.name}の作品を現在${c.works.length}件収録しています。`)+(tags?(en?`Common themes include ${tags}. Use these tags to start exploring.`:`よく見られるタグは${tags}です。タグを手がかりに作品をお探しください。`):'');
      for(const link of section.querySelectorAll('.role-type-links a')){
        const type=link.getAttribute('href')?.match(/\/([^/]+)\.html$/)?.[1],count=link.querySelector('small');
        link.textContent=en?c.name+' · '+kind(api,type):c.name+'の'+kind(api,type);if(count)link.appendChild(count);
      }
      const selected=counts.find(([t])=>t.id==='meme')||counts[0];
      const questions=section.querySelectorAll('.reading-faq details');
      if(questions[0]&&selected){
        questions[0].querySelector('summary').textContent=en?'How can I find works featuring '+c.name+'?':c.name+'の作品はどう探せますか？';
        questions[0].querySelector('div').innerHTML='<p>'+escape(en?'Browse by type on this page, or start with ':'このページで作品の種類を絞り込むか、')+'<a class="button small" href="/characters/'+escape(c.character.id)+'/'+escape(selected[0].id)+'.html">'+escape(kind(api,selected[0].id))+'</a>'+escape(en?' and follow the tags to explore.':'から、タグを手がかりにお探しください。')+'</p>';
      }
    }
  }
  const lead=document.querySelector('.page-head .lede');if(lead)lead.textContent=description;
  return {title:c.title+(page?(en?' · Page ':' · ')+page+(en?'':'ページ目'):'')+' | DeepSeek Chan',description};
}
