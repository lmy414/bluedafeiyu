export const IMAGE_PLACEHOLDER = '/components/image-placeholder.svg';

// Image names are frozen independently of work IDs and editable characters.
// Validate the recorded URL; never reconstruct a filename from those fields.
export function workImageURL(value, fallback = IMAGE_PLACEHOLDER) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const source = value.trim();
  try {
    const url = new URL(source, 'https://archive.invalid/');
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    const filename = decodeURIComponent(url.pathname).split('/').pop();
    const match = /^(.*)\.(?:png|jpe?g|gif|webp|avif|apng|svg|bmp)$/i.exec(filename);
    if (!match || !match[1].trim() || /^(?:undefined|null|nan)$/i.test(match[1])) return fallback;
    return /^https?:\/\//i.test(source) ? source : url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

export function workImages(work, exists = () => true) {
  const choose = values => values.map(value => workImageURL(value, '')).find(value => value && exists(value));
  const thumbnail = choose([work.thumbUrl, work.thumbnailPath]);
  const display = choose([work.displayUrl, work.fullPath]);
  return { thumbUrl: thumbnail || display || IMAGE_PLACEHOLDER, displayUrl: display || thumbnail || IMAGE_PLACEHOLDER };
}
