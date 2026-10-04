// Download only the frozen public members of a topic, never the visible DOM list.
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export class DownloadLimitError extends Error {}

export function topicMembers(data, id) {
  const topic = data.topics.find(t => t.id === id);
  if (!topic) throw new Error('topic');
  const bySlug = new Map(data.works.map(w => [w.slug, w]));
  const works = [...new Set(topic.slugs)].map(slug => bySlug.get(slug));
  if (!works.length || works.some(w => !w?.o)) throw new Error('members');
  return { topic, works };
}

const clean = value => Array.from(String(value || '').normalize('NFC')
  .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
  .replace(/[. ]+$/g, '').trim()).slice(0, 70).join('') || 'image';
export const archiveName = topic => clean(topic.name) + '_原图.zip';
export function entryName(work, index) {
  const urlExt = new URL(work.o, 'https://xn--pssy23gqgbz2d718b.com').pathname.split('.').pop().toLowerCase();
  const ext = /^[a-z0-9]{2,5}$/.test(urlExt) ? urlExt : String(work.f || 'png').toLowerCase();
  if (!/^(png|jpg|jpeg|gif|webp|apng|avif|svg|bmp)$/.test(ext)) throw new Error('format');
  return `${String(index + 1).padStart(3, '0')}_${clean(work.c)}_${clean(work.n)}_${clean(work.id)}.${ext}`;
}

async function readOriginal(work, parentSignal, budget, fetchImpl) {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', abort, { once: true });
  if (parentSignal.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), 45000);
  let size = 0, kept = false, reader;
  try {
    const response = await fetchImpl(work.o, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok || !/^image\//i.test(response.headers.get('Content-Type') || '')) throw new Error('image');
    if (Number(response.headers.get('Content-Length')) > MAX_IMAGE_BYTES) throw new DownloadLimitError('image-size');
    reader = response.body.getReader();
    const chunks = [];
    while (true) {
      controller.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      budget.used += value.byteLength;
      if (size > MAX_IMAGE_BYTES || budget.used > MAX_ZIP_BYTES) throw new DownloadLimitError('size');
      chunks.push(value);
    }
    controller.signal.throwIfAborted();
    if (!size) throw new Error('empty');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    kept = true;
    return bytes;
  } finally {
    if (!kept) budget.used -= size;
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abort);
  }
}

export async function downloadMembers(works, { signal, files = new Map(), onProgress = () => {}, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const budget = { used: [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0) };
  if (works.reduce((sum, w) => sum + (Number(w.bytes) || 0), 0) > MAX_ZIP_BYTES) {
    signal?.removeEventListener('abort', abort);
    throw new DownloadLimitError('size');
  }
  const pending = works.filter(w => !files.has(w.id));
  const failed = [];
  let cursor = 0, finished = works.length - pending.length, fatal;
  onProgress(finished, works.length);
  async function worker() {
    while (cursor < pending.length && !controller.signal.aborted) {
      const work = pending[cursor++];
      try { files.set(work.id, await readOriginal(work, controller.signal, budget, fetchImpl)); }
      catch (error) {
        if (error instanceof DownloadLimitError) { fatal = error; controller.abort(error); }
        else if (!controller.signal.aborted) failed.push(work);
      }
      if (!controller.signal.aborted) onProgress(++finished, works.length);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    if (fatal) throw fatal;
    signal?.throwIfAborted();
    return { files, failed };
  } finally { signal?.removeEventListener('abort', abort); }
}

export async function zipMembers(works, files, zip) {
  const entries = {};
  works.forEach((work, index) => { if (files.has(work.id)) entries[entryName(work, index)] = files.get(work.id); });
  if (!Object.keys(entries).length) throw new Error('empty');
  return new Promise((resolve, reject) => zip(entries, { level: 0 }, (error, bytes) => error ? reject(error) : resolve(bytes)));
}
