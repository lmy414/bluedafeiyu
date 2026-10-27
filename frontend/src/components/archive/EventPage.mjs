import {events, eventPaths} from '../../lib/events.mjs';
import {createEventDirectory} from './EventDirectory.mjs';

export function createEventPage(ctx) {
  const {tr, old, esc, button, breadcrumbs, pageHead, write} = ctx;
  const {eventTabs} = createEventDirectory(ctx);
  const event = events.find(item => item.id === 'national-day-2026');
  if (!event) return;
  const t = (key, ...copy) => tr('events.' + key, ...copy);
  const archiveTitle = t('nationalArchive', '2026 国庆网站前台设计征集 · 活动回顾', '2026 National Day Website Design Contest · Event archive', '2026年国慶節サイトデザイン募集・イベント記録');
  const rules = `<details class="event-rules"><summary>${t('originalRules', '查看原活动规则', 'View the original event rules', '当初のイベントルールを見る')}</summary><div class="event-rules-content">
    <p>${old('ev.lede', '新版网站已经上线，但站长还是不太满意，想看看大家心目中的 AI 娘二创站应该长什么样。')}</p>
    <p>${old('ev.s1', '不限 AI，不限工具，不限技术栈。')}<br>${old('ev.s2', '可以古法手搓，也可以给 AI 许愿。')}</p>
    <div class="info-grid section"><section class="info-card"><h3>${old('ev.p1', '采用奖')}</h3><b class="prize-number">88 ${tr('yuan', '元', 'RMB', '元')}</b><p>${old('ev.p1d', '你的设计会成为网站未来的前台，上线时署名。')}</p></section>
    <section class="info-card"><h3>${old('ev.p2', '人气奖')}</h3><b class="prize-number">66 ${tr('yuan', '元', 'RMB', '元')}</b><p>${old('ev.p2d', '投稿满 3 份时设立。截稿后在 GitHub 投票 Issue 里给喜欢的作品点 👍，想投几个就投几个，得票最多的获奖。')}</p></section></div>
    <p class="source-note">${old('ev.prizeNote', '奖金为 DeepSeek 开放平台 API 额度，可以折现；两个奖可以同一个人拿。奖金由站长个人出资，本活动与 DeepSeek 官方无关。')}</p>
    <h3>${t('originalSubmission', '原参与方式（征集已截止）', 'Original participation instructions (submissions closed)', '当初の参加方法（募集終了）')}</h3>
    <ol class="steps"><li><b>Fork ${tr('eventRepo', '活动仓库', 'the event repository', 'イベントリポジトリ')}</b></li>
      <li><b>${tr('eventFiles', '放入你的静态网页', 'Add your static pages', '静的ページを追加')}</b><span><code>submissions/&lt;GITHUB_USERNAME&gt;/index.html</code></span></li>
      <li><b>${tr('eventPr', '提交 PR', 'Submit a PR', 'PRを提出')}</b><span>${old('ev.how3', '提交 PR。页面能打开、内容和主题相关，就会被合并，合并后就算参与成功。')}</span></li></ol>
  </div></details>`;

  write(event.href, '2026 国庆网站前台设计征集 · 活动回顾', 'event', `
    ${pageHead('EVENT ARCHIVE', archiveTitle, t('archiveLead', '感谢每一位参与者，一起留下了 AI 娘二创站的不同可能。', 'Thank you to everyone who shared a different vision for the AI-girl fan art archive.', 'AI娘の二次創作サイトのさまざまな可能性を寄せてくださった皆さん、ありがとうございました。'))}
    ${eventTabs('archived')}
    ${breadcrumbs([[t('archived', '往期活动回顾', 'Past events', '過去のイベント'), eventPaths.archived], [t('national-day-2026.title', ...event.title)]])}
    <article data-event-archive="${esc(event.id)}"><header class="event-archive-hero"><div>
      <p class="eyebrow">2026 NATIONAL DAY</p><p class="event-status">${t(event.id + '.status', ...event.statusLabel)}</p>
      <p>${t('closedNotice', '本次设计征集已于北京时间 2026 年 10 月 26 日 23:59 截止，活动页面现已归档。', 'Submissions closed on October 26, 2026 at 23:59 Beijing time. This page now preserves the event archive.', 'デザインの募集は北京時間2026年10月26日23:59に終了しました。このページはイベントの記録として保存しています。')}</p>
      <div class="hero-actions">${button(event.exhibition, t('viewExhibition', '浏览投稿作品', 'Browse submitted designs', '投稿作品を見る'), 'primary')}${button(event.repository, t('viewRepository', '查看活动仓库', 'View event repository', 'イベントリポジトリを見る'))}</div>
    </div><figure><img src="${esc(event.cover.src)}" width="${event.cover.width}" height="${event.cover.height}" alt="${esc(event.coverAlt[0])}" data-i18n-attr="alt:d.events.nationalCover"></figure></header>
    <section class="event-archive-section"><h2>${t('exhibitionTitle', '投稿作品展览', 'Submission exhibition', '投稿作品の展示')}</h2>
      <p>${tr('exhibitionDesc', '所有被合并的作品会保留在投稿展览中。', 'All merged submissions remain in the exhibition.', 'マージされた作品は投稿展示に残ります。')}</p>
      <p>${t('exhibitionLead', '前往展览查看各位作者的设计、作品介绍与可运行的网页。', 'Visit the exhibition for each creator’s design, introduction and runnable website.', '展示ページで各作者のデザイン、紹介文、実際に動くウェブサイトをご覧いただけます。')}</p>
      ${button(event.exhibition, t('openExhibition', '打开作品展览', 'Open exhibition', '展示を開く'))}</section>
    <section class="event-archive-section intro-panel"><h2>${t('resultsTitle', '评选进度与结果', 'Selection progress and results', '選考の進捗と結果')}</h2>
      <p>${t('resultsPending', '征集已结束，评选结果待公布。投票入口与最终结果以活动仓库公告为准。', 'Submissions are closed and results are pending. Check the event repository for voting announcements and final results.', '募集は終了し、選考結果は発表待ちです。投票の案内と最終結果はイベントリポジトリのお知らせをご確認ください。')}</p>
      <dl class="event-timeline"><div><dt><time datetime="2026-10-26T23:59:59+08:00">2026.10.26 · 23:59</time></dt><dd>${t('deadlinePassed', '征集截止（已结束）', 'Submission deadline (closed)', '募集締切（終了）')}</dd></div>
      <div><dt><time datetime="2026-11-06T23:59:59+08:00">2026.11.06 · 23:59</time></dt><dd>${t('votingSchedule', '原定人气投票截止', 'Originally scheduled voting deadline', '当初予定の人気投票締切')}</dd></div>
      <div><dt><time datetime="2026-11-07">2026.11.07</time></dt><dd>${t('resultsSchedule', '原定结果公布日期', 'Originally scheduled results announcement', '当初予定の結果発表日')}</dd></div></dl>
      <p class="source-note">${t('beijingTime', '以上时间均为北京时间。', 'All dates and times use Beijing time.', '日程・時刻はいずれも北京時間です。')}</p></section>
    ${rules}</article>`);
  t('nationalCover', ...event.coverAlt);
}
