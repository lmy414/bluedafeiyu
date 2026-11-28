import { isIP } from 'node:net';

function normalizeIp(value?: string) {
  if (!value) return undefined;
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6 || value.includes('%')) return undefined;
  const normalized = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized);
  if (!mapped?.[1] || !mapped[2]) return normalized;
  return mapped.slice(1).flatMap(part => { const number = Number.parseInt(part, 16); return [number >> 8, number & 255]; }).join('.');
}

export function clientIp(peer?: string, forwarded?: string, trustedProxyHops = 0): string | undefined {
  const address = normalizeIp(peer);
  if (!address || trustedProxyHops < 1 || !forwarded) return address;
  const chain = forwarded.split(',').map(ip => ip.trim());
  const candidate = chain[chain.length - trustedProxyHops];
  return normalizeIp(candidate) ?? address;
}

export function createRateLimiter({ limit = 10, windowMs = 3600_000, maxKeys = 10_000, now = Date.now, autoCleanup = false } = {}) {
  if (![limit, windowMs, maxKeys].every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError('Invalid rate limit options');
  const keys = new Map<string, number[]>();
  let cleanup: NodeJS.Timeout | undefined;
  function pruneExpired(cutoff: number) {
    for (const [key, attempts] of keys) {
      if ((attempts.at(-1) ?? 0) <= cutoff) keys.delete(key);
    }
  }
  function scheduleCleanup() {
    if (!autoCleanup || cleanup || !keys.size) return;
    cleanup = setTimeout(() => {
      cleanup = undefined;
      pruneExpired(now() - windowMs);
      scheduleCleanup();
    }, windowMs).unref();
  }
  function consume(key: string): { allowed: boolean; remaining: number; retryAfter: number } {
    const time = now();
    const cutoff = time - windowMs;
    let times = keys.get(key)?.filter(value => value > cutoff);
    if (!times && keys.size >= maxKeys) {
      pruneExpired(cutoff);
      if (keys.size >= maxKeys) return { allowed: false, remaining: 0, retryAfter: Math.ceil(windowMs / 1000) };
    }
    times ??= [];
    if (times.length >= limit) return { allowed: false, remaining: 0, retryAfter: Math.ceil(((times[0] ?? time) + windowMs - time) / 1000) };
    times.push(time);
    keys.set(key, times);
    scheduleCleanup();
    return { allowed: true, remaining: limit - times.length, retryAfter: 0 };
  }
  return {
    consume,
    reserve(key: string) {
      if (!consume(key).allowed) return null;
      const times = keys.get(key);
      return () => {
        // An earlier update failure must leave a newer reservation intact.
        if (!times || keys.get(key) !== times) return;
        if (times.length === 1) keys.delete(key);
        else keys.set(key, times.slice(0, -1));
      };
    },
  };
}
