// A verified upstream rename changes only the download target, never frozen identity.
export function upstreamOriginalPath(sourcePath, editorial = {}) {
  const override = editorial.upstreamOriginalPath;
  if (override === undefined) return sourcePath;
  if (typeof override !== 'string' || !/^media\/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|gif|apng|avif)$/i.test(override)) throw new Error('Invalid upstream original path');
  return override;
}
