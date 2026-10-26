// Shared ordering for the archive, collection filters and download highlights.
export function shuffledSlugs(works, random = Math.random) {
  const slugs = works.map(work => work.slug);
  for (let i = slugs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [slugs[i], slugs[j]] = [slugs[j], slugs[i]];
  }
  return slugs;
}

export function orderWorks(works, {sort = 'latest', direction = 'desc', metric = () => 0, scores, randomOrder = []} = {}) {
  const ordered = [...works];
  const ranks = new Map((sort === 'random' ? randomOrder : works.map(work => work.slug)).map((slug, index) => [slug, index]));
  const timestamp = work => Number.isFinite(work.at) ? work.at : Date.parse(work.createdAt || work.dt) || 0;
  const recent = (a, b) => timestamp(a) - timestamp(b) || a.slug.localeCompare(b.slug);
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const sign = direction === 'asc' ? 1 : -1;
  return ordered.sort((a, b) => {
    if (sort === 'curated' || sort === 'random') return sign * ((ranks.get(a.slug) ?? 0) - (ranks.get(b.slug) ?? 0));
    if (sort === 'popular' || sort === 'downloads') return sign * (number(metric(a.id, sort)) - number(metric(b.id, sort)) || recent(a, b));
    if (sort === 'relevance' && scores) return sign * (number(scores.get(a.id)) - number(scores.get(b.id)) || recent(a, b));
    return sign * recent(a, b);
  });
}
