import {copyImage,copyPNG,imagePNG} from '../archive/image-copy.js';
import {shareCardId,shareCardImageURL} from './share-card-model.js';

export function installShareCards() {
  const dialog = document.querySelector('#share-card-dialog');
  if (!dialog) return;
  const image = dialog.querySelector('[data-share-image]');
  const status = dialog.querySelector('[data-share-status]');
  const copy = dialog.querySelector('[data-share-copy]');
  const save = dialog.querySelector('[data-share-save]');
  const tx = (key, fallback) => window.SiteLang?.fmt('d.' + key, fallback) || fallback;
  let opener, cardURL = '', linkURL = '', request = 0, preparedPNG;
  const reset = () => {preparedPNG = null; copy.disabled = true; save.removeAttribute('href'); save.setAttribute('aria-disabled', 'true'); image.hidden = true; };
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-share-card]');
    if (!button) return;
    event.preventDefault();
    opener = button;
    const sequence = ++request;
    reset();
    status.textContent = tx('shareLoading', '正在加载分享卡片…');
    const href = button.dataset.shareCard || location.pathname;
    const local = window.SiteLang?.url(href) || href;
    linkURL = new URL(local, 'https://xn--pssy23gqgbz2d718b.com').href;
    cardURL = new URL(shareCardImageURL(href), location.origin).href;
    image.onload = async () => {
      if (sequence !== request || !dialog.open) return;
      image.hidden = false;
      save.href = cardURL; save.download = shareCardId(href) + '.jpg'; save.removeAttribute('aria-disabled');
      // Prepare the PNG before the click so writing a ready Blob stays inside
      // user activation and also works in browsers with limited promise support.
      let png;
      try {png = await imagePNG(cardURL);} catch {}
      if (sequence !== request || !dialog.open) return;
      preparedPNG = png; copy.disabled = false; status.textContent = '';
    };
    image.onerror = () => { if (sequence === request) {reset(); status.textContent = tx('shareError', '卡片加载失败，请重试。也可以先复制链接。');} };
    if (!dialog.open) dialog.showModal();
    image.src = cardURL;
  });
  copy.addEventListener('click', () => {
    if (copy.disabled) return;
    const sequence = request;
    const pending = preparedPNG ? copyPNG(preparedPNG) : copyImage(cardURL);
    copy.disabled = true;
    pending.then(() => { if(sequence === request) status.textContent = tx('shareCopied', '卡片已复制，可以直接粘贴分享。'); }, () => {
      if(sequence === request) status.textContent = tx('shareCopyError', '浏览器暂时无法复制图片，请点击“保存卡片”或长按卡片保存。');
    }).finally(() => { if(sequence === request) copy.disabled = false; });
  });
  dialog.querySelector('[data-share-link]').addEventListener('click', () => {
    if (!navigator.clipboard?.writeText) {status.textContent = tx('copyFail','复制失败，请手动复制。') + ' ' + linkURL; return;}
    navigator.clipboard.writeText(linkURL).then(() => {status.textContent = tx('shareLinkCopied','链接已复制');}, () => {status.textContent = tx('copyFail','复制失败，请手动复制。') + ' ' + linkURL;});
  });
  dialog.querySelector('[data-share-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {request++; reset(); opener?.focus();});
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
}
