import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {localizeHtml, LOCALES, ORIGIN} from '../scripts/localize-pages.mjs';
import {videoArchive} from '../src/lib/video-archive.mjs';
import {videoTerminology} from '../src/lib/video-terminology.mjs';

test('legacy video aliases use the confirmed role without rewriting other roles or author names', () => {
  assert.equal(videoTerminology('Big Fat Fish Teaches You Quantitative Trading', 'en', ['deepseek']), 'DeepSeek Chan Teaches You Quantitative Trading');
  assert.equal(videoTerminology('Blue Fish and Whale Chan', 'en', ['deepseek']), 'DeepSeek Chan and DeepSeek Chan');
  assert.equal(videoTerminology('Blue Fish draws Fat Fish', 'en', ['deepseek'], ['Blue Fish']), 'Blue Fish draws DeepSeek Chan');
  assert.equal(videoTerminology('Blue Fish', 'en', ['gpt']), 'Blue Fish');
  assert.equal(videoTerminology('大肥鱼教你玩量化', 'zh', ['deepseek']), '大肥鱼教你玩量化');
});

test('creator identity survives role-name translation in title, credits and sharing metadata', async () => {
  const creator = {uid: '3747573030456892', name: 'DeepSeek鲸鱼娘在运营'};
  const route = `/creators/bilibili-${creator.uid}.html`;
  const before = videoArchive.creators;
  const beforeVideos = videoArchive.videos;
  videoArchive.creators = [creator];
  videoArchive.videos = [{bvid: 'BV1bvnE69ETy', uid: creator.uid, characterIds: ['deepseek'], i18n: {en: {title: 'Big Fat Fish Teaches You Quantitative Trading', description: 'A DeepSeek Chan skit.'}, ja: {title: 'DeepSeekちゃんの寸劇', description: '短い寸劇です。'}}}];
  try {
    const html = `<html><head><title>${creator.name} · 作者视频档案</title><link rel="canonical" href="${ORIGIN}${route}"><meta name="description" content="作者介绍"><meta property="og:title"><meta name="twitter:title"><meta property="og:image:alt"><script type="application/ld+json">${JSON.stringify({'@type': 'WebPage', name: creator.name, url: ORIGIN + route})}</script></head><body data-i18n-page="videos"><main><h1><img class="creator-avatar" src="/creator-avatars/test.jpg" alt=""><span data-creator-name>${creator.name}</span></h1><a href="${route}"><img class="creator-avatar" src="/creator-avatars/test.jpg" alt=""><span data-creator-name>${creator.name}</span></a></main></body></html>`;
    for (const locale of LOCALES) {
      const withVideo = html.replace('</main>', '<article data-video-bvid="BV1bvnE69ETy"><h2 data-video-title>大肥鱼教你玩量化</h2><p data-video-description>同人短片</p></article></main>');
      const {document} = parseHTML(await localizeHtml(withVideo, route, locale, {works: [], characters: [], topics: []}));
      assert.ok(document.title.startsWith(creator.name + ' · '), locale.id);
      assert.equal(document.querySelector('main h1').textContent, creator.name, locale.id);
      assert.equal(document.querySelector('main a').textContent, creator.name, locale.id);
      assert.equal(document.querySelectorAll('.creator-avatar').length,2,locale.id+' must preserve avatars');
      assert.equal(document.querySelector('meta[property="og:image:alt"]').getAttribute('content'), document.title);
      if (locale.id !== 'zh') {
        for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) assert.equal(document.querySelector(selector).getAttribute('content'), document.title);
        assert.equal(JSON.parse(document.querySelector('script').textContent).name, document.title);
      }
      if (locale.id === 'en') assert.doesNotMatch(document.title.replace(creator.name, ''), /[\u3400-\u9fff]/u);
      if (locale.id === 'en') assert.equal(document.querySelector('[data-video-title]').textContent, 'DeepSeek Chan Teaches You Quantitative Trading');
    }
  } finally { videoArchive.creators = before; videoArchive.videos = beforeVideos; }
});


test('creator labels and title-only video previews survive localization on the saved page', async()=>{
  const creator={uid:'3747573030456892',name:'DeepSeek鲸鱼娘在运营'};
  const before=videoArchive.creators,beforeVideos=videoArchive.videos;
  videoArchive.creators=[creator];
  videoArchive.videos=[{bvid:'BV1bvnE69ETy',uid:creator.uid,characterIds:['deepseek'],i18n:{en:{title:'A short DeepSeek Chan clip',description:'Fan work.'},ja:{title:'DeepSeekちゃんの短編',description:'二次創作です。'}}}];
  try{
    const html=`<html><head><title>Saved</title><link rel="canonical" href="${ORIGIN}/saved.html"><meta name="description"><meta property="og:title"><meta name="twitter:title"><meta property="og:image:alt"></head><body data-i18n-page="saved"><main><h1>Saved</h1><a aria-label="${creator.name}" data-creator-label="${creator.name}"><img alt=""></a><article data-video-bvid="BV1bvnE69ETy"><b data-video-title>Video</b></article></main></body></html>`;
    for(const locale of LOCALES.filter(l=>['en','ja'].includes(l.id))){
      const {document}=parseHTML(await localizeHtml(html,'/saved.html',locale,{works:[],characters:[],topics:[]}));
      assert.equal(document.querySelector('[data-creator-label]').getAttribute('aria-label'),creator.name);
      assert.equal(document.querySelector('[data-video-title]').textContent,videoArchive.videos[0].i18n[locale.id].title);
      assert.equal(document.title,locale.id==='en'?'Saved works | DeepSeek Chan':'お気に入り | 藍色大肥魚');
    }
  }finally{videoArchive.creators=before;videoArchive.videos=beforeVideos;}
});
