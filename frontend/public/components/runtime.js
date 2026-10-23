/* Component-owned dynamic geometry. Business scripts use these named operations. */
(function (scope) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const px = value => Number.isFinite(Number(value)) ? Number(value) + 'px' : '0px';
  scope.SiteComponents = Object.freeze({
    roleDot(color) { return '<i class="role-dot" style="--role:' + escape(color) + '"></i>'; },
    mediaAttributes(color, soft) { return 'style="--c:' + escape(color) + ';--cs:' + escape(soft) + '"'; },
    aspectAttributes(width, height) { return width && height ? ' style="aspect-ratio:' + Number(width) + '/' + Number(height) + '"' : ''; },
    roleAttributes(color) { return 'style="--c:' + escape(color) + '"'; },
    scrollLock(locked) { document.body.classList.toggle('component-scroll-locked', locked); },
    clipboardField(field) { field.classList.add('component-clipboard-field'); },
    popover(panel, {width, height, left, top, bottom}) {
      Object.assign(panel.style, {width:px(width), maxHeight:px(height), left:px(left), top:top === null ? 'auto' : px(top), bottom:bottom === null ? 'auto' : px(bottom)});
    },
    tooltip(tip, left, top) { Object.assign(tip.style, {left:px(left), top:px(top)}); },
    masonryReset(grid, items = []) {
      grid.style.height = '';
      for (const item of items) Object.assign(item.style, {width:'', left:'', top:''});
    },
    masonryWidth(items, width) { for (const item of items) item.style.width = px(width); },
    masonryPlace(grid, items, result) {
      items.forEach((item, i) => Object.assign(item.style, {left:px(result.positions[i].left), top:px(result.positions[i].top)}));
      grid.style.height = px(result.height);
    },
    columns(grid, count) { grid.style.setProperty('--cols', Number(count)); },
    previewImage(image, width, height, thumb = '') {
      if (width && height) { image.style.setProperty('--r', String(width / height)); image.style.setProperty('--w', px(width)); }
      else { image.style.removeProperty('--r'); image.style.removeProperty('--w'); }
      image.style.backgroundImage = thumb ? 'url("' + String(thumb).replace(/["\\]/g, encodeURIComponent) + '")' : '';
    }
  });
})(globalThis);
