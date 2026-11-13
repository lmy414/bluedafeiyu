import {videoArchive} from './video-archive.mjs';

export const creatorRank = uid => ({'4168597':0, '4456176':1}[uid] ?? 2);
export const archiveDate = date => String(date || '').replaceAll('.', '-');

// Directory counts treat an explicitly authored serial as one work.
export function creatorDirectoryEntries(creators, topics) {
  return creators.map(creator => {
    const series = topics.filter(topic => topic.reader && topic.author && (
      creator.uid ? topic.author.channels.some(channel => channel.url.match(/space\.bilibili\.com\/(\d+)/)?.[1] === creator.uid) : topic.id === creator.id
    ));
    const serialIds = new Set(series.flatMap(topic => topic.list.map(work => work.id)));
    const images = creator.images.filter(work => !serialIds.has(work.id));
    const serials = series.map(topic => ({kind:'serial', date:archiveDate(topic.updatedAt || creator.latest), item:topic.cover || topic.list[0], topic}));
    const media = [...serials, ...creator.media.filter(media => media.kind !== 'image' || !serialIds.has(media.item.id))];
    return {...creator, images, media, serialCount:serials.length, total:images.length+creator.videos.length+serials.length};
  }).sort((a,b) => b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name));
}

export function archiveCreators(topics, archive = videoArchive) {
  const authors = new Map(archive.creators.map(c => [c.uid, {
    ...c, id:'bilibili-' + c.uid, href:'/creators/bilibili-' + c.uid + '.html', images:[],
    videos:archive.videos.filter(v => v.uid === c.uid)
  }]));
  for (const topic of topics.filter(t => t.author)) {
    const uid = topic.author.channels.map(c => c.url.match(/space\.bilibili\.com\/(\d+)/)?.[1]).find(Boolean);
    const key = uid || topic.id;
    const existing = authors.get(key);
    if (existing) {
      existing.images = [...new Map([...existing.images, ...topic.list].map(w => [w.id,w])).values()];
      existing.topic = topic;
      existing.intro ||= topic.author.bio || '';
      existing.avatar ||= topic.avatar || '';
      existing.channels = topic.author.channels;
    } else authors.set(key, {
      uid:uid || '', id:uid ? 'bilibili-' + uid : topic.id,
      name:topic.author.name, intro:topic.author.bio || '', avatar:topic.avatar || '',
      href:'/creators/' + (uid ? 'bilibili-' + uid : topic.id) + '.html',
      homepage:topic.author.channels[0].url, channels:topic.author.channels,
      images:topic.list, videos:[], topic
    });
  }
  return [...authors.values()].map(c => {
    const media = [
      ...c.images.map(w => ({kind:'image', date:archiveDate(w.dt), item:w})),
      ...c.videos.map(v => ({kind:'video', date:v.publishedAt, item:v}))
    ].sort((a,b) => b.date.localeCompare(a.date));
    return {...c, media, latest:media[0]?.date || '', total:media.length};
  }).sort((a,b) => creatorRank(a.uid) - creatorRank(b.uid) || a.name.localeCompare(b.name));
}
