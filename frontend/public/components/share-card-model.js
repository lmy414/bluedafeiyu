const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const SHARE_CARD_VERSION = '20261023-4';

export function shareCardId(href) {
  const path = new URL(href, 'https://xn--pssy23gqgbz2d718b.com').pathname.replace(/^\/(?:en|ja|zh-hant)(?=\/)/, '');
  return 'archive-' + (path === '/' || path === '/index.html' ? 'home' : path.replace(/[^a-z0-9-]/gi, '-'));
}

export function shareCardImageURL(href) {
  return '/og/' + shareCardId(href) + '.jpg?v=' + SHARE_CARD_VERSION;
}

export function renderShareButton(href = '', {translate = (_key, text) => text, compact = false} = {}) {
  const label = escape(translate('d.shareCard', '分享卡片'));
  return `<button class="${compact ? 'card-share' : 'button'}" type="button" data-share-card="${escape(href)}" aria-label="${label}" title="${label}" data-i18n-attr="aria-label:d.shareCard,title:d.shareCard"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/></svg>${compact ? '' : `<span data-i18n="d.shareCard">${label}</span>`}</button>`;
}
