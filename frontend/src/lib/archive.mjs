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
import {createFriendWall} from '../components/archive/FriendWall.mjs';
import {friendLinks} from './friend-links.mjs';
import {shareCopy} from './share-copy.mjs';
import {createGuidePages} from "../components/archive/GuidePages.mjs";
import { aboutCopy, aboutQuestions } from './about-copy.mjs';
import { videoCopy } from './video-copy.mjs';
import { createVideoPages } from '../components/archive/VideoPages.mjs';
import { createDemoPages } from './demo-design.mjs';
import {createPageModel} from '../components/library/page-model.mjs';
import {videoArchive} from './video-archive.mjs';
import {events} from './events.mjs';
const root = process.env.SITE_SOURCE || path.resolve(process.cwd(), '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/data', name), 'utf8'));
const works = Object.entries(overlayData()).map(([slug,w])=>({...w,slug}));
const bySlug = new Map(works.map(w=>[w.slug,w])), byId = new Map(works.map(w=>[w.id,w]));
const types = snapshot.categories.filter(t=>t.status==='active');
// 作者头像由内容仓库按 topicId 命名（<topicId>.webp），构建时经 tools/sync_content.mjs
// 同步进站点仓 dist/author-avatars/。这里按 topic 探测文件，缺失或探测失败时静默回退。
const authorAvatarDir=path.join(path.dirname(process.env.SITE_SNAPSHOT||path.join(root,'dist/site-data.json')),'author-avatars');
const topicAvatar=id=>{try{return fs.statSync(path.join(authorAvatarDir,id+'.webp')).isFile()?'/author-avatars/'+id+'.webp':null}catch{return null}};
const topics = snapshot.topics.filter(t=>t.status!=='removed').map(t=>{
  const list=t.workIds.map(id=>byId.get(id)).filter(Boolean);
  const cover=list.find(w=>w.id===t.coverWorkId)||(t.reader?null:list[0]);
  const art=[cover,...list.filter(w=>w!==cover)].filter(Boolean).slice(0,3);
  return {...t,list,cover,art,avatar:topicAvatar(t.id),eyebrow:t.author?'作者作品集':'主题合集'};
});
const serialWorkIds = new Set(topics.filter(topic=>topic.reader).flatMap(topic=>topic.workIds));
const galleryWorks = works.filter(work=>!serialWorkIds.has(work.id));
const chars = snapshot.characters.filter(c=>c.status==='active').map(c=>{
  const allList=works.filter(w=>w.cids.includes(c.id));
  return {...c,allList,list:allList.filter(w=>!serialWorkIds.has(w.id))};
}).filter(c=>c.allList.length).sort((a,b)=>b.list.length-a.list.length);
const tagCounts=new Map();for(const w of works)for(const tag of w.tg)tagCounts.set(tag,(tagCounts.get(tag)||0)+1);
const translations={en:{'d.navigationToggle':'Toggle navigation','d.saveWork':'Save work','d.saveCreator':'Save creator','d.saved':'Saved','d.unsave':'Remove from saved','d.savedTitle':'Saved works','d.storageUnavailable':'Your browser could not save this item.'},ja:{'d.navigationToggle':'ナビゲーションを切り替え','d.saveWork':'作品を保存','d.saveCreator':'作者を保存','d.saved':'保存済み','d.unsave':'お気に入りから削除','d.savedTitle':'お気に入り','d.storageUnavailable':'ブラウザーに保存できませんでした。'}};
for (const [key, row] of Object.entries(videoCopy)) { translations.en['d.' + key] = row[1]; translations.ja['d.' + key] = row[2]; }
for (const [key, row] of Object.entries(shareCopy)) { translations.en['d.' + key] = row[1]; translations.ja['d.' + key] = row[2]; }
for (const [key, values] of Object.entries(aboutCopy)) {
  translations.en['d.about.'+key] = values[1]; translations.ja['d.about.'+key] = values[2];
}
for (const [i, row] of aboutQuestions.entries()) {
  for (const [key, offset] of [['q',0],['a',3]]) {
    translations.en['d.about.faq.'+i+'.'+key] = row[offset+1];
    translations.ja['d.about.faq.'+i+'.'+key] = row[offset+2];
  }
}
for(const [key, en, ja] of [
  ['allRoles','All characters','すべてのキャラクター'],['allTypes','All types','すべての種類'],
  ['galleryTabs','Image archive views','画像の表示方法'],
  ['siteSearch','Search works, characters, creators or tags','作品・キャラクター・作者・タグを検索'],
  ['viewLarge','View image','画像を見る'],['longImage','Long image · view full','長い画像・全体を見る'],
  ['specialThanks','Special thanks','特別な感謝'],['visitWebsite','Visit website','サイトを見る'],
  ['brandName','DeepSeek Chan','藍色大肥魚'],['discover','Discover','見つける'],['gallery','All images','画像一覧'],['brandSub','AI-girl fan art archive','AI娘の二次創作アーカイブ'],
  ['weeklyNav','AI Girl Weekly','AI娘ウィークリー'],
  ['explore','EXPLORE','ブラウズ'],['sideText','A home for every delightful image.','楽しい一枚を、大切に。'],['nonOfficial','Unofficial fan archive','非公式ファンアーカイブ'],
  ['footerText','AI-girl fan art archive · Images belong to their creators','AI娘の二次創作アーカイブ · 画像の権利は原作者に帰属します'],['rights','Sources & permissions','出典と利用許諾'],
  ['curated','Curated order','掲載順'],['selectRole','Select a character','キャラクターを選択'],['quickView','Quick preview','プレビュー'],['copyFail','Could not copy. Please copy manually.','コピーできませんでした。手動でコピーしてください。'],
  ['resultCounts','{count} works','{count} 件の作品'],['noResults','No matching works yet.','条件に合う作品が見つかりませんでした。'],
  ['noResultsDesc','Try fewer filters, another keyword, or browse a character.','条件を減らすか、キーワードを変えてください。'],
  ['loadFail','Could not load data. Please refresh.','データを読み込めませんでした。再読み込みしてください。'],
  ['fullDetail','View full details','詳細を見る'],['prevWork','Previous image','前の画像'],['nextWork','Next image','次の画像'],
  ['previewTitle','Work preview','作品プレビュー'],['previewClose','Close preview','プレビューを閉じる'],['previewFormat','Original format','元画像の形式'],['previewSize','File size','ファイルサイズ'],['previewPermission','Usage permission','利用許諾'],['previewNavigation','Browse preview images','プレビュー画像を切り替え'],
  ['fileTooLarge','Images must be 10 MB or smaller.','画像は10 MB以下にしてください。'],['fileType','Please choose a supported image format.','対応する画像形式を選んでください。'],
  ['commentsFail','Comments could not load. Please try again later.','コメントを読み込めませんでした。後でもう一度お試しください。']
]){translations.en['d.'+key]=en;translations.ja['d.'+key]=ja;}

for (const [key,en,ja] of [
  ['zipCancel','Cancel','キャンセル'],
  ['zipRetry','Retry failed images','失敗した画像を再試行'],
  ['zipSave','Save ZIP','ZIPを保存'],
  ['zipTitle','Collection originals ZIP','コレクションの元画像ZIP'],
  ['zipLoading','Loading collection…','コレクションを読み込み中…'],
  ['zipProgress','Fetching originals {done} / {total}','元画像を取得中 {done} / {total}'],
  ['zipPacking','Packing originals…','元画像をZIPにまとめています…'],
  ['zipFailed','Fetched {done} / {total} images; {failed} failed. Retry or save the successful images.','{total}枚中{done}枚を取得、{failed}枚が失敗。再試行するか取得済み画像を保存できます。'],
  ['zipReady','{count} originals packed. Download started. If it did not save, click “Save ZIP”.','{count}枚の元画像をZIPにまとめ、ダウンロードを開始しました。保存されない場合は「ZIPを保存」を押してください。'],
  ['zipError','Could not create ZIP. Close and try again.','ZIPを作成できませんでした。閉じて再試行してください。'],
  ['zipLimit','Originals exceed the packing limit (100 MB total, 20 MB per image). No incomplete archive was created.','元画像が上限（合計100 MB、1枚20 MB）を超えています。不完全なZIPは作成していません。'],
  ['zipSavePartial','Save successful images','取得済み画像を保存'],
  ['zipPartialPrefix','Partial_','一部_'],
  ['zipCancelled','Packing cancelled','ZIP作成をキャンセルしました'],
  ['zipClose','Close','閉じる'],
  ['copyStill','Still image copied. Download the original for animation.','静止画像をコピーしました。アニメーションは元画像をダウンロードしてください。'],
  ['copyImageFail','Could not copy. Try again or download the original.','コピーできませんでした。再試行するか元画像をダウンロードしてください。']
]) { translations.en['d.'+key]=en; translations.ja['d.'+key]=ja; }
for(const [key,en,ja] of [
 ['migrationTitle','Demo components and browsing updates','Demo コンポーネントと閲覧体験の更新'],
 ['migrationBrowse','Restored image masonry, gallery tabs, image previews and browser-local saved items.','画像の段組み、ギャラリーのタブ、プレビュー、ブラウザー内のお気に入りを整備しました。'],
 ['migrationCreators','Creator profiles now show real avatars, image and video archives, search, sorting and work previews.','作者の実際のアイコン、画像と動画の作品集、検索、並び替え、作品プレビューを追加しました。'],
 ['migrationPages','Aligned navigation, typography, community and information pages across desktop, mobile and four languages.','ナビゲーション、文字組み、コミュニティと案内ページを、デスクトップ・モバイル・4言語で統一しました。'],
 ['imageSubmit','Submit an image','画像作品を投稿'],
 ['submissionMode','Submission type','投稿方法'],
 ['releaseTitle','New frontend and automatic video publishing','新しいフロントエンドと動画の自動公開'],
 ['releaseLayout','New layouts for discovery, community, characters, creators and information pages, with mobile and dark-mode support.','ホーム、コミュニティ、キャラクター、作者、案内ページを刷新。モバイルとダークモードに対応。'],
 ['releaseFlow','Creator registration, RSSHub discovery, AI review and automatic publishing are connected, with release notifications sent to the Feishu group.','作者登録、RSSHubによる検出、AI審査、自動公開を接続。公開結果はFeishuグループに通知します。']
]){translations.en['d.design.'+key]=en;translations.ja['d.design.'+key]=ja;}
for(const work of works)work.owners=topics.filter(t=>t.author&&t.list.some(w=>w.id===work.id)).map(t=>{const uid=t.author.channels.map(c=>c.url.match(/space\.bilibili\.com\/(\d+)/)?.[1]).find(Boolean);return {name:t.author.name,href:'/creators/'+(uid?'bilibili-'+uid:t.id)+'.html'};});
const ctx={works,galleryWorks,serialWorkIds,bySlug,chars,topics,types,snapshot,localizationInputs:{videoArchive,friendLinks,events},translations,editorial:read('discovery.json'),modelVendors:read('model-vendors.json').vendors,commonTags:[...tagCounts].sort((a,b)=>b[1]-a[1]).slice(0,16)};
Object.assign(ctx,createPrimitives(ctx));
for(const factory of [createWorkCards,createCollectionCards,createCharacterCards,createListing]) Object.assign(ctx,factory(ctx));
ctx.seo=createSEO(ctx);
const pages=new Map();
ctx.write=(url,title,active,content,options={})=>pages.set(url,createPageModel(ctx,url,title,active,content,options));
createDiscovery(ctx);
createBrowsePages(ctx);
createCharacterPages(ctx);
createCollectionPages(ctx);
createGuidePages(ctx);
createWorkPages(ctx);
createSearchPage(ctx);
createCommunityPage(ctx);
createEventPage(ctx);
createUtilityPages(ctx);
createFriendWall(ctx);
Object.assign(ctx,createVideoPages(ctx));
createDemoPages(ctx,pages);
ctx.seo.generatePages(ctx.write,ctx.browsePage,ctx.breadcrumbs);
export const archivePages=pages;
export const archiveContext=ctx;
export const archiveTranslations=translations;
export const archiveData={works,characters:chars.map(({list,allList,...c})=>c),types,topics:topics.map(({list,cover,art,avatar,...t})=>({...t,slugs:list.map(w=>w.slug)}))};
