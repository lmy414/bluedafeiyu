// 社群联系卡：社群页与关于页共用同一份结构与文案。
// 中文写在卡片里，en / ja 由 archive.mjs 注册进 ArchiveLabels（各页都加载 archive-labels.js），
// 繁体沿用 lang.js 的 OpenCC 转换，不再单独维护第四份。
import { SITE } from '../../lib/v2.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]);
const span = (key, zh) => `<span data-i18n="d.community.${key}">${esc(zh)}</span>`;

// key：数组下标 0 = 中文，1 = English，2 = 日本語。
export const COMMUNITY_CONTACT_COPY = {
  discordText: [
    '服务器里聊新图、二创和站点反馈，随时来坐坐。',
    'Talk about new works, fan art and site feedback in the server — drop by any time.',
    '新しい作品や二次創作、サイトへの意見をサーバーで話せます。いつでも気軽にどうぞ。'
  ],
  discordJoin: ['加入 Discord', 'Join Discord', 'Discord に参加'],
  qqText: [
    'QQ 群同样聊图、催更和反馈；扫码、复制群号或在 QQ 里搜索都能加入。',
    'The QQ group is another place to chat about art, ask for updates and report issues. Scan the code, copy the group number, or search for it in QQ.',
    'QQグループでも作品の話や更新のお願い、不具合の報告ができます。QRコードを読み取るか、グループ番号をコピーするか、QQで検索して参加できます。'
  ],
  qqName: ['蓝色大肥鱼.com', 'Blue Dafeiyu.com', 'Blue Dafeiyu.com'],
  qqNumberLabel: ['群号', 'Group number', 'グループ番号'],
  qqCopy: ['复制群号', 'Copy group number', 'グループ番号をコピー'],
  qqJoin: ['打开 QQ 加群', 'Join the QQ group', 'QQグループに参加'],
  qqScan: ['扫码进群', 'Scan to join', 'QRコードで参加'],
  qqQrAlt: [
    'QQ 群「蓝色大肥鱼.com」（群号 1134100615）的加入二维码',
    'QR code to join the QQ group “Blue Dafeiyu.com” (group number 1134100615)',
    'QQグループ「Blue Dafeiyu.com」（グループ番号 1134100615）に参加するためのQRコード'
  ],
  wechatTitle: ['微信公众号', 'WeChat Official Account', 'WeChat公式アカウント'],
  wechatScan: ['微信扫码关注', 'Scan with WeChat to follow', 'WeChatでQRコードを読み取ってフォロー'],
  wechatQrAlt: ['微信公众号关注二维码', 'WeChat Official Account follow QR code', 'WeChat公式アカウントのフォロー用QRコード']
};

// 在 archive.mjs 建立翻译表时调用一次，确保 archive-labels.js 带上全部按键。
export function registerCommunityContacts(translations) {
  for (const [key, row] of Object.entries(COMMUNITY_CONTACT_COPY)) {
    translations.en['d.community.' + key] = row[1];
    translations.ja['d.community.' + key] = row[2];
  }
}

export function communityContacts({ compact = false } = {}) {
  const { discord, qq, wechat } = SITE.community;
  const className = 'community-contacts' + (compact ? ' community-contacts--compact' : '');
  const discordCard = `<article class="community-contact community-contact--discord" data-community-channel="discord">
      <p class="community-contact-kicker">DISCORD</p>
      <h3 class="community-contact-title">${esc(discord.name)}</h3>
      <p class="community-contact-text">${span('discordText', COMMUNITY_CONTACT_COPY.discordText[0])}</p>
      <p class="community-contact-acts"><a class="button primary" href="${esc(discord.url)}" target="_blank" rel="noopener noreferrer">${span('discordJoin', COMMUNITY_CONTACT_COPY.discordJoin[0])}</a></p>
    </article>`;
  const qqCard = `<article class="community-contact community-contact--qq" data-community-channel="qq">
      <p class="community-contact-kicker">QQ</p>
      <h3 class="community-contact-title">${span('qqName', qq.name)}</h3>
      <p class="community-contact-text">${span('qqText', COMMUNITY_CONTACT_COPY.qqText[0])}</p>
      <p class="community-contact-number"><span class="community-contact-label">${span('qqNumberLabel', COMMUNITY_CONTACT_COPY.qqNumberLabel[0])}</span><strong class="community-contact-digits">${esc(qq.number)}</strong></p>
      <figure class="community-contact-qr">
        <a href="${esc(qq.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(qq.qr)}" width="${qq.qrWidth}" height="${qq.qrHeight}" alt="${esc(COMMUNITY_CONTACT_COPY.qqQrAlt[0])}" data-i18n-attr="alt:d.community.qqQrAlt" loading="lazy" decoding="async" /></a>
        <figcaption>${span('qqScan', COMMUNITY_CONTACT_COPY.qqScan[0])}</figcaption>
      </figure>
      <p class="community-contact-acts"><button class="button" type="button" data-copy="${esc(qq.number)}">${span('qqCopy', COMMUNITY_CONTACT_COPY.qqCopy[0])}</button><a class="button primary" href="${esc(qq.url)}" target="_blank" rel="noopener noreferrer">${span('qqJoin', COMMUNITY_CONTACT_COPY.qqJoin[0])}</a></p>
    </article>`;
  const wechatCard = wechat ? `<article class="community-contact community-contact--wechat" data-community-channel="wechat">
      <p class="community-contact-kicker">WECHAT</p>
      <h3 class="community-contact-title">${span('wechatTitle', COMMUNITY_CONTACT_COPY.wechatTitle[0])}</h3>
      <figure class="community-contact-qr">
        <img src="${esc(wechat.qr)}" width="${wechat.qrWidth}" height="${wechat.qrHeight}" alt="${esc(COMMUNITY_CONTACT_COPY.wechatQrAlt[0])}" data-i18n-attr="alt:d.community.wechatQrAlt" loading="lazy" decoding="async" />
        <figcaption>${span('wechatScan', COMMUNITY_CONTACT_COPY.wechatScan[0])}</figcaption>
      </figure>
    </article>` : '';
  return `<div class="${className}" data-community-contacts>${discordCard}${qqCard}${wechatCard}</div>`;
}
