import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createSearchIndex,normalizeSearchText} from '../public/archive/search.js';
import {createListing} from '../src/components/archive/Listing.mjs';
import {createSearchPage} from '../src/components/archive/SearchPage.mjs';
import {parseHTML} from 'linkedom';
import {clientArchiveData} from '../src/lib/client-data.mjs';

const work=(id,fields={})=>({id,slug:id,n:'普通作品',d:'',cm:'',tg:[],c:'',cids:[],roles:[],...fields});
const ids=(index,query)=>[...index.search(query).keys()];

test('search finds descriptions and archive notes, with all keywords required across fields',()=>{
  const index=createSearchIndex([
    work('description',{d:'蓝发女孩站在海边，远处升起烟花。'}),
    work('commentary',{cm:'这烟花放得我又想去海边摸鱼了。'}),
    work('split',{n:'海边假日',tg:['烟花']}),
    work('unrelated',{n:'海边假日',cm:'今天想睡觉。'})
  ]);
  assert.deepEqual(new Set(ids(index,'海边 烟花')),new Set(['description','commentary','split']));
  assert.deepEqual(ids(index,'睡觉'),['unrelated']);
  assert.deepEqual(ids(index,'海边 火山'),[]);
});

test('creator names and displayed credits remain searchable without unrelated authors matching',()=>{
  const index=createSearchIndex([
    work('creator',{n:'Reference sheet',sa:'Ninon',a:'',k:['setting']}),
    work('credit',{n:'Portrait',sa:'ZipZipPipe',a:'Archive Credit',k:['standing']}),
    work('collection',{owners:[{name:'Community Artist'}],k:['illustration']})
  ]);
  assert.deepEqual(ids(index,'Ninon'),['creator']);
  assert.deepEqual(ids(index,'ZipZipPipe'),['credit']);
  assert.deepEqual(ids(index,'Archive Credit'),['credit']);
  assert.deepEqual(ids(index,'Community Artist'),['collection']);
  assert.deepEqual(ids(index,'Unrelated Author'),[]);
  assert.deepEqual(ids(index,'Ninon reference'),['creator']);
  assert.deepEqual(ids(index,'Ninon portrait'),[]);
});

test('production locale catalogs feed named submission credits and origin creators into the shared index',()=>{
  const translations={en:{name:'Reference',description:'Design sheet',commentary:'',tags:[]},ja:{name:'設定画',description:'デザイン',commentary:'',tags:[]}};
  const data={works:[
    work('submission',{n:'Reference',a:'Ninon',sa:'',i18n:translations}),
    work('origin',{n:'Portrait',a:'',sa:'ZipZipPipe',i18n:translations}),
    work('unrelated',{n:'Landscape',a:'Another Credit',sa:'Another Creator',i18n:translations})
  ]};
  for(const locale of ['zh','en','ja']){
    const catalog=JSON.parse(JSON.stringify(clientArchiveData(data,locale)));
    const index=createSearchIndex(catalog.works);
    assert.deepEqual(ids(index,'Ninon'),['submission'],locale);
    assert.deepEqual(ids(index,'ZipZipPipe'),['origin'],locale);
    assert.deepEqual(ids(index,'Ninon reference'),['submission'],locale);
    assert.deepEqual(ids(index,'Ninon landscape'),[],locale);
    assert.deepEqual(ids(index,'Unrelated Artist'),[],locale);
  }
});

test('Chinese words do not require spaces or contiguous matching',()=>{
  const index=createSearchIndex([
    work('split',{d:'一位蓝发女孩，穿着女仆装。'}),
    work('other',{d:'一位蓝发女孩，穿着校服。'})
  ]);
  assert.deepEqual(ids(index,'蓝发女仆'),['split']);
  assert.deepEqual(ids(index,'蓝发的女仆'),['split']);
});

test('literal phrases rank first and titles/tags outrank descriptions and playful notes',()=>{
  const index=createSearchIndex([
    work('note',{cm:'今天也要加油'}),work('description',{d:'今天也要加油'}),
    work('tag',{tg:['加油']}),work('title',{n:'加油'}),
    work('scattered',{n:'蓝色',d:'女仆拿着信封。'}),
    work('phrase',{d:'这是蓝色女仆的画像。'})
  ]);
  assert.deepEqual(ids(index,'加油'),['title','tag','description','note']);
  assert.equal(ids(index,'蓝色女仆')[0],'phrase');
});

test('normalization handles Traditional Chinese, full-width text, case and punctuation',()=>{
  const index=createSearchIndex([work('match',{d:'蓝发女仆',tg:['DeepSeek']})]);
  assert.deepEqual(ids(index,'藍髮，女僕！ＤｅｅｐＳｅｅｋ'),['match']);
  assert.equal(normalizeSearchText(' ＣＬＡＵＤＥ　抱抱！ '),'claude 抱抱');
});

test('every character and alias is searchable, including secondary characters',()=>{
  const index=createSearchIndex([work('shared',{cids:['deepseek','claude']})],[
    {id:'deepseek',name:'DeepSeek娘',aliases:['蓝色大肥鱼']},
    {id:'claude',name:'Claude娘',aliases:['克劳德']}
  ]);
  assert.deepEqual(ids(index,'克劳德'),['shared']);
  assert.deepEqual(ids(index,'大肥鱼 Claude'),['shared']);
  const localized=createSearchIndex([work('shared',{cids:['deepseek']})],[{id:'deepseek',name:'肥鱼',aliases:[]}],{characterName:()=> 'Whale Girl'});
  assert.deepEqual(ids(localized,'Whale Girl'),['shared']);
});

test('a small wording dictionary supports common keywords without inferring meanings',()=>{
  const index=createSearchIndex([
    work('pat',{tg:['摸摸头']}),work('work',{cm:'今天不想打工。'}),work('other',{d:'在办公室睡觉。'})
  ]);
  assert.deepEqual(ids(index,'摸头'),['pat']);
  assert.deepEqual(ids(index,'上班'),['work']);
  assert.deepEqual(ids(index,'放假'),[]);
});

test('Latin typo tolerance accepts one edit but keeps exact matches ahead',()=>{
  const index=createSearchIndex([
    work('typo',{tg:['Claude']}),work('exact',{tg:['Cluade']}),
    work('short',{tg:['AI']}),work('far',{tg:['Clouds']})
  ]);
  assert.deepEqual(ids(index,'cluade'),['exact','typo']);
  assert.ok(ids(index,'claudee').includes('typo'));
  assert.ok(ids(index,'cloude').includes('typo'));
  assert.deepEqual(ids(index,'aj'),[]);
  assert.deepEqual(ids(index,'cxxude'),[]);
});

test('localized titles, descriptions, tags and notes remain searchable alongside Chinese',()=>{
  const index=createSearchIndex([work('translated',{n:'晚安',i18n:{
    en:{name:'Good night',description:'A blue maid',commentary:'Time for a nap',tags:['Sleep']},
    ja:{name:'おやすみ',description:'青い髪',commentary:'仕事は明日',tags:['眠い']}
  }})]);
  for(const query of ['晚安','good night','blue maid','nap','sleep','おやすみ','仕事'])assert.deepEqual(ids(index,query),['translated'],query);
});

test('empty queries do not match everything and one-character queries stay literal',()=>{
  const index=createSearchIndex([work('cat',{d:'猫在睡觉'}),work('fish',{d:'鱼在睡觉'})]);
  for(const query of ['','   ','！？'])assert.deepEqual(ids(index,query),[]);
  assert.deepEqual(ids(index,'猫'),['cat']);
});

test('browsers without Intl.Segmenter retain phrase, spaced keyword and typo search',()=>{
  const moduleURL=new URL('../public/archive/search.js',import.meta.url).href;
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    Intl.Segmenter=undefined;
    const {createSearchIndex}=await import(${JSON.stringify(moduleURL)});
    const index=createSearchIndex([{id:'a',n:'蓝发女仆 Claude',d:'海边',cm:'烟花'}]);
    for(const query of ['蓝发女仆','海边 烟花','Cluade'])if(!index.search(query).has('a'))throw Error(query);
  `],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('the search page defaults to relevance while gallery ordering stays unchanged',()=>{
  const ctx={works:[],chars:[],types:[],esc:String,tr:(_key,zh)=>zh,old:(_key,zh)=>zh,icon:()=>''};
  const {filters}=createListing(ctx);
  assert.equal(parseHTML(filters()).document.querySelector('option[value=relevance]'),null);
  let page;
  createSearchPage({...ctx,filters,translations:{en:{},ja:{}},tagLink:String,roleCard:()=>'',commonTags:[],pageHead:()=>'',sectionHead:()=>'',write:(_url,_title,_active,content,options)=>{page={content,options};}});
  const {document}=parseHTML(page.content);
  assert.equal(document.querySelector('select[name=sort] option').getAttribute('value'),'relevance');
  assert.match(page.options.attrs,/data-sort="relevance"/);
  assert.ok(document.querySelector('option[value=latest]'));
  assert.ok(document.querySelector('option[value=random]'));
});
