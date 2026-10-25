// Use the original file's format, never the WebP preview's extension.
export function isGifWork(work) {
  if (/^gif$/i.test(work.format || work.f || '')) return true;
  if (/^image\/gif(?:;|$)/i.test(work.mimeType || '')) return true;
  try {
    const original = new URL(work.originalUrl || work.o || work.path || '', 'https://archive.invalid');
    return /\.gif$/i.test(decodeURIComponent(original.pathname));
  } catch {
    return false;
  }
}
