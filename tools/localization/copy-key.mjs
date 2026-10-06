// Count placeholders keep reusable page copy stable as the archive grows.
export function copyKey(text) { let n=0;return String(text).trim().replace(/\d+(?:[.,]\d+)*/g,()=>'{n'+n+++'}'); }
export function renderCopy(template, source) {const numbers=String(source).match(/\d+(?:[.,]\d+)*/g)||[];return template.replace(/\{n(\d+)\}/g,(_,i)=>numbers[i]??'');}
