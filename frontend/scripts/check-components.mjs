import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '@astrojs/compiler-rs';
import {filesIn} from './incremental.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const inlineStylePattern=/<style\b|\bstyle\s*=|\.style\b|\[['"]style['"]\]|setAttribute\s*\(\s*['"]style['"]|\b(?:cssText|insertRule|adoptedStyleSheets)\b/i;
export async function pageViolations(source, file) {
  const errors=[];
  const {ast,diagnostics}=parse(source);
  if (diagnostics.some(item=>item.severity==='error')) return [file+': invalid Astro syntax'];
  const components=new Set((ast.frontmatter?.program.body||[]).filter(node=>node.type==='ImportDeclaration' && /\/(components|layouts)\//.test(node.source.value)).flatMap(node=>node.specifiers.map(item=>item.local.name)));
  if((ast.frontmatter?.program.body||[]).some(node=>node.type==='ImportDeclaration' && /\.css(?:\?|$)/.test(node.source.value)))errors.push(file+': CSS imports belong to the owning component');
  function visit(node) {
    if (!node || typeof node!=='object') return;
    if (node.type==='JSXElement') {
      const name=node.openingElement.name.name;
      if (!components.has(name)) errors.push(file+': business markup must be a library component: '+name);
      if (node.openingElement.attributes.some(attr=>attr.type==='JSXSpreadAttribute' || /^(style|class|pageStyles|bodyStyle)(:|$)/.test(typeof attr.name?.name==='string'?attr.name.name:(attr.name?.namespace?.name||'')+':'))) errors.push(file+': use component variants instead of page styles/classes');
    }
    for(const [key,value] of Object.entries(node)) {
      if(key==='frontmatter') continue;
      if(Array.isArray(value)) value.forEach(visit);else if(value && typeof value==='object') visit(value);
    }
  }
  visit(ast);return errors;
}
export async function checkComponents(frontend=root) {
  const catalog=JSON.parse(fs.readFileSync(path.join(frontend,'component-library.json'),'utf8'));
  const owned=name=>catalog.componentRoots.some(dir=>name.startsWith(dir+'/'));
  const errors=[];
  for (const dir of ['src','public']) for(const name of filesIn(path.join(frontend,dir))) {
    const relative=dir+'/'+name;
    if (relative.includes('/vendor/')) continue;
    if (!/\.(astro|mjs|js|css)$/.test(relative)) continue;
    const source=fs.readFileSync(path.join(frontend,relative),'utf8');
    if (/\.(astro|mjs|js)$/.test(relative) && !owned(relative) && inlineStylePattern.test(source)) errors.push(relative+': dynamic or inline styling belongs in the component library');
    if (relative.startsWith('src/pages/') && relative.endsWith('.astro')) errors.push(...await pageViolations(source,relative));
    if (relative.endsWith('.css') && !owned(relative) && relative!=='src/styles/archive.css') {
      const owner=catalog.styleAssets[relative]?.owner;
      if (!owner || !owned(owner) || !fs.existsSync(path.join(frontend,owner))) errors.push(relative+': stylesheet has no registered component owner');
    }
  }
  return errors;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const errors=await checkComponents();
  if (errors.length) {console.error(errors.join('\n'));process.exitCode=1;}
  else console.log('[components] business pages, dynamic styles and stylesheet ownership verified');
}
