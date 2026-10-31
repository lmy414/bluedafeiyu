import {Converter} from 'opencc-js/t2cn';

// Shared by archive and search pages. All text stays in the browser; no search API.
const simplify = Converter({from:'twp',to:'cn'});
export const normalizeSearchText = value => simplify(String(value ?? '').normalize('NFKC'))
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');

// A small, explicit spelling/wording dictionary, rather than inferred semantics.
const equivalents = [ ['摸头','摸摸头'], ['拥抱','抱抱'], ['上班','打工'] ];
const alternatives = new Map(equivalents.flatMap(group=>group.map(word=>[word,group])));
const particles = new Set(['的','了','着','在','是','一个','一只','the','a','an','of','and','with']);
const wordSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh',{granularity:'word'}) : null;
const segment = text => wordSegmenter ? [...wordSegmenter.segment(text)].filter(s=>s.isWordLike).map(s=>s.segment) : text.split(' ');

function grams(text) {
  const chars = [...text];
  return chars.length < 2 ? chars : [...new Set(chars.slice(1).map((char,i)=>chars[i]+char))];
}
function add(map,key,value) {
  if(!map.has(key))map.set(key,new Set());
  map.get(key).add(value);
}
function intersect(sets) {
  if(!sets.length || sets.some(set=>!set?.size))return new Set();
  const ordered = [...sets].sort((a,b)=>a.size-b.size);
  return new Set([...ordered[0]].filter(id=>ordered.every(set=>set.has(id))));
}
function signatures(word) {
  return [word,...[...word].map((_,i)=>word.slice(0,i)+word.slice(i+1))];
}
// One insertion, deletion, substitution or adjacent transposition; Latin words only.
function oneEditApart(a,b) {
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0;
  while(i<a.length && a[i]===b[i])i++;
  if(i===a.length)return b.length-a.length===1;
  if(a.length===b.length)return a.slice(i+1)===b.slice(i+1) ||
    (a[i]===b[i+1] && a[i+1]===b[i] && a.slice(i+2)===b.slice(i+2));
  return a.length>b.length ? a.slice(i+1)===b.slice(i) : a.slice(i)===b.slice(i+1);
}

export function createSearchIndex(works,characters=[],{characterName=(_id,name)=>name}={}) {
  const byCharacter = new Map(characters.map(c=>[c.id,[c.id,c.name,characterName(c.id,c.name),...(c.aliases||[])]]));
  const postings = new Map(), fuzzyWords = new Map(), vocabulary = new Set(), textCache = new Map();
  const fold = value => {
    const text = String(value ?? '');
    if(!textCache.has(text))textCache.set(text,normalizeSearchText(text));
    return textCache.get(text);
  };
  const documents = works.map((work,id)=>{
    const fields = [], seenFields = new Set();
    const field = (values,weight) => {
      for(const value of values) {
        const text=fold(value),key=weight+'\n'+text;
        if(text&&!seenFields.has(key)){fields.push({text,weight});seenFields.add(key);}
      }
    };
    field([work.n],10);
    field(work.tg||[],9);
    field([work.sa,work.a,...(work.owners||[]).map(owner=>owner.name)],8);
    field([work.c,...(work.roles||[]).map(role=>role.name),...(work.cids||[work.cid]).flatMap(cid=>byCharacter.get(cid)||[])],8);
    field([work.d],4);
    field([work.cm],2);
    for(const translation of Object.values(work.i18n||{})) {
      field([translation.name],10); field(translation.tags||[],9);
      field([translation.description],4); field([translation.commentary],2);
    }
    const keys = new Set();
    for(const {text} of fields) {
      for(const chunk of text.split(' ')) {
        for(const char of chunk)keys.add(char);
        for(const gram of grams(chunk))keys.add(gram);
      }
      for(const word of text.match(/[a-z][a-z0-9]{3,31}/g)||[])vocabulary.add(word);
    }
    for(const key of keys)add(postings,key,id);
    return {work,fields};
  });
  // Deletion signatures narrow typo lookup without comparing against every work.
  for(const word of vocabulary)for(const signature of signatures(word))add(fuzzyWords,signature,word);
  textCache.clear();
  const literalCache = new Map(), queryCache = new Map();
  function literal(term) {
    if(literalCache.has(term))return literalCache.get(term);
    const ids = intersect(term.split(' ').flatMap(grams).map(gram=>postings.get(gram)));
    const matches = new Map();
    for(const id of ids) {
      let score=0;
      for(const {text,weight} of documents[id].fields) {
        if(text.includes(term))score=Math.max(score,weight*(text===term?2:1));
      }
      if(score)matches.set(id,score);
    }
    if(literalCache.size>=256)literalCache.delete(literalCache.keys().next().value);
    literalCache.set(term,matches);
    return matches;
  }
  function match(term) {
    const matches = new Map();
    for(const variant of alternatives.get(term)||[term]) {
      for(const [id,score] of literal(variant))matches.set(id,Math.max(matches.get(id)||0,score*(variant===term?1:0.7)));
    }
    if(/^[a-z][a-z0-9]{3,31}$/.test(term)) {
      const nearby = new Set(signatures(term).flatMap(key=>[...fuzzyWords.get(key)||[]]));
      for(const word of nearby)if(word!==term && oneEditApart(term,word)) {
        for(const [id,score] of literal(word))matches.set(id,Math.max(matches.get(id)||0,score*0.4));
      }
    }
    return matches;
  }
  return {
    search(query) {
      const text=normalizeSearchText(query);
      if(queryCache.has(text))return queryCache.get(text);
      let terms=[...new Set(text.split(' ').filter(Boolean).flatMap(chunk=>alternatives.has(chunk)?[chunk]:segment(chunk)))];
      const meaningful=terms.filter(term=>!particles.has(term));
      if(meaningful.length)terms=meaningful;
      const groups=terms.map(match);
      const ids=intersect(groups.map(group=>new Set(group.keys())));
      const phrase=literal(text);
      // Exact phrases always survive tokenization, including punctuation and aliases.
      for(const id of phrase.keys())ids.add(id);
      const ranked=[...ids].map(id=>({id,score:groups.reduce((sum,group)=>sum+(group.get(id)||0),0)+(phrase.has(id)?80+phrase.get(id)*2:0)}))
        .sort((a,b)=>b.score-a.score||a.id-b.id);
      const result=new Map(ranked.map(({id,score})=>[documents[id].work.id,score]));
      if(queryCache.size>=32)queryCache.delete(queryCache.keys().next().value);
      queryCache.set(text,result);
      return result;
    }
  };
}
