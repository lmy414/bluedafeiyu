// This tag records an author/submitter statement; visual style is not evidence.
export function matchesCreationMethod(work, method = '') {
  return !method || (method === 'non-ai' && (work.tg || work.tags || []).includes('非AI'));
}
