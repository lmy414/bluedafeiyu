import {homeDownloadSection} from './HomeDownloads.mjs';
import {videoCoverAttributes} from './video-cover.mjs';
import { parseHTML } from 'linkedom';
import { videoArchive } from '../../lib/video-archive.mjs';
import {archiveCreators} from '../../lib/creators.mjs';
import {createCreatorViews} from './CreatorViews.mjs';
import {renderPageHeading} from './PageHeading.mjs';

// The reviewed Demo's composition, populated exclusively from the production archive.
export function createDemoPages(ctx, pages) {
  const {works,galleryWorks,chars,topics,esc:e,tr,icon,button,pageHead,write,card,grid}=ctx;
  const t=(key,zh,en,ja)=>tr('design.'+key,zh,en,ja);
  const img=(w,priority=false)=>`<img src="${e(w.i)}" width="${w.w}" height="${w.h}" alt="" ${priority?'loading="eager" fetchpriority="high"':'loading="lazy"'}>`;
  const labels={pictures:t('pictures','图片图库','Image archive','画像アーカイブ'),videos:t('videos','视频作品','Videos','動画'),characters:t('characters','角色图鉴','Characters','キャラクター図鑑'),topics:t('topics','主题合集','Collections','コレクション'),creators:t('creators','创作者合集','Creators','クリエイター')};
  const entry=(href,title,desc,ic,meta,art,cls)=>`<a href="${href}" class="portal-entry ${cls}"><div class="portal-entry-top"><span class="portal-entry-icon">${icon(ic,23)}</span><span class="portal-entry-meta">${meta}</span>${icon('arrow',19)}</div><h2>${title}</h2><p>${desc}</p>${art}</a>`;
  const v=videoArchive.videos[0];
  const ordered=archiveCreators(topics);
  const {creatorCard}=createCreatorViews(ctx,ordered);
  const featured=topics.slice(0,3);
  const latestStrip=`<section class="home-latest"><div class="home-latest-head"><h2>${t('latestWorks','最新作品','Latest works','最新の作品')}</h2><a class="home-latest-more" href="/browse.html">${t('latestAll','全部图片','Browse all pictures','すべての画像')}${icon('arrow',14)}</a></div>${grid(galleryWorks.slice(0,12),'',2)}</section>`;
  write('/index.html','蓝色大肥鱼','home',`<header class="portal-heading"><div><p class="eyebrow">AI GIRL ARCHIVE</p><h1>${t('welcome','蓝色大肥鱼 · DeepSeek娘（大肥鱼）表情包与二创档案','Blue Dafeiyu · DeepSeek Chan Memes & AI Girl Fan Art','藍色大肥魚 · DeepSeekちゃんのスタンプと二次創作アーカイブ')}</h1><p>${t('lead','蓝色大肥鱼 · AI 娘的图片、影像与角色档案。','Blue Dafeiyu · Images, videos and character archives of AI girls.','藍色大肥魚 · AI娘の画像、映像、キャラクターアーカイブ。')}</p><div class="portal-welcome-actions">${button('/browse.html',labels.pictures+icon('arrow',16),'primary')}${button('/serials.html',tr('archiveSerials','连载','Series','連載')+icon('arrow',16))}${button('/community.html',t('join','加入社群','Join the community','コミュニティに参加'))}</div></div><div class="portal-edition"><span>${t('collect','一起收好有趣的创作','Keep delightful creations together','楽しい作品を、一緒に集めよう')}</span><dl>${[[labels.pictures,works.length],[labels.characters,chars.length],[labels.topics,topics.length]].map(([l,n])=>`<div><dt>${l}</dt><dd>${n}</dd></div>`).join('')}</dl><small>${t('copyright','作品版权归原作者所有','Works belong to their creators','作品の権利は原作者に帰属します')}</small></div></header><nav class="portal-primary">${entry('/browse.html',labels.pictures,t('pictureLead','表情包、插画、立绘与漫画。','Memes, illustrations, character art and comics.','ミーム、イラスト、立ち絵、漫画。'),'image',String(works.length),`<div class="portal-image-strip">${galleryWorks.slice(0,3).map((w,i)=>img(w,i===0)).join('')}</div>`,'portal-images')}${entry('/videos.html',labels.videos,t('videoLead','发现影像创作，前往原平台观看。','Discover videos and watch on the original platform.','映像作品を見つけて、元のプラットフォームで楽しもう。'),'image',String(videoArchive.videos.length),v?`<div class="portal-video-art"><img ${videoCoverAttributes(v.cover,e)} width="480" height="270" alt=""><span>▶</span></div>`:'','portal-videos')}</nav>${latestStrip}${homeDownloadSection(ctx)}<nav class="portal-secondary">${[['/characters.html',labels.characters,'roles',chars.length],['/topics.html',labels.topics,'book',topics.length],['/creators.html',labels.creators,'roles',ordered.length]].map(([href,l,ic,n])=>`<a href="${href}">${icon(ic,24)}<span><h2>${l}</h2></span><small>${n}</small>${icon('arrow',16)}</a>`).join('')}</nav><section class="portal-curated"><div class="live-topic-slider portal-topic-slider" data-design-slider>${featured.map((topic,i)=>`<article class="live-topic-slide" data-design-slide ${i?'hidden':''}><a class="paper-feature" href="/topics/${e(topic.id)}.html"><div class="feature-copy"><p class="eyebrow">COLLECTION</p><h2>${e(topic.name)}</h2><p>${e(topic.summary)}</p><span class="portal-topic-link">${labels.topics} ${icon('arrow',15)}</span></div><div class="feature-prints">${topic.art.map((w,j)=>`<figure class="photo-print photo-${j}">${img(w)}</figure>`).join('')}</div></a></article>`).join('')}<div class="live-topic-controls">${featured.map((topic,i)=>`<button type="button" class="live-topic-dot ${i?'':'is-active'}" data-design-dot="${i}" aria-label="${e(topic.name)}" aria-pressed="${i===0}">${String(i+1).padStart(2,'0')}</button>`).join('')}</div></div></section><nav class="portal-participate">${[['/events.html',t('events','活动与共创','Events & collaboration','イベントと共同制作'),'spark'],['/community.html',t('community','加入社群','Join the community','コミュニティに参加'),'roles'],['/submit.html',t('submit','分享作品','Share your work','作品を投稿'),'upload']].map(([href,l,ic])=>`<a href="${href}">${icon(ic,20)}<span><b>${l}</b></span>${icon('arrow',16)}</a>`).join('')}</nav>`);
  const creatorCards=ordered.map(creatorCard).join('');
  write('/creators.html','创作者合集','creators',`${pageHead('CREATORS',labels.creators,t('creatorLead','横向翻阅作品，或进入作者的完整作品集。','Browse each creator’s work or open their full archive.','作品を横にめくり、作者のアーカイブへ。'))}<aside class="registration-entry"><div><b>${t('registerQuestion','你也在创作 AI 娘视频？','Creating AI girl videos?','AI娘の動画を制作していますか？')}</b><p>${tr('videoReleaseRegister','填写 Bilibili UID 或主页链接和一句话说明，即可加入同步队列。','Join the sync queue with a Bilibili UID or profile URL and a short introduction.','Bilibili UID またはプロフィール URL と短い紹介文で同期待ちに追加できます。')}</p></div>${button('/submit.html?media=video#creator-registration',t('register','视频作者登记','Register as a video creator','動画クリエイター登録')+icon('arrow',14))}<small>${tr('videoPlatformOnly','当前仅开放 Bilibili','Bilibili only','Bilibili のみ')}</small></aside><form class="creator-directory-tools" data-design-creator-search><label class="creator-directory-search">${icon('search',18)}<span>${t('findCreator','找作者或作品','Find creators or works','作者・作品を検索')}</span><input type="search" name="q" aria-label="Search" autocomplete="off"></label><label class="creator-sort">${tr('sortFilter','排序','Sort','並び順')}<select name="sort"><option value="name">${t('creatorName','作者名称','Creator name','作者名')}</option><option value="latest">${t('creatorLatest','最近作品','Recent work','最近の作品')}</option></select></label></form><div class="directory-results"><span><span data-design-creator-count>${ordered.length}</span> ${t('creatorUnit','位创作者','creators','人の作者')}</span></div><div class="creator-directory-grid" data-design-creators>${creatorCards}</div><div class="empty-state" data-creator-empty hidden><h2>${tr('creatorNoMatch','没有找到对应作者或作品','No matching creators or works','該当する作者や作品がありません')}</h2><p>${tr('creatorTryAgain','试试作者名称、作品标题或其他关键词。','Try a creator name, a work title or another keyword.','作者名、作品名、別のキーワードをお試しください。')}</p></div>`);
  for(const [url,p] of pages){
    if(url==='/community.html'||url==='/projects.html')p.content=decorateDocument(p.content,url.includes('community')?'community':url.includes('projects')?'projects':'events',ctx);
    if(url==='/characters.html')p.content=p.content.replace('class="role-grid"','class="role-grid character-grid character-index-grid"').replaceAll('class="role-card"','class="role-card character-card"').replaceAll('class="role-art"','class="role-art character-art"').replaceAll('class="role-body"','class="role-body character-copy"');
    if(url.startsWith('/characters/'))p.content=p.content.replace('class="character-hero"','class="character-hero live-character-header"').replace('class="character-portrait"','class="character-portrait live-character-portrait"');
    if(/^\/characters\/[^/]+\.html$/.test(url)){
      const {document}=parseHTML('<html><body>'+p.content+'</body></html>');
      const hero=document.querySelector('.character-hero');
      if(hero){
        const character=chars.find(c=>url==='/characters/'+c.id+'.html');
        hero.querySelector('h1 small')?.remove();
        hero.querySelector('.character-portrait')?.classList.remove('character-portrait');
        const facts=hero.querySelector('.character-facts');
        if(facts&&character){facts.className='live-character-facts';facts.innerHTML=`<span><b>${character.list.length}</b> ${t('characterWorks','件作品','works','作品')}</span><span><b>${new Set(character.list.flatMap(w=>w.k)).size}</b> ${t('characterKinds','种作品类型','types','種類')}</span>`;}
        const details=document.createElement('details');details.className='character-introduction';
        details.innerHTML=`<summary>${t('characterIntroduction','角色介绍与收录说明','Character introduction and archive notes','キャラクター紹介と収録について')}${icon('chevron',13)}</summary>`;
        const info=document.createElement('div');info.className='character-info';details.append(info);
        for(const node of [...hero.querySelectorAll('.model-vendor,.lede,.tags,.source-note')]){
          if(character?.id==='deepseek'&&node.matches('.lede'))continue;
          info.append(node);
        }
        const reading=document.querySelector('.role-reading');if(reading)details.append(reading);
        hero.after(details);
        const highlights=[...document.body.children].find(node=>node.matches('.section')&&!node.id&&node.querySelector('.work-grid'));
        if(highlights)highlights.remove();
        const linked=[...document.body.children].find(node=>node.matches('.section')&&!node.id&&node.querySelector('.collection-grid'));
        const all=document.querySelector('#all-works');if(linked&&all)all.after(linked);
        p.content=document.body.innerHTML;
      }
    }
    if(url.startsWith('/works/'))p.transformContent(content=>content.replace('class="detail-info"','class="detail-info work-information"').replace('class="detail-image"','class="detail-image work-stage"'));
    if(url.startsWith('/creators/'))p.content=p.content.replace('class="page-head"','class="page-head author-header"');
  }
}

export function decorateDocument(html,key,ctx) {
  const {document}=parseHTML('<html><body>'+html+'</body></html>');
  const body=document.body;
  const tr=(k,z,en,ja)=>ctx?.tr('design.'+k,z,en,ja)||z;
  const icon=name=>ctx?.icon(name,17)||'';
  const element=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
  for(const node of body.querySelectorAll('[class]'))for(const cls of [...node.classList])if(!cls.startsWith('live-')&&!cls.startsWith('friend-wall-'))node.classList.add('live-'+cls);

  if(key==='community'){
    const grid=body.querySelector('.live-info-grid');
    if(grid?.children.length===3){
      const [submission,activity,feedback]=[...grid.children];
      submission.insertAdjacentHTML('afterbegin','<span class="participation-number" aria-hidden="true">01</span>');
      submission.insertAdjacentHTML('beforeend',`<a class="community-entry-link" href="/submit.html">${tr('imageSubmitLink','图片作品投稿 →','Submit an image →','画像作品を投稿 →')}</a>`);
      const video=element('section','live-info-card');
      video.innerHTML=`<span class="participation-number" aria-hidden="true">02</span><h2>${tr('register','视频作者登记','Register as a video creator','動画クリエイター登録')}</h2><p>${tr('registrationLead','填写 UID 或主页链接和一句话说明，通过审核的 AI 娘二创视频自动收录。','Add your UID or profile URL and a short introduction. Approved AI-girl fan videos are published automatically.','UIDまたはプロフィールURLと紹介文を登録。審査を通過したAI娘の二次創作動画が自動公開されます。')}</p><a class="community-entry-link" href="/submit.html?media=video#creator-registration">${tr('start','开始登记 →','Register →','登録する →')}</a>`;
      feedback.insertAdjacentHTML('afterbegin','<span class="participation-number" aria-hidden="true">03</span>');
      const join=body.querySelector('.live-community-hero a')?.getAttribute('href');
      if(join)feedback.insertAdjacentHTML('beforeend',`<a class="community-entry-link" href="${ctx?.esc(join)||join}">${tr('joinCommunity','加入交流群 →','Join the community →','コミュニティに参加 →')}</a>`);
      const heading=element('h2','community-section-title');heading.innerHTML=tr('participationTitle','一起参与，让档案更完整。','Help the archive grow.','一緒にアーカイブを育てよう。');grid.before(heading);
      grid.replaceChildren(submission,video,feedback);activity.className='community-activity';grid.after(activity);
    }
  }
  if(key==='about'){
    const columns=body.querySelector('.live-about-columns');
    const main=body.querySelector('.live-about-main');
    const heading=body.querySelector('#what-is-blue-dafeiyu');
    if(heading)heading.innerHTML=tr('originName','名字的由来','Where the name comes from','名前の由来');
    if(columns&&main){
      let section,index=0;
      for(const node of [...main.children]){
        if(node.tagName==='H2'){
          if(!node.id)node.id='about-section-'+(++index);
          section=element('section','reading-section');main.insertBefore(section,node);section.append(node);
        }else if(section&&node.tagName!=='SECTION')section.append(node);
        else section=null;
      }
      const community=element('section','about-community');
      for(const node of [...columns.children])if(node!==main)community.append(node);
      columns.replaceWith(main);main.after(community);
    }
  }
  if(key==='events'){
    const hero=body.querySelector('.event-hero');
    if(hero){hero.className='designed-event-hero';const figure=hero.querySelector('figure');if(figure)hero.append(figure);}
  }

  const originalHeading=body.querySelector('.page-head');
  const title=originalHeading?.querySelector('h1') || body.querySelector('h1');
  const description=originalHeading?.querySelector('.lede,.live-lede') ||
    (title?.nextElementSibling?.matches('.lede,.live-lede') ? title.nextElementSibling : null);
  // Preserve translation and anchor attributes when moving the introductory copy.
  const inlineCopy=node=>{
    if(!node)return '';
    const span=document.createElement('span');
    for(const attr of node.attributes)if(attr.name!=='class')span.setAttribute(attr.name,attr.value);
    span.innerHTML=node.innerHTML;
    node.remove();
    return span.outerHTML;
  };
  const heading=renderPageHeading({
    eyebrow:tr('siteCommunity','站点与社区','SITE & COMMUNITY','サイトとコミュニティ'),
    title:inlineCopy(title),
    description:inlineCopy(description)
  });
  originalHeading?.remove();
  for(const node of body.querySelectorAll('[class]'))for(const cls of [...node.classList])if(!cls.startsWith('live-')&&node.classList.contains('live-'+cls))node.classList.remove(cls);
  const nav=[['community','社群','Community','コミュニティ','roles'],['about','关于与版权','About & copyright','このサイトについて','book'],['events','活动','Events','イベント','spark'],['projects','友情链接','Friend links','リンク集','link'],['changelog','更新日志','Changelog','更新履歴','pin']];
  return `${heading}<nav class="document-sections section-tabs" aria-label="站点与社区" data-i18n-attr="aria-label:d.design.siteCommunity">${nav.map(([id,z,en,ja,ic])=>`<a href="/${id}.html" ${id.startsWith(key)?'aria-current="page" class="is-active"':''}>${icon(ic)}${tr('doc.'+id,z,en,ja)}</a>`).join('')}</nav><div class="document-layout"><div class="document-reader"><article class="synced-prose" data-live-document="${key}">${body.innerHTML}</article></div></div>`;
}
