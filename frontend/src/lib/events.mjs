import fs from 'node:fs';
import path from 'node:path';

const root = process.env.SITE_SOURCE || (fs.existsSync(path.join(process.cwd(), 'data/events.json')) ? process.cwd() : path.resolve(process.cwd(), '..'));
export const events = JSON.parse(fs.readFileSync(path.join(root, 'data/events.json'), 'utf8'));
export const eventPaths = {current: '/events/current.html', archived: '/events/archive.html'};
export const eventCopy = (values, language = 'zh') => values[language === 'en' ? 1 : language === 'ja' ? 2 : 0];

export function eventsByStatus(status, list = events) {
  return list.filter(event => event.status === status).sort((a, b) => b.deadline.localeCompare(a.deadline));
}

export const defaultEventStatus = eventsByStatus('current').length ? 'current' : 'archived';

export function eventPageMetadata(url, language = 'zh') {
  const brand = language === 'en' ? 'DeepSeek Chan' : language === 'ja' ? '藍色大肥魚' : '蓝色大肥鱼';
  const directory = {
    '/events.html': [
      ['活动与共创', 'Events & collaboration', 'イベントと共同制作'],
      ['查看当期活动与历届活动回顾，从每一期活动入口浏览作品、规则与评选记录。', 'Explore current events and past editions, with separate pages for submissions, rules and results.', '開催中のイベントと過去の各回の記録から、作品・ルール・選考結果をご覧ください。']
    ],
    [eventPaths.current]: [
      ['当期活动', 'Current events', '開催中のイベント'],
      ['查看蓝色大肥鱼正在开展的活动、活动时间与参与入口。', 'Find current community events, dates and participation links.', '開催中のコミュニティイベントの日程と参加方法をご覧ください。']
    ],
    [eventPaths.archived]: [
      ['往期活动回顾', 'Past events', '過去のイベント'],
      ['历届活动的归档入口，按时间浏览每一期活动的作品展览、规则与评选记录。', 'Browse the archive of past editions, with a separate page for each event’s exhibition, rules and results.', '過去のイベントを時系列で一覧。各回の展示・ルール・選考記録を個別ページで振り返れます。']
    ]
  }[url];
  const event = events.find(item => item.href === url);
  if (!directory && !event) return null;
  const name = directory ? eventCopy(directory[0], language) : eventCopy(event.title, language) + eventCopy([' · 活动回顾', ' · Event archive', '・イベント記録'], language);
  const description = directory ? eventCopy(directory[1], language) : eventCopy(event.summary, language) + ' ' + eventCopy(event.statusLabel, language) + (language === 'en' ? '.' : '。');
  return {name, title: name + ' — ' + brand, description};
}
