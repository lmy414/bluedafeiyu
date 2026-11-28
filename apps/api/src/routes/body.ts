import { ApiError } from '../errors.js';

export async function readBounded(request: Request, max: number): Promise<Buffer> {
  if (Number(request.headers.get('content-length')) > max) throw new ApiError(413, 'body_too_large', '请求超过大小上限');
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.length;
      if (size > max) throw new ApiError(413, 'body_too_large', '请求超过大小上限');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function boundedJson(request: Request, max = 256 * 1024): Promise<unknown> {
  const bytes = await readBounded(request, max);
  try { return bytes.length ? JSON.parse(bytes.toString('utf8')) : {}; }
  catch { throw new ApiError(400, 'invalid_json', 'JSON 格式无效'); }
}

export async function boundedForm(request: Request, max: number): Promise<FormData> {
  const bytes = await readBounded(request, max);
  try {
    return await new Response(new Uint8Array(bytes), { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData();
  } catch { throw new ApiError(400, 'invalid_form', '表单格式无效'); }
}
