import { guides, guidePath } from '../../lib/landing-copy.mjs';

// Editorial guides link to existing archives; CMS topic membership stays owner-curated.
export function guideLinks(ctx) {
  const { tr, button } = ctx;
  return `<div class="role-entry-links">${guides.map(g => button(guidePath(g), tr('guide.' + g.id + '.name', ...g.name), 'small')).join('')}</div>`;
}

export function createGuidePages(ctx) {
  const { chars, types, esc, tr, button, grid, breadcrumbs, pageHead, sectionHead, write } = ctx;
  for (const g of guides) {
    if ((ctx.topics || []).some(topic=>topic.id === g.id)) throw new Error('Topic ID is reserved for an editorial guide: ' + g.id);
    const character = chars.find(c => c.id === g.character);
    if (!character) throw new Error('Guide character has no published works: ' + g.character);
    const list = character.list.filter(w => !g.type || w.k.includes(g.type));
    const destination = '/characters/' + g.character + (g.type ? '/' + g.type : '') + '.html';
    write(guidePath(g), g.name[0], 'topics', `${breadcrumbs([[tr('guide.label', '专题导览', 'Fan art guides', 'ファンアートガイド'), '/topics.html'], [tr('guide.' + g.id + '.name', ...g.name)]])}
      ${pageHead(tr('guide.label', '专题导览', 'Fan art guides', 'ファンアートガイド'), tr('guide.' + g.id + '.name', ...g.name), tr('guide.' + g.id + '.summary', ...g.summary))}
      <section class="section intro-panel"><h2>${tr('guide.explore', '从角色与类型开始找图', 'Explore by character and artwork type', 'キャラクターと作品の種類から探す')}</h2>
      <p><b>${list.length}</b> ${tr('guide.count', '件相关作品已归档，完整列表随本站收录更新。', 'related works archived. The full list updates as works are added.', '件の関連作品を収録。新しい作品は一覧に反映されます。')}</p>
      ${button(destination, tr('guide.browse', '浏览全部相关作品', 'Browse all related works', '関連作品をすべて見る'), 'primary')}
      <div class="role-entry-links">${types.filter(t => character.list.some(w => w.k.includes(t.id))).map(t => button('/characters/' + character.id + '/' + t.id + '.html', tr('guide.type.' + t.id, t.name, { meme: 'Memes', illustration: 'Illustrations', setting: 'Character designs', comic: 'Comics', standing: 'Character portraits', other: 'Other works' }[t.id], { meme: 'ネタ画像', illustration: 'イラスト', setting: '設定画', comic: '漫画', standing: '立ち絵', other: 'その他' }[t.id]), 'small')).join('')}</div></section>
      <section class="section">${sectionHead(tr('guide.recent', '最近收录的相关作品', 'Recent related works', '最近収録した関連作品'))}${grid(list.slice(0, 8))}</section>
      <section class="section intro-panel"><h2>${tr('guide.permissions', '下载前查看来源与授权', 'Check sources and permissions before use', '使用前に出典と利用許諾を確認')}</h2><p>${tr('guide.permissionsText', '每张作品都保留独立详情页，提供原图、来源、署名和授权备注。可以下载不代表可以任意转载或商用；授权不明时，请先联系原作者。', 'Each work has its own detail page with the original image, source, credits and license notes. Download access does not grant permission to repost or use it commercially. Contact the creator if permissions are unclear.', '各作品の詳細には元画像、出典、クレジット、利用許諾を掲載しています。ダウンロードできることは転載や商用利用の許可を意味しません。不明な場合は原作者にご確認ください。')}</p>${button('/about.html#licensing', tr('guide.rights', '查看图片使用许可说明', 'Read the image permissions guide', '画像の利用許諾について'), 'small')}</section>
      <section class="section">${sectionHead(tr('guide.more', '继续阅读专题导览', 'Explore more guides', 'ほかのガイドを読む'))}${guideLinks(ctx)}</section>`, { attrs: 'data-editorial-guide="' + esc(g.id) + '"' });
  }
}
