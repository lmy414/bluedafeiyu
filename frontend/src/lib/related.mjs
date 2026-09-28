// Deterministic related-work selection, matching the existing generator's order.
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const newest=(a,b)=>{const ta=Date.parse(String(a.createdAt||''))||0,tb=Date.parse(String(b.createdAt||''))||0;return tb-ta||cmp(String(b.slug),String(a.slug))};
function hash32(text){let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}h^=h>>>16;h=Math.imul(h,0x85ebca6b)>>>0;h^=h>>>13;h=Math.imul(h,0xc2b2ae35)>>>0;h^=h>>>16;return h>>>0}
export function relatedWorks(work,works){
 const same=works.filter(x=>x.characterId===work.characterId&&x.slug!==work.slug).sort(newest).slice(0,4);
 const used=new Set([work.slug,...same.map(x=>x.slug)]),tags=new Set(work.tags||[]);
 const common=x=>(x.tags||[]).reduce((n,tag)=>n+(tags.has(tag)?1:0),0);
 const guess=works.filter(x=>x.characterId!==work.characterId&&!used.has(x.slug)&&common(x)>0).sort((a,b)=>common(b)-common(a)||newest(a,b)).slice(0,4);
 if(guess.length<4){const picked=new Set(guess.map(x=>x.slug));const pool=works.filter(x=>!used.has(x.slug)&&!picked.has(x.slug)).sort((a,b)=>hash32(`${work.slug}|${a.slug}`)-hash32(`${work.slug}|${b.slug}`)||cmp(String(a.slug),String(b.slug)));guess.push(...pool.slice(0,4-guess.length))}
 return {same,guess};
}
