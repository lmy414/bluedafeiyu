export function renderSectionTabs(active, tabs, {label, key, className = ''}) {
  return `<nav class="section-tabs ${className}" aria-label="${label}" data-i18n-attr="aria-label:${key}">${tabs.map(([id, href, text]) => `<a href="${href}"${id === active ? ' class="is-active" aria-current="page"' : ''}>${text}</a>`).join('')}</nav>`;
}

export function renderArchiveTabs(active, {tr, old}) {
  const tabs = [
    ['browse', '/browse.html', tr('archiveAll', '全部', 'All', 'すべて')],
    ['characters', '/characters.html', old('v2.nav.characters', '角色')],
    ['topics', '/topics.html', old('v2.nav.collections', '合集')],
    ['gifs', '/gifs.html', tr('archiveGifs', 'GIF 动图', 'GIFs', 'GIFアニメ')]
  ];
  return renderSectionTabs(active, tabs, {label: '图片档案', key: 'd.galleryTabs', className: 'gallery-tabs'});
}
