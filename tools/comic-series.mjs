// Explicit editorial selections; never discover series members by tags or author.
export function mergeTopicSources(topics, serials = []) {
  const ids = new Set();
  for (const serial of serials) {
    if (!serial.reader || ids.has(serial.id)) throw new Error(`连载专题配置重复或缺少 reader：${serial.id}`);
    ids.add(serial.id);
  }
  // Repository-owned serials survive a CMS export. The manifest is authoritative
  // for these IDs, including their deliberately selected members and reading order.
  return [...topics.filter(topic => !ids.has(topic.id)), ...serials];
}

export function normalizeComicReader(reader, workIds, coverWorkId) {
  if (!reader) return null;
  const totalPages = Number(reader.totalPages);
  if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > 1000) throw new Error('连载总页数必须为 1–1000 的整数');
  const numbers = new Set(), ids = new Set(), available = new Set(workIds);
  const pages = [];
  for (const page of reader.pages || []) {
    const number = Number(page.number), workId = String(page.workId || '');
    if (!Number.isInteger(number) || number < 1 || number > totalPages || numbers.has(number) || !workId || ids.has(workId) || workId === coverWorkId) throw new Error(`连载页码或作品重复/无效：${number}`);
    numbers.add(number); ids.add(workId);
    if (available.has(workId)) pages.push({number, workId});
  }
  if (workIds.some(id => id !== coverWorkId && !ids.has(id))) throw new Error('连载专题中有未配置原稿页码的作品');
  return {totalPages, credits: String(reader.credits || ''), creditsI18n: reader.creditsI18n || {}, pages: pages.sort((a, b) => a.number - b.number)};
}
