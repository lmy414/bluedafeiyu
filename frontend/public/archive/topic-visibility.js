// Only explicit serial membership changes where an image may be displayed.
// Ordinary topic membership never changes the source work list or its order.
export function serialWorkIds(topics = []) {
  return new Set(topics.filter(topic => topic.reader).flatMap(topic => topic.workIds || (topic.list || []).map(work => work.id)));
}

export function nonSerialWorks(works, topics = []) {
  const ids = serialWorkIds(topics);
  return works.filter(work => !ids.has(work.id));
}
