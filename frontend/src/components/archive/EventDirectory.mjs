import {events, eventPaths, eventsByStatus, eventPageMetadata} from '../../lib/events.mjs';
import {renderSectionTabs} from './ArchiveTabs.mjs';

export function createEventDirectory(ctx, editions = events) {
  const {tr, esc, icon, button, pageHead, write} = ctx;
  const t = (key, ...copy) => tr('events.' + key, ...copy);
  const title = t('title', '活动', 'Events', 'イベント');
  const current = t('current', '当期活动', 'Current events', '開催中のイベント');
  const archived = t('archived', '往期活动回顾', 'Past events', '過去のイベント');
  // Register labels before the language dictionaries are emitted.
  t('navigation', '活动分页', 'Event sections', 'イベントの分類');
  const tabs = active => renderSectionTabs(active, [
    ['current', eventPaths.current, current],
    ['archived', eventPaths.archived, archived]
  ], {label: '活动分页', key: 'd.events.navigation', className: 'event-tabs'});

  const eventCard = event => `<article class="event-archive-card" data-event-id="${esc(event.id)}">
    <a class="event-archive-cover" href="${esc(event.href)}" tabindex="-1" aria-hidden="true"><img src="${esc(event.cover.src)}" width="${event.cover.width}" height="${event.cover.height}" alt="" loading="lazy"></a>
    <div class="event-archive-copy"><p class="event-status">${t(event.id + '.status', ...event.statusLabel)}</p>
      <h3><a href="${esc(event.href)}">${t(event.id + '.title', ...event.title)}</a></h3>
      <p class="event-archive-date">${t('deadline', '征集截止', 'Submission deadline', '募集締切')} <time datetime="${esc(event.deadline)}">${esc(event.deadline.slice(0, 10))}</time></p>
      <p>${t(event.id + '.summary', ...event.summary)}</p>
      ${button(event.href, (event.status === 'archived' ? t('review', '查看回顾', 'View recap', '記録を見る') : t('details', '查看活动', 'View event', 'イベントを見る')) + icon('arrow', 16))}
    </div></article>`;

  function content(status) {
    const list = eventsByStatus(status, editions);
    const empty = status === 'current'
      ? `<section class="empty-state event-empty"><h2>${t('emptyCurrent', '暂无进行中的活动', 'No current events', '現在開催中のイベントはありません')}</h2><p>${t('emptyCurrentLead', '新的共创正在等待发生，先看看大家之前留下的创作吧。', 'While we wait for the next event, revisit the community’s earlier creations.', '次のイベントを待ちながら、これまでのみんなの創作を振り返ってみましょう。')}</p>${button(eventPaths.archived, archived + icon('arrow', 16))}</section>`
      : `<section class="empty-state event-empty"><h2>${t('emptyArchive', '活动回顾即将收录', 'Event recaps coming soon', 'イベント記録は準備中です')}</h2></section>`;
    return `${pageHead('EVENTS', title, t('lead', '参与当下的共创，也回看每一次相聚。', 'Join current collaborations and revisit each past edition.', '開催中の共同制作に参加し、これまでの各回を振り返りましょう。'))}${tabs(status)}
      <section class="event-directory" data-event-directory="${status}"><div class="section-head"><h2>${status === 'current' ? current : archived}</h2><span class="source-note">${list.length} ${t('editions', '期活动', 'events', '件のイベント')}</span></div>
      ${list.length ? `<div class="event-archive-grid">${list.map(eventCard).join('')}</div>` : empty}</section>`;
  }

  const defaultStatus = eventsByStatus('current', editions).length ? 'current' : 'archived';
  for (const [url, status] of [['/events.html', defaultStatus], [eventPaths.current, 'current'], [eventPaths.archived, 'archived']]) {
    write(url, eventPageMetadata(url).name, 'event', content(status));
  }
  return {eventTabs: tabs};
}
