async function imagePNG(url) {
  const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('image');
  const source = await response.blob();
  if (!source.type.startsWith('image/')) throw new Error('type');
  if (source.type === 'image/png') return source;
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('png')), 'image/png'));
  } finally { bitmap.close(); }
}

export function copyImage(url) {
  if (!globalThis.isSecureContext || !navigator.clipboard?.write || !globalThis.ClipboardItem) {
    return Promise.reject(new Error('unsupported'));
  }
  // Call write during the click; Safari awaits the promised PNG without losing user activation.
  const png = imagePNG(url);
  png.catch(() => {});
  try { return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); }
  catch (error) { return Promise.reject(error); }
}
