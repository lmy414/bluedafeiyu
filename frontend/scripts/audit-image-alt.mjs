import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseHTML} from 'linkedom';

// Parse HTML, not a regex: quoted >, entity escapes and template images count.
export function auditImages(html) {
  const {document} = parseHTML(html);
  const result = {images:0, missing:0, empty:0, descriptive:0, issues:[]};
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
      // These content images cannot be decorative. Empty avatars and collection
      // mosaics remain valid when the surrounding link already names its target.
      if (img.matches('.work-card img,.detail-image img,.comic-sheet img,.video-cover img,[data-video-cover-alt]')) {
        result.issues.push({kind:'empty-content',src:img.getAttribute('src')});
      }
    } else result.descriptive++;
  }
  return result;
}
export function auditSite(root) {
  const result = {pages:0,images:0,missing:0,empty:0,descriptive:0,locales:{},issues:[]};
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
