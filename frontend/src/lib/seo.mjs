// Title/description contract ported from the current site's archived SEO rules.
const kind = {meme:'表情包', illustration:'二创插画',setting:'设定图',comic:'漫画',standing:'立绘',other:'其他作品'};
export function seoContext(work, character, variant='tag') {
 const tags=Array.isArray(work.tags)?work.tags.map(String):[];
 const aliases=Array.isArray(character.aliases)?character.aliases.map(String):[];
 const kindWord=kind[work.categoryIds?.[0]]||'作品';
 return {work,name:String(work.name||''),characterName:String(character.name||work.characterId||''),aliasesJoined:aliases.join('、'),alias1:aliases[0]||'',tags,tagsJoined:tags.join('、'),tagWords:tags.slice(0,2).join('、'),tagQuoteList:tags.slice(0,2).map(t=>`「${t}」`).join(''),kindWord,kindClause:kindWord.startsWith('二创')?kindWord:`二创${kindWord}`,titleVariant:variant};
}
export function seoTitle(ctx) {
 const head=`《${ctx.name}》${ctx.characterName}${ctx.kindWord}`,sep=' - ',tail=' | 蓝色大肥鱼';
 let mid=ctx.titleVariant==='alias'&&ctx.alias1?`${ctx.alias1}表情包`:ctx.tagWords&&ctx.tags[0]?`${ctx.tags[0]} AI娘二创`:'AI娘二创表情包';
 const budget=60-head.length-sep.length-tail.length;
 if(budget<2)return head+tail;
 if(mid.length>budget)mid=mid.slice(0,budget);
 return `${head}${sep}${mid}${tail}`;
}
export function seoDescription(ctx){
 const aliasPart=ctx.aliasesJoined?`（又称${ctx.aliasesJoined}）`:'';
 const topicPart=ctx.tagsJoined?`，主题：${ctx.tagsJoined}`:'';
 const scenePart=ctx.tags[0]?`适合${ctx.tagQuoteList}相关的聊天斗图、日常吐槽场景`:'聊天斗图、日常吐槽都能用';
 const aliasWord=ctx.alias1||'AI娘';
 return `《${ctx.name}》${ctx.characterName}${ctx.kindClause}${aliasPart}${topicPart}。${scenePart}，可查看高清大图、免费下载原图。`+
 `更多${ctx.characterName}表情包、${aliasWord}梗图、AI娘二创同人图、立绘设定与多格漫画，尽在蓝色大肥鱼开放档案。`;
}
