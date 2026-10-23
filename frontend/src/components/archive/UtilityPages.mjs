export function createUtilityPages(ctx) {
  const { works, chars, tr, old, icon, button, card, grid, roleCard, pageHead, write } = ctx;
write('/404.html','找不到这一页','404',`<div class="error-page blue-fish-404"><p class="error-number">404</p><h1>${tr('missingPage','这张图游走了。','This page swam away.','このページは泳いでいきました。')}</h1><p>${tr('missingDesc','页面可能不存在，或者作品已下架。去图库再捞捞看。','The page may not exist or the work may have been removed. Try the archive.','ページが存在しないか、作品が削除された可能性があります。作品一覧をご覧ください。')}</p>${button('/browse.html',tr('backGallery','回到图库','Back to the archive','作品一覧へ'),'primary')}</div>`);
write('/category.html','角色','characters',`${pageHead('CHARACTERS',old('v2.nav.characters','角色'))}<div class="role-grid">${chars.map(roleCard).join('')}</div>`,{attrs:'data-legacy-category'});

}
