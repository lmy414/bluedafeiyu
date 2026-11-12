import {installWorkPreview} from './work-preview.js';
import {loadArchiveData} from '../archive/data-loader.js';
import {copyImage} from '../archive/image-copy.js';
import {installShareCards} from './share-card.js';
import '../../src/scripts/saved-ui.js';
import {homePreviewText as tx} from './home-preview-copy.js';
const url=href=>window.SiteLang?SiteLang.url(href):href;
const toast=message=>{const node=document.querySelector('#toast');node.textContent=message;node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.hidden=true,3000);};
installWorkPreview({load:loadArchiveData,localize:work=>window.SiteLang?SiteLang.localWork(work):work,translate:tx,url,names:text=>window.SiteLang?SiteLang.contentText(text):text,toast});
installShareCards();

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-copy-img],[data-copy-link]');
  if(!button||button.disabled)return;
  const status=button.closest('[data-work-actions]')?.querySelector('[data-image-copy-status]');
  const report=message=>status?status.textContent=message:toast(message);
  button.disabled=true;
  try{
    if(button.hasAttribute('data-copy-img')){await copyImage(button.dataset.copyImg);report(tx(button.dataset.copyAnimated==='true'?'d.copyStill':'v2.copiedImg',button.dataset.copyAnimated==='true'?'已复制静态图片，动图请下载原图':'已复制图片'));}
    else{await navigator.clipboard.writeText(new URL(url(button.dataset.copyLink),'https://xn--pssy23gqgbz2d718b.com').href);report(tx('ui.copied','已复制'));}
  }catch{report(tx('d.copyFail','复制失败，请手动复制。'));}
  finally{button.disabled=false;}
});
