import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseHTML} from 'linkedom';

// This is a deliberately narrow, reviewed allowlist. New empty-alt patterns
// fail closed instead of silently being counted as decorative.
export const CONTENT_IMAGE_SELECTOR = '.work-card img,.detail-image img,.comic-sheet img,.video-cover img,[data-video-cover-alt],.preview-photo img,.preview-zoom img,.role-card img,.character-portrait img,.live-character-portrait img,.topic-mosaic img';
function visibleText(node) {
  if (!node || node.hasAttribute('hidden') || node.getAttribute('aria-hidden')==='true') return '';
  const copy=node.cloneNode(true);
  for(const hidden of copy.querySelectorAll('[hidden],[aria-hidden="true"],svg,script,style'))hidden.remove();
  return copy.textContent.trim();
}
function linkName(link) {
  if(!link)return '';
  const labelled=(link.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>visibleText(link.ownerDocument.getElementById(id))).join(' ').trim();
  return labelled || (link.getAttribute('aria-label')||'').trim() || visibleText(link);
}
export function decorativeReason(img) {
  const link=img.closest('a,button');
  const named=(container,title)=>{
    const scope=img.closest(container), label=scope?.querySelector(title);
    const hidden=label?.closest('[hidden],[aria-hidden="true"]');
    // A whole inert slide may later become visible; a hidden title inside its
    // link cannot provide that link's specific title when the slide opens.
    return hidden && scope.contains(hidden) ? '' : visibleText(label);
  };
  if(img.matches('.event-archive-cover[aria-hidden="true"][tabindex="-1"] img'))return 'hidden-repeated-event-cover';
  // An otherwise decorative image must not leave its own control unnamed.
  if(link && !linkName(link))return null;
  if(img.matches('.character-portrait img[src="/avatar.png"]') && !img.closest('[data-cutout]') && !img.parentElement.querySelector('.character-cover-credit'))return 'character-brand-placeholder';
  if(img.matches('.collection-art img') && named('a.collection-card','.collection-copy h2'))return 'named-collection-mosaic';
  if(img.matches('.creator-preview-cover img') && named('a.creator-work-preview','.creator-preview-title'))return 'named-creator-preview';
  if(img.matches('.portal-image-strip img,.portal-video-art img') && named('a.portal-entry','h2'))return 'named-portal-entry';
  if(img.matches('.photo-print img') && named('a.paper-feature','.feature-copy h2'))return 'named-feature-mosaic';
  if(img.matches('.comic-card-cover img') && named('.comic-card a','.comic-card-copy h2'))return 'named-comic-cover';
  if(img.matches('img.creator-avatar') && named('a.video-author','[data-creator-name]'))return 'adjacent-video-author';
  if(img.matches('img.author-avatar') && named('.topic-author','b'))return 'adjacent-topic-author';
  if(img.matches('.avatar[aria-hidden="true"] img')) {
    if(img.closest('a.avatar-link,a.creator-recommendation') && linkName(link))return 'named-author-link';
    if(named('.author-masthead','h1'))return 'adjacent-profile-author';
  }
  return null;
}

// Parse HTML, not a regex: quoted >, entity escapes and template images count.
export function auditImages(html) {
  const {document} = parseHTML(html);
  const result = {images:0, missing:0, empty:0, descriptive:0, decorations:{}, issues:[]};
  function images(root) {
    return [...root.querySelectorAll('img'), ...[...root.querySelectorAll('template')].flatMap(t=>images(t.content))];
  }
  for (const img of images(document)) {
    result.images++;
    if (!img.hasAttribute('alt')) {
      result.missing++;
      result.issues.push({kind:'missing',src:img.getAttribute('src')});
    } else if (!img.getAttribute('alt').trim()) {
      result.empty++;
      const reason=decorativeReason(img);
      if(reason && (!img.matches(CONTENT_IMAGE_SELECTOR) || reason==='character-brand-placeholder'))result.decorations[reason]=(result.decorations[reason]||0)+1;
      else {
        const kind=img.matches(CONTENT_IMAGE_SELECTOR)?'empty-content':img.closest('a,button')&&!linkName(img.closest('a,button'))?'empty-image-control':'unreviewed-empty';
        result.issues.push({kind,src:img.getAttribute('src')});
      }
    } else result.descriptive++;
  }
  return result;
}
export function auditSite(root) {
  const result = {pages:0,images:0,missing:0,empty:0,descriptive:0,decorations:{},locales:{},issues:[]};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const filename=path.join(dir,entry.name);
      if(entry.isDirectory())walk(filename);
      else if(entry.name.endsWith('.html')) {
        const relative=path.relative(root,filename).split(path.sep).join('/');
        const locale=relative.match(/^(en|ja|zh-hant)\//)?.[1]||'zh';
        const audit=auditImages(fs.readFileSync(filename,'utf8'));
        const counts=result.locales[locale] ||= {pages:0,images:0,missing:0,empty:0,descriptive:0};
        result.pages++; counts.pages++;
        for(const key of ['images','missing','empty','descriptive']){result[key]+=audit[key];counts[key]+=audit[key];}
        for(const [reason,count] of Object.entries(audit.decorations))result.decorations[reason]=(result.decorations[reason]||0)+count;
        result.issues.push(...audit.issues.map(issue=>({page:relative,...issue})));
      }
    }
  }
  walk(root);
  if(!result.pages)throw Error('No HTML pages found: '+root);
  return result;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw Error('Usage: node frontend/scripts/audit-image-alt.mjs <build directory>');
  const result=auditSite(path.resolve(process.argv[2]));
  console.log(JSON.stringify(result,null,2));
  if(result.issues.length)process.exitCode=1;
}
