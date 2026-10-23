export function renderArchiveTabs(active, {tr, old}) {
  const tabs = [
    ['browse', '/browse.html', tr('archiveAll', '全部', 'All', 'すべて')],
    ['characters', '/characters.html', old('v2.nav.characters', '角色')],
    ['topics', '/topics.html', old('v2.nav.collections', '合集')]
  ];
  return `<nav class="section-tabs gallery-tabs" aria-label="图片档案" data-i18n-attr="aria-label:d.galleryTabs">${tabs.map(([id, href, label]) => `<a href="${href}"${id === active ? ' class="is-active" aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}
