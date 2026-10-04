import fs from 'node:fs';
import path from 'node:path';
import { site as snapshot } from './site.mjs';
import { overlayData } from './v2.mjs';
import { createPrimitives } from '../components/archive/primitives.mjs';
import { createSEO } from './archive-seo.mjs';
import {createWorkCards} from "../components/archive/WorkCards.mjs";
import {createCollectionCards} from "../components/archive/CollectionCards.mjs";
import {createCharacterCards} from "../components/archive/CharacterCards.mjs";
import {createListing} from "../components/archive/Listing.mjs";
import {createDiscovery} from "../components/archive/Discovery.mjs";
import {createBrowsePages} from "../components/archive/BrowsePages.mjs";
import {createCharacterPages} from "../components/archive/CharacterPages.mjs";
import {createCollectionPages} from "../components/archive/CollectionPages.mjs";
import {createWorkPages} from "../components/archive/WorkPages.mjs";
import {createSearchPage} from "../components/archive/SearchPage.mjs";
import {createCommunityPage} from "../components/archive/CommunityPage.mjs";
import {createEventPage} from "../components/archive/EventPage.mjs";
import {createUtilityPages} from "../components/archive/UtilityPages.mjs";
const root = process.env.SITE_SOURCE || path.resolve(process.cwd(), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/data', name), 'utf8'));
const works = Object.entries(overlayData()).map(([slug,w])=>({...w,slug}));
const bySlug = new Map(works.map(w=>[w.slug,w])), byId = new Map(works.map(w=>[w.id,w]));
const types = snapshot.categories.filter(t=>t.status==='active');
const chars = snapshot.characters.filter(c=>c.status==='active').map(c=>({...c,list:works.filter(w=>w.cid===c.id)})).filter(c=>c.list.length).sort((a,b)=>b.list.length-a.list.length);
const topics = snapshot.topics.filter(t=>t.status!=='removed').map(t=>({...t,list:t.workIds.map(id=>byId.get(id)).filter(Boolean),eyebrow:t.author?'作者作品集':'主题合集'}));
const tagCounts=new Map();for(const w of works)for(const tag of w.tg)tagCounts.set(tag,(tagCounts.get(tag)||0)+1);
const translations={en:{},ja:{}};
for(const [key, en, ja] of [
  ['discover','Discover','見つける'],['gallery','All works','作品一覧'],['brandSub','AI-girl fan art archive','AI娘の二次創作アーカイブ'],
  ['explore','EXPLORE','ブラウズ'],['sideText','A home for every delightful image.','楽しい一枚を、大切に。'],['nonOfficial','Unofficial fan archive','非公式ファンアーカイブ'],
  ['footerText','AI-girl fan art archive · Images belong to their creators','AI娘の二次創作アーカイブ · 画像の権利は原作者に帰属します'],['rights','Sources & permissions','出典と利用許諾'],
  ['curated','Curated order','掲載順'],['selectRole','Select a character','キャラクターを選択'],['quickView','Quick preview','プレビュー'],['copyFail','Could not copy. Please copy manually.','コピーできませんでした。手動でコピーしてください。'],
  ['resultCounts','{count} works','{count} 件の作品'],['noResults','No matching works yet.','条件に合う作品が見つかりませんでした。'],
  ['noResultsDesc','Try fewer filters, another keyword, or browse a character.','条件を減らすか、キーワードを変えてください。'],
  ['loadFail','Could not load data. Please refresh.','データを読み込めませんでした。再読み込みしてください。'],
  ['fullDetail','View full details','詳細を見る'],['prevWork','Previous image','前の画像'],['nextWork','Next image','次の画像'],
  ['previewTitle','Work preview','作品プレビュー'],['previewFormat','Original format','元画像の形式'],['previewSize','File size','ファイルサイズ'],['previewPermission','Usage permission','利用許諾'],['previewNavigation','Browse preview images','プレビュー画像を切り替え'],
  ['fileTooLarge','Images must be 10 MB or smaller.','画像は10 MB以下にしてください。'],['fileType','Please choose a supported image format.','対応する画像形式を選んでください。'],
  ['commentsFail','Comments could not load. Please try again later.','コメントを読み込めませんでした。後でもう一度お試しください。']
]){translations.en['d.'+key]=en;translations.ja['d.'+key]=ja;}

const ctx={works,bySlug,chars,topics,types,snapshot,translations,editorial:read('discovery.json'),modelVendors:read('model-vendors.json').vendors,commonTags:[...tagCounts].sort((a,b)=>b[1]-a[1]).slice(0,16)};
Object.assign(ctx,createPrimitives(ctx));
for(const factory of [createWorkCards,createCollectionCards,createCharacterCards,createListing]) Object.assign(ctx,factory(ctx));
ctx.seo=createSEO(ctx);
const pages=new Map();
ctx.write=(url,title,active,content,options={})=>pages.set(url,{url,title,active,content:ctx.seo.enrich(url,content),options,meta:ctx.seo.metadata(url,title,active,options)});
createDiscovery(ctx);
createBrowsePages(ctx);
createCharacterPages(ctx);
createCollectionPages(ctx);
createWorkPages(ctx);
createSearchPage(ctx);
createCommunityPage(ctx);
createEventPage(ctx);
createUtilityPages(ctx);
ctx.seo.generatePages(ctx.write,ctx.browsePage,ctx.breadcrumbs);
export const archivePages=pages;
export const archiveContext=ctx;
export const archiveTranslations=translations;
export const archiveData={works,characters:chars.map(({list,...c})=>c),types,topics:topics.map(({list,...t})=>({...t,slugs:list.map(w=>w.slug)}))};
