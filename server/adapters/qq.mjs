/* server/adapters/qq.mjs —— QQ 群入站适配器
 *
 * 定位：**被动入站**。QQ 机器人（AstrBot 侧）把群消息里的图片推给这个适配器，
 * 适配器校验后统一写入投稿队列。它自己**从不连接任何 QQ 机器人**，
 * 也就不存在「连了未配置机器人」这种问题。
 *
 * 拒绝优先的顺序（任何一步不过就拒绝，绝不入库）：
 *   1. SUBMISSION_QQ_ENABLED 不是 true        -> 503 disabled
 *   2. 令牌或群白名单没配                      -> 503 not_configured
 *   3. Bearer 令牌常量时间比对失败             -> 401 unauthorized
 *   4. groupId 不在白名单                      -> 403 forbidden
 *   5. 图片既非 base64 也非白名单内 URL        -> 400/403
 *   6. 解出来的字节不是图片 / 超限             -> 400/413
 *
 * 幂等键：qq:<groupId>:<messageId>:<sha256 前 16 位>，同一条群消息重复推不重复入库。
 */
import { timingSafeEqual } from 'node:crypto';

import { sniffImageFormat, sha256 } from '../queue.mjs';
import { fetchWithLimits } from './github.mjs';

function safeEqual(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function reply(status, code, error = null, extra = {}) {
  return { status, code, body: error ? { ok: false, error } : { ok: true, ...extra } };
}

export function createQqAdapter(cfg, { queue, fetchImpl = globalThis.fetch } = {}) {
  const { enabled, inboundToken, groupAllowlist, imageHostAllowlist, timeoutMs } = cfg.qq;
  const configured = Boolean(inboundToken) && groupAllowlist.length > 0;

  function isAllowedImageUrl(value) {
    if (imageHostAllowlist.length === 0) return false;
    let url;
    try {
      url = new URL(String(value));
    } catch {
      return false;
    }
    if (url.protocol !== 'https:') return false;
    if (url.port !== '') return false;
    if (url.username || url.password) return false;
    return imageHostAllowlist.includes(url.hostname);
  }

  function fieldsFrom(payload) {
    const nested = payload.fields && typeof payload.fields === 'object' ? payload.fields : {};
    return {
      name: payload.name ?? nested.name ?? '',
      character: payload.character ?? nested.character ?? '',
      description: payload.description ?? nested.description ?? '',
      tags: Array.isArray(payload.tags) ? payload.tags : (Array.isArray(nested.tags) ? nested.tags : []),
    };
  }

  async function handleInbound({ authorization = '', payload = {} } = {}) {
    if (!enabled) return reply('disabled', 503, 'QQ 入站未开启（SUBMISSION_QQ_ENABLED 未设为 true）');
    if (!configured) return reply('not_configured', 503, 'QQ 入站未配置令牌或群白名单');
    if (!safeEqual(authorization, `Bearer ${inboundToken}`)) return reply('unauthorized', 401, '鉴权失败');

    const groupId = String(payload.groupId ?? payload.group_id ?? '');
    if (!groupAllowlist.includes(groupId)) return reply('forbidden', 403, '群不在白名单');

    const image = (payload.image && typeof payload.image === 'object') ? payload.image : {};
    const base64 = image.base64 ?? payload.imageBase64 ?? '';
    const imageUrl = image.url ?? payload.imageUrl ?? '';

    let buffer = null;
    let via = '';
    try {
      if (base64) {
        const text = String(base64).includes(',') ? String(base64).slice(String(base64).indexOf(',') + 1) : String(base64);
        buffer = Buffer.from(text, 'base64');
        via = 'base64';
      } else if (imageUrl) {
        if (!isAllowedImageUrl(imageUrl)) return reply('forbidden', 403, '图片地址不在白名单');
        const result = await fetchWithLimits(fetchImpl, imageUrl, {
          maxBytes: cfg.maxBytes,
          timeoutMs,
          maxRedirects: 2,
          headers: { 'User-Agent': 'blue-fish-submission-server' },
          allowUrl: isAllowedImageUrl,
        });
        buffer = result.buffer;
        via = 'url';
      } else {
        return reply('invalid_image', 400, '缺少图片内容');
      }
    } catch (error) {
      return reply('invalid_image', 400, `图片获取失败：${error.message}`);
    }

    if (!buffer || buffer.length === 0) return reply('invalid_image', 400, '图片内容为空');
    if (buffer.length > cfg.maxBytes) return reply('too_large', 413, `图片超过大小上限 ${cfg.maxBytes} 字节`);
    if (!sniffImageFormat(buffer)) return reply('invalid_image', 400, '文件头不是已知图片格式');

    const messageId = String(payload.messageId ?? payload.message_id ?? '') || 'unknown';
    const userId = String(payload.userId ?? payload.user_id ?? '');
    const digest = sha256(buffer);
    const sourceId = `qq:${groupId}:${messageId}:${digest.slice(0, 16)}`;

    const existing = await queue.findBySourceId(sourceId);
    if (existing) {
      return reply('duplicate', 200, null, { id: existing.id, status: existing.state });
    }

    const result = await queue.enqueue({
      source: 'qq',
      sourceId,
      buffer,
      fields: fieldsFrom(payload),
      origin: { groupId, userId, messageId, via },
    });
    const accepted = result.status === 'created';
    return reply(accepted ? 'accepted' : 'duplicate', accepted ? 202 : 200, null, {
      id: result.item.id,
      status: result.item.state,
    });
  }

  return { enabled, configured, handleInbound, isAllowedImageUrl };
}
